# Offline-First Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard (`/`) work offline with stale-while-revalidate semantics, add a „Start" nav entry, make the PWA entry page user-configurable, and add a „Start" PWA shortcut.

**Architecture:** The SW serves a cached snapshot of `/` instantly and revalidates in the background; a client `DashboardRefresher` calls `router.refresh()` when online so displayed data is always fresh. The shopping summary card overlays live IndexedDB data when not online. Dashboard recipe/plan links disable while offline. `start_url` points to a new `/start` client page that redirects per a localStorage preference set in Einstellungen.

**Tech Stack:** Next.js (App Router, RSC), plain-JS service worker (`public/sw.js`), `idb`, vitest + fake-indexeddb, lucide-react.

**Spec:** `docs/superpowers/specs/2026-06-04-offline-dashboard-design.md`

**Conventions:** Commit messages follow `feat(dashboard): …` style (see `git log`). Tests are pure-TS vitest files in `tests/` (`tests/**/*.test.ts` — **no `.tsx`/component tests**; component wiring is verified by `npm run typecheck` + `npm run build`). Run a single test file with `npx vitest run tests/<file>.test.ts`. fake-indexeddb is auto-loaded via `tests/setup/fake-indexeddb.ts`.

**Per AGENTS.md:** this Next.js version has breaking changes — if any API behaves unexpectedly, check `node_modules/next/dist/docs/`. Already verified for this plan: `router.refresh()` exists and re-renders Server Components in place (`01-app/03-api-reference/04-functions/use-router.md`); the dashboard page already has `export const dynamic = "force-dynamic"`.

---

### Task 1: Start-page preference helper

**Files:**
- Create: `src/lib/start-page.ts`
- Test: `tests/start-page.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/start-page.test.ts
import { describe, expect, it } from "vitest";
import { resolveStartPage, START_PAGE_KEY, START_PAGE_OPTIONS } from "@/lib/start-page";

describe("resolveStartPage", () => {
  it("accepts every allow-listed page", () => {
    for (const o of START_PAGE_OPTIONS) {
      expect(resolveStartPage(o.value)).toBe(o.value);
    }
  });

  it("falls back to the dashboard for anything else", () => {
    expect(resolveStartPage(null)).toBe("/");
    expect(resolveStartPage(undefined)).toBe("/");
    expect(resolveStartPage("")).toBe("/");
    expect(resolveStartPage("/admin")).toBe("/");
    expect(resolveStartPage("https://evil.example/")).toBe("/");
    expect(resolveStartPage(42)).toBe("/");
  });

  it("offers dashboard, einkauf, plan and rezepte", () => {
    expect(START_PAGE_OPTIONS.map((o) => o.value)).toEqual(["/", "/einkauf", "/plan", "/rezepte"]);
  });

  it("uses a stable storage key", () => {
    expect(START_PAGE_KEY).toBe("nomly.startPage");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/start-page.test.ts`
Expected: FAIL — cannot resolve `@/lib/start-page`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/start-page.ts
/**
 * Per-device start-page preference for the PWA. The manifest's start_url
 * points at /start, which reads this localStorage key and redirects. Stored
 * client-side only (deliberately per-device, works offline, no migration).
 */

export const START_PAGE_KEY = "nomly.startPage";

export const START_PAGE_OPTIONS = [
  { value: "/", label: "Dashboard" },
  { value: "/einkauf", label: "Einkaufsliste" },
  { value: "/plan", label: "Planer" },
  { value: "/rezepte", label: "Rezepte" },
] as const;

export type StartPage = (typeof START_PAGE_OPTIONS)[number]["value"];

