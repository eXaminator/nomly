# Per-user Recipe Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-user recipe favorites: a login-driven `user` table, a `recipe_favorite` join, a toggle on recipe cards (corner heart) and detail, a favorites-by-user filter on `/rezepte`, a settings user list, and a one-time tag→favorite backfill (Familywall-Favorit→Steven, Janine→Janine) on first login by partial name.

**Architecture:** `user` keyed by OIDC `sub`, auto-created on first authenticated request (and at login callback), seeded from tags once via a `favorites_seeded_at` stamp. Favorites are a `(user_id, recipe_id)` join. Read paths take `currentUserId` (for `isFavorite`) and an optional `favoriteOfUserId` filter. The toggle mirrors the existing `NeedsUpdateToggle`/needs-update endpoint pattern.

**Tech Stack:** Next.js 16, SQLite + Drizzle, iron-session OIDC, Vitest, React.

---

## File structure
- `src/db/schema.ts` + `drizzle/0040_*.sql` — `user`, `recipe_favorite`.
- `src/lib/users/service.ts` (new) — `upsertUserFromSession`, `getCurrentUser`, `listUsers`, `removeUser`, backfill.
- `src/lib/users/favorite-seed.ts` (new) — name→tag mapping + seed logic (kept separate, testable).
- `src/lib/recipes/favorites.ts` (new) — `toggleFavorite`, `favoriteRecipeIdsForUser`.
- `src/lib/recipes/service.ts` — `ListRecipesOptions` (+`currentUserId`,`favoriteOfUserId`), `listRecipes` (isFavorite + filter), recipe detail read model `isFavorite`.
- `src/lib/recipes/types.ts` — `RecipeListItem.isFavorite`, detail view `isFavorite`.
- `src/lib/recipes/list-query.ts` — parse `fav`.
- `src/app/api/auth/callback/route.ts` — call upsert.
- `src/app/api/v1/recipes/[id]/favorite/route.ts` (new) — PATCH toggle.
- `src/app/api/v1/users/route.ts` (new, GET) + `src/app/api/v1/users/[id]/route.ts` (new, DELETE).
- `src/components/recipes/favorite-toggle.tsx` (new, detail) + `favorite-heart.tsx` (new, card).
- `src/components/recipes/recipe-card.tsx`, `recipe-detail.tsx`, `recipe-filter-bar.tsx` + a `favorites-filter.tsx` (new).
- `src/app/(app)/rezepte/page.tsx`, `src/app/(app)/rezepte/[id]/page.tsx`.
- `src/app/(app)/einstellungen/benutzer/page.tsx` (new) + a `user-list-client.tsx` (new) + settings index link.
- Tests under `tests/`.

---

## Task 1: Schema + migration

**Files:** `src/db/schema.ts`; `drizzle/0040_*.sql`.

