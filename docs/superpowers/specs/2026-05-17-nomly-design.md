# nomly — Design Specification

- **Date:** 2026-05-17
- **Status:** Design approved; epics defined; implementation pending
- **Owner:** Steven Weingärtner

## 1. Purpose

Personal webapp combining a cookbook, a meal planner, and a shopping list, used by two people on a self-hosted LAN deployment. The workflow it supports:

1. Add recipes — manual entry, import from URL, and a one-time bulk import from Familywall (legacy).
2. Plan meals on a calendar.
3. Generate a shopping list for an upcoming window of days.
4. Use the shopping list on a phone inside a supermarket — must work offline and stay live-synced with the other user when online.
5. Expose a small REST API so Home Assistant can read and check off items on the shopping list.

## 2. Top-Level Decisions

| Topic | Decision |
|---|---|
| Auth | OIDC (Authentik or any compliant IdP). **All authenticated users see the same data** — auth is a gate, not a partition. No user table. |
| API access for machines | `api_token` rows issued from settings UI; bearer tokens grant `/api/v1/*` access without an OIDC session. This is how HA connects. |
| Deployment | Docker image published to `ghcr.io/examinator/nomly` via GitHub Actions on push to `main` and on tags. Docker Compose recipe in repo. Container runs as non-root, mounts `./data:/app/data` for SQLite DB and photos. |
| UI language | German only. No i18n framework. |
| Entity naming | One canonical `name` per entity. Where useful (`ingredient`, `product`, `unit`, `category`), an `*_alias` child table provides search hits. No language tags anywhere. |
| Hosting | Self-hosted Node.js process behind a reverse proxy on the home network. |
| Stack | Next.js 16 (App Router, Turbopack), TS, Tailwind v4, better-sqlite3 + Drizzle ORM. |
| Server | Custom `server.ts` runs Next + WebSocket server on a single HTTP port. |
| Offline | Shopping list page is a PWA with IndexedDB + service worker + offline mutation queue. |
| Realtime | WebSocket pub/sub on shopping-list and meal-plan topics. |
| External API | REST under `/api/v1/...` with bearer-token auth for Home Assistant. |
| DB file | `./data/nomly.db` — WAL mode, foreign keys on. |
| Photos | `./data/photos/<uuid>.webp`, resized on upload with `sharp`. |
| Planner UX | Desktop = two-column (calendar left, recipe list right) with drag-and-drop. Mobile = single-column tap-to-add. Visible days and start weekday are configurable. |
| iCal | Server-side fetch + parse of user-configured iCal URLs (`node-ical`); events shown alongside meals in the planner. |
| Non-recipe products | Manually-added shopping items (toilet paper, batteries…) are first-class `product` entities — reusable across lists, with their own categories, aliases, and management UI. |
| Shopping list | **One running list, forever.** No "create new list" / "complete list" / history concepts. Adding meals appends to it. Checked items render as grayed/strikethrough and stay visible for 24 h, then a background sweeper deletes them. Unchecked items stay until checked. |
| Supermarket filter | Stored per-device in `localStorage` — different devices/users can hold different active filters. |
| UI design | Mobile-first, touch-friendly, modern. Tailwind v4 + Radix UI primitives + shadcn-style component layer + `lucide-react` + `next-themes` (dark mode default) + `framer-motion` for transitions. See §5.7. |
| Seed data | Default ingredient / unit / category / supermarket library imported from [`TandoorRecipes/open-tandoor-data`](https://github.com/TandoorRecipes/open-tandoor-data) (DbCL contents, ODbL schema). A snapshot of `build/de.json` is vendored into the repo; a transform script (Epic 1) idempotently maps it into our schema on first migrate. Attribution lives in `THIRD_PARTY_NOTICES.md` and the README. |

## 3. Domain Model

### 3.1 Naming pattern

Every entity that represents a real-world concept stores a single canonical `name` (text, language-agnostic). The UI always shows this name.

Four entity types — `ingredient`, `product`, `unit`, `category` — have an additional `*_alias` table holding free-form alternate names (`(parent_id, name)`). Aliases participate in autocomplete and matching but are never displayed in lieu of the canonical name.

`recipe.title`, `tag.name`, `supermarket.name`, `ical_feed.name` are canonical-only — no alias table.

`ingredient` and `product` are separate namespaces. An ingredient is something used in a recipe; a product is something bought manually but never referenced from a recipe. The autocomplete in "Artikel zur Einkaufsliste hinzufügen" searches both namespaces and shows the type next to each hit.

### 3.2 Tables (Drizzle target schema, final form lives in migrations)

```
recipe
  id, title, description (md, optional), source_url (optional),
  photo_path (optional), servings, prep_time_min, cook_time_min,
  created_at, updated_at

recipe_section
  id, recipe_id (FK), title (nullable; e.g. "Teig", "Sauce", null = main),
  instructions (md), sort_order

recipe_ingredient
  id, section_id (FK), ingredient_id (FK),
  quantity (decimal, nullable — "eine Prise"), unit_id (FK, nullable),
  notes (nullable; e.g. "fein gehackt"), sort_order

ingredient
  id, name, default_category_id (FK, nullable),
  exclude_from_shopping_list (bool, default false),
  created_at, updated_at

ingredient_alias
  id, ingredient_id (FK), name
  -- globally unique across (ingredient.name ∪ ingredient_alias.name)

product
  id, name, default_category_id (FK, nullable),
  created_at, updated_at

product_alias
  id, product_id (FK), name
  -- globally unique across (product.name ∪ product_alias.name)

unit
  id, name, dimension (enum: mass | volume | count),
  base_unit_id (FK, nullable, self-ref),
  factor (decimal; conversion to base unit; 1 for base units)

unit_alias
  id, unit_id (FK), name (globally unique)

category
  id, name

category_alias
  id, category_id (FK), name (globally unique)

tag
  id, name (unique)

recipe_tag
  recipe_id, tag_id  (composite PK)

meal_plan
  id, recipe_id (FK), date, servings_override (nullable),
  note (nullable), sort_order, created_at

supermarket
  id, name (unique)

supermarket_category
  id, supermarket_id (FK), category_id (FK), sort_order
  -- unique(supermarket_id, category_id)

shopping_item
  id,
  ingredient_id (FK, nullable), product_id (FK, nullable),
  -- XOR: exactly one of ingredient_id / product_id is set
  quantity (decimal, nullable), unit_id (FK, nullable),
  category_id (FK, nullable; snapshot from
    ingredient.default_category_id OR product.default_category_id at add-time),
  checked (bool, default false), checked_at (nullable),
  note (nullable), sort_order,
  version (int, monotonic — for sync conflict resolution),
  created_at, updated_at

shopping_item_source
  id,
  item_id (FK shopping_item.id, ON DELETE CASCADE),
  meal_plan_id (FK meal_plan.id, ON DELETE CASCADE),
  recipe_ingredient_id (FK recipe_ingredient.id, ON DELETE CASCADE),
  contributed_quantity (decimal, nullable),
  contributed_unit_id (FK unit.id, nullable),
  added_at
  -- Many-to-many between items and the (meal_plan, recipe_ingredient)
  -- combos that contributed to them. Items merged from multiple meals
  -- have multiple rows here. Manually-added items have none.
  -- contributed_quantity / contributed_unit_id store the scaled
  -- contribution at add-time so meal removal can subtract precisely
  -- (§4.2.1). A meal_plan is "currently on the list" iff at least one
  -- row references it.

ical_feed
  id, name, url, color (hex, e.g. "#3b82f6"),
  enabled (bool, default true),
  last_fetched_at (nullable),
  last_error_at (nullable), last_error_message (nullable),
  created_at

api_token
  id, name (label), token_hash, last_used_at (nullable),
  created_at, revoked_at (nullable)

app_setting
  key (PK), value
  -- e.g.
  --   shopping_list.default_length_days = "7"
  --   planner.days_visible              = "7"
  --   planner.start_weekday             = "1"  (ISO 1=Mon … 7=Sun)
```

### 3.3 Invariants

- An `ingredient`'s `name` and all its `ingredient_alias.name` rows are globally unique across the union — typing any of them resolves to exactly one ingredient. Same rule for `product`, `unit`, `category` within their own namespaces.
- `ingredient` and `product` share no uniqueness constraint with each other — `"Salz"` could exist as both, though the merge tooling in Epic 7 makes it easy to clean up.
- Every `recipe` has at least one `recipe_section`. A single-section recipe uses one section with `title = null` and the UI renders it flat.
- `shopping_item.ingredient_id` and `shopping_item.product_id` are mutually exclusive (XOR): exactly one is set.
- `unit` conversions only sum within the same `dimension`. Cross-dimension entries for one ingredient render as separate lines under one ingredient header.
- A `shopping_item` whose `checked = true` and `checked_at < now() - 24h` is eligible for deletion by the background sweeper (§4.4). Until then it stays on the list, rendered in a struck-through / muted style.
- A `meal_plan` is "currently on the shopping list" iff `shopping_item_source` has a row referencing it (transitively, the item it produced still exists). When the last sourced item is purged or deleted, the meal naturally becomes addable again from the dialog.
- Editing a `meal_plan` after its ingredients have been added does NOT retroactively update the items it produced. The items remain effectively snapshotted at add-time at the item level.

## 4. Key Flows

### 4.1 Recipe creation

- "Neues Rezept" → form: Titel, Beschreibung (optional, Markdown), Portionen, Vorbereitungszeit, Kochzeit, Quelle-URL, Foto, Tags.
- One or more sections. Each section: Titel (optional) + Anleitung (Markdown) + Zutaten-Liste.
- Zutat row: Menge, Einheit, Zutat, Notiz. `Einheit` and `Zutat` are autocompletes against canonical name ∪ aliases; `Zutat neu anlegen` and `Einheit neu anlegen` available inline.
- New ingredients created inline get `default_category_id = null`; they can be categorized later from the ingredient management page.
- Save persists the recipe + sections + ingredients atomically.

### 4.2 Meal planning

**Settings (in `app_setting`):**
- `planner.days_visible` — integer, default `7`.
- `planner.start_weekday` — ISO 1–7, default `1` (Monday). Controls which weekday the visible window starts on when "Heute" is pressed.

**Desktop layout (≥ md breakpoint):**
- Two columns. Left = calendar showing `days_visible` consecutive days starting from the current range origin. Right = recipe list (search by title/tag + filter chips).
- Each day-cell stacks: planned meals first (movable), then iCal events (read-only, rendered with the source feed's color) — see §4.5.
- Drag-and-drop:
  - From recipe-list card → drop on day-cell → creates a `meal_plan` row with `servings_override = recipe.servings` and `sort_order = max + 1`.
  - From day-cell meal card → drop on another day-cell → moves the meal (updates `date`, recomputes `sort_order`).
  - Within a day-cell → reorders via `sort_order`.
- Range nav: `←` / `→` buttons advance by `days_visible`; "Heute"-Button jumps back to today and resets the origin to the configured `start_weekday`.
- Click a meal card → side panel for editing portions and note; delete from there.

**Mobile layout (< md breakpoint):**
- Single column: calendar only, no recipe list panel.
- Drag-and-drop is disabled. Adding a meal: tap a day → "Mahlzeit hinzufügen" → recipe-search modal → portions + note → save.
- Reorder within a day: long-press handle (lightweight DnD inside one cell is acceptable, cross-day moves use a "Verschieben" action with a date picker).

**Both layouts:**
- Multiple meals per day stack in `sort_order`.
- iCal events appear inline with meals but are visually distinct (left-color-bar from feed color, read-only).

#### 4.2.1 Deleting a meal that has hit the shopping list

If a meal is deleted from the plan after its ingredients have already been added to the shopping list, the user is asked what to do with those ingredients. The server checks `shopping_item_source` for rows pointing at the meal's `meal_plan_id`; if any exist, the delete confirmation shows three options:

- **"Nur Mahlzeit löschen"** — deletes the `meal_plan` row only. The `shopping_item_source` rows go with it via `ON DELETE CASCADE`, but the underlying `shopping_item` rows keep their current quantity. The items effectively become "manual" (no remaining source); they stay on the list until checked or manually deleted.
- **"Mahlzeit und Zutaten entfernen"** — for each `shopping_item` referenced by this meal: recompute the quantity from the remaining `shopping_item_source` rows (sum `contributed_quantity` converted to a common unit per `(ingredient, dimension)` bucket). If the recomputed quantity is `0` (no other sources), delete the item. Otherwise update `quantity` and bump `version`. Then delete the `meal_plan` row. The whole flow is one transaction; affected item changes broadcast on the `shopping` WS topic.
- **"Abbrechen"** — no changes.

If no `shopping_item_source` rows reference the meal, the delete confirmation is the regular one-button "Mahlzeit löschen?" prompt with no shopping-list mention.

Note: manual quantity edits the user made after the meal was added are not tracked separately, so the "Zutaten entfernen" path may lose them. Flagged in open questions.

### 4.3 Adding meals to the shopping list

There is **one running shopping list**, forever. The `/einkauf` page renders it directly — no completion flow, no history, no list IDs in URLs.

**The "Mahlzeiten zur Einkaufsliste hinzufügen" dialog** is the single way to append meals. It owns the date selection:

```
Mahlzeiten zur Einkaufsliste hinzufügen

Startdatum: [ 19.05.2026 ▾ ]   Länge: [ 7 ] Tage

[ Alle auswählen ]  [ Keine auswählen ]

▣ Mo, 19.05.  Spaghetti Bolognese (4 Portionen)
   ▣ 500 g Hackfleisch
   ▣ 1 Dose Tomaten
   ▣ 200 g Spaghetti
   ...

▣ Di, 20.05.  Linsensuppe (2 Portionen)
   ▣ 250 g Linsen
   ▣ 1 Karotte
   ...

                                [ Abbrechen ]  [ Übernehmen ]
```

- Startdatum defaults to today; Länge defaults to `shopping_list.default_length_days` (setting, default 7).
- The preview below the controls refreshes live as the user changes date or length.
- The preview is computed server-side per §4.3.1: every meal plan in `[start, start + length - 1]` scaled by `servings_override / recipe.servings`, with `exclude_from_shopping_list = true` ingredients pre-filtered out. Each meal carries an `alreadyOnList: boolean` flag — true iff a `shopping_item_source` row still references it (transitively, an item still exists on the list). Meals with zero eligible ingredients after filtering are hidden.
- **New meals start checked.** Already-on-list meals start **unchecked** and display a "Bereits auf der Liste" badge next to the recipe title — explicit opt-in is required to re-add them. Re-adding a meal still on the list invokes the merge-on-add path; the new contribution is summed onto the existing item and a fresh `shopping_item_source` row is written for the new add-event.
- Each meal-card's header checkbox toggles every ingredient inside; indeterminate state when only some are checked.
- "Alle auswählen" / "Keine auswählen" header buttons apply across the entire current preview.
- "Übernehmen" merges the checked ingredients into the running list (per §4.3.2) and inserts `shopping_item_source` rows linking each affected item back to the contributing `(meal_plan, recipe_ingredient)` pairs.
- "Abbrechen" closes the dialog without changes.
- Empty preview state: the dialog still opens, shows a "Keine Mahlzeiten in diesem Zeitraum" note, and offers "Abbrechen" (the user can still add products directly from the list page).
- On mobile this dialog renders as a full-height bottom sheet rather than a modal — see §5.7.

#### 4.3.1 Preview computation

For a given `(start_date, length_days)`:

1. `meal_plan` rows in `[start, start + length - 1]`.
2. For each, expand `recipe_section.recipe_ingredient` and scale quantities by `servings_override / recipe.servings`.
3. Drop lines where the ingredient has `exclude_from_shopping_list = true`.
4. Drop meals that end up with no remaining lines.
5. For each remaining meal, set `alreadyOnList = true` iff `shopping_item_source.meal_plan_id` references it (transitively, an item still exists).
6. Return as `[{ mealPlanId, date, recipeTitle, servings, alreadyOnList, ingredients: [{ recipeIngredientId, ingredient, qty, unit, notes }] }]`.

#### 4.3.2 Merge-on-add algorithm

For the user's checked selection:

1. Group selected `(ingredient_id, unit.dimension)` pairs across the entire selection (NOT per meal — overlaps merge).
2. Within each `(ingredient, dimension)` bucket, convert to the base unit and sum; format in the largest sensible unit (`1200g → 1,2 kg`).
3. Open-ended lines (null quantity) within a bucket collapse to one line.
4. For each merged bucket, look for an existing `shopping_item` with the same `(ingredient_id, unit.dimension)`:
   - **Found and unchecked:** add the new amount onto the existing item's quantity. Bump `version` and `updated_at`.
   - **Found and checked (within the 24 h grace window):** uncheck it (`checked = false`, clear `checked_at`), set quantity to the new amount, bump `version` / `updated_at`. Rationale: the user has decided they need this item again — re-add ⇒ reactivate.
   - **Not found:** create a new `shopping_item` with `category_id` snapshotted from `ingredient.default_category_id`.
5. For every affected item, insert one `shopping_item_source` row per contributing `(meal_plan, recipe_ingredient)`, recording the scaled `contributed_quantity` and `contributed_unit_id` from that line. The dialog uses these rows to flag the meal as `alreadyOnList`; the meal-delete flow uses them to compute precise subtractions (§4.2.1).
6. Cross-dimension lines for the same ingredient remain separate but render under one ingredient header in the UI (no special DB representation — just a UI grouping by `ingredient_id` on render).

**Products** are not touched by this flow — they are appended manually via §4.4.

### 4.4 Shopping in a store (offline + sync)

- `/einkauf` is the offline-capable page and renders the single running list.
- Top-bar controls on the page:
  - "Mahlzeiten hinzufügen" → opens the §4.3 dialog.
  - "Artikel hinzufügen" → autocomplete across `ingredient ∪ product` (with type label per result). If nothing matches, "Als neues Produkt anlegen" creates a new `product` row inline (with optional category) and attaches it. New products are reusable later and editable via Epic 7 management.
  - **Supermarkt-Filter** dropdown — persists per device in `localStorage` (key `nomly.shopping.supermarketId`). When set, items group by `category` and sort by that supermarket's `sort_order`; when unset, items sort by ingredient/product name. The setting is purely a view filter — never written to the database, so two devices can hold different filters simultaneously.

**Item lifecycle and display.**

- Unchecked items render fully styled, sorted per the active supermarket filter.
- Each item row shows three explicit action buttons (no swipe gestures): **check** (toggles `checked`), **edit** (opens an inline editor for qty / unit / note), **delete** (hard delete, no 24 h grace). Same buttons across mobile and desktop — consistent and discoverable.
- Each item displays its meal sources beneath the name as small chips: `Für: Spaghetti Bolognese (Mo, 19.05.), Lasagne (Mi, 21.05.)`. Tapping a chip routes to the meal in the planner. Items with no sources (manually-added) show no chips.
- Checked items render with a strike-through, reduced opacity, and a visible "Rückgängig" button (replacing the check button). They remain in the same position so the user can see what's been grabbed without losing context.
- A background sweeper inside the custom server (`server.ts`, fires every 60 minutes) deletes items where `checked = true AND checked_at < now() - INTERVAL '24 hours'`. Each deletion broadcasts on the WS so connected clients update in real time.
- The same sweep cleans up orphaned `shopping_item_source` rows (cascade handles this automatically) and, transitively, makes the contributing meal plans eligible for re-add in the §4.3 dialog.
- The sweeper also runs once at app boot (so a restarted container catches up).

**Mutation transport and sync.**

- First visit (while online) caches the list payload to IndexedDB and the app shell to the service worker cache.
- Every mutation (check, uncheck, edit qty/unit/note, add item, delete) writes to IndexedDB first and is sent to the server, queued if offline. The transport evolves across epics: Epic 8 ships with HTTP `POST`/`PATCH` to the existing REST endpoints; Epic 9 swaps to a WebSocket mutate frame on the same protocol shape and adds live peer broadcast.
- Each mutation carries a client-generated `mutationId` and the item's last-known `version`. The server applies LWW per item: a mutation with a stale `version` is reconciled (the server's current state wins for the conflicting field) and the merged state is returned (and, from Epic 9, broadcast).
- On reconnect, the queue flushes FIFO. Server idempotency dedupes by `mutationId`.
- From Epic 9 onward, all clients subscribed to the `shopping` topic receive item updates in real time.

### 4.5 iCal calendar feeds

- Settings page `/einstellungen/kalender` provides CRUD for `ical_feed` rows (Name, URL, Farbe, Aktiv).
- On the planner page load, the server fetches each `enabled = true` feed and parses with `node-ical`. Results cached in memory for 5 minutes (key = `ical_feed.id`); a "Aktualisieren" button on the planner forces a refresh.
- Per-feed errors (network/parse) are stored in `last_error_*` and surfaced as a small warning chip on the planner header; the rest of the planner keeps working.
- Only events that fall within the visible range are returned to the client.
- Recurring events are expanded by `node-ical` and filtered to the visible range.
- Events are display-only — they cannot be edited, dragged, or converted into meals in v1.

### 4.6 Home Assistant integration

Two concrete use cases drive the API surface:

1. **Voice-add to the shopping list.** From an HA voice assist intent like *"Setz Toilettenpapier auf die Einkaufsliste"*, HA calls a single endpoint with a free-text item name. The server resolves the name against existing ingredient and product aliases; on match it adds a reference, on miss it creates a new product. The response says which path was taken so HA can respond *"Vorhandener Eintrag hinzugefügt"* or *"Neues Produkt angelegt und hinzugefügt"*.
2. **Today's / tomorrow's meals on a dashboard.** An HA template card fetches today's (or upcoming N days') planned meals — each with title, photo URL, description, scaled ingredient list, and instructions — and renders them. One round-trip per refresh.

