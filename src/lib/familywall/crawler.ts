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

const FAMILYWALL_BASE = "https://app.familywall.com";

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
  loginEmail: ["input[type=email]", "input[name=email]", "#email"],
  loginPassword: ["input[type=password]", "input[name=password]", "#password"],
  loginSubmit: [
    "button[type=submit]",
    "input[type=submit]",
    "button:has-text('Anmelden')",
    "button:has-text('Sign in')",
  ],
  recipesNav: [
    "a[href*='recipes']",
    "nav a:has-text('Rezepte')",
    "nav a:has-text('Recipes')",
  ],
  recipeCard: ["a[href*='recipe/']", "[data-testid='recipe-card']"],
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

async function firstExisting(page: Page, candidates: string[]) {
  for (const sel of candidates) {
    const locator = page.locator(sel).first();
    if ((await locator.count()) > 0) return locator;
  }
  return null;
}

async function login(page: Page, email: string, password: string) {
  await page.goto(FAMILYWALL_BASE);
  const emailField = await firstVisible(page, SELECTORS.loginEmail);
  const pwField = await firstVisible(page, SELECTORS.loginPassword);
  if (!emailField || !pwField) {
    throw new Error(
      "Login form not found — Familywall's layout may have changed or you're already logged in.",
    );
  }
  await emailField.fill(email);
  await pwField.fill(password);
  const submit = await firstVisible(page, SELECTORS.loginSubmit);
  if (submit) {
    await submit.click();
  } else {
    await pwField.press("Enter");
  }
  // Wait for any post-login element to appear. We use the recipes-nav link
  // as the canary, with a generous timeout in case a CAPTCHA is interposed
  // (the user solves it in --headed mode).
  const nav = page.locator(SELECTORS.recipesNav.join(", ")).first();
  await nav.waitFor({ timeout: 60_000 });
}

async function listRecipeUrls(page: Page, limit?: number): Promise<string[]> {
  // Navigate to the recipes index. If the nav-click doesn't land us there
  // we try a direct URL.
  const nav = await firstVisible(page, SELECTORS.recipesNav);
  if (nav) {
    await nav.click().catch(() => {});
  } else {
    await page.goto(`${FAMILYWALL_BASE}/recipes`);
  }
  await page.waitForLoadState("networkidle");

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