- [ ] **Step 1:** Add to `src/db/schema.ts` (after the `recipe` table, before/after `tag` — placement doesn't matter, but `recipe_favorite` references both `user` and `recipe`):

```ts
export const user = sqliteTable("user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** OIDC subject claim — the stable per-user identity. */
  sub: text("sub").notNull().unique(),
  /** Latest display name from the OIDC claims. */
  name: text("name").notNull(),
  lastLoginAt: integer("last_login_at").notNull().default(now),
  /** Set once the tag→favorite backfill has run for this user (null = pending);
   *  guards re-seeding favorites the user later removed. */
  favoritesSeededAt: integer("favorites_seeded_at"),
});

export const recipeFavorite = sqliteTable(
  "recipe_favorite",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.recipeId] })],
);
```

(`now` and `primaryKey` are already imported/defined in schema.ts — confirm and reuse.)

- [ ] **Step 2:** `npm run db:generate` → `drizzle/0040_*.sql` creating both tables.
- [ ] **Step 3:** `npm run migrate` + `DATABASE_URL=./data/nomly-prodtest.db npm run migrate` → clean.
- [ ] **Step 4:** Commit: `feat(users): user + recipe_favorite tables (migration 0040)`.

---

## Task 2: Favorite seeding (name→tag) — pure logic + test

**Files:** `src/lib/users/favorite-seed.ts` (new). Test: `tests/favorites-seed.test.ts`.

- [ ] **Step 1: Failing test** for the mapping:

```ts
import { describe, expect, it } from "vitest";
import { tagForUserName } from "@/lib/users/favorite-seed";

describe("tagForUserName", () => {
  it("maps Steven (partial, ci) to Familywall-Favorit", () => {
    expect(tagForUserName("Steven")).toBe("Familywall-Favorit");
    expect(tagForUserName("steven weingärtner")).toBe("Familywall-Favorit");
  });
  it("maps Janine (partial, ci) to Janine", () => {
    expect(tagForUserName("Janine")).toBe("Janine");
    expect(tagForUserName("JANINE B.")).toBe("Janine");
  });
  it("returns null for anyone else", () => {
    expect(tagForUserName("Opa")).toBeNull();
  });
});
```

- [ ] **Step 2:** Run `npm run test -- favorites-seed` → FAIL.
- [ ] **Step 3: Implement** `src/lib/users/favorite-seed.ts`:

```ts
/** Maps a display name to the tag whose recipes should be auto-favorited for
 *  that person on first login. Partial, case-insensitive substring match for a
 *  small household. Returns null when no mapping applies. */
const NAME_TAG_MAP: Array<{ needle: string; tag: string }> = [
  { needle: "steven", tag: "Familywall-Favorit" },
  { needle: "janine", tag: "Janine" },
];

export function tagForUserName(name: string): string | null {
  const n = name.toLowerCase();
  for (const m of NAME_TAG_MAP) if (n.includes(m.needle)) return m.tag;
  return null;
}
```

- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit: `feat(users): name→favorite-tag mapping`.

---

## Task 3: User service (upsert, getCurrentUser, list, remove, seed)

**Files:** `src/lib/users/service.ts` (new). Test: `tests/users-service.test.ts` (temp-DB pattern, see `tests/unit-plural-matching.test.ts`).

- [ ] **Step 1: Failing tests** (insert seeds once by name; update bumps last_login; remove cascades). Seed setup: create a tag "Familywall-Favorit" + 2 recipes tagged with it; assert that upserting a user named "Steven Weingärtner" creates the user, sets `favoritesSeededAt`, and creates 2 favorites; a second upsert (same sub) updates `lastLoginAt` and does NOT duplicate favorites; a user named "Opa" gets `favoritesSeededAt` set but 0 favorites; `removeUser` deletes the row and its favorites.

```ts
// ... temp DB migrate + dynamic imports ...
// seed tag + recipes, then:
const { upsertUserFromSession, listUsers, removeUser } = await import("@/lib/users/service");
const { db } = await import("@/db");
const { recipeFavorite } = await import("@/db/schema");
const u = upsertUserFromSession({ sub: "abc", name: "Steven Weingärtner", lastLoginAt: 100 });
expect(u.favoritesSeededAt).not.toBeNull();
expect(db.select().from(recipeFavorite).all().filter((f) => f.userId === u.id)).toHaveLength(2);
const again = upsertUserFromSession({ sub: "abc", name: "Steven W.", lastLoginAt: 200 });
expect(again.id).toBe(u.id);
expect(db.select().from(recipeFavorite).all().filter((f) => f.userId === u.id)).toHaveLength(2); // no dup
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `src/lib/users/service.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { recipe, recipeFavorite, recipeTag, tag, user } from "@/db/schema";
import { tagForUserName } from "./favorite-seed";

export type UserRow = typeof user.$inferSelect;

export type UpsertInput = { sub: string; name: string; lastLoginAt: number };

/** Insert-or-update by `sub`. A brand-new user is seeded from tags once. */
export function upsertUserFromSession(input: UpsertInput): UserRow {
  const existing = db.select().from(user).where(eq(user.sub, input.sub)).get();
  if (existing) {
    db.update(user)
      .set({ name: input.name, lastLoginAt: input.lastLoginAt })
      .where(eq(user.id, existing.id))
      .run();
    return { ...existing, name: input.name, lastLoginAt: input.lastLoginAt };
  }
  const seededAt = input.lastLoginAt;
  const inserted = db
    .insert(user)
    .values({
      sub: input.sub,
      name: input.name,
      lastLoginAt: input.lastLoginAt,
      favoritesSeededAt: seededAt,
    })
    .returning()
    .all()[0];
  seedFavoritesFromTags(inserted);
  return inserted;
}

/** Insert favorites for every recipe carrying the user's mapped tag (if any).
 *  Idempotent (INSERT OR IGNORE via onConflictDoNothing). */
function seedFavoritesFromTags(u: UserRow): void {
  const tagName = tagForUserName(u.name);
  if (!tagName) return;
  const t = db.select({ id: tag.id }).from(tag).where(eq(tag.name, tagName)).get();
  if (!t) return;
  const recipeIds = db
    .select({ recipeId: recipeTag.recipeId })
    .from(recipeTag)
    .where(eq(recipeTag.tagId, t.id))
    .all();
  if (recipeIds.length === 0) return;
  db.insert(recipeFavorite)
    .values(
      recipeIds.map((r) => ({
        userId: u.id,
        recipeId: r.recipeId,
        createdAt: u.lastLoginAt,
      })),
    )
    .onConflictDoNothing()
    .run();
}

export function listUsers(): Array<{ id: number; name: string; lastLoginAt: number }> {
  return db
    .select({ id: user.id, name: user.name, lastLoginAt: user.lastLoginAt })
    .from(user)
    .orderBy(asc(user.name))
    .all();
}

export function removeUser(id: number): boolean {
  return db.delete(user).where(eq(user.id, id)).run().changes > 0;
}
```

Note: `createdAt`/`lastLoginAt` use injected timestamps (`input.lastLoginAt`) — never `Date.now()` in seeding logic that tests assert on; the caller (session/route) supplies the time.

- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit: `feat(users): upsert-from-session + list/remove + tag backfill`.

---

## Task 4: Favorites service

**Files:** `src/lib/recipes/favorites.ts` (new). Test: `tests/favorites-service.test.ts`.

- [ ] **Step 1: Failing test:** toggle on inserts, toggle off deletes, idempotent; `favoriteRecipeIdsForUser` returns the set.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement:**

```ts
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { recipeFavorite } from "@/db/schema";

export function toggleFavorite(
  userId: number,
  recipeId: number,
  favorite: boolean,
  now: number,
): void {
  if (favorite) {
    db.insert(recipeFavorite)
      .values({ userId, recipeId, createdAt: now })
      .onConflictDoNothing()
      .run();
  } else {
    db.delete(recipeFavorite)
      .where(and(eq(recipeFavorite.userId, userId), eq(recipeFavorite.recipeId, recipeId)))
      .run();
  }
}

export function favoriteRecipeIdsForUser(userId: number): Set<number> {
  return new Set(
    db
      .select({ recipeId: recipeFavorite.recipeId })
      .from(recipeFavorite)
      .where(eq(recipeFavorite.userId, userId))
      .all()
      .map((r) => r.recipeId),
  );
}
```

(import `and` from drizzle-orm.)

- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit: `feat(recipes): favorites toggle + per-user favorite-id set`.

---

## Task 5: Read models — isFavorite + favoriteOfUserId filter

**Files:** `src/lib/recipes/service.ts`, `src/lib/recipes/types.ts`. Test: `tests/favorites-list.test.ts`.

- [ ] **Step 1: Failing test:** with two users and favorites, `listRecipes({ currentUserId: A })` marks only A's favorites `isFavorite: true`; `listRecipes({ favoriteOfUserId: B })` returns only B's favorited recipes; combine with a `query` to confirm AND.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement:**
  - `RecipeListItem` (types.ts): add `isFavorite: boolean;`.
  - `ListRecipesOptions` (service.ts): add `currentUserId?: number;` and `favoriteOfUserId?: number;`.
  - In `listRecipes`: build `const myFavs = currentUserId != null ? favoriteRecipeIdsForUser(currentUserId) : new Set<number>();` and, when `favoriteOfUserId != null`, `const filterFavs = favoriteRecipeIdsForUser(favoriteOfUserId);`. In the per-row loop add `if (favoriteOfUserId != null && !filterFavs.has(r.id)) continue;`. In the returned item add `isFavorite: myFavs.has(r.id)`.
  - The recipe **detail** read model (`getRecipe`/`RecipeView`): add `isFavorite: boolean`. Add a `currentUserId?: number` parameter to `getRecipe` (default → isFavorite false) computing `isFavorite` via a single `recipe_favorite` lookup. (Confirm getRecipe's signature; thread the param from the page.)
- [ ] **Step 4:** Run test → PASS; `npm run test -- recipe` green.
- [ ] **Step 5:** Commit: `feat(recipes): isFavorite read flag + favorite-of-user list filter`.

---

## Task 6: Current-user resolver + wire OIDC callback

**Files:** `src/lib/users/current.ts` (new), `src/app/api/auth/callback/route.ts`.

- [ ] **Step 1:** `src/lib/users/current.ts`:

```ts
import { getSession } from "@/lib/server-session";
import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { upsertUserFromSession, type UserRow } from "./service";

/** Resolve the DB user for the current session, creating it (and seeding
 *  favorites) on first sight. Returns null when unauthenticated. Does NOT bump
 *  last_login on every read — that happens at the OIDC callback. */
export async function getCurrentUser(): Promise<UserRow | null> {
  const session = await getSession();
  if (!session.sub || !session.name) return null;
  const existing = db.select().from(user).where(eq(user.sub, session.sub)).get();
  if (existing) return existing;
  return upsertUserFromSession({
    sub: session.sub,
    name: session.name,
    lastLoginAt: Math.floor(Date.now() / 1000),
  });
}
```

- [ ] **Step 2:** In the OIDC callback, after `Object.assign(session, data)` and before `await session.save()`, add:

```ts
  upsertUserFromSession({ sub: data.sub, name: data.name, lastLoginAt: now });
```

(import `upsertUserFromSession`; `now` already exists in the callback.)

- [ ] **Step 3:** `npm run typecheck` clean in src. Commit: `feat(users): resolve current user; upsert on login`.

---

## Task 7: Favorite toggle endpoint

**Files:** `src/app/api/v1/recipes/[id]/favorite/route.ts` (new).

- [ ] **Step 1:** Implement (mirror needs-update):

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/users/current";
import { toggleFavorite } from "@/lib/recipes/favorites";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
const bodySchema = z.object({ favorite: z.boolean() });

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  toggleFavorite(me.id, id, parsed.data.favorite, Math.floor(Date.now() / 1000));
  return NextResponse.json({ ok: true, favorite: parsed.data.favorite });
}
```

- [ ] **Step 2:** `npm run typecheck` clean. Commit: `feat(api): PATCH recipe favorite toggle`.

---

## Task 8: Users API (list + delete)

**Files:** `src/app/api/v1/users/route.ts` (GET), `src/app/api/v1/users/[id]/route.ts` (DELETE).

- [ ] **Step 1:** GET returns `{ items: listUsers() }` (requires a session — return 401 if `getCurrentUser()` is null). DELETE parses id, `removeUser(id)`, returns `{ ok }` (404 if no change). Mirror the units `[id]` route shape.
- [ ] **Step 2:** `npm run typecheck` clean. Commit: `feat(api): users list + delete`.

---

## Task 9: Card heart + detail toggle components

**Files:** `src/components/recipes/favorite-heart.tsx` (new, card), `src/components/recipes/favorite-toggle.tsx` (new, detail), edits to `recipe-card.tsx` + `recipe-detail.tsx`.

- [ ] **Step 1:** `favorite-heart.tsx` — a `"use client"` button: props `{ recipeId, initial }`. Optimistic state; `PATCH /api/v1/recipes/[id]/favorite`; `router.refresh()`; revert on error; `onClick` calls `e.preventDefault(); e.stopPropagation()` (the card is a Link). `Heart` from lucide; `fill-current` + `opacity-100` when favorite, outline + `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` when not. Positioned by the parent.

- [ ] **Step 2:** `recipe-card.tsx` — add `<FavoriteHeart recipeId={recipe.id} initial={recipe.isFavorite} />` wrapped in an absolute `left-2 top-2 z-10` container (mirroring the edit pencil's `right-2 top-2`). The card stays a client component (it already is).

- [ ] **Step 3:** `favorite-toggle.tsx` — a detail-row button (mirror `NeedsUpdateToggle`): `{ recipeId, initial }`, optimistic PATCH + refresh, filled `Heart` + "Favorit"/"Als Favorit" label, accent styling when active.

- [ ] **Step 4:** `recipe-detail.tsx` — add `currentUserId?: number | null` is NOT needed; instead add `isFavorite: boolean` to the component props (the page passes it from the read model) and render `<FavoriteToggle recipeId={recipe.id} initial={recipe.isFavorite} />` in the action row next to `NeedsUpdateToggle`. (The detail read model already carries `isFavorite` from Task 5 — render `recipe.isFavorite`.)

- [ ] **Step 5:** `npm run typecheck` + `npm run build` (RSC boundary). Commit: `feat(recipes): favorite heart on cards + toggle on detail`.

---

## Task 10: Thread currentUserId through the pages

**Files:** `src/app/(app)/rezepte/page.tsx`, `src/app/(app)/rezepte/[id]/page.tsx`.

- [ ] **Step 1:** `[id]/page.tsx` — `const me = await getCurrentUser();` and `const recipe = getRecipe(id, me?.id ?? null);` so the detail read model computes `isFavorite`. (Update `getRecipe` signature in Task 5 accordingly.)
- [ ] **Step 2:** `rezepte/page.tsx` — `const me = await getCurrentUser();`. Parse `fav` from searchParams; pass `currentUserId: me?.id` and `favoriteOfUserId` (from `fav`) into `toListOptions`/`listRecipes`. Load `const users = listUsers();` and pass `users` + `currentUserId` to `RecipeFilterBar` and the `fav` value to `RecipeGridVirtual.filters`. Add `fav` to `filterKey`.
- [ ] **Step 3:** `list-query.ts` `toListOptions` — accept `fav` + `currentUserId`; set `favoriteOfUserId: fav ? Number(fav) : undefined`. (Add `currentUserId` to its input and pass through.)
- [ ] **Step 4:** `RecipeGridVirtual` + `GET /api/v1/recipes` — the client grid refetches the full list; ensure `fav` rides along in its filter→query (Task 11 covers the filter-bar serialization; the grid passes the same params). Add `fav` to the grid's `filters` prop type and to the query it builds, and `currentUserId`/`favoriteOfUserId` handling in the recipes API route (mirror page). Quote and follow the existing grid fetch.
- [ ] **Step 5:** `npm run build`. Commit: `feat(recipes): thread current user + favorites filter through list/detail pages`.

---

## Task 11: Favorites filter control

**Files:** `src/components/recipes/favorites-filter.tsx` (new), `recipe-filter-bar.tsx`.

- [ ] **Step 1:** Inspect `needs-update-filter.tsx` to copy its URL-backed-vs-controlled pattern (reads/writes the page URL when no `value`/`onChange`).
- [ ] **Step 2:** `RecipeFilterValue` gains `favoriteUserId: number | null` (null = off); add to `EMPTY_RECIPE_FILTER`; `recipeFilterToQuery` adds `if (f.favoriteUserId != null) p.set("fav", String(f.favoriteUserId))`.
- [ ] **Step 3:** `RecipeFilterBar` gains optional props `users?: {id;name}[]` and `currentUserId?: number | null`. Render `<FavoritesFilter users={users} currentUserId={currentUserId} value=… onChange=… />` only when `users` is provided (so the planner, which doesn't pass users, doesn't show it).
- [ ] **Step 4:** `favorites-filter.tsx` — a segmented control: a `[★ Favoriten]` toggle button + a `<select>` of users (default option = current user labeled "Meine"; other users by name). Toggle on → set `favoriteUserId` to the selected user (default current); off → null. In URL-backed mode read/write `fav` directly (mirror needs-update-filter).
- [ ] **Step 5:** `npm run build`. Commit: `feat(recipes): favorites-by-user filter control`.

---

## Task 12: Settings — user management page

**Files:** `src/app/(app)/einstellungen/benutzer/page.tsx` (new), `src/components/settings/users/user-list-client.tsx` (new), settings index link.

- [ ] **Step 1:** Server page (mirror `einstellungen/zutaten/page.tsx`): back-link + `listUsers()` → `<UserListClient initialUsers={...} />`.
- [ ] **Step 2:** `UserListClient` — table/list of name + last login (format with the app's date convention), each with a Remove button calling `DELETE /api/v1/users/[id]` then `router.refresh()`. Confirm-on-click (no native dialog that blocks — a small inline confirm or just immediate per existing patterns).
- [ ] **Step 3:** Add a card/link to the settings index (`einstellungen/page.tsx` `STAMMDATEN_LINKS` or the appropriate nav array) pointing to `/einstellungen/benutzer` ("Benutzer").
- [ ] **Step 4:** `npm run build`. Commit: `feat(settings): user management list (name, last login, remove)`.

---

## Task 13: Full verification
- [ ] `npm run test` → green (note any pre-existing test-fixture typecheck failures are unrelated).
- [ ] `npm run typecheck` → no NEW src errors.
- [ ] `npm run build` → passes.
- [ ] Manual sanity: heart toggles on a card + persists across refresh; detail toggle; `fav` filter narrows the list; settings lists users.

---

## Self-review notes
- **Spec coverage:** model (T1), backfill mapping + seed (T2–T3), favorites toggle service/api (T4,T7), read flags + filter (T5), current-user + login upsert (T6), UI card+detail (T9), pages threading (T10), filter control (T11), settings (T12). All spec sections map to a task.
- **Type consistency:** `currentUserId`/`favoriteOfUserId` (numbers), `isFavorite` (bool on read models), `favoriteUserId` (filter value), `tagForUserName`, `upsertUserFromSession`, `getCurrentUser`, `toggleFavorite`, `favoriteRecipeIdsForUser` named consistently across tasks.
- **No Date.now in tested logic:** seeding/upsert take an injected `lastLoginAt`/`now`; only the thin route/page callers read the clock.
- **Re-seed on re-add:** intentional — a removed user returns with a null `favoritesSeededAt` and re-seeds.