Token issuance in settings: enter a label → token shown once → only the hash is stored. Single token type, no scopes (v1).

**Auth model.** Every request to `/api/v1/*` must present **either** a valid OIDC session cookie (this is how the web UI calls these endpoints) **or** a valid bearer token from `api_token` (this is how HA calls them). Anything else returns `401`. WebSocket upgrades on `/ws` use the same rule: session cookie passed automatically by the browser, or `Authorization: Bearer …` header / `?token=` query param for non-browser clients.

Endpoints under `/api/v1/`:

**Shopping list** — there is exactly one running list. Endpoints are unscoped:

  - `GET /api/v1/shopping` — full list with items. Items include `checked` and `checked_at` (for the 24 h grace state) plus `sources: [{ mealPlanId, mealDate, recipeId, recipeTitle, contributedQuantity, contributedUnit }, ...]` so dashboards can render "Für: …" chips. Manually-added items return `sources: []`.
  - `POST /api/v1/shopping/items` — add an item. Body is one of:
    - `{ ingredient_id, quantity?, unit_id?, note? }` — existing ingredient
    - `{ product_id, quantity?, unit_id?, note? }` — existing product
    - `{ newProduct: { name, default_category_id? }, quantity?, unit_id?, note? }` — explicit new product
    - `{ byName: "Toilettenpapier", quantity?, unit?, note? }` — **the voice-add path**: server searches `ingredient.name ∪ ingredient_alias.name ∪ product.name ∪ product_alias.name` (case-insensitive, exact match first then substring). If exactly one match, attach as that type. If no match, create a `product` with that canonical name and attach. If multiple matches, return `409` with the candidates and let the caller disambiguate.
    - Response: the created or reactivated item plus `resolved: { mode: "ingredient" | "product" | "createdProduct", refId, displayName }` and `action: "created" | "incremented" | "reactivated"` so HA can speak a tailored confirmation.
    - `unit` (string) may be passed instead of `unit_id` and is resolved the same alias-aware way.
  - `PATCH /api/v1/shopping/items/:itemId` — toggle `checked` (sets/clears `checked_at`), edit `quantity` / `unit_id` / `note`.
  - `DELETE /api/v1/shopping/items/:itemId` — immediate hard delete (no 24 h grace).
  - `POST /api/v1/shopping/preview-meals` — body `{ start, length }`; returns the dialog preview per §4.3.1.
  - `POST /api/v1/shopping/add-meals` — body `{ start, length, selection: [{ mealPlanId, recipeIngredientIds: [...] }] }`; merge-on-add per §4.3.2; writes `shopping_item_source` rows.

