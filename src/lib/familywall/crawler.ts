/**
 * Playwright-driven Familywall crawler. Logs in once with the provided
 * credentials, enumerates recipes, and yields one {@link FamilywallRawRecipe}
 * per recipe. Selectors live here — they're the part that will need
 * iteration against the real DOM (the user runs `--headed --limit 1
 * --dry-run` first to verify).
 *
 * The yielded objects are still raw strings; pure-function normalisation
 * happens in {@link transformFamilywallRecipe}.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { FamilywallRawRecipe } from "./types.ts";

const FAMILYWALL_BASE = "https://www.familywall.com";
const FAMILYWALL_LOGIN_URL = `${FAMILYWALL_BASE}/fw2_signin.php`;
/** Best guess for the post-login recipes index. If the user's account
 *  redirects this to the home page we fall back to clicking a recipes-nav
 *  link from wherever the post-login redirect dropped us. */
const FAMILYWALL_RECIPES_URL = `${FAMILYWALL_BASE}/fw2_recipes.php`;

export type CrawlOptions = {
  email: string;
  password: string;
  headed?: boolean;
  /** Cap the number of recipes processed (handy for first runs). */
  limit?: number;
  /** Override the base URL — useful if the user's deployment differs. */
  baseUrl?: string;
  /** Per-page navigation timeout. Default 30 s. */
  pageTimeoutMs?: number;
};

export type CrawlSink = (recipe: FamilywallRawRecipe) => Promise<void> | void;

const POLITE_DELAY_MS = 500;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Locator candidates tried in order until one is visible. Familywall's
 * markup changes over time and varies by locale; keeping a small fallback
 * list here means a small breakage doesn't kill the whole crawl. The user
 * will inevitably need to refine these once they run the script against
 * the live site.
 */
const SELECTORS = {
  // Verified against https://www.familywall.com/fw2_signin.php on 2026-05-18:
  // <input id="identifier" name="a00identifier"> for email,
  // <input name="a00password"> for password,
  // submit button with text "Anmelden".
  loginEmail: [
    "#identifier",
    "input[name='a00identifier']",
    "input[type=email]",
  ],
  loginPassword: [
    "input[name='a00password']",
    "input[type=password]",
  ],
  loginSubmit: [
    "button[type=submit]",
    "input[type=submit]",
    "button:has-text('Anmelden')",
    "button:has-text('Sign in')",
  ],
  /** Anything reachable from the post-login nav that talks about recipes.
   *  We try links with `fw2_recipes`-style hrefs first, then fall back to
   *  text-based matches. */
  recipesNav: [
    "a[href*='fw2_recipes']",
    "a[href*='recipes']",
    "a[href*='rezept']",
    "nav a:has-text('Rezepte')",
    "nav a:has-text('Recipes')",
    "a:has-text('Rezepte')",
    "a:has-text('Recipes')",
  ],
  // Selectors below are still best-effort guesses until we see the real
  // post-login DOM. The orchestrator surfaces failures per-recipe so a
  // mismatch here doesn't tank the whole run.
  recipeCard: [
    "a[href*='fw2_recipe.php']",
    "a[href*='recipe/']",
    "[data-testid='recipe-card']",
  ],
  recipeTitle: ["h1", "[data-testid='recipe-title']"],
  recipeDescription: ["[data-testid='recipe-description']", ".recipe-description"],
  recipeServings: ["[data-testid='recipe-servings']", ".recipe-servings"],
  recipeIngredients: [
    "[data-testid='recipe-ingredient']",
    ".recipe-ingredient",
    "ul.ingredients li",
  ],
  recipeInstructions: [
    "[data-testid='recipe-step']",
    ".recipe-step",
    "ol.instructions li",
  ],
  recipeImage: ["img.recipe-photo", "[data-testid='recipe-photo'] img", "main img"],
  recipeSourceLink: [
    "a[data-testid='recipe-source']",
    "a.recipe-source",
    "a:has-text('Quelle')",
    "a:has-text('Source')",
  ],
};

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
  // Race every candidate against the timeout — whichever shows up first wins.
  // Playwright's `or()` would also work, but we want per-attempt logging.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await firstVisible(page, candidates);
    if (found) return found;
    await delay(200);
  }
  return null;
}

async function firstExisting(page: Page, candidates: string[]) {
  for (const sel of candidates) {
    const locator = page.locator(sel).first();
    if ((await locator.count()) > 0) return locator;
  }
  return null;
}

