/**
 * Playwright-driven Familywall crawler. Logs in once with the provided
 * credentials, walks every recipe in the user's recipebox by clicking
 * each entry in the master-detail list, and yields a SNAPSHOT for each
 * (the raw `#recipeDetail` HTML + the recipe image bytes).
 *
 * The crawler is intentionally dumb about parsing — that happens later,
 * offline, against the cached snapshots (see parse-snapshot.ts). Keeping
 * the network step purely about fetching means we can iterate the parser
 * without re-hitting Familywall.
 *
 * DOM structure (verified 2026-05-19 against www.familywall.com):
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
 *   - The list panel lazy-renders rows as `<div class="main flexcol">`
 *     scrolls. We scroll to the bottom up-front so the locator returns
 *     every card.
 *
 * - Detail pane (`#recipeDetail`):
 *   - Title: `<flexauto class="h1 line">`
 *   - Image: `.mp-recipe-header-imgcontainer img` (served from api.familywall.com)
 *   - Other content described in extract.ts.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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

const FAMILYWALL_BASE = "https://www.familywall.com";
const FAMILYWALL_LOGIN_URL = `${FAMILYWALL_BASE}/fw2_signin.php`;
const FAMILYWALL_RECIPES_URL = `${FAMILYWALL_BASE}/recipebox.php`;

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
 * Returns `{ id, title }` for every visible recipe in the list, after
 * applying any `--recipe-id` / `--title` filters.
 */
async function collectRecipes(
  page: Page,
  options: CrawlOptions,
  debug: boolean,
): Promise<Array<{ id: string; title: string }>> {
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
  let result = all.filter((r) => r.id.length > 0);

  if (options.onlyRecipeId) {
    const target = options.onlyRecipeId.startsWith("recipe/")
      ? options.onlyRecipeId
      : `recipe/${options.onlyRecipeId}`;
    result = result.filter((r) => r.id === target);
    if (result.length === 0) {
      console.warn(`[familywall] no recipe matched --recipe-id ${target}`);
    } else if (debug) {
      console.log(`[familywall] --recipe-id matched: ${target}`);
    }
  } else if (options.onlyTitleSubstring) {
    const needle = options.onlyTitleSubstring.toLowerCase();
    result = result.filter((r) => r.title.toLowerCase().includes(needle));
    if (result.length === 0) {
      console.warn(
        `[familywall] no recipe titles contained "${options.onlyTitleSubstring}"`,
      );
    } else if (debug) {
      console.log(`[familywall] --title matched ${result.length} recipe(s)`);
    }
  }

  return result;
}

export type CapturedSnapshot = {
  id: string;
  title: string;
  /** outerHTML of `#recipeDetail` as a string. */
  detailHtml: string;
  imageBytes: Buffer | null;
  imageExt: string | null;
};

/**
 * Captures the raw HTML of `#recipeDetail` plus the recipe image bytes
 * (fetched via the authenticated browser context). Returns null if the
 * detail pane is empty or has no title.
 */
async function captureDetailSnapshot(
  page: Page,
  ctx: BrowserContext,
  id: string,
): Promise<CapturedSnapshot | null> {
  const captured = await page.evaluate(() => {
    const detail = document.getElementById("recipeDetail");
    if (!detail) return null;
    const titleEl = detail.querySelector(".h1.line, flexauto.h1, .h1");
    const title = (titleEl?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!title) return null;
    const imgEl = detail.querySelector(
      ".mp-recipe-header-imgcontainer img",
    ) as HTMLImageElement | null;
    return {
      title,
      detailHtml: detail.outerHTML,
      imageUrl: imgEl?.src || null,
    };
  });
  if (!captured) return null;

  let imageBytes: Buffer | null = null;
  let imageExt: string | null = null;
  if (captured.imageUrl) {
    try {
      const res = await ctx.request.get(captured.imageUrl);
      if (res.ok()) {
        imageBytes = Buffer.from(await res.body());
        imageExt = pickImageExtension(
          res.headers()["content-type"] ?? "",
          captured.imageUrl,
        );
      }
    } catch {
      // Image failures are non-fatal — the snapshot still saves without it.
    }
  }

  return {
    id,
    title: captured.title,
    detailHtml: captured.detailHtml,
    imageBytes,
    imageExt,
  };
}