**Photos**
  - `GET /api/v1/photos/:filename` — streams the binary from `data/photos/<filename>`. Returned `photoUrl` fields in other endpoints reference this path.

**Meal plans** — all return nested recipe data shaped for dashboards (scaled `recipe_ingredient` quantities applied, `recipe.photo_path` materialized as an absolute `photoUrl` using the request's scheme+host).

  - `GET /api/v1/meal-plans?from&to` — flat date range; `recipe` is nested.
  - `GET /api/v1/meal-plans/today` — convenience: all meal plans where `date = today` in the server's timezone.
  - `GET /api/v1/meal-plans/upcoming?days=N` (default N=2) — convenience: meal plans in `[today, today + N - 1]`, grouped by date.
  - Response shape (single meal plan):
    ```json
    {
      "id": 42,
      "date": "2026-05-17",
      "servings": 4,
      "note": null,
      "recipe": {
        "id": 7,
        "title": "Spaghetti Bolognese",
        "description": "...",
        "photoUrl": "http://nomly.local:3000/api/v1/photos/abc.webp",
        "prepTimeMin": 15,
        "cookTimeMin": 30,
        "sections": [
          {
            "title": null,
            "instructions": "1. ...",
            "ingredients": [
              { "name": "Hackfleisch", "quantity": 500, "unit": "g", "notes": null }
            ]
          }
        ]
      }
    }
    ```

**Realtime parity.** Changes made via the HA API broadcast on the same WebSocket topics as web-UI mutations (Epic 9) — adding via voice instantly appears on the phone in the store.

The API shares the same service layer as the web UI; the API is a thin adapter. The web UI uses the exact same `/active/*` routes so there is no second implementation to keep in sync.

## 5. Architecture

### 5.1 Server topology

`server.ts` (custom entry):

```
HTTP server (single port)
├── /ws   → WebSocket upgrade (sync hub)
└── /*    → Next.js request handler (App Router pages + /api/v1)
```

One Node process. Boots Drizzle, opens SQLite (WAL), starts the WS hub, then hands off HTTP routing to Next.

### 5.2 WebSocket protocol (initial sketch)

```
client → server  { "op": "subscribe", "topic": "shopping" }
client → server  { "op": "mutate", "topic": "shopping",
                   "mutationId": "uuid", "type": "check",
                   "itemId": 17, "version": 4 }
server → client  { "op": "applied", "mutationId": "uuid",
                   "item": { ...new state... } }
server → all     { "op": "broadcast", "topic": "shopping",
                   "item": { ... } }
server → all     { "op": "broadcast", "topic": "shopping",
                   "deleted": [itemId, ...] }   // from sweeper or explicit delete
```

Topics: `shopping` (the one running list), `meal-plan:<yyyy-ww>` (ISO week).

### 5.3 Client state

- **Most pages**: TanStack Query for fetch caching and revalidation.
- **Shopping list page**: bypasses Query for live state — a small store (Zustand or hand-rolled) backed by IndexedDB. `useShoppingList()` hydrates from IndexedDB, subscribes to the `shopping` WS topic, and exposes mutators that write locally → enqueue WS message → reconcile broadcasts.

### 5.4 PWA / service worker

- Web app manifest: name, icons, theme color, `display: standalone`.
- SW caches: app shell on install; recipe and shopping-list responses on first fetch; photos on demand. Cache-first for static assets, network-first with cache fallback for data.
- Targets iOS Safari and Android Chrome ("Add to Home Screen").

### 5.5 Offline mutation queue

- Each mutation: `{ id, listId, type, payload, attemptedAt }`. Persisted in IndexedDB.
- Flushed FIFO when the WS reconnects.
- Server-side idempotency: per-list ring-buffer of recent `mutationId`s; duplicates are no-ops.

### 5.6 Authentication

OIDC via `openid-client` (Node-side discovery + token exchange) + `iron-session` (encrypted, signed cookie session — no DB).

- Required env: `OIDC_ISSUER` (e.g. `https://auth.example.com/application/o/nomly/`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET` (≥ 32 chars), `BASE_URL` (used to build the redirect URI). App refuses to start if any are missing (fail-loud).
- Routes (unauthenticated by definition):
  - `GET /api/auth/login` — initiates the auth-code flow, stores PKCE verifier + state in a short-lived cookie, redirects to the issuer.
  - `GET /api/auth/callback` — verifies state, exchanges code for tokens, stores `{ sub, name, email, exp }` in the iron-session cookie, redirects to the original `?next=` path.
  - `POST /api/auth/logout` — clears the session cookie. Optional issuer back-channel logout if `OIDC_END_SESSION_URL` is set.
- Token refresh: when the session is older than `SESSION_REFRESH_AT` (e.g. 30 min) but inside the absolute lifetime, the middleware silently uses the stored refresh token to extend the session.
- Identity is stored for display only (header avatar, audit log of API token actions). It is never used to filter data.

**Middleware** (`src/middleware.ts`)

- Bypasses: `/api/auth/*`, `/api/health`, `/_next/*`, static assets.
- Order of checks:
  1. Session cookie (iron-session) → if valid → allow.
  2. Bearer token → if valid `api_token` → allow with a machine principal flag set on the request context.
  3. Otherwise: if the request is HTML, redirect to `/api/auth/login?next=<path>`; if it's an API call, return `401` JSON.
- Web UI mutations always go through path 1; HA mutations always through path 2.

**Session cookie.** `__nomly_session`, `HttpOnly`, `Secure` (when `BASE_URL` is `https`), `SameSite=Lax`, signed and encrypted with `SESSION_SECRET`. Inactivity timeout 30 days; absolute timeout 90 days.

### 5.7 UI design language

**Mobile-first, touch-friendly, modern.** The shopping list is used one-handed in a noisy store; the planner is used at a desk or on a tablet. Both must feel built for their context, not retrofitted.

**Tooling baseline**

- Tailwind v4 — utility layer.
- Radix UI primitives — unstyled accessible bases for Dialog, DropdownMenu, Checkbox, Switch, Popover, ToggleGroup, Tabs, Toast, ScrollArea.
- `shadcn/ui`-style component layer copied into `src/components/ui/*` — owned, restyleable, no runtime dep beyond Radix + Tailwind.
- `lucide-react` — icon set.
- `framer-motion` — transitions for page changes, dialog open/close, list reordering.
- `next-themes` — light / dark / system, with dark as the default for in-store readability.
- `vaul` (or Radix Dialog with mobile variant) — bottom-sheet pattern on mobile.
- `@dnd-kit/core` already chosen for the planner (Epic 4) — desktop-only.

**Layout principles**

- Mobile is the primary form factor for shopping, planning, and recipe browsing-while-cooking. Desktop is secondary.
- Single-column layouts on `< md`. Two-column appears only where it genuinely helps (planner DnD).
- Persistent bottom-nav on mobile for the four main areas: Rezepte, Plan, Einkauf, Einstellungen. Top header collapses to a slim avatar + page title.
- Desktop: same four areas as a top nav.

**Touch targets and buttons over gestures**

- Every tappable element ≥ 44 × 44 CSS px.
- Spacing minimum 8 px between adjacent tappables.
- Hover-only affordances are forbidden — every desktop hover state has an equivalent always-visible touch affordance.
- **Drag-and-drop is desktop-only.** Where the desktop UI uses DnD (e.g. the planner two-column layout), mobile uses explicit buttons that perform the same action. The planner gets a per-meal "Verschieben" action with a date picker on mobile (vs. dragging on desktop).
- **No swipe gestures for primary actions.** Buttons everywhere. Shopping list rows have visible check / edit / delete buttons on all screen sizes — discoverability beats clever gestures.
- Long-press is reserved for context menus where a tap is taken by the primary action, but no v1 feature relies on long-press as the only way to do something.

**Type, color, motion**

- System font stack with `font-feature-settings: 'cv11', 'ss01'` if available; falls back to `-apple-system`, `Segoe UI`, etc.
- A small palette: one accent (warm, food-friendly — likely an amber / spice tone), neutrals, and semantic red / green / amber for state. Defined in Tailwind theme.
- Dark mode is the default. The "Einstellungen" page exposes the toggle.
- All transitions are short (120 – 240 ms) and ease-out. No bouncy springs by default. Motion respects `prefers-reduced-motion`.

**Composition rules for every epic**

- Use Radix primitives as the base for any interactive widget. No raw `<dialog>` / `<details>` / custom click-outside logic.
- New components live under `src/components/<feature>/` and reuse the shared UI layer in `src/components/ui/*`.
- A component file does one thing and is ≤ ~200 lines of TSX. Split when it grows.
- Every form uses the same shared field components (Input, Textarea, Select, Combobox, Switch, etc.) for consistency.

## 6. Open Questions & Deferred

- **Familywall extraction path.** Decide between (a) authenticated web scrape, (b) mobile-API capture via mitmproxy, (c) screen-record + manual transcription. Investigation is Epic 11; concrete approach picked there.
- **LLM fallback for URL import.** Sites without JSON-LD (~30%) need either manual fill or an LLM-parse path. Deferred past v1.
- **Backups.** Out of scope for v1. Practical baseline: a cron-triggered `sqlite3 .backup` daily to a local NAS path.
- **Photo serving.** v1 serves photos via a Next route handler. If perf becomes a problem, revisit (CDN, image CDN, etc.).
- **Mobile camera capture.** Standard `<input type="file" accept="image/*" capture="environment">` is expected to work; verify in Epic 3.
- **Delete + concurrent edit conflict.** Default rule: delete wins. Refine in Epic 9 if a real conflict pattern emerges.
- **WS auth.** `/ws` follows the same gate as `/api/v1/*`: session cookie (web UI) or bearer token (machine clients). Connections without either are rejected at upgrade.
- **Per-supermarket category overrides.** Currently a product/ingredient has a single `default_category_id` and the supermarket's ordering of categories does the rest. If real shopping experience shows that the same product genuinely belongs to different aisles in different stores, add a `product_supermarket_category` (and `ingredient_supermarket_category`) override table. Deferred unless needed.
- **Promote product → ingredient.** If a manually-added product turns out to be used in recipes, manual re-entry as an ingredient is the v1 path. A "promote" action can be added later.
- **iCal refresh policy.** v1 fetches on planner load with a 5-minute in-memory cache and a manual refresh button. A background refresh job (e.g. every 15 minutes) is a future enhancement.
- **DnD on mobile.** Drag-and-drop is desktop-only. Epic 4 mobile uses explicit buttons everywhere (add via "Mahlzeit hinzufügen", move via bottom-sheet "Verschieben" with a date picker, reorder within a day via up/down buttons).
- **Edited meal plan after add.** If a user edits a `meal_plan` (changes recipe, portions, etc.) AFTER its ingredients have been folded into the list, the items do NOT update. The meal carries an `alreadyOnList` badge in the dialog until the contributions are gone. Workaround: use the planner's "Mahlzeit löschen → Mahlzeit und Zutaten entfernen" flow (§4.2.1) to roll back, then re-add the meal fresh.
- **Manual quantity edits lost on meal removal.** The "Mahlzeit und Zutaten entfernen" flow (§4.2.1) recomputes each affected item's quantity from remaining `shopping_item_source.contributed_quantity` rows. If the user had manually adjusted an item's quantity in the meantime, that delta is lost. v1 ships without separate adjustment tracking; revisit if it becomes a real problem.
- **Per-food unit conversions.** The Tandoor seed bundle includes 163 conversions like "1 cup potato = 4.92 oz" that bridge mass and volume (and other dimensions) per ingredient. Our v1 schema has only generic per-dimension unit conversions, so we can't use them yet. An obvious follow-up is an `ingredient_unit_conversion(ingredient_id, from_unit_id, from_amount, to_unit_id, to_amount)` table that the smart-merge consults when summing same-ingredient cross-dimension contributions. Deferred — the data is already vendored in `data/seed/tandoor-de.json` so a future epic can light it up without re-fetching.
- **HA push notifications.** v1 is pull-only — HA polls REST endpoints and reacts on its own schedule. A future enhancement could expose webhooks (e.g. "fire on item-checked") so HA can react instantly without polling. Deferred.
- **Per-user data.** v1 has no user table; everyone authenticated sees the same data. If a future use case ("private notes per user", "favorites") emerges, a `user` table keyed by OIDC `sub` plus per-feature ownership columns would be the natural addition. Deferred.
- **Multiple HA token scopes.** v1 has a single token type that grants full API access. If the deployment grows beyond personal use, scoped tokens (read-only, shopping-only, …) become worthwhile. Deferred.
- **Voice disambiguation.** If `byName` matches multiple ingredients/products, the API returns `409` with candidates. HA voice intents would have to handle that — for now the user picks via touch in the HA UI or just retypes with the canonical name. Document the behavior; revisit if it becomes a friction point.

## 7. Epics

Each epic is independently mergeable. Order reflects the critical path to a usable v1; later epics layer on quality and integrations.

| # | Epic | Depends on | One-line scope |
|---|---|---|---|
| 1 | **Foundation + Auth** | — | Custom server, full schema, base seeds, layout/nav shell, settings shell, **OIDC middleware gating every page and API call from day 1**, `/api/health`, UI tooling baseline (§5.7). |
| 2 | **Deployment & CI** | 1 | Multi-stage Dockerfile, `docker-compose.example.yml` (with Authentik wiring hints), GitHub Actions workflow that builds + pushes `linux/amd64` images to `ghcr.io/examinator/nomly` on push to `main` and on tags, migrations-on-start, healthcheck. |
| 3 | **Recipes** | 1 | Recipe CRUD with multi-section model, inline ingredient/unit/category create, tags, photo upload, list/grid + detail, search. |
| 4 | **Meal planner (UI)** | 3 | Two-column desktop with DnD (recipe list ↔ calendar, calendar ↔ calendar), configurable `days_visible` + `start_weekday`, mobile uses buttons (no DnD). Meal-delete prompt offers to also remove shopping-list contributions per §4.2.1. |
| 5 | **Shopping list (online)** | 4 | Single running list, "Mahlzeiten hinzufügen" dialog with already-on-list badge, merge-on-add with `contributed_quantity` tracking and 24 h-grace reactivation, per-item meal-source chips, visible check / edit / delete buttons on every row, supermarket UI filter, inline product create, 60-minute sweeper. |
| 6 | **Supermarkets** | 5 | Supermarket CRUD, per-supermarket category ordering, filter-and-sort on shopping list. |
| 7 | **Ingredient / product / unit / category management** | 3, 5 | Settings sub-pages: CRUD, alias management, multi-select merge, delete-with-replacement, `exclude_from_shopping_list` toggle (ingredients only). |
| 8 | **Offline shopping list (PWA)** | 5 | Manifest, service worker, IndexedDB-backed state, optimistic mutations, FIFO offline queue, offline indicator. |
| 9 | **Realtime sync** | 5, 8 | WS hub on custom server, subscribe/broadcast protocol, item versioning + LWW reconciliation, sweeper delete broadcasts. |
| 10 | **Recipe URL import** | 3 | Server-side fetch + JSON-LD `Recipe` parse, photo fetch, manual fallback. |
| 11 | **Familywall import** | 3 | Extraction investigation + one-time, idempotent CLI ingestion script. |
| 12 | **Home Assistant API** | 5 | `api_token` table + UI, bearer middleware, `/api/v1/*` endpoints, voice-add `byName` mode, dashboard endpoints. |
| 13 | **iCal calendar feeds** | 4 | `ical_feed` CRUD UI, server-side fetch + `node-ical` parse with in-memory cache, events rendered in planner. |

### 7.1 Detailed scope per epic

**Epic 1 — Foundation + Auth**
- Custom `server.ts` with Next programmatic boot + `ws` upgrade hook on `/ws` (no consumers yet — placeholder, but the upgrade handler runs the same auth check as `/api/v1/*`).
- Drizzle schema for every table listed in §3.2. First migration committed. `npm run db:migrate` applies pending migrations on container start.
- Seed: a vendored snapshot of [`TandoorRecipes/open-tandoor-data`](https://github.com/TandoorRecipes/open-tandoor-data) `build/de.json` is committed at `data/seed/tandoor-de.json`. A transform script (`npm run seed`) is idempotent (skips on canonical-name conflict) and runs after `db:migrate` on container start. Mapping:
  - Tandoor `unit` → `unit` (`name` ← `name`; `plural_name` → `unit_alias`; Tandoor `type` `WEIGHT|VOLUME|OTHER` → our `dimension` `mass|volume|count`; `base_unit` reference → `base_unit_id`). Pads in the few units the app needs but Tandoor lacks (`EL`, `TL`, `Prise`) directly inside the script.
  - Tandoor `category` → `category` (`name` ← `name`).
  - Tandoor `food` → `ingredient` (`name` ← `name`; `plural_name` → `ingredient_alias` when distinct; `store_category` → `default_category_id` via lookup). Tandoor nutritional `properties` and `fdc_id` are ignored in v1.
  - Tandoor `store` → `supermarket` (`name` ← `name`). Tandoor's empty `categories` arrays mean no aisle-ordering data — the user fills that in via Epic 6.
  - Tandoor `conversion` (per-food density) is **not** consumed in v1 — our schema only models generic per-dimension unit conversions. The data is retained in the vendored snapshot for a future enhancement (§6).
- Update procedure documented in `THIRD_PARTY_NOTICES.md`: pull a fresh `build/de.json`, replace the snapshot, re-run `npm run seed` (no-op for unchanged entries, adds new ones). Attribution to Tandoor Recipes per DbCL stays in `THIRD_PARTY_NOTICES.md` and the README.
- Authentication per §5.6:
  - `openid-client` + `iron-session` integrated.
  - Routes `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`.
  - `src/middleware.ts` enforces session-or-bearer on every non-bypass route. The bearer side is wired but only meaningful once Epic 12 adds the management UI (the table and middleware already work from day 1).
- Required env: `BASE_URL`, `SESSION_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. App refuses to start if any are missing (fail-loud).
- `/api/health` route — returns `{ ok: true, version }`, bypasses auth (for the Docker healthcheck).
- Layout: mobile bottom-nav + desktop top-nav with the four main areas (Rezepte, Plan, Einkauf, Einstellungen). Header carries the page title and an avatar/menu with display name + "Abmelden".
- UI tooling installed and wired per §5.7 (Tailwind v4, Radix UI primitives, shadcn-style `src/components/ui/*` scaffold, `lucide-react`, `framer-motion`, `next-themes`, `vaul`). Dark mode default; system theme toggle available in Einstellungen.
- Empty `/einstellungen` page with sub-page placeholders.

**Epic 2 — Deployment & CI**
- `Dockerfile` (multi-stage):
  - **Builder** stage on `node:24-alpine` — installs build deps for native modules (`python3`, `make`, `g++`), runs `npm ci`, `npm run build`, prunes dev deps.
  - **Runtime** stage on `node:24-alpine` — copies only `.next/standalone` (with the custom server entry), `.next/static`, `public/`, `node_modules` (production), and `drizzle/` migration artifacts. Runs as non-root (`USER node`). `EXPOSE 3000`. `CMD ["node", "server.js"]`.
  - Entrypoint script applies pending Drizzle migrations against `DATABASE_URL` before exec'ing the server.
  - `HEALTHCHECK` hits `/api/health`.
- `.dockerignore` excludes `node_modules`, `.next`, `data`, `.git`, dev artifacts.
- `docker-compose.example.yml`:
  - `nomly` service from `ghcr.io/examinator/nomly:latest`, port mapping, `./data:/app/data` volume, env file reference.
  - Commented hints for connecting to an existing Authentik instance (issuer URL, client id/secret env vars).
  - Optional `caddy` / `traefik` reverse-proxy stanza for TLS termination (commented).
- `.env.example` lists all required + optional vars (`BASE_URL`, `SESSION_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `DATABASE_URL`).
- `.github/workflows/docker-publish.yml`:
  - Triggers on push to `main` and on tags `v*`.
  - Steps: checkout → set up Buildx → login to `ghcr.io` (via `GITHUB_TOKEN`) → `docker/build-push-action` building `linux/amd64` only.
  - Tags: `latest` for `main`, `v1.2.3` and `1.2` and `1` for semver tags.
  - Uses GitHub Actions cache for layers.
- `README.md` (new top section): one-paragraph quickstart with Docker Compose + Authentik wiring.

**Epic 3 — Recipes**
- Pages: `/rezepte` (grid w/ search), `/rezepte/neu`, `/rezepte/[id]`, `/rezepte/[id]/bearbeiten`.
- Form: title, description (md), servings, prep/cook times, source URL, photo upload, tags.
- Section editor: add / remove / reorder sections; each section has title + markdown instructions + ingredient rows.
- Ingredient row: qty + unit + ingredient + note. Autocomplete searches `name ∪ aliases`. Inline "neu anlegen" for ingredient, unit, category (limited fields; rich edits live in Epic 7).
- Photo pipeline: upload → `sharp` resize (e.g. max 1600px long edge) → `.webp` → save under `data/photos/`.
- Search: SQLite `LIKE` on title and tag.name. FTS is a future enhancement, not v1.

**Epic 4 — Meal planner (UI)**
- Settings page entries for `planner.days_visible` (default 7) and `planner.start_weekday` (ISO 1–7, default 1=Mon).
- Desktop (≥ md):
  - Two-column layout. Left = calendar of `days_visible` days. Right = recipe list with text search + tag filter chips.
  - DnD library: `@dnd-kit/core` (lightweight, keyboard-accessible).
  - DnD operations: recipe-card → day-cell (create), meal-card → day-cell (move), meal-card within cell (reorder).
  - Click meal-card → side-panel editor (portions override, note, delete).
  - Range nav: `←` / `→` step by `days_visible`; "Heute" resets to the configured origin.
- Mobile (< md):
  - Single-column calendar. **No DnD anywhere on mobile.** Tap day-cell → "Mahlzeit hinzufügen" → recipe-search modal → portions + note. Add via explicit button.
  - Edit a meal: tap meal-card → bottom-sheet editor with explicit "Verschieben" (date picker), "Bearbeiten", "Löschen" buttons. Move to other day uses the date picker — no drag.
- Empty days show a subtle "+" affordance on hover/tap.
- **Meal-delete prompt per §4.2.1.** When deleting a meal that has rows in `shopping_item_source`, the confirmation offers three buttons: "Nur Mahlzeit löschen", "Mahlzeit und Zutaten entfernen", "Abbrechen". The second path recomputes affected `shopping_item` quantities from remaining sources transactionally and broadcasts updates on the `shopping` WS topic.
- Calendar day-cells host both meals (this epic) and iCal events (Epic 13) — Epic 4 reserves a render slot for events so Epic 13 only needs to add the data source.

**Epic 5 — Shopping list (online)**
- Page: `/einkauf` only. No history, no per-list pages.
- "Mahlzeiten hinzufügen" dialog per §4.3 (a bottom sheet on mobile, modal on desktop) — date + length controls + live-refreshing per-meal/per-ingredient checkbox preview. Already-on-list meals appear with a "Bereits auf der Liste" badge and start unchecked. Backed by `POST /api/v1/shopping/preview-meals` and `POST /api/v1/shopping/add-meals`.
- Merge-on-add algorithm per §4.3.2, including the "reactivate within 24 h grace" rule. Writes `shopping_item_source` rows with `contributed_quantity` and `contributed_unit_id` so meal-delete cleanup (Epic 4 / §4.2.1) can subtract precisely.
- Item rows: ingredient/product name, qty + unit, note, plus visible **check / edit / delete** buttons on every screen size — no swipe gestures, no hover-only affordances. Buttons sized per §5.7.
- Each item shows its meal sources beneath the name as chips: `Für: Spaghetti Bolognese (Mo, 19.05.), Lasagne (Mi, 21.05.)`. Tapping a chip routes to the meal in the planner. Manually-added items show no chips.
- Checked items render struck-through and muted but remain in place; the check button is replaced by a "Rückgängig" button.
- Background sweeper in `server.ts` deletes items with `checked = true AND checked_at < now() - 24h` every 60 minutes; runs once at boot. Broadcasts deletions on the `shopping` WS topic.
- "Artikel hinzufügen" autocomplete searches `ingredient ∪ product` (with type label per result). Selecting an ingredient creates an item with `ingredient_id`; selecting a product creates one with `product_id`; typing a new name and confirming creates a new `product` (with optional category in the inline form) and attaches it.
- Supermarket filter dropdown in the page header; selection persists in `localStorage` (key `nomly.shopping.supermarketId`).
- Introduces the JSON endpoints under `/api/v1/shopping/*` per §4.6 — used here for web-UI mutations and consumed unchanged by Epic 8's offline queue and Epic 12's HA flow.

**Epic 6 — Supermarkets**
- `/einstellungen/supermaerkte`: list + add/edit/delete.
- Per-supermarket category order: drag-and-drop list on desktop; up/down buttons on mobile (no DnD).
- Shopping list UI: supermarket select; when set, items group by `category` and sort by that supermarket's `sort_order`. When unset, items sort by ingredient name.

**Epic 7 — Ingredient / product / unit / category management**
- `/einstellungen/zutaten`: paginated/searchable list with columns name, aliases (chip list), default category, exclude flag.
- Edit form: rename, add/remove aliases, set default category, toggle `exclude_from_shopping_list`.
- Multi-select merge (ingredients): choose ≥2, click "zusammenführen", pick the row to keep; others' names + aliases become aliases of the kept row; all `recipe_ingredient.ingredient_id` and `shopping_item.ingredient_id` refs update in an atomic transaction.
- Delete (ingredient): prompt for optional replacement; if chosen, rewire references; if not, remove references (recipes and lists affected are listed in the confirm dialog).
- `/einstellungen/produkte`: analogous screen for `product` (name, aliases, default category). No "exclude" flag — products only land on the list via manual add anyway. Merge + delete-with-replacement work over `shopping_item.product_id` refs.
- Analogous (lighter) screens for `/einstellungen/einheiten` and `/einstellungen/kategorien` — merge on units must check for incompatible `dimension` (refuse) and align `factor` math.

**Epic 8 — Offline shopping list (PWA)**
- `public/manifest.webmanifest` + icons.
- Service worker registered from app shell; install/activate/fetch handlers per §5.4.
- IndexedDB stores: `shopping_items` (the full list payload) + `mutation_queue`.
- `useShoppingList()` hook: hydrate from IDB → fetch fresh if online → reconcile → return state + mutators.
- Mutators write to IDB and POST/PATCH to JSON endpoints under `/api/v1/shopping/*`. Requests carry the existing session cookie automatically. Mutations queue if offline.
- "Offline" banner with queued-mutation count.
- Note: this epic does **not** introduce WebSockets. It ships a fully working offline-first experience that revalidates on focus / reconnect. Epic 9 then swaps the transport to WS and adds peer push, including the sweeper's delete broadcasts.

**Epic 9 — Realtime sync**
- WS hub: topic → set of sockets; broadcast helper.
- Single `shopping` topic for the running list (no per-list ids). `meal-plan:<yyyy-ww>` reserved for the planner.
- Mutation transport switches from HTTP (Epic 8) to WS `mutate` frames; HTTP endpoints stay live as fallback and as the HA-facing API.
- Server applies mutations transactionally, bumps `version`, broadcasts updated item to all topic subscribers.
- The sweeper from Epic 5 also publishes `{ deleted: [...] }` broadcasts when it removes items.
- Client reconciler: when a broadcast arrives with `version > local.version`, replace local item; if local has uncommitted mutation for the same item, replay the local mutation on top of the broadcast. Deletion broadcasts remove items from the IndexedDB cache.
- Heartbeat ping/pong every 30s; reconnect with exponential backoff.

**Epic 10 — Recipe URL import**
- `/rezepte/neu` gains a "Aus URL importieren" button.
- Server route fetches URL with a reasonable timeout, parses `<script type="application/ld+json">`, finds `@type: Recipe` (or recipe inside a `@graph`).
- Maps fields: `name → title`, `recipeIngredient[] → recipe_ingredient[]` (single section, parser splits qty+unit+name heuristically), `recipeInstructions → instructions` (concat as one section's markdown), `recipeYield → servings`, times via ISO 8601 → minutes, `image → photo` (download + resize).
- Validation surface: shows what was parsed; user confirms or fixes before save.

**Epic 11 — Familywall import**
- Investigation phase produces a short doc on the extraction approach actually used.
- CLI: `npm run import:familywall -- <input-path>`.
- Idempotency: dedupe key on `title + source` (or content-hash); re-run inserts only new recipes.
- Outputs a summary (`N rezepte importiert, M übersprungen`).

**Epic 12 — Home Assistant API**
- `/einstellungen/api-tokens`: create (token shown once), revoke.
- API-token middleware: reads `Authorization: Bearer <token>`, hashes, looks up active row, rejects if missing or revoked, otherwise updates `last_used_at` and continues. This middleware is the **machine-auth** path; the web UI takes the session-auth path defined in §5.6.
- All endpoints per §4.6, JSON-only.
- `byName` resolution: shared service function (also reused by the web-UI "Artikel hinzufügen" flow) so voice + manual go through identical matching. Multiple-match disambiguation returns `409` with the candidates so HA can ask a follow-up.
- Meal-plan response shaper: a single mapper produces the nested recipe shape (with ingredient scaling and absolute `photoUrl`) and is reused for `/meal-plans`, `/meal-plans/today`, and `/meal-plans/upcoming`.
- Photo URL builder reads `X-Forwarded-Proto` / `X-Forwarded-Host` if set (reverse proxy case), otherwise falls back to the direct request host. Document the reverse-proxy header requirement in the settings page.
- Reference HA configuration snippets (REST sensors for today's meal, a `shopping_list_add` script using `rest_command`) are added to `docs/integrations/home-assistant.md` so the user can copy-paste.

**Epic 13 — iCal calendar feeds**
- `/einstellungen/kalender`: CRUD for `ical_feed` (Name, URL, Farbe — color picker, Aktiv-Toggle).
- Server-side fetch with `node-ical` (`fetch` from URL, parse). 5-minute in-memory cache keyed by feed id; a "Aktualisieren" button on the planner busts the cache.
- Endpoint: `GET /api/v1/ical-events?from&to` returns events from all enabled feeds, expanded for recurrence, clipped to range, tagged with `feedId` and `color`.
- Planner integration: events render in their day-cell alongside meals using the slot reserved in Epic 4; visually distinct (color bar + read-only treatment).
- Errors per feed are persisted (`last_error_*`) and surfaced as a small warning chip in the planner header — they do not block the rest of the planner.

### 7.2 Success criteria (acceptance per epic)

- **1** `npm run dev` with valid OIDC env vars boots the custom server; visiting `/` while logged out redirects to the configured Authentik login; after sign-in the German layout renders with the user's display name in the header; "Abmelden" clears the session. `db:migrate` applies the full schema; `npm run seed` populates the schema from `data/seed/tandoor-de.json` (≥10 units, ≥20 categories, ≥300 ingredients, ≥50 supermarkets) and is a no-op on second run. `/api/health` returns `200` without auth.
- **2** A push to `main` triggers the workflow; the resulting `ghcr.io/examinator/nomly:latest` image (linux/amd64) starts under Docker Compose with the example file + an env file pointing at Authentik; on first start, migrations apply and the seed runs; the healthcheck passes; the user can log in via Authentik and reach `/`; a tag `v0.1.0` produces additional version-tagged images.
- **3** A recipe with two named sections and ten ingredients (spanning two units of the same dimension) can be created, edited, viewed, deleted; photo upload renders correctly; ingredient autocomplete finds existing entries and creates new ones.
- **4** On desktop, a recipe can be dragged from the right-hand list onto a day-cell to create a meal, and a meal can be dragged to another day to move; `days_visible` and `start_weekday` settings change the visible range; "Heute" resets to the configured origin. On mobile, DnD is fully suppressed — adding uses the explicit "Mahlzeit hinzufügen" button, moving uses the bottom-sheet "Verschieben" date picker. Deleting a meal whose ingredients are on the shopping list shows the three-option prompt; "Mahlzeit und Zutaten entfernen" updates affected `shopping_item` quantities (and removes items where no source remains) in one transaction; "Nur Mahlzeit löschen" leaves items intact.
- **5** End-to-end on the running list: the "Mahlzeiten hinzufügen" dialog opens with date/length controls and a live preview (full-height bottom sheet on mobile); changing the date refreshes the preview; deselecting a meal clears its ingredients; deselecting one ingredient leaves the meal in indeterminate state; "Alle/Keine auswählen" toggles the whole preview; confirming merges the selection (overlapping `(ingredient, dimension)` items get summed into existing unchecked items, items in the 24 h grace state get reactivated, otherwise new items are created); re-opening the dialog with the same range now shows the contributing meals with a "Bereits auf der Liste" badge and unchecked default; each shopping item displays its meal-source chips with date and recipe title, and clicking a chip routes to the planner; check / edit / delete are visible buttons on every screen size with no swipe gesture; the background sweeper (run manually via test hook or by faking `checked_at` 25 h in the past) removes checked items, which in turn frees their source meals to reappear without the "bereits" badge; adding "Toilettenpapier" inline creates a reusable `product` with its category preserved; the supermarket filter dropdown changes the on-screen grouping/order without touching the DB and survives a page reload (per device).
- **6** Two supermarkets with different category orders flip the grouping/sort when toggled; both ingredient-items and product-items respect the supermarket's order.
- **7** Merging ingredients moves all references and preserves all aliases; merging products does the same over `shopping_item.product_id`; delete-with-replacement rewires references; `exclude_from_shopping_list` keeps those ingredients off future add-meals flows.
- **8** Airplane-mode mid-shop allows continued check/uncheck/qty edit; reconnect flushes the queue cleanly with no data loss.
- **9** Two browser tabs on the running list reflect each other's checks within ~1s; when the sweeper deletes an aged-out item, both tabs lose it without a manual refresh.
- **10** A Chefkoch URL produces a complete recipe; a no-JSON-LD URL shows a clear "manual" prompt.
- **11** Familywall data lands as recipes with sections + ingredients; a re-run produces zero duplicates.
- **12** With a bearer token: (a) `POST /shopping/items` with `{ byName: "Toilettenpapier" }` creates a product and adds it, and the response identifies it as `createdProduct` / `action: created`; (b) repeating the same call returns `action: incremented` (or `reactivated` if the previous item is in the 24 h grace state); (c) `{ byName: "Hackfleisch" }` (already an ingredient) resolves to `mode: "ingredient"`; (d) `GET /meal-plans/today` returns today's plans with `recipe.photoUrl` as an absolute URL, scaled ingredient quantities, and instructions; (e) the additions show up in real time on a web client subscribed to the `shopping` WebSocket topic.
- **13** With two iCal feeds configured (different colors) and one feed deliberately misconfigured, the planner shows valid events in their day-cells, the broken feed surfaces a warning chip, and the rest of the planner still works.

### 7.3 Cross-cutting

- **Tests.** Unit tests for server logic (smart merge + conversion, recipe scaling, alias resolution, merge transaction). At least one integration test per epic running against a temp SQLite file.
- **Migrations.** Every schema change ships a migration. No `db:push` against committed data.
- **Style.** Tailwind; component library is hand-rolled — pull in a primitive lib (shadcn-style) only if a complex component (dnd, autocomplete) gets too noisy.
- **No premature abstraction.** Build each epic concretely. Refactor when a second concrete use case appears.
- **Markdown.** Use a lightweight renderer (e.g. `marked` + `dompurify`) — no rich editor in v1.

## 8. Next step

Once this spec is approved, individual epics get their own implementation plan via the `writing-plans` skill — one plan per epic, starting with Epic 1 (Foundation). Plans go to `docs/superpowers/plans/`.