/** Validates a raw (untrusted) stored value; anything unknown → dashboard. */
export function resolveStartPage(raw: unknown): StartPage {
  const hit = START_PAGE_OPTIONS.find((o) => o.value === raw);
  return hit ? hit.value : "/";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/start-page.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/start-page.ts tests/start-page.test.ts
git commit -m "feat(pwa): add per-device start-page preference helper"
```

---

### Task 2: Upcoming-dates filter (no past meals)

**Files:**
- Create: `src/lib/meal-plans/upcoming-dates.ts`
- Test: `tests/upcoming-dates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/upcoming-dates.test.ts
import { describe, expect, it } from "vitest";
import { filterUpcomingDates } from "@/lib/meal-plans/upcoming-dates";

describe("filterUpcomingDates", () => {
  const dates = ["2026-06-02", "2026-06-03", "2026-06-04"];

  it("keeps all dates when today is the first", () => {
    expect(filterUpcomingDates(dates, "2026-06-02")).toEqual(dates);
  });

  it("drops days before today (stale cached snapshot)", () => {
    expect(filterUpcomingDates(dates, "2026-06-04")).toEqual(["2026-06-04"]);
  });

  it("returns empty when the whole snapshot window is in the past", () => {
    expect(filterUpcomingDates(dates, "2026-06-10")).toEqual([]);
  });

  it("keeps future-only windows untouched", () => {
    expect(filterUpcomingDates(dates, "2026-06-01")).toEqual(dates);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/upcoming-dates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/meal-plans/upcoming-dates.ts
/**
 * Drops ISO dates before `today`. Used by the dashboard's upcoming-meals card
 * so a stale SW-cached snapshot never shows past days — the client re-filters
 * with the device's current date at view time. ISO yyyy-mm-dd strings compare
 * correctly lexicographically.
 */
export function filterUpcomingDates(
  dates: ReadonlyArray<string>,
  today: string,
): string[] {
  return dates.filter((d) => d >= today);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/upcoming-dates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meal-plans/upcoming-dates.ts tests/upcoming-dates.test.ts
git commit -m "feat(dashboard): add upcoming-dates filter so cached snapshots never show past meals"
```

---

### Task 3: Pure shopping-summary computation (shared server/client)

**Files:**
- Create: `src/lib/shopping/shopping-summary.ts`
- Modify: `src/app/(app)/page.tsx` (use the helper; removes duplicated sort logic)
- Test: `tests/shopping-summary.test.ts`

The dashboard page currently computes `openCount` + sorted per-store counts inline (`src/app/(app)/page.tsx:34-48`). Extract that into a pure helper reusing `countNeededItemsPerSupermarket` (`src/lib/shopping/supermarket-availability.ts` — already pure and client-safe), so the offline IDB reader (Task 4) computes identical results.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shopping-summary.test.ts
import { describe, expect, it } from "vitest";
import { computeShoppingSummary } from "@/lib/shopping/shopping-summary";

const item = (over: Partial<{ checked: boolean; categoryId: number | null; unavailableSupermarketIds: number[] }> = {}) => ({
  checked: false,
  categoryId: null,
  unavailableSupermarketIds: [],
  ...over,
});

const market = (id: number, name: string, categoryIds: number[]) => ({
  id,
  name,
  categories: categoryIds.map((categoryId) => ({ categoryId })),
});

describe("computeShoppingSummary", () => {
  it("counts open items and per-store needs, sorted by count desc then name", () => {
    const items = [
      item({ categoryId: 1 }),                     // carried by both
      item({ categoryId: 2 }),                     // only B carries cat 2
      item({ checked: true, categoryId: 1 }),      // checked — ignored
      item(),                                      // uncategorized — everywhere
    ];
    const summary = computeShoppingSummary(items, [
      market(1, "Aldi", [1]),
      market(2, "Bio", [1, 2]),
    ]);
    expect(summary.openCount).toBe(3);
    expect(summary.stores).toEqual([
      { id: 2, name: "Bio", count: 3 },
      { id: 1, name: "Aldi", count: 2 },
    ]);
  });

  it("hides stores with zero needed items", () => {
    const summary = computeShoppingSummary([item({ categoryId: 9 })], [market(1, "Aldi", [1])]);
    expect(summary.openCount).toBe(1);
    expect(summary.stores).toEqual([]);
  });

  it("breaks count ties by German name order", () => {
    const summary = computeShoppingSummary([item()], [market(2, "Ödland", []), market(1, "Aldi", [])]);
    expect(summary.stores.map((s) => s.name)).toEqual(["Aldi", "Ödland"]);
  });

  it("returns zero state for empty inputs", () => {
    expect(computeShoppingSummary([], [])).toEqual({ openCount: 0, stores: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shopping-summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/shopping/shopping-summary.ts
import {
  countNeededItemsPerSupermarket,
  type NeededItem,
  type SupermarketCarry,
} from "./supermarket-availability";

export type SummarySupermarket = SupermarketCarry & { name: string };

export type StoreSummary = { id: number; name: string; count: number };

export type ShoppingSummary = { openCount: number; stores: StoreSummary[] };

/**
 * Open-item count + per-store needed counts for the dashboard's shopping
 * card. Pure (no DB/React) so the server page and the offline IDB overlay
 * compute identical results. Stores with nothing to buy are hidden; sorted
 * by count desc, then German name order.
 */
export function computeShoppingSummary(
  items: ReadonlyArray<NeededItem>,
  supermarkets: ReadonlyArray<SummarySupermarket>,
): ShoppingSummary {
  const openCount = items.filter((i) => !i.checked).length;
  const counts = countNeededItemsPerSupermarket(items, supermarkets);
  const stores = supermarkets
    .map((s) => ({ id: s.id, name: s.name, count: counts.get(s.id) ?? 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
  return { openCount, stores };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shopping-summary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Use the helper in the dashboard page**

In `src/app/(app)/page.tsx`, replace lines 34-48 (from `const items = listShoppingItems();` through the `stores` computation) with:

```ts
  const items = listShoppingItems();
  const supermarkets = listSupermarkets()
    .map((s) => getSupermarketDetail(s.id))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      categories: s.orderedCategories.map((c) => ({ categoryId: c.categoryId })),
    }));
  const shoppingSummary = computeShoppingSummary(items, supermarkets);
```

Add the import:

```ts
import { computeShoppingSummary } from "@/lib/shopping/shopping-summary";
```

Remove the now-unused `countNeededItemsPerSupermarket` import. Update the JSX usage:

```tsx
<ShoppingSummaryCard openCount={shoppingSummary.openCount} stores={shoppingSummary.stores} />
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npx vitest run tests/shopping-summary.test.ts tests/supermarket-availability.test.ts`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/shopping/shopping-summary.ts src/app/\(app\)/page.tsx tests/shopping-summary.test.ts
git commit -m "refactor(dashboard): extract pure shopping-summary computation"
```

---

### Task 4: Offline shopping-summary reader (IndexedDB)

**Files:**
- Create: `src/lib/shopping/offline/dashboard-summary.ts`
- Test: `tests/shopping/offline-dashboard-summary.test.ts`

Reads the existing `nomly` IDB (`src/lib/shopping/offline/db.ts`) and computes the summary. The `items` store already reflects optimistic offline toggles (see `toggleItemOptimistic` in `store.ts`), so no mutation-queue overlay is needed. Returns `null` when there's no offline truth (never seeded) or on **any** failure — callers then keep the server snapshot.

- [ ] **Step 1: Write the failing test**

Follow the fixture pattern of `tests/shopping/offline-navigation.test.ts` (full `ShoppingItemView` shape required by the IDB types):

```ts
// tests/shopping/offline-dashboard-summary.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { resetOfflineDbForTests, openOfflineDb } from "@/lib/shopping/offline/db";
import { readOfflineShoppingSummary } from "@/lib/shopping/offline/dashboard-summary";
import type { ShoppingItemView } from "@/lib/shopping/items";

function makeItem(over: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: 1, refType: "ingredient", refId: 1, name: "Mehl",
    amounts: [], categoryId: null, categoryName: null,
    checked: false, checkedAt: null, note: null,
    sortOrder: 0, version: 1, createdAt: 0, updatedAt: 0,
    unavailableSupermarketIds: [], sources: [], stapleSources: [], manualAmounts: [],
    stock: null, defaultUnitId: null, defaultUnitName: null,
    ...over,
  };
}

describe("readOfflineShoppingSummary", () => {
  beforeEach(async () => {
    await resetOfflineDbForTests();
  });

  it("returns null when IDB was never seeded (no offline truth)", async () => {
    expect(await readOfflineShoppingSummary()).toBeNull();
  });

  it("computes the summary from IDB items + supermarkets", async () => {
    const db = await openOfflineDb();
    await db.put("meta", { key: "shoppingFetchedAt", value: 1 });
    await db.put("items", makeItem({ id: 1, categoryId: 5 }));
    await db.put("items", makeItem({ id: 2, name: "Salz", checked: true }));
    await db.put("items", makeItem({ id: 3, name: "Zucker" }));
    await db.put("supermarkets", { id: 1, name: "Aldi", categories: [{ categoryId: 5, sortOrder: 0 }] });

    const summary = await readOfflineShoppingSummary();
    expect(summary).toEqual({
      openCount: 2,
      stores: [{ id: 1, name: "Aldi", count: 2 }],
    });
  });

  it("reflects items checked off offline", async () => {
    const db = await openOfflineDb();
    await db.put("meta", { key: "shoppingFetchedAt", value: 1 });
    await db.put("items", makeItem({ id: 1, checked: true }));
    await db.put("items", makeItem({ id: 2, name: "Salz", checked: true }));

    const summary = await readOfflineShoppingSummary();
    expect(summary).toEqual({ openCount: 0, stores: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shopping/offline-dashboard-summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/shopping/offline/dashboard-summary.ts
import { openOfflineDb } from "./db";
import {
  computeShoppingSummary,
  type ShoppingSummary,
} from "@/lib/shopping/shopping-summary";

/**
 * Shopping summary from the offline store, for the dashboard card while not
 * online. The `items` store already carries optimistic offline toggles, so
 * the result reflects what the user checked off offline.
 *
 * Returns null when IDB holds no shopping truth yet (this device never loaded
 * /einkauf) or on any failure — the caller keeps the server-rendered snapshot
 * in that case. Errors are deliberately swallowed: a broken IDB must degrade
 * to "no overlay", never break the dashboard.
 */
export async function readOfflineShoppingSummary(): Promise<ShoppingSummary | null> {
  try {
    const db = await openOfflineDb();
    const seeded = await db.get("meta", "shoppingFetchedAt");
    if (!seeded) return null;
    const [items, supermarkets] = await Promise.all([
      db.getAll("items"),
      db.getAll("supermarkets"),
    ]);
    return computeShoppingSummary(items, supermarkets);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shopping/offline-dashboard-summary.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopping/offline/dashboard-summary.ts tests/shopping/offline-dashboard-summary.test.ts
git commit -m "feat(dashboard): read offline shopping summary from IndexedDB"
```

---

### Task 5: Manifest — start_url, Start shortcut, shortcut icon

**Files:**
- Modify: `src/app/manifest.ts`
- Modify: `scripts/render-icons.mts:8` (add `"start"` to `SHORTCUT_KEYS`)
- Create: `public/icons/shortcut-start.svg`
- Test: `tests/manifest.test.ts` (update expectations)

- [ ] **Step 1: Update the failing test first**

In `tests/manifest.test.ts`, change the `start_url` expectation and the shortcuts expectation:

```ts
    expect(m.start_url).toBe("/start");
```

```ts
  it("declares the five shortcut targets, dashboard first", () => {
    const urls = m.shortcuts!.map((s) => s.url);
    expect(urls).toEqual(["/", "/einkauf", "/plan", "/rezepte", "/rezepte/neu"]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manifest.test.ts`
Expected: FAIL — start_url is "/einkauf", shortcuts have 4 entries.

- [ ] **Step 3: Update the manifest**

In `src/app/manifest.ts`: change `start_url: "/einkauf"` to `start_url: "/start"`, and prepend to `shortcuts`:

```ts
      { name: "Start",        short_name: "Start",   url: "/",            icons: [{ src: "/icons/shortcut-start-96.png",   sizes: "96x96", type: "image/png" }] },
```

- [ ] **Step 4: Create the shortcut SVG**

Copy the mascot template from `public/icons/shortcut-plan.svg` and change only the badge glyph (the trailing `<text>` element) to `S`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <ellipse cx="100" cy="191" rx="52" ry="5" fill="#A85718" opacity="0.3" />
  <ellipse cx="100" cy="102" rx="86" ry="88" fill="#E1721F" />
  <path d="M 36 76 Q 64 46, 92 76"  stroke="#1A1A1A" stroke-width="8" fill="none" stroke-linecap="round" />
  <path d="M 108 76 Q 136 46, 164 76" stroke="#1A1A1A" stroke-width="8" fill="none" stroke-linecap="round" />
  <ellipse cx="56"  cy="112" rx="11" ry="7" fill="#F2A66B" opacity="0.75" />
  <ellipse cx="144" cy="112" rx="11" ry="7" fill="#F2A66B" opacity="0.75" />
  <path d="M 60 136 Q 100 172, 140 136" stroke="#1A1A1A" stroke-width="8" fill="none" stroke-linecap="round" />
  <circle cx="170" cy="170" r="22" fill="#FFF8EF" stroke="#1A1A1A" stroke-width="3" />
  <text x="170" y="178" font-family="system-ui,sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="#1A1A1A">S</text>
</svg>
```

In `scripts/render-icons.mts` change line 8 to:

```ts
const SHORTCUT_KEYS = ["einkauf", "plan", "rezepte", "neu", "start"] as const;
```

Render: `npm run icons`
Expected: `public/icons/shortcut-start-96.png` exists.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/manifest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/manifest.ts scripts/render-icons.mts public/icons/shortcut-start.svg public/icons/shortcut-start-96.png tests/manifest.test.ts
git commit -m "feat(pwa): start_url via /start redirect, Start shortcut in long-press menu"
```

---

### Task 6: „Start" entry in the navigation

**Files:**
- Modify: `src/components/layout/nav-items.tsx`
- Modify: `src/components/layout/bottom-nav.tsx:15` (`grid-cols-4` → `grid-cols-5`)
- Test: `tests/nav-items.test.ts` (new)

`isNavItemActive` is already exact-safe for `/`: `pathname === "/"` matches, and `matchPrefix: "/"` only extends to `pathname.startsWith("//")`, which never occurs. Pin that with a test.

- [ ] **Step 1: Write the failing test**

```ts
// tests/nav-items.test.ts
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavItemActive } from "@/components/layout/nav-items";

describe("nav items", () => {
  it("leads with the dashboard Start entry", () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual([
      "/", "/rezepte", "/plan", "/einkauf", "/einstellungen",
    ]);
    expect(NAV_ITEMS[0].label).toBe("Start");
  });

  it("activates the Start entry only on the dashboard itself", () => {
    const start = NAV_ITEMS[0];
    expect(isNavItemActive(start, "/")).toBe(true);
    expect(isNavItemActive(start, "/rezepte")).toBe(false);
    expect(isNavItemActive(start, "/plan")).toBe(false);
    expect(isNavItemActive(start, "/offline")).toBe(false);
  });

  it("keeps prefix matching for section entries", () => {
    const rezepte = NAV_ITEMS.find((i) => i.href === "/rezepte")!;
    expect(isNavItemActive(rezepte, "/rezepte/42")).toBe(true);
    expect(isNavItemActive(rezepte, "/")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nav-items.test.ts`
Expected: FAIL — first href is "/rezepte".

- [ ] **Step 3: Implement**

In `src/components/layout/nav-items.tsx`: add `House` to the lucide import and prepend to `NAV_ITEMS`:

```ts
  { href: "/", label: "Start", icon: House, matchPrefix: "/" },
```

In `src/components/layout/bottom-nav.tsx` change `grid-cols-4` to `grid-cols-5`. (The desktop `TopNav` maps the same `NAV_ITEMS` and needs no change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/nav-items.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/nav-items.tsx src/components/layout/bottom-nav.tsx tests/nav-items.test.ts
git commit -m "feat(nav): add Start (dashboard) entry to bottom and top navigation"
```

---

### Task 7: `OfflineAwareLink` component

**Files:**
- Create: `src/components/dashboard/offline-aware-link.tsx`

Client component; no unit test (no component-test infra) — verified via typecheck/build and manual pass in Task 13.

- [ ] **Step 1: Write the component**

```tsx
// src/components/dashboard/offline-aware-link.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useConnectivity } from "@/components/shopping/offline-indicator";
import { cn } from "@/lib/cn";

/**
 * A Link that degrades to inert, dimmed text while offline. Used for
 * dashboard links into areas that aren't available offline (recipes, plan).
 * Shopping links stay plain <Link>s — /einkauf works offline.
 *
 * "checking" keeps links enabled: the probe resolves within seconds and
 * briefly-disabled links on every load would just flicker.
 */
export function OfflineAwareLink({
  href,
  className,
  children,
  ...rest
}: React.ComponentProps<typeof Link>) {
  const connectivity = useConnectivity();
  if (connectivity === "offline" || connectivity === "sessionExpired") {
    return (
      <span aria-disabled="true" className={cn(className, "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/offline-aware-link.tsx
git commit -m "feat(dashboard): add OfflineAwareLink that disables while offline"
```

---

### Task 8: Dashboard cards — offline links + past-meals filter

**Files:**
- Modify: `src/components/dashboard/upcoming-meals-card.tsx` (becomes a client component)
- Modify: `src/components/dashboard/top-recipes-card.tsx`
- Modify: `src/components/dashboard/needs-update-card.tsx`

Before editing, confirm `@/lib/meal-plans/dates` and `@/components/recipes/diet-badge` are client-safe (no `server-only`/DB imports): `grep -n "import" src/lib/meal-plans/dates.ts src/components/recipes/diet-badge.tsx`. Both are expected to be pure; if not, stop and split out the pure parts.

- [ ] **Step 1: Client-ify `UpcomingMealsCard` with the past-day filter**

In `src/components/dashboard/upcoming-meals-card.tsx`:

1. Add `"use client";` as the first line.
2. Add imports:

```tsx
import * as React from "react";
import { todayIso } from "@/lib/meal-plans/dates"; // extend the existing dates import
import { filterUpcomingDates } from "@/lib/meal-plans/upcoming-dates";
import { OfflineAwareLink } from "./offline-aware-link";
```

3. Inside the component body, before `byDate`, add the client-clock filter. The `today` prop stays the server's date for the first (hydration-consistent) render; an effect swaps in the device date and keeps it current when the PWA resumes from background:

```tsx
  // A SW-cached snapshot may be days old: re-filter with the device clock so
  // past days never render. Effect-based (not render-time) to avoid a
  // hydration mismatch with the cached HTML; also re-checks when the PWA
  // resumes from the background (visibilitychange).
  const [clientToday, setClientToday] = React.useState(today);
  React.useEffect(() => {
    const update = () => setClientToday(todayIso());
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const visibleDates = filterUpcomingDates(dates, clientToday);
```

4. Replace `dates.map(...)` with `visibleDates.map(...)`, and both `today` usages in the day header (`dayLabel(date, today)` and `date === today`) with `clientToday`.
5. Add an empty state before the map (inside `CardContent`):

```tsx
        {visibleDates.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">
            Keine aktuellen Plandaten — einmal online öffnen.
          </p>
        ) : null}
```

6. Replace the two `<Link>` usages (`href="/plan"` in the header, `href={`/rezepte/${meal.recipe.id}?meal=${meal.id}`}` per meal) with `<OfflineAwareLink>` (same props/className). Remove the now-unused `next/link` import.

- [ ] **Step 2: Swap links in `TopRecipesCard` and `NeedsUpdateCard`**

Both stay server components — `OfflineAwareLink` is a client leaf taking serializable props + children. In each file: replace `import Link from "next/link";` with `import { OfflineAwareLink } from "./offline-aware-link";` and rename the `<Link …>` elements to `<OfflineAwareLink …>` (hrefs: `/rezepte/${…}`, `/rezepte?update=1`). `ShoppingSummaryCard` and `TodayShoppingWarning` keep plain links (they point at `/einkauf`).

Check `TodayShoppingWarning` (`src/components/dashboard/today-shopping-warning.tsx`): if it links anywhere other than `/einkauf`, swap those links too; `/einkauf` links stay.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/
git commit -m "feat(dashboard): disable recipe/plan links offline, never show past meals"
```

---

### Task 9: Live shopping overlay + dashboard refresher

**Files:**
- Create: `src/components/dashboard/shopping-summary-live.tsx`
- Create: `src/components/dashboard/dashboard-refresher.tsx`
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: Write `ShoppingSummaryLive`**

```tsx
// src/components/dashboard/shopping-summary-live.tsx
"use client";

import * as React from "react";
import {
  ShoppingSummaryCard,
  type ShoppingStoreSummary,
} from "./shopping-summary-card";
import { useConnectivity } from "@/components/shopping/offline-indicator";
import { readOfflineShoppingSummary } from "@/lib/shopping/offline/dashboard-summary";
import type { ShoppingSummary } from "@/lib/shopping/shopping-summary";

/**
 * Shopping card with an offline overlay. Online, the server-rendered values
 * are authoritative (they're refreshed by DashboardRefresher and include
 * changes from other devices). While not online, IndexedDB is — it carries
 * the user's offline check-offs. No overlay data (IDB never seeded or
 * broken) → the server snapshot stays.
 */
export function ShoppingSummaryLive({
  openCount,
  stores,
  className,
}: {
  openCount: number;
  stores: ShoppingStoreSummary[];
  className?: string;
}) {
  const connectivity = useConnectivity();
  const [offline, setOffline] = React.useState<ShoppingSummary | null>(null);

  React.useEffect(() => {
    if (connectivity === "online") return;
    let cancelled = false;
    void readOfflineShoppingSummary().then((summary) => {
      if (!cancelled && summary) setOffline(summary);
    });
    return () => {
      cancelled = true;
    };
  }, [connectivity]);

  const show = connectivity !== "online" && offline ? offline : { openCount, stores };
  return (
    <ShoppingSummaryCard
      openCount={show.openCount}
      stores={show.stores}
      className={className}
    />
  );
}
```

- [ ] **Step 2: Write `DashboardRefresher`**

```tsx
// src/components/dashboard/dashboard-refresher.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useConnectivity } from "@/components/shopping/offline-indicator";

// The SW may have answered this navigation with a cached snapshot. Refresh
// once per full page load — soft navigations already rendered fresh data
// (the page is force-dynamic), so they skip the extra request.
let refreshedThisPageLoad = false;

/**
 * Keeps the dashboard from going stale while online. router.refresh()
 * re-renders the Server Components in place (no reload, no lost state):
 * - on mount after a hard load (the SW-snapshot case),
 * - when connectivity recovers (offline → online),
 * - when the PWA resumes from the background while online.
 * Never fires offline — the snapshot is all we have then.
 */
export function DashboardRefresher() {
  const router = useRouter();
  const connectivity = useConnectivity();
  const lastState = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!refreshedThisPageLoad && navigator.onLine) {
      refreshedThisPageLoad = true;
      router.refresh();
    }
  }, [router]);

  React.useEffect(() => {
    const prev = lastState.current;
    lastState.current = connectivity;
    // "checking" → "online" is the normal mount probe; the mount refresh
    // already covered it. Only genuine recoveries re-fetch.
    if (connectivity === "online" && (prev === "offline" || prev === "sessionExpired")) {
      router.refresh();
    }
  }, [connectivity, router]);

  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  return null;
}
```

- [ ] **Step 3: Wire both into the page**

In `src/app/(app)/page.tsx`: import both components, render `<DashboardRefresher />` as the first child of the fragment, and replace `<ShoppingSummaryCard openCount={…} stores={…} />` with:

```tsx
<ShoppingSummaryLive openCount={shoppingSummary.openCount} stores={shoppingSummary.stores} />
```

Remove the now-unused `ShoppingSummaryCard` import.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ src/app/\(app\)/page.tsx
git commit -m "feat(dashboard): live IDB shopping overlay + in-place refresh when online"
```

---

### Task 10: `/start` redirect page + Einstellungen setting

**Files:**
- Create: `src/app/start/page.tsx`
- Create: `src/components/settings/start-page-setting.tsx`
- Modify: `src/proxy.ts:15-23` (add `/start` to `BYPASS_EXACT`)
- Modify: `src/app/(app)/einstellungen/page.tsx` (new „App" section)

- [ ] **Step 1: Write the `/start` page**

`/start` lives outside the `(app)` route group — no app shell, it only redirects.

```tsx
// src/app/start/page.tsx
"use client";

import * as React from "react";
import { START_PAGE_KEY, resolveStartPage } from "@/lib/start-page";

/**
 * PWA entry point (manifest start_url). Reads the per-device start-page
 * preference and redirects. A hard navigation (location.replace, not the
 * router) so the request goes through the service worker and the target can
 * be served from cache when offline. Unknown/broken stored values fall back
 * to the dashboard.
 */
export default function StartRedirectPage() {
  React.useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(START_PAGE_KEY);
    } catch {
      // storage unavailable — fall back to the dashboard
    }
    window.location.replace(resolveStartPage(raw));
  }, []);
  return null;
}
```

- [ ] **Step 2: Bypass auth for `/start`**

In `src/proxy.ts`, add to `BYPASS_EXACT` (after the `/offline` entry, keeping its comment style):

```ts
  // The PWA entry redirect — must succeed (not bounce to login) so the SW
  // can precache it and launch offline; it carries no data, the target page
  // enforces auth itself.
  "/start",
```

- [ ] **Step 3: Write the settings control**

```tsx
// src/components/settings/start-page-setting.tsx
"use client";

import * as React from "react";
import {
  START_PAGE_KEY,
  START_PAGE_OPTIONS,
  resolveStartPage,
} from "@/lib/start-page";

/**
 * Per-device start-page select (localStorage, not the DB — each device may
 * want a different entry page, and the value must be readable offline at
 * app launch).
 */
export function StartPageSetting() {
  const [value, setValue] = React.useState<string>("/");

  React.useEffect(() => {
    try {
      setValue(resolveStartPage(window.localStorage.getItem(START_PAGE_KEY)));
    } catch {
      // storage unavailable — keep the default
    }
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = resolveStartPage(e.target.value);
    setValue(next);
    try {
      window.localStorage.setItem(START_PAGE_KEY, next);
    } catch {
      // storage unavailable — the select still reflects the choice
    }
  };

  return (
    <select
      value={value}
      onChange={onChange}
      aria-label="Startseite"
      className="h-11 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
    >
      {START_PAGE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: Add the „App" section to Einstellungen**

In `src/app/(app)/einstellungen/page.tsx`, import `StartPageSetting` and add a new section between „Stammdaten" and „Wartung" (same structure as the Wartung block):

```tsx
        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
            App
          </h2>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Startseite</CardTitle>
                <CardDescription>
                  Mit welcher Seite die App öffnet. Gilt nur für dieses Gerät.
                </CardDescription>
              </div>
              <StartPageSetting />
            </CardHeader>
          </Card>
        </div>
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run tests/embed-session.test.ts tests/start-page.test.ts`
(embed-session covers proxy-adjacent behavior; make sure nothing regressed.)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/start/ src/components/settings/start-page-setting.tsx src/proxy.ts src/app/\(app\)/einstellungen/page.tsx
git commit -m "feat(pwa): /start entry redirect with per-device Startseite setting"
```

---

### Task 11: Service worker — dashboard SWR, photo cache, hardening

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Bump the version**

`public/sw.js:8`: `const CACHE_VERSION = "v4";`

- [ ] **Step 2: Seed `/` at install**

In the `install` handler, after the `/einkauf` shell block (line 33), add:

```js
    // Best-effort seed of the dashboard snapshot so even a first launch
    // offline has something to show. `redirect: "error"` keeps a login
    // redirect from being cached when the session is dead at install time;
    // normal visits keep the snapshot fresh via stale-while-revalidate.
    try {
      const dashRes = await fetch("/", { cache: "no-store", redirect: "error" });
      if (dashRes.ok) await cache.put("/", dashRes.clone());
    } catch (e) {
      console.warn("[sw] dashboard pre-cache failed", e);
    }
```

- [ ] **Step 3: Add route predicates**

Next to `isShellNavigation` (line 103), add:

```js
function isDashboardNavigation(req, url) {
  return req.mode === "navigate" && url.pathname === "/";
}
// Recipe photos render on the dashboard and in lists; cache-first keeps them
// visible offline (bounded: one household's recipe images).
function isRecipePhoto(req, url) {
  return req.destination === "image" && url.pathname.startsWith("/api/v1/");
}
```

- [ ] **Step 4: Route them in the fetch listener**

In the `fetch` listener, add the dashboard branch **before** the generic `isNavigation` branch, and the photo branch **before** `isDataPath`:

```js
  if (isDashboardNavigation(req, url)) {
    event.respondWith(dashboardNavigationStrategy(event));
    return;
  }
```

```js
  if (isRecipePhoto(req, url)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
```

- [ ] **Step 5: Implement the SWR strategy**

After `shellNavigationStrategy`, add:

```js
async function dashboardNavigationStrategy(event) {
  // Stale-while-revalidate for the dashboard: respond from cache instantly,
  // refresh the cache in the background. The page itself re-fetches fresh
  // data via router.refresh() when online, so what the user *sees* never
  // stays stale — this cache only decides what paints first (and what shows
  // offline). Unlike /einkauf, caching the data-bearing page is safe: the
  // dashboard is read-only, nothing can clobber IDB.
  const req = event.request;
  try {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match("/");

    const revalidate = (async () => {
      try {
        const res = await fetch(req);
        // Only a good same-origin 200 may overwrite the snapshot — a 500 or
        // a login redirect must never eat a working offline dashboard.
        if (res.ok && res.type === "basic" && !res.redirected) {
          try {
            await cache.put("/", res.clone());
          } catch (e) {
            console.warn("[sw] dashboard cache update failed", e);
          }
        }
        return res;
      } catch {
        return null; // offline — caller falls back
      }
    })();

    if (cached) {
      event.waitUntil(revalidate);
      return cached;
    }
    const res = await revalidate;
    if (res) return res;
    const offline = await cache.match("/offline");
    if (offline) return offline;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>nomly offline</title><p>Offline — das Dashboard konnte nicht geladen werden. Öffne die Seite einmal online, dann steht sie auch offline bereit.</p>",
      { headers: { "content-type": "text/html;charset=utf-8" }, status: 503 },
    );
  } catch (e) {
    // Any unexpected SW bug must never take the app down — go to network.
    console.warn("[sw] dashboard strategy failed, falling through", e);
    return fetch(req);
  }
}
```

- [ ] **Step 6: Serve precached pages from the generic navigation fallback**

`/start` is precached (Task 12) but currently an offline navigation to it would get the generic `/offline` page. In `navigationFallbackStrategy`, match the requested path before falling back:

```js
async function navigationFallbackStrategy(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    return await fetch(req);
  } catch {
    // Serve the page itself when it was precached (e.g. /start), else the
    // generic offline fallback.
    const cached = await cache.match(new URL(req.url).pathname);
    if (cached) return cached;
    const offline = await cache.match("/offline");
    if (offline) return offline;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>nomly offline</title><p>Offline.</p>",
      { headers: { "content-type": "text/html;charset=utf-8" }, status: 503 },
    );
  }
}
```

- [ ] **Step 7: Verify by reading**

`node --check public/sw.js` — Expected: no syntax errors. Re-read the diff: every new code path must either return a `Response` or fall through to `fetch(req)`.

- [ ] **Step 8: Commit**

```bash
git add public/sw.js
git commit -m "feat(pwa): stale-while-revalidate dashboard caching with hardened fallbacks"
```

---

### Task 12: Precache manifest — `/start` shell + normalized page keys

**Files:**
- Modify: `scripts/generate-precache.mts`

The app-router build manifest keys pages as e.g. `/(app)/einkauf/page`; the current exact-match filter silently never matches them (only `rootMainFiles` land in the precache). Normalize the keys so page-specific chunks for the offline-relevant routes get precached.

- [ ] **Step 1: Implement normalization + new shell entry**

Replace the `main()` page-filter block (lines 21-50) with:

```ts
// Build-manifest page keys look like "/(app)/einkauf/page" in the app
// router. Strip route groups and the trailing "/page" so they're comparable
// to route paths ("/(app)/page" → "/").
function normalizePageKey(page: string): string {
  const cleaned = page.replace(/\/\([^)]*\)/g, "").replace(/\/page$/, "");
  return cleaned === "" ? "/" : cleaned;
}

// Routes whose page chunks the SW precaches: everything that must render
// offline. ("/_app"/"/_layout" cover the pages-router style manifest.)
const PRECACHE_ROUTES = new Set(["/", "/start", "/einkauf", "/offline", "/_app", "/_layout"]);

async function main(): Promise<void> {
  const manifest = await loadBuildManifest();
  const assets = new Set<string>();

  if (manifest?.pages) {
    for (const [page, files] of Object.entries(manifest.pages)) {
      if (PRECACHE_ROUTES.has(normalizePageKey(page))) {
        for (const f of files) assets.add(`/_next/${f}`);
      }
    }
  }
  if (manifest?.rootMainFiles) {
    for (const f of manifest.rootMainFiles) assets.add(`/_next/${f}`);
  }

  // App shell extras the SW always wants cached on install. `/offline` is the
  // generic fallback served when a navigation fails offline; `/start` is the
  // PWA entry redirect and must work at offline launch. The dashboard `/` is
  // deliberately NOT in this list — the SW seeds it itself with
  // `redirect: "error"` so a logged-out install can't cache the login page.
  const shell = [
    "/einkauf",
    "/start",
    "/offline",
    "/manifest.webmanifest",
    "/icons/icon.svg",
    "/icons/icon-192.png",
  ];

  const payload = { shell, assets: Array.from(assets).sort() };
  await writeFile(join("public", "sw-precache.json"), JSON.stringify(payload, null, 2));
  console.log(`> wrote public/sw-precache.json (${shell.length} shell + ${assets.size} assets)`);
}
```

Keep `loadBuildManifest` and the trailing `main().catch(...)` as they are. Note the existing install handler filters `p !== "/einkauf"` from `addAll` — `/start` passes through and gets cached, which is what we want.

- [ ] **Step 2: Verify against a real build**

Run: `npm run build`
Expected: build succeeds, ends with `> wrote public/sw-precache.json (6 shell + N assets)` where N > 0.

Then: `node -e "const m=require('./.next/app-build-manifest.json');console.log(Object.keys(m.pages).join('\n'))"`
Confirm the printed keys for einkauf/start/offline/dashboard normalize to the `PRECACHE_ROUTES` entries (adjust `normalizePageKey` if the real format differs, and say so in the commit message).

And: `node -e "const p=require('./public/sw-precache.json');console.log(p.shell);console.log(p.assets.length)"`
Expected: shell contains `/start`; assets non-empty.

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-precache.mts public/sw-precache.json
git commit -m "feat(pwa): precache /start and page chunks for offline routes"
```

(If `public/sw-precache.json` is git-ignored, commit only the script.)

---

### Task 13: Full verification

- [ ] **Step 1: Static + unit**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all pass.

- [ ] **Step 2: Production build (RSC boundary check — required before pushing)**

Run: `npm run build`
Expected: success. Confirm the route list shows `/` as dynamic (ƒ) and `/start` as static (○).

- [ ] **Step 3: Manual smoke (dev server or production start)**

1. Open `/` online → dashboard renders; bottom nav shows „Start" first, highlighted only on `/`.
2. DevTools → Application → SW updated to v4; Cache Storage `nomly-shell-v4` contains `/`, `/einkauf`, `/start`, `/offline`.
3. Network → Offline; reload `/` → snapshot paints; recipe/plan links dimmed and inert; „Zur Liste →" works; no past days in „Nächste Mahlzeiten".
4. Check an item off in `/einkauf` while offline; back to `/` → open count reflects it.
5. Back online; on the dashboard → data refreshes in place (watch a `?_rsc` request fire).
6. Einstellungen → „Startseite" → pick „Einkaufsliste"; visit `/start` → lands on `/einkauf`. Pick „Dashboard" → `/start` lands on `/`.

- [ ] **Step 4: Update memory/backlog notes if anything shipped differently than the spec**
