import { expect, test, type Page } from "@playwright/test";

/**
 * The shopping list is the one thing that has to keep working with no server:
 * it is IndexedDB-owned, and mutations queue locally until they can be sent.
 *
 * Written against the row itself rather than a toggle child — `data-toggle` and
 * `data-shopping-row` are the same element (see shopping-item-row.tsx) — and
 * against list membership rather than a row's `data-checked`, because checking
 * an item moves it out of the open list, so "the first row" afterwards is a
 * different item entirely.
 */
const OPEN_ROWS = "[data-shopping-row]";

async function queueLength(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open("nomly");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("mutationQueue")) return resolve(0);
          const all = db
            .transaction("mutationQueue", "readonly")
            .objectStore("mutationQueue")
            .getAll();
          all.onsuccess = () => resolve((all.result as unknown[]).length);
          all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Load the list and wait for the service worker, which owns the offline shell. */
async function openList(page: Page): Promise<void> {
  await page.goto("/einkauf", { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller != null,
    null,
    { timeout: 30_000 },
  );
  await expect(page.locator(OPEN_ROWS).first()).toBeVisible();
}

test.describe("shopping list — offline", () => {
  test("checks an item offline, then syncs when back online", async ({
    page,
    context,
  }) => {
    await openList(page);
    const before = await page.locator(OPEN_ROWS).count();
    expect(before, "the harness must seed a few shopping rows").toBeGreaterThan(1);

    await context.setOffline(true);
    await expect(page.getByText("Du bist offline.")).toBeVisible();

    const first = page.locator(OPEN_ROWS).first();
    const name = (await first.innerText()).split("\n")[0];
    await first.click();

    // Checking it takes it out of the open list, and the change is recorded
    // locally rather than lost.
    await expect(page.locator(OPEN_ROWS)).toHaveCount(before - 1);
    await expect(page.locator(OPEN_ROWS).first()).not.toContainText(name);
    expect(await queueLength(page)).toBe(1);

    await context.setOffline(false);
    // Reconnecting drains the queue on its own — no reload, no user action.
    await expect
      .poll(() => queueLength(page), { timeout: 30_000 })
      .toBe(0);
    await expect(page.locator(OPEN_ROWS)).toHaveCount(before - 1);
  });

  test("a reload while offline keeps the list visible", async ({
    page,
    context,
  }) => {
    await openList(page);
    const before = await page.locator(OPEN_ROWS).count();

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });

    // Served from the cached shell — which carries no items — so the rows can
    // only come from IndexedDB. That is the offline guarantee.
    await expect(page.locator(OPEN_ROWS)).toHaveCount(before);
    // And the app knows it is offline. This is the case that used to sit on
    // "Prüfe Verbindung…" forever, because the state was written before the
    // component subscribed (see useConnectivity).
    await expect(page.getByText("Du bist offline.")).toBeVisible();
    await context.setOffline(false);
  });
});
