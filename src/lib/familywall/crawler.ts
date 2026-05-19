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
  await Promise.all([
    page.waitForURL((url) => !url.toString().includes("fw2_signin.php"), {
      timeout: 60_000,
    }),
    submit ? submit.click() : pwField.press("Enter"),
  ]);
}

async function gotoRecipeList(page: Page, debug: boolean) {
  await page.goto(FAMILYWALL_RECIPES_URL, { waitUntil: "domcontentloaded" });
  await page
    .waitForSelector(".mp-recipe-list .mp-recipe", { timeout: 20_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});

  // The recipe list lives inside a vertically-scrolling `<div class="main
  // flexcol">` panel and progressively renders more rows as you scroll
  // toward the bottom. Without this nudge a handful of recipes at the very
  // end of the alphabet were missed. Scroll repeatedly until the visible
  // count is stable across two consecutive checks.
  let stable = 0;
  let previous = -1;
  while (stable < 2) {
    const count = await page.locator(".mp-recipe-list .mp-recipe").count();
    if (count === previous) {
      stable += 1;
    } else {
      stable = 0;
      previous = count;
    }
    await page
      .evaluate(() => {
        const scrollEl =
          (document.querySelector(".main.flexcol") as HTMLElement | null) ??
          document.scrollingElement;
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      })
      .catch(() => {});
    await delay(POLITE_DELAY_MS);
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
async function* iterRecipes(
  page: Page,
  limit: number | undefined,
  pageTimeoutMs: number,
  debug: boolean,
): AsyncGenerator<FamilywallRawRecipe | null> {
  const cards = page.locator(".mp-recipe-list .mp-recipe");
  const count = await cards.count();
  const n = limit ? Math.min(limit, count) : count;
  if (debug) {
    console.log(`[familywall] iterating ${n} of ${count} recipes`);
  }
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    try {
      await card.scrollIntoViewIfNeeded({ timeout: pageTimeoutMs });
      const titleBefore = await page
        .evaluate(() => {
          const t = document
            .getElementById("recipeDetail")
            ?.querySelector(".h1.line, .h1");
          return t ? (t as HTMLElement).innerText.trim() : "";
        })
        .catch(() => "");
      await card.click({ timeout: pageTimeoutMs });
      // Wait for the URL to switch to this recipe AND the title in the
      // detail pane to change from the previous one. Recipes with the same
      // title are rare; if they happen we just wait the budget out.
      await page
        .waitForFunction(
          (prev) => {
            const u = location.search;
            if (!u.includes("id=recipe")) return false;
            const t = document
              .getElementById("recipeDetail")
              ?.querySelector(".h1.line, .h1");
            const cur = t ? (t as HTMLElement).innerText.trim() : "";
            return cur.length > 0 && cur !== prev;
          },
          titleBefore,
          { timeout: pageTimeoutMs },
        )
        .catch(() => {});
      // Give the image + content a moment to settle.
      await delay(POLITE_DELAY_MS);
      const raw = await extractCurrentDetail(page);
      yield raw;
    } catch (e) {
      if (debug) console.log(`[familywall] recipe #${i} failed: ${e}`);
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
    });
    const page = await ctx.newPage();
    await login(page, options.email, options.password);
    await gotoRecipeList(page, debug);

    const total = await page.locator(".mp-recipe-list .mp-recipe").count();
    const cap = options.limit ? Math.min(options.limit, total) : total;
    let current = 0;
    for await (const recipe of iterRecipes(
      page,
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
