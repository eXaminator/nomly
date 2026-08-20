import { expect, test, type Page, type BrowserContext } from "@playwright/test";

import { E2E_BASE_URL } from "./support/config.ts";

/**
 * The regression net under "no endless reloads, however the server answers".
 *
 * The loop these tests exist to catch: a router fetch comes back unusable, the
 * Next router falls back to an MPA navigation (a hard `location` assign of the
 * current URL), the service worker serves that URL from cache, the restored
 * page hydrates, fires its refresh, and gets the same unusable response. It
 * needs no bug of ours — a reverse proxy answering 503 while the container
 * restarts is enough.
 *
 * Only an end-to-end test can hold this: the loop is a three-way interaction
 * between the router, the service worker and the network, and every one of the
 * three has to be real.
 */

/** Bumped by an init script, so it counts document loads and nothing else. */
async function documentLoads(page: Page): Promise<number> {
  return Number(
    await page.evaluate(() => sessionStorage.getItem("e2eLoads") ?? "0"),
  );
}

async function setProxyMode(mode: "pass" | "fail"): Promise<void> {
  const res = await fetch(`${E2E_BASE_URL}/__mode/${mode}`);
  expect(res.ok, `could not switch the fault proxy to ${mode}`).toBe(true);
}

/** Click any in-app link to a different route: the router traffic under test. */
async function navigateWithinApp(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href^="/"]'),
    ).find((a) => new URL(a.href).pathname !== location.pathname);
    target?.click();
  });
}

async function openAppWithServiceWorker(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript(() => {
    const n = Number(sessionStorage.getItem("e2eLoads") ?? "0") + 1;
    sessionStorage.setItem("e2eLoads", String(n));
  });
  await page.goto("/einkauf", { waitUntil: "networkidle" });
  // The cached shell is half the loop, so it has to be in place before the
  // failure — otherwise a passing test proves nothing.
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller != null,
    null,
    { timeout: 30_000 },
  );
}

test.beforeEach(async () => {
  await setProxyMode("pass");
});

test.afterEach(async () => {
  await setProxyMode("pass");
});

test.describe("reload resilience", () => {
  test("a server answering 503 never reloads the page", async ({
    page,
    context,
  }) => {
    await openAppWithServiceWorker(page, context);
    const before = await documentLoads(page);

    await setProxyMode("fail");
    await navigateWithinApp(page);
    // Long enough that a loop would have turned over many times: before the
    // fix this window held a reload every few seconds.
    await page.waitForTimeout(12_000);

    expect(
      (await documentLoads(page)) - before,
      "the page reloaded while the server was failing",
    ).toBe(0);

    // Minimum functionality survives: frame, navigation, and a message saying
    // why the content stopped moving.
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("nav").first()).toBeVisible();
    await expect(
      page.getByText("Der Server antwortet nicht."),
    ).toBeVisible();

    // ...and it heals on its own, without a reload and without user action.
    await setProxyMode("pass");
    await expect(
      page.getByText("Der Server antwortet nicht."),
    ).toBeHidden({ timeout: 30_000 });
    expect(
      (await documentLoads(page)) - before,
      "recovery cost a reload",
    ).toBe(0);
  });

  test("losing the network never reloads the page", async ({
    page,
    context,
  }) => {
    await openAppWithServiceWorker(page, context);
    const before = await documentLoads(page);

    await context.setOffline(true);
    await navigateWithinApp(page);
    await page.waitForTimeout(10_000);

    expect(
      (await documentLoads(page)) - before,
      "the page reloaded while offline",
    ).toBe(0);
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.getByText("Du bist offline.")).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText("Du bist offline.")).toBeHidden({
      timeout: 30_000,
    });
  });

  test("a hard reload while offline still lands in the app", async ({
    page,
    context,
  }) => {
    await openAppWithServiceWorker(page, context);
    await context.setOffline(true);

    // The user's own reload — the one thing we cannot prevent. It has to come
    // back as the app shell, not the browser's error page.
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("[data-shopping-row]").first()).toBeVisible();
    await context.setOffline(false);
  });

  test("a hard reload while the server 503s still lands in the app", async ({
    page,
    context,
  }) => {
    await openAppWithServiceWorker(page, context);
    await setProxyMode("fail");

    // Same again, but the proxy is answering rather than the network being
    // gone: the service worker has to treat a 5xx like an outage and fall back
    // to the cached shell, or the user gets the gateway's error page instead of
    // their shopping list.
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("[data-shopping-row]").first()).toBeVisible();
  });
});