function pickImageExtension(contentType: string, url: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  // Fall back to URL extension if the response didn't pin one down.
  const m = /\.([a-z]{3,4})(?:\?|$)/i.exec(url);
  return m ? m[1].toLowerCase() : "jpg";
}

async function* iterSnapshots(
  page: Page,
  ctx: BrowserContext,
  options: CrawlOptions,
  recipes: Array<{ id: string; title: string }>,
  limit: number | undefined,
  pageTimeoutMs: number,
  debug: boolean,
): AsyncGenerator<CapturedSnapshot | null> {
  const n = limit ? Math.min(limit, recipes.length) : recipes.length;
  if (debug) {
    console.log(`[familywall] iterating ${n} of ${recipes.length} recipes`);
  }

  for (let i = 0; i < n; i++) {
    const recipe = recipes[i];
    try {
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
          return t ? (t.textContent ?? "").trim() : "";
        })
        .catch(() => "");

      const clicked = await page.evaluate((id) => {
        const card = document.querySelector(
          `.mp-recipe-list .mp-recipe[data-fw-meta-id="${id}"]`,
        ) as HTMLElement | null;
        if (!card) return false;
        card.scrollIntoView({ block: "center" });
        card.click();
        return true;
      }, recipe.id);

      if (!clicked) {
        if (debug) {
          console.log(`[familywall] #${i} (${recipe.id}) card missing`);
        }
        await ensureOnRecipeList(page, options, debug);
        yield null;
        continue;
      }

      await page
        .waitForFunction(
          ({ id, prev }) => {
            const search = decodeURIComponent(location.search);
            if (!search.includes(`id=${id}`)) return false;
            const t = document
              .getElementById("recipeDetail")
              ?.querySelector(".h1.line, .h1");
            const cur = t ? (t.textContent ?? "").trim() : "";
            return cur.length > 0 && cur !== prev;
          },
          { id: recipe.id, prev: titleBefore },
          { timeout: pageTimeoutMs },
        )
        .catch(() => {});
      await delay(POLITE_DELAY_MS);
      const snapshot = await captureDetailSnapshot(page, ctx, recipe.id);
      yield snapshot;
    } catch (e) {
      if (debug) {
        console.log(`[familywall] #${i} (${recipe.id}) failed: ${e}`);
      }
      await ensureOnRecipeList(page, options, debug).catch(() => {});
      yield null;
    }
  }
}

export type CrawlSink = (
  snapshot: CapturedSnapshot,
  helpers: { ctx: BrowserContext },
) => Promise<void> | void;

/**
 * Drive a Playwright session through Familywall, calling `sink` with each
 * captured snapshot. The sink is responsible for writing to the cache (or
 * doing whatever else with the snapshot) — the crawler itself is purely
 * about fetching. Returns the total number of recipes that were walked
 * (counting nulls), plus the IDs that were successfully captured (so the
 * caller can build a cache index).
 */
export async function withFamilywallCrawler(
  options: CrawlOptions,
  sink: CrawlSink,
  onProgress?: (info: { total: number; current: number }) => void,
): Promise<{
  total: number;
  capturedRecipes: Array<{ id: string; title: string }>;
}> {
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
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    const page = await ctx.newPage();
    await login(page, options.email, options.password);
    await gotoRecipeList(page, debug);

    const recipes = await collectRecipes(page, options, debug);
    const cap = options.limit ? Math.min(options.limit, recipes.length) : recipes.length;
    const capturedRecipes: Array<{ id: string; title: string }> = [];
    let current = 0;
    for await (const snapshot of iterSnapshots(
      page,
      ctx,
      options,
      recipes,
      options.limit,
      pageTimeoutMs,
      debug,
    )) {
      current += 1;
      onProgress?.({ total: cap, current });
      if (!snapshot) continue;
      await sink(snapshot, { ctx });
      capturedRecipes.push({ id: snapshot.id, title: snapshot.title });
      await delay(POLITE_DELAY_MS);
    }
    return { total: cap, capturedRecipes };
  } finally {
    await browser.close();
  }
}
