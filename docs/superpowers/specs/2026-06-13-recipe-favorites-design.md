# Per-user Recipe Favorites — Design

**Date:** 2026-06-13
**Status:** Approved for planning (autonomous implementation)

## Problem

Each household member wants their own favorite recipes. There's no `user` table
today — users are only identified by their OIDC `sub` at login. Existing data
already carries the intent as tags: **Familywall-Favorit** (17 recipes, Steven's
favorites from the Familywall import) and **Janine** (114 recipes, Janine's).

## Goal

- A per-user favorite flag on recipes.
- Toggle a favorite from the recipe detail page and from each recipe-list card
  (a heart in the image corner, like the edit button).
- A recipe-list filter to show favorites — your own by default, or another
  user's via a dropdown.
- Users are created automatically from OIDC logins; a settings screen lists them
  (name + last login) and can remove one.
- One-time backfill: Familywall-Favorit → Steven, Janine → Janine.

## Decisions (from brainstorming)

- **User table** keyed by OIDC `sub`, auto-filled on login, storing `name` and
  `last_login_at`. Favorites reference the user; removing a user clears their
  favorites until they log back in.
- **Backfill** runs at first login, matching the display name by partial,
  case-insensitive contains ("Steven" / "Janine") → seed from the mapped tag,
  once per user (guarded by a `favorites_seeded_at` stamp).
- **Card heart**: filled + always visible when it's my favorite; outline +
  hover/focus-only when not (mirrors the edit pencil).
- **Filter**: a unified segmented control — a "★ Favoriten" toggle plus a user
  dropdown (all users, default = me). On → filter to the selected user's
  favorites; off → no filter. Combines with search/tags/diet.
- **Re-seeding on re-add is intentional**: a removed Steven/Janine who logs back
  in gets a fresh row (null `favorites_seeded_at`) and is re-seeded from tags.

## Data model (migration `0040`)

```
user:
  id              integer PK autoincrement
  sub             text NOT NULL UNIQUE          -- OIDC subject
  name            text NOT NULL
  last_login_at   integer NOT NULL              -- unix seconds
  favorites_seeded_at integer                   -- nullable; set after backfill

recipe_favorite:
  user_id     integer NOT NULL → user.id   ON DELETE CASCADE
  recipe_id   integer NOT NULL → recipe.id ON DELETE CASCADE
  created_at  integer NOT NULL
  PRIMARY KEY (user_id, recipe_id)
```

Migration is additive (new tables only); applies cleanly on container start.

## User upsert + backfill (`src/lib/users/service.ts`)

`upsertUserFromSession(session)`:
- If a row with `sub` exists → update `name`, `last_login_at`, return it.
- Else insert `{sub, name, last_login_at}`; then run the backfill for the new
  row; return it.

`seedFavoritesFromTags(user)` (called once, on insert):
- Mapping (hardcoded config): name contains "steven" (ci) → tag
  "Familywall-Favorit"; name contains "janine" (ci) → tag "Janine".
- If a mapping matches, insert a `recipe_favorite` for every recipe carrying
  that tag (INSERT OR IGNORE). Stamp `favorites_seeded_at` regardless of match
  (so a non-matching user isn't re-checked, and a matched one isn't re-seeded).

The upsert is invoked from the OIDC callback (`src/app/api/auth/callback`) after
the session is established, so a user row exists right after login. (Also safe to
call from a session-read helper if the callback can't see the final claims, but
the callback is the single natural place.)

## Favorites service (`src/lib/recipes/favorites.ts`)

- `toggleFavorite(userId, recipeId, favorite: boolean)` — INSERT OR IGNORE /
  DELETE.
- `isFavorite(userId, recipeId)` — boolean (used where a single check is needed).
- The list/detail read paths get `isFavorite` for the current user via a join /
  a set of favorited recipe ids for that user.

## API

- `POST /api/v1/recipes/[id]/favorite` — body `{ favorite: boolean }`. Resolves
  the current user from the session (upsert to be safe), toggles, returns
  `{ favorite }`. 401 when unauthenticated. Mirrors the needs-update endpoint.
- `GET /api/v1/users` — list `{ id, name, lastLoginAt }` (for the filter
  dropdown and settings). Ordered by name.
- `DELETE /api/v1/users/[id]` — remove the user row (favorites cascade).

## Read models

- `RecipeListItem` gains `isFavorite: boolean` (current user). `listRecipes`
  gains options: `currentUserId` (to compute `isFavorite`) and
  `favoriteOfUserId` (filter: only recipes favorited by that user). The favorite
  filter is a join/`IN` against `recipe_favorite`.
- The recipe detail read model gains `isFavorite: boolean` (current user).
- The recipe pages resolve the current user id from the session and pass it
  through.

## UI

### Recipe card (`src/components/recipes/recipe-card.tsx`)
- Add a heart button in the **top-left** corner (the edit pencil is top-right).
- Filled heart, always visible (`opacity-100`) when `isFavorite`; outline heart,
  `opacity-0 … group-hover:opacity-100 focus-visible:opacity-100` when not.
- Client component island for the toggle (the card is currently a server-ish
  link); the heart is a small client button doing an optimistic `POST` and
  refreshing. Stops propagation so it doesn't trigger the card's navigation.

### Recipe detail (`src/components/recipes/recipe-detail.tsx`)
- A `FavoriteToggle` button in the existing action row (next to Bearbeiten),
  filled/outline by state, optimistic POST.

### Favorites filter (`src/components/recipes/recipe-filter-bar.tsx`)
- A segmented control: `[ ★ Favoriten ]` toggle + a user `<select>` dropdown of
  all users (default = the current user, labeled "Meine"). When the toggle is
  on, the active user id is in the filter; off → none.
- `RecipeFilterValue` gains `favoriteUserId: number | null` (null = off).
- `recipeFilterToQuery` serializes `fav=<userId>`; the page parses it into
  `favoriteOfUserId`.
- The dropdown's user list is fetched (`GET /api/v1/users`) or passed in as a
  prop from the page (preferred — the page already runs server-side and can load
  users once).

### Settings — user management
- A new settings section/page listing users (name + last login) with a Remove
  button (`DELETE /api/v1/users/[id]`). Follows the existing settings list
  patterns.

## Testing

- **User service**: upsert inserts a new user (stamps last_login), updates an
  existing one (name + last_login, no duplicate); backfill seeds favorites once
  by partial name match, sets `favorites_seeded_at`, and does not re-seed when
  the stamp is already set; a non-matching name seeds nothing but still stamps.
- **Favorites**: toggle on/off is idempotent; cascade — deleting a user removes
  their favorites; deleting a recipe removes its favorites.
- **List filter**: `favoriteOfUserId` returns only that user's favorites and
  combines with `q`/tags/diet; `isFavorite` reflects `currentUserId`.
- **API**: favorite toggle requires a session (401 otherwise); `GET /users`
  lists users; `DELETE /users/[id]` cascades favorites.

## Out of scope

- Sharing/visibility limits beyond "see any user's favorites" (open within the
  household, matching the app's existing trust model).
- Favorites on the planner's recipe picker filter (the shared card heart will
  still appear there; the favorites *filter* is added to `/rezepte`).
- Editing a user's name in-app (it always reflects the latest OIDC claim).