/**
 * Familywall ships OneTrust's cookie banner; in a fresh browser context
 * it overlays the form. We click "Accept all" if present, then carry on.
 * No-op if the banner isn't there.
 */
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
    // The OneTrust SDK animates out; give it a beat so the form is clickable.
    await delay(300);
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto(FAMILYWALL_LOGIN_URL, { waitUntil: "domcontentloaded" });
  await dismissConsent(page);
  const emailField = await waitForFirstVisible(page, SELECTORS.loginEmail, 15_000);
  const pwField = await waitForFirstVisible(page, SELECTORS.loginPassword, 15_000);
  if (!emailField || !pwField) {
    throw new Error(
      "Login form not found on " + FAMILYWALL_LOGIN_URL +
        " — Familywall's layout may have changed.",
    );
  }
  await emailField.fill(email);
  await pwField.fill(password);
  const submit = await firstVisible(page, SELECTORS.loginSubmit);
  // The signin form on www.familywall.com uses method="get" but has JS that
  // intercepts submit; wait for the URL to leave the signin page either way.
  await Promise.all([
    page.waitForURL((url) => !url.toString().includes("fw2_signin.php"), {
      timeout: 60_000,
    }),
    submit ? submit.click() : pwField.press("Enter"),
  ]);
}

async function listRecipeUrls(page: Page, limit?: number): Promise<string[]> {
  // Try the most likely direct URL first.
  await page
    .goto(FAMILYWALL_RECIPES_URL, { waitUntil: "domcontentloaded" })
    .catch(() => {});

  // If that redirected us off the recipes section (e.g. straight to the
  // home page because we're not actually on the recipes route), look for a
  // recipes-nav element and click it.
  if (!page.url().includes("recipe") && !page.url().includes("rezept")) {
    const nav = await firstVisible(page, SELECTORS.recipesNav);
    if (nav) {
      await nav.click().catch(() => {});
    }
  }
  await page.waitForLoadState("networkidle").catch(() => {});

  // Familywall paginates recipes; we keep scrolling until the count stops
  // growing or we hit the limit.
  const seen = new Set<string>();
  let stable = 0;
  while (stable < 3) {
    const links = await page
      .locator(SELECTORS.recipeCard.join(", "))
      .evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLAnchorElement).href).filter(Boolean),
      );
    const before = seen.size;
    for (const href of links) seen.add(href);
    if (limit && seen.size >= limit) break;
    if (seen.size === before) {
      stable += 1;
    } else {
      stable = 0;
    }
    // Scroll to load more.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(POLITE_DELAY_MS);
  }
  return Array.from(seen).slice(0, limit);
}

async function scrapeRecipe(
  page: Page,
  url: string,
  pageTimeoutMs: number,
): Promise<FamilywallRawRecipe | null> {
  try {
    await page.goto(url, { timeout: pageTimeoutMs, waitUntil: "domcontentloaded" });
  } catch {
    return null;
  }

  const titleLoc = await firstExisting(page, SELECTORS.recipeTitle);
  const title = ((await titleLoc?.textContent()) ?? "").trim();
  if (!title) return null;

  const descLoc = await firstExisting(page, SELECTORS.recipeDescription);
  const description = (await descLoc?.textContent())?.trim() || null;

  const servingsLoc = await firstExisting(page, SELECTORS.recipeServings);
  const servingsText = (await servingsLoc?.textContent()) ?? "";
  const servings = (() => {
    const m = /(\d+)/.exec(servingsText);
    return m ? parseInt(m[1], 10) : null;
  })();

  const ingredients = await page
    .locator(SELECTORS.recipeIngredients.join(", "))
    .evaluateAll((nodes) =>
      nodes
        .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((s) => s.length > 0),
    );

  const instructions = await page
    .locator(SELECTORS.recipeInstructions.join(", "))
    .evaluateAll((nodes) =>
      nodes
        .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((s) => s.length > 0),
    );

  const imageLoc = await firstExisting(page, SELECTORS.recipeImage);
  const imageUrl = (await imageLoc?.getAttribute("src")) ?? null;

  const sourceLoc = await firstExisting(page, SELECTORS.recipeSourceLink);
  let sourceUrl = (await sourceLoc?.getAttribute("href")) ?? null;
  // Defensive: never store a Familywall URL as "source" — that's a hard
  // product rule. Only links pointing outside the Familywall domain qualify.
  if (sourceUrl) {
    try {
      const u = new URL(sourceUrl, FAMILYWALL_BASE);
      if (u.host.endsWith("familywall.com")) {
        sourceUrl = null;
      } else {
        sourceUrl = u.toString();
      }
    } catch {
      sourceUrl = null;
    }
  }

  return {
    title,
    description,
    servings,
    prepTimeMin: null,
    cookTimeMin: null,
    ingredients,
    instructions,
    imageUrl,
    sourceUrl,
  };
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
    const urls = await listRecipeUrls(page, options.limit);
    let current = 0;
    for (const url of urls) {
      current += 1;
      const recipe = await scrapeRecipe(page, url, pageTimeoutMs);
      onProgress?.({ total: urls.length, current });
      if (!recipe) continue;
      await sink(recipe, { ctx });
      await delay(POLITE_DELAY_MS);
    }
    return { total: urls.length };
  } finally {
    await browser.close();
  }
}
