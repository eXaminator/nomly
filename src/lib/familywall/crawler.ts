/**
 * Playwright-driven Familywall crawler. Logs in once with the provided
 * credentials, walks every recipe in the user's recipebox by clicking
 * each entry in the master-detail list, and yields one
 * {@link FamilywallRawRecipe} per recipe.
 *
 * The yielded objects are raw strings; pure-function normalisation
 * happens in {@link transformFamilywallRecipe}.
 *
 * DOM structure (verified 2026-05-18 against www.familywall.com):
 *
 * - Login page: https://www.familywall.com/fw2_signin.php
 *   - email input `#identifier` (name="a00identifier")
 *   - password input `name="a00password"`
 *   - submit button text "Anmelden"
 *   - OneTrust cookie banner overlays the form on first visit.
 *
 * - Recipe list: https://www.familywall.com/recipebox.php
 *   - Master-detail SPA. Recipes are `<flexrow class="border-pane mp-recipe">`
 *     elements inside `<flexcol class="mp-recipe-list">`. There are no `<a>`
 *     hrefs; clicking sets the URL to `?id=recipe%2F<id>` and renders the
 *     detail in the right pane (`#recipeDetail`).
 *   - All recipes are loaded into the DOM up front — no pagination/scroll.
 *
 * - Detail pane (`#recipeDetail`):
 *   - Title: `<flexauto class="h1 line">`
 *   - Image: `.mp-recipe-header-imgcontainer img` (served from api.familywall.com)
 *   - Metadata table: `<table class="mp-recipe-times">` with rows of
 *     `<td class="recipe-field-name">label</td><td>value</td>`. Labels are
 *     localised — German ("Zubereitungszeit", "Kochzeit", "Portionen",
 *     "Ansehen auf") or English. The "Ansehen auf"/"View on" row contains
 *     the original source URL as an `<a href>`.
 *   - Description / Zutaten / Anweisungen sections: each is a
 *     `<flexauto class="border-pane">` (or `<div class="border-pane">`)
 *     containing a `<p>` heading with the section name and one or more
 *     content children (a `<p>` for description, a `<ul>` for ingredients,
 *     a `<p>` or `<ol>` for instructions). Each section also contains a
 *     `<div class="rb-button">` add-button which we filter out.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { FamilywallRawRecipe } from "./types.ts";

const FAMILYWALL_BASE = "https://www.familywall.com";
const FAMILYWALL_LOGIN_URL = `${FAMILYWALL_BASE}/fw2_signin.php`;
const FAMILYWALL_RECIPES_URL = `${FAMILYWALL_BASE}/recipebox.php`;

export type CrawlOptions = {
  email: string;
  password: string;
  headed?: boolean;
  limit?: number;
  pageTimeoutMs?: number;
  /** Emit structural diagnostics. */
  debug?: boolean;
  /**
   * When set, restrict the import to a single recipe matched by its
   * Familywall `data-fw-meta-id` (e.g. "recipe/8084800_2230040", or just
   * "8084800_2230040" — we prepend "recipe/" if missing).
   */
  onlyRecipeId?: string;
  /**
   * When set, restrict the import to recipes whose title contains this
   * substring (case-insensitive). Ignored if `onlyRecipeId` is also set.
   */
  onlyTitleSubstring?: string;
};

export type CrawlSink = (recipe: FamilywallRawRecipe) => Promise<void> | void;

