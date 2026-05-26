import { expect, test } from "@playwright/test";

// NOTE: Epic 8 ships the implementation, but the Playwright harness is
// not wired up in this repo yet — no playwright.config, no e2e script in
// package.json, and the OIDC auth flow requires a running Authentik
// instance. The tests below are kept here so the offline scenarios are
// described in code; they're marked `test.fixme` so they're skipped until
// the harness lands. When that happens:
//   1. Add `playwright.config.ts` with the project's dev/prod server boot.
//   2. Provide a signed-in `storageState` via test-only auth bypass or a
//      headed login.
//   3. Remove the `.fixme` markers.

test.describe("shopping list — offline", () => {
  test.fixme("checks items offline, then syncs when back online", async ({ page, context }) => {
    await page.goto("/einkauf");
    await expect(page).toHaveURL(/\/einkauf$/);

    // 1) Online: check an item to seed IDB.
    const firstRow = page.locator("[data-shopping-row]").first();
    await firstRow.locator("[data-toggle]").click();
    await expect(firstRow).toHaveAttribute("data-checked", "true");

    // 2) Go offline; toggle two items.
    await context.setOffline(true);
    await expect(page.locator("text=Offline")).toBeVisible();

    const rows = page.locator("[data-shopping-row]");
    await rows.nth(1).locator("[data-toggle]").click();
    await rows.nth(2).locator("[data-toggle]").click();
    await expect(page.locator("text=ausstehend")).toContainText("2");

    // Verify IDB contains the queued mutations.
    const queueLength = await page.evaluate(async () => {
      const dbReq = indexedDB.open("nomly");
      return await new Promise<number>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const tx = dbReq.result.transaction("mutationQueue", "readonly");
          const all = tx.objectStore("mutationQueue").getAll();
          all.onsuccess = () => resolve((all.result as unknown[]).length);
          all.onerror = () => reject(all.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(queueLength).toBe(2);

    // 3) Go online; the queue drains; the chip shows Online.
    await context.setOffline(false);
    await expect(page.locator("text=Online")).toBeVisible({ timeout: 15_000 });

    const remaining = await page.evaluate(async () => {
      const dbReq = indexedDB.open("nomly");
      return await new Promise<number>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const tx = dbReq.result.transaction("mutationQueue", "readonly");
          const all = tx.objectStore("mutationQueue").getAll();
          all.onsuccess = () => resolve((all.result as unknown[]).length);
          all.onerror = () => reject(all.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(remaining).toBe(0);
  });

  test.fixme("reload offline keeps the list visible from cache", async ({ page, context }) => {
    await page.goto("/einkauf");
    await expect(page.locator("[data-shopping-row]").first()).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("[data-shopping-row]").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=Offline")).toBeVisible();
  });
});