const POLITE_DELAY_MS = 500;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function firstVisible(page: Page, candidates: string[]) {
  for (const sel of candidates) {
    const locator = page.locator(sel).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function waitForFirstVisible(
  page: Page,
  candidates: string[],
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await firstVisible(page, candidates);
    if (found) return found;
    await delay(200);
  }
  return null;
}

async function dismissConsent(page: Page) {
  const buttons = [
    "#onetrust-accept-btn-handler",
    "button:has-text('Alle akzeptieren')",
    "button:has-text('Accept all')",
    "button:has-text('Accept All Cookies')",
  ];
  const btn = await firstVisible(page, buttons);
  if (btn) {
    await btn.click().catch(() => {});
    await delay(300);
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto(FAMILYWALL_LOGIN_URL, { waitUntil: "domcontentloaded" });
  await dismissConsent(page);
  const emailField = await waitForFirstVisible(
    page,
    ["#identifier", "input[name='a00identifier']", "input[type=email]"],
    15_000,
  );
  const pwField = await waitForFirstVisible(
    page,
    ["input[name='a00password']", "input[type=password]"],
    15_000,
  );
  if (!emailField || !pwField) {
    throw new Error(
      `Login form not found on ${FAMILYWALL_LOGIN_URL} — Familywall's layout may have changed.`,
    );
  }
  await emailField.fill(email);
  await pwField.fill(password);
  const submit = await firstVisible(page, [
    "button[type=submit]",
    "input[type=submit]",
    "button:has-text('Anmelden')",
    "button:has-text('Sign in')",
  ]);
  // Fire the submit then poll the URL ourselves — `page.waitForURL` waits
  // for the `load` event by default and Familywall's redirect chain
  // (signin → home → …) doesn't always settle cleanly within the budget.
  // Polling is cheap and dodges the "load never fired" timeout.
  if (submit) {
    await submit.click().catch(() => {});
  } else {
    await pwField.press("Enter").catch(() => {});
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (!url.includes("fw2_signin.php") && !url.includes("about:blank")) {
      break;
    }
    await delay(300);
  }
  if (page.url().includes("fw2_signin.php")) {
    throw new Error(
      "Login did not redirect off /fw2_signin.php — check credentials or a CAPTCHA may have appeared (try --headed).",
    );
  }
}

async function gotoRecipeList(page: Page, debug: boolean) {
  await page.goto(FAMILYWALL_RECIPES_URL, { waitUntil: "domcontentloaded" });
  await page
    .waitForSelector(".mp-recipe-list .mp-recipe", { timeout: 20_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});

  // The recipe list lives inside a vertically-scrolling `<div class="main
  // flexcol">` panel that progressively renders more rows. Scroll until
  // the visible count is stable across three consecutive checks with a
  // generous beat — Familywall has been observed to need >1 s to render
  // late additions in headless mode.
  let stable = 0;
  let previous = -1;
  let iterations = 0;
  while (stable < 3 && iterations < 40) {
    iterations += 1;
    const count = await page.locator(".mp-recipe-list .mp-recipe").count();
    if (count === previous) {
      stable += 1;
    } else {
      stable = 0;
      previous = count;
      if (debug) console.log(`[familywall] scroll: visible=${count}`);
    }
    await page
      .evaluate(() => {
        const scrollEl =
          (document.querySelector(".main.flexcol") as HTMLElement | null) ??
          document.scrollingElement;
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      })
      .catch(() => {});
    await delay(1000);
  }

  // Scroll back to top so the first .mp-recipe is in view and the first
  // click in iterRecipes lands on the right card.
  await page
    .evaluate(() => {
      const scrollEl =
        (document.querySelector(".main.flexcol") as HTMLElement | null) ??
        document.scrollingElement;
      if (scrollEl) scrollEl.scrollTop = 0;
    })
    .catch(() => {});

  if (debug) {
    const stats = await page.evaluate(() => ({
      url: location.href,
      recipeCount: document.querySelectorAll(".mp-recipe").length,
      hasDetailPane: !!document.getElementById("recipeDetail"),
    }));
    console.log("[familywall] recipe list:", JSON.stringify(stats));
  }
}

/**
 * Extracts the recipe currently rendered in `#recipeDetail` into a raw
 * payload. Returns null if the detail pane is empty or has no title.
 *
 * Runs entirely inside the page context — all parsing happens in
 * `page.evaluate` so we don't pay round-trip costs per field.
 */
async function extractCurrentDetail(
  page: Page,
): Promise<FamilywallRawRecipe | null> {
  return page.evaluate(() => {
    const detail = document.getElementById("recipeDetail");
    if (!detail) return null;

    const titleEl = detail.querySelector(
      ".h1.line, flexauto.h1, .h1",
    ) as HTMLElement | null;
    const title = titleEl ? titleEl.innerText.replace(/\s+/g, " ").trim() : "";
    if (!title) return null;

    const imgEl = detail.querySelector(
      ".mp-recipe-header-imgcontainer img",
    ) as HTMLImageElement | null;
    const imageUrl = imgEl?.src || null;

    // Favorite ("bester Moment") — the heart icon's title swaps between
    // "Als bester Moment gekennzeichnet" (marked) and "Mir gefällt dieser
    // Post" (unmarked), so the title text alone tells us the state.
    let isFavorite = false;
    for (const icon of Array.from(detail.querySelectorAll("icon"))) {
      const t = icon.getAttribute("title") || "";
      if (
        t === "Als bester Moment gekennzeichnet" ||
        t === "Marked as best moment"
      ) {
        isFavorite = true;
        break;
      }
    }

    // Category chips become tags. Familywall prefixes each with an emoji
    // (e.g. "🍚 Reis"); strip leading emoji + whitespace so the resulting
    // tags match plain user-created ones.
    const tags = Array.from(detail.querySelectorAll(".mp-category"))
      .map((el) => (el as HTMLElement).innerText.replace(/\s+/g, " ").trim())
      .map((t) =>
        t
          .replace(
            /^[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]+\s*/u,
            "",
          )
          .trim(),
      )
      .filter((t) => t.length > 0);

    function parseMins(t: string): number | null {
      const trimmed = t.replace(/\s+/g, " ").trim();
      if (!trimmed) return null;
      const hMatch = /(\d+)\s*h/i.exec(trimmed);
      const mMatch = /(\d+)\s*(?:mins?|min\.?|Min(?:uten)?)/i.exec(trimmed);
      const h = hMatch ? parseInt(hMatch[1], 10) : 0;
      const m = mMatch ? parseInt(mMatch[1], 10) : 0;
      if (h === 0 && m === 0) {
        const justNum = /^(\d+)$/.exec(trimmed);
        return justNum ? parseInt(justNum[1], 10) : null;
      }
      return h * 60 + m;
    }

    let prepTimeMin: number | null = null;
    let cookTimeMin: number | null = null;
    let servings: number | null = null;
    let sourceUrl: string | null = null;

    const PREP_LABELS = new Set([
      "Zubereitungszeit",
      "Vorbereitungszeit",
      "Prep time",
      "Preparation time",
    ]);
    const COOK_LABELS = new Set(["Kochzeit", "Cook time", "Cooking time"]);
    const SERVING_LABELS = new Set([
      "Portionen",
      "Servings",
      "Portions",
      "Personen",
    ]);
    const SOURCE_LABELS = new Set([
      "Ansehen auf",
      "View on",
      "Source",
      "Quelle",
    ]);

    const timesTable = detail.querySelector(".mp-recipe-times");
    if (timesTable) {
      for (const row of Array.from(timesTable.querySelectorAll("tr"))) {
        const cells = Array.from(row.querySelectorAll("td"));
        const labelCell = cells.find((c) =>
          c.classList.contains("recipe-field-name"),
        );
        if (!labelCell) continue;
        const valueCell = labelCell.nextElementSibling as HTMLElement | null;
        if (!valueCell) continue;
        const label = (labelCell as HTMLElement).innerText
          .replace(/\s+/g, " ")
          .trim();
        const valueText = valueCell.innerText.replace(/\s+/g, " ").trim();
        if (PREP_LABELS.has(label)) {
          prepTimeMin = parseMins(valueText);
        } else if (COOK_LABELS.has(label)) {
          cookTimeMin = parseMins(valueText);
        } else if (SERVING_LABELS.has(label)) {
          const n = /(\d+)/.exec(valueText);
          servings = n ? parseInt(n[1], 10) : null;
        } else if (SOURCE_LABELS.has(label)) {
          const link = valueCell.querySelector("a") as HTMLAnchorElement | null;
          if (link?.href) sourceUrl = link.href;
        }
      }
    }

    /**
     * Each section ("Beschreibung", "Zutaten", "Anweisungen") is a
     * <p>-headed child of a border-pane container. Returns the content
     * children minus the heading and any "add" buttons.
     */
    function sectionContent(headingTexts: string[]): Element[] {
      for (const ht of headingTexts) {
        const heading = Array.from(detail!.querySelectorAll("p")).find(
          (p) => p.textContent?.replace(/\s+/g, " ").trim() === ht,
        );
        if (!heading) continue;
        const container = heading.parentElement;
        if (!container) continue;
        return Array.from(container.children).filter(
          (c) =>
            c !== heading &&
            !c.classList.contains("rb-button") &&
            !c.classList.contains("mp-button-like"),
        );
      }
      return [];
    }

    const descParts = sectionContent(["Beschreibung", "Description"])
      .map((el) => (el as HTMLElement).innerText.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const description = descParts.length ? descParts.join("\n\n") : null;

    function listItemsFrom(els: Element[]): string[] {
      const out: string[] = [];
      for (const el of els) {
        if (el.tagName === "UL" || el.tagName === "OL") {
          for (const li of Array.from(el.querySelectorAll("li"))) {
            const t = (li as HTMLElement).innerText
              .replace(/\s+/g, " ")
              .trim();
            if (t) out.push(t);
          }
        } else {
          // Some recipes free-text the section. Split by newlines so we
          // don't lose multi-line content.
          const raw = (el as HTMLElement).innerText;
          for (const line of raw.split(/\r?\n/)) {
            const t = line.replace(/\s+/g, " ").trim();
            if (t) out.push(t);
          }
        }
      }
      return out;
    }

    const ingredients = listItemsFrom(
      sectionContent(["Zutaten", "Ingredients"]),
    );
    const instructions = listItemsFrom(
      sectionContent(["Anweisungen", "Zubereitung", "Instructions", "Steps"]),
    );

    return {
      title,
      description,
      servings,
      prepTimeMin,
      cookTimeMin,
      ingredients,
      instructions,
      imageUrl,
      sourceUrl,
      isFavorite,
      tags,
    };
  });
}

/**
 * Walks every recipe in the user's recipebox. Sequential by design: each
 * iteration clicks one `.mp-recipe` row, waits for `#recipeDetail` to
 * re-render, then extracts the detail.
 */
/**
 * Best-effort recovery: if the page is no longer on the recipe list
 * (session timed out, accidental navigation, …) bring it back. Returns
 * true if we end up on a working recipebox page.
 */
async function ensureOnRecipeList(
  page: Page,
  options: CrawlOptions,
  debug: boolean,
): Promise<boolean> {
  let url = "";
  try {
    url = page.url();
  } catch {
    // Detached page — let goto re-create it.
  }
  if (url.includes("recipebox.php") && !url.includes("noautologin")) {
    return true;
  }
  if (debug) console.log(`[familywall] recovering session (at ${url})`);
  try {
    if (url.includes("noautologin") || url.includes("fw2_signin")) {
      await login(page, options.email, options.password);
    }
    await gotoRecipeList(page, debug);
    return true;
  } catch (e) {
    if (debug) console.log(`[familywall] recovery failed: ${e}`);
    return false;
  }
}

/**
 * Read all recipe (id, title) pairs from the rendered list, then apply
 * any --recipe-id / --title filters. Returns the IDs to iterate.
 */
async function collectRecipeIds(
  page: Page,
  options: CrawlOptions,
  debug: boolean,
): Promise<string[]> {
  const all = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(".mp-recipe-list .mp-recipe[data-fw-meta-id]"),
    ).map((el) => ({
      id: el.getAttribute("data-fw-meta-id") ?? "",
      title:
        el
          .querySelector("line")
          ?.textContent?.replace(/\s+/g, " ")
          .trim() ?? "",
    })),
  );
  let ids = all.map((r) => r.id).filter((id) => id.length > 0);

  if (options.onlyRecipeId) {
    const target = options.onlyRecipeId.startsWith("recipe/")
      ? options.onlyRecipeId
      : `recipe/${options.onlyRecipeId}`;
    ids = ids.filter((id) => id === target);
    if (ids.length === 0) {
      console.warn(`[familywall] no recipe matched --recipe-id ${target}`);
    } else if (debug) {
      console.log(`[familywall] --recipe-id matched: ${target}`);
    }
  } else if (options.onlyTitleSubstring) {
    const needle = options.onlyTitleSubstring.toLowerCase();
    const matching = new Set(
      all
        .filter((r) => r.title.toLowerCase().includes(needle))
        .map((r) => r.id),
    );
    ids = ids.filter((id) => matching.has(id));
    if (ids.length === 0) {
      console.warn(
        `[familywall] no recipe titles contained "${options.onlyTitleSubstring}"`,
      );
    } else if (debug) {
      console.log(`[familywall] --title matched ${ids.length} recipe(s)`);
    }
  }

  return ids;
}

async function* iterRecipes(
  page: Page,
  options: CrawlOptions,
  recipeIds: string[],
  limit: number | undefined,
  pageTimeoutMs: number,
  debug: boolean,
): AsyncGenerator<FamilywallRawRecipe | null> {
  const n = limit ? Math.min(limit, recipeIds.length) : recipeIds.length;
  if (debug) {
    console.log(
      `[familywall] iterating ${n} of ${recipeIds.length} recipe ids`,
    );
  }

  for (let i = 0; i < n; i++) {
    const recipeId = recipeIds[i];
    try {
      // If we drifted off the recipe list (session timed out, unexpected
      // redirect), recover before trying to click the next card. Doing
      // this at the top of each iteration means a single bad recipe
      // doesn't take down the rest of the run.
      const currentUrl = page.url();
      if (!currentUrl.includes("recipebox.php") || currentUrl.includes("noautologin")) {
        const ok = await ensureOnRecipeList(page, options, debug);
        if (!ok) {
          yield null;
          continue;
        }
      }

      const titleBefore = await page
        .evaluate(() => {
          const t = document
            .getElementById("recipeDetail")
            ?.querySelector(".h1.line, .h1");
          return t ? (t as HTMLElement).innerText.trim() : "";
        })
        .catch(() => "");

      // Click the card by attribute selector so we don't rely on indexed
      // locators that may have shifted. scrollIntoView happens inside the
      // page context — works for off-screen tail elements that
      // Playwright's actionability checks sometimes refuse to scroll to.
      const clicked = await page.evaluate((id) => {
        const card = document.querySelector(
          `.mp-recipe-list .mp-recipe[data-fw-meta-id="${id}"]`,
        ) as HTMLElement | null;
        if (!card) return false;
        card.scrollIntoView({ block: "center" });
        card.click();
        return true;
      }, recipeId);

      if (!clicked) {
        if (debug) {
          console.log(`[familywall] recipe #${i} (${recipeId}) card missing`);
        }
        // Card missing usually means the page drifted — try to recover so
        // the next iteration has a chance.
        await ensureOnRecipeList(page, options, debug);
        yield null;
        continue;
      }

      // Wait until the URL reflects this recipe's id AND the detail title
      // has actually changed (so we don't extract the previous recipe).
      await page
        .waitForFunction(
          ({ id, prev }) => {
            const search = decodeURIComponent(location.search);
            if (!search.includes(`id=${id}`)) return false;
            const t = document
              .getElementById("recipeDetail")
              ?.querySelector(".h1.line, .h1");
            const cur = t ? (t as HTMLElement).innerText.trim() : "";
            return cur.length > 0 && cur !== prev;
          },
          { id: recipeId, prev: titleBefore },
          { timeout: pageTimeoutMs },
        )
        .catch(() => {});
      await delay(POLITE_DELAY_MS);
      const raw = await extractCurrentDetail(page);
      yield raw;
    } catch (e) {
      if (debug) {
        console.log(`[familywall] recipe #${i} (${recipeId}) failed: ${e}`);
      }
      // Most likely a navigation-destroyed-execution-context error. Try
      // to recover so the rest of the queue can still run.
      await ensureOnRecipeList(page, options, debug).catch(() => {});
      yield null;
    }
  }
}

/**
 * Fetch the bytes of an image using the same authenticated context as the
 * crawl. Returns null on any failure — the orchestrator just stores a
 * null `photoPath` in that case.
 */
export async function fetchImageWithContext(
  ctx: BrowserContext,
  imgUrl: string,
): Promise<Buffer | null> {
  try {
    const res = await ctx.request.get(imgUrl);
    if (!res.ok()) return null;
    return Buffer.from(await res.body());
  } catch {
    return null;
  }
}

export async function withFamilywallCrawler(
  options: CrawlOptions,
  sink: (
    recipe: FamilywallRawRecipe,
    helpers: { ctx: BrowserContext },
  ) => Promise<void>,
  onProgress?: (info: { total: number; current: number }) => void,
): Promise<{ total: number }> {
  const pageTimeoutMs = options.pageTimeoutMs ?? 30_000;
  const debug = options.debug === true;
  const browser: Browser = await chromium.launch({
    headless: options.headed !== true,
  });
  try {
    const ctx = await browser.newContext({
      locale: "de-DE",
      viewport: { width: 1280, height: 900 },
      // Familywall serves a slightly smaller recipe list to HeadlessChrome —
      // we were missing ~2 recipes at the end of the alphabet. Spoof a real
      // Chrome user-agent and hide the webdriver flag.
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    await ctx.addInitScript(() => {
      // navigator.webdriver = true is the most common headless tell.
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    const page = await ctx.newPage();
    await login(page, options.email, options.password);
    await gotoRecipeList(page, debug);

    // Resolve the queue once (applies --recipe-id / --title filters) so
    // the iterator and the progress total agree on what's being walked.
    const recipeIds = await collectRecipeIds(page, options, debug);
    const total = recipeIds.length;
    const cap = options.limit ? Math.min(options.limit, total) : total;
    let current = 0;
    for await (const recipe of iterRecipes(
      page,
      options,
      recipeIds,
      options.limit,
      pageTimeoutMs,
      debug,
    )) {
      current += 1;
      onProgress?.({ total: cap, current });
      if (!recipe) continue;
      await sink(recipe, { ctx });
      await delay(POLITE_DELAY_MS);
    }
    return { total: cap };
  } finally {
    await browser.close();
  }
}
