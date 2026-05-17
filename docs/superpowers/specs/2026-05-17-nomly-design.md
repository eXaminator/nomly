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
5. Expose a small REST API so Home Assistant can read and check off items on the active list.

## 2. Top-Level Decisions

| Topic | Decision |
|---|---|
| Users | One shared "account", no auth for the web UI. LAN-trust. |
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
| Shopping list cardinality | Exactly **one active list** at any time. Adding meals appends to it; "Liste abschließen" closes it and a fresh empty active list is created. Completed lists are kept as read-only history. |
| Supermarket filter | Stored per-device in `localStorage`, not as a list property — different devices/users can hold different active filters. |

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

shopping_list
  id, title (auto: "Einkaufsliste vom DD.MM.YYYY"),
  created_at, completed_at (nullable)
  -- exactly one row has completed_at IS NULL (the active list)
  -- enforced by a partial unique index on (completed_at IS NULL)

shopping_list_item
  id, list_id (FK),
  ingredient_id (FK, nullable), product_id (FK, nullable),
  -- XOR: exactly one of ingredient_id / product_id is set
  quantity (decimal, nullable), unit_id (FK, nullable),
  category_id (FK, nullable; snapshot from
    ingredient.default_category_id OR product.default_category_id at add-time),
  checked (bool, default false), checked_at (nullable),
  note (nullable), sort_order,
  version (int, monotonic — for sync conflict resolution),
  updated_at

shopping_list_meal
  list_id (FK), meal_plan_id (FK), added_at
  -- composite PK (list_id, meal_plan_id)
  -- records which meal plans have already been folded into a list,
  -- so the add-meals dialog can hide them and the system can't
  -- double-count their ingredients.

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
- `ingredient` and `product` share no uniqueness constraint with each other — `"Salz"` could exist as both, though the merge tooling in Epic 6 makes it easy to clean up.
- Every `recipe` has at least one `recipe_section`. A single-section recipe uses one section with `title = null` and the UI renders it flat.
- `shopping_list_item.ingredient_id` and `shopping_list_item.product_id` are mutually exclusive (XOR): exactly one is set.
- `unit` conversions only sum within the same `dimension`. Cross-dimension entries for one ingredient render as separate lines under one ingredient header.
- Exactly one `shopping_list` row has `completed_at IS NULL` — the **active list**. The first migration seeds it; "Liste abschließen" creates the next one in the same transaction that sets `completed_at` on the current one.
- A `meal_plan` row is added to the active list at most once — `shopping_list_meal` is the truth source. Edits to a `meal_plan` after it has been added do NOT retroactively update the items it produced (it remains effectively snapshotted at add-time at the item level).

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

### 4.3 Adding meals to the shopping list

There is always exactly one active `shopping_list`. The `/einkauf` page renders that list directly — no "list of lists" UI in the main flow (a "Verlauf" link reveals completed lists read-only).

**The "Mahlzeiten zur Einkaufsliste hinzufügen" dialog** is the single way to append meals to the active list. It owns the date selection:

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
- The preview is computed server-side per §4.3.1 below and contains only **eligible** meals — meal plans in `[start, start + length - 1]` that are not already in `shopping_list_meal` for the active list, scaled by `servings_override / recipe.servings`, with `exclude_from_shopping_list = true` ingredients pre-filtered out. Meals that have zero eligible ingredients left after filtering are hidden.
- Every meal and every ingredient starts **checked** by default.
- Each meal-card's header checkbox toggles every ingredient inside; indeterminate state when only some are checked.
- "Alle auswählen" / "Keine auswählen" header buttons apply across the entire current preview.
- "Übernehmen" merges the checked ingredients into the active list (per §4.3.2) and inserts `shopping_list_meal` rows for the meal plans whose ingredients were included (even partially).
- "Abbrechen" closes the dialog without changes.
- Empty preview state: the dialog still opens, shows a "Keine Mahlzeiten in diesem Zeitraum" note, and offers "Abbrechen" (the user can still add products from the list page itself).

#### 4.3.1 Preview computation

For a given `(start_date, length_days, active_list_id)`:

1. `meal_plan` rows in `[start, start + length - 1]` whose id is NOT in `shopping_list_meal` for `active_list_id`.
2. For each, expand `recipe_section.recipe_ingredient` and scale quantities by `servings_override / recipe.servings`.
3. Drop lines where the ingredient has `exclude_from_shopping_list = true`.
4. Drop meals that end up with no remaining lines.
5. Return as `[{ mealPlanId, date, recipeTitle, servings, ingredients: [{ recipeIngredientId, ingredient, qty, unit, notes }] }]`.

#### 4.3.2 Merge-on-add algorithm

For the user's checked selection:

1. Group selected `(ingredient_id, unit.dimension)` pairs across the entire selection (NOT per meal — overlaps merge).
2. Within each `(ingredient, dimension)` bucket, convert to the base unit and sum; format in the largest sensible unit (`1200g → 1,2 kg`).
3. Open-ended lines (null quantity) within a bucket collapse to one line.
4. For each merged bucket, look for an existing `shopping_list_item` on the active list with the same `(ingredient_id, unit.dimension)`:
   - **Found:** add the new amount onto the existing item's quantity. Bump `version` and `updated_at`. `checked` stays as it was (a re-add of an already-checked item does NOT uncheck it; we treat a re-add as "still need more" and the user can decide).
   - **Not found:** create a new `shopping_list_item` with `category_id` snapshotted from `ingredient.default_category_id`.
5. Cross-dimension lines for the same ingredient remain separate but render under one ingredient header in the UI (no special DB representation — just a UI grouping by `ingredient_id` on render).

**Products** are not touched by this flow — they are appended manually via §4.4.

### 4.4 Shopping in a store (offline + sync)

- `/einkauf` is the offline-capable page and renders the **active** list.
- Top-bar controls on the page:
  - "Mahlzeiten hinzufügen" → opens the §4.3 dialog.
  - "Artikel hinzufügen" → autocomplete across `ingredient ∪ product` (with type label per result). If nothing matches, "Als neues Produkt anlegen" creates a new `product` row inline (with optional category) and attaches it. New products are reusable on future lists and editable via Epic 6 management.
  - **Supermarkt-Filter** dropdown — persists per device in `localStorage` (key `nomly.shopping.supermarketId`). When set, items group by `category` and sort by that supermarket's `sort_order`; when unset, items sort by ingredient/product name. The setting is purely a view filter — never written to the database, so two devices can hold different filters simultaneously.
  - "Liste abschließen" → confirm dialog, then transactionally: set `completed_at = now()` on the active list AND insert a new active list. The page reloads showing the empty new list. The completed list is now visible read-only via "Verlauf".
- "Verlauf" link routes to `/einkauf/verlauf` — a chronological list of completed `shopping_list` rows, each click opens a read-only view at `/einkauf/[id]`.
- First visit (while online) caches the active list payload to IndexedDB and the app shell to the service worker cache.
- Every mutation (check, uncheck, edit qty/unit/note, add item, delete) writes to IndexedDB first and is sent to the server, queued if offline. The transport evolves across epics: Epic 7 ships with HTTP `POST`/`PATCH` to the existing REST endpoints; Epic 8 swaps to a WebSocket mutate frame on the same protocol shape and adds live peer broadcast.
- Each mutation carries a client-generated `mutationId` and the item's last-known `version`. The server applies LWW per item: a mutation with a stale `version` is reconciled (the server's current state wins for the conflicting field) and the merged state is returned (and, from Epic 8, broadcast).
- On reconnect, the queue flushes FIFO. Server idempotency dedupes by `mutationId`.
- From Epic 8 onward, all clients subscribed to the list topic receive item updates in real time.

### 4.5 iCal calendar feeds

- Settings page `/einstellungen/kalender` provides CRUD for `ical_feed` rows (Name, URL, Farbe, Aktiv).
- On the planner page load, the server fetches each `enabled = true` feed and parses with `node-ical`. Results cached in memory for 5 minutes (key = `ical_feed.id`); a "Aktualisieren" button on the planner forces a refresh.
- Per-feed errors (network/parse) are stored in `last_error_*` and surfaced as a small warning chip on the planner header; the rest of the planner keeps working.
- Only events that fall within the visible range are returned to the client.
- Recurring events are expanded by `node-ical` and filtered to the visible range.
- Events are display-only — they cannot be edited, dragged, or converted into meals in v1.

### 4.6 Home Assistant integration

- Token issuance in settings: enter a label → token shown once → only the hash is stored.
- Endpoints under `/api/v1/`, bearer auth required:
  - `GET /api/v1/shopping-lists` — all lists, with an `active: true` flag on the one that has `completed_at IS NULL`
  - `GET /api/v1/shopping-lists/active` — convenience shortcut to the active list
  - `GET /api/v1/shopping-lists/:id` — single list (active or historical)
  - `POST /api/v1/shopping-lists/:id/items` — add an item (body references an existing `ingredient_id`, an existing `product_id`, or includes a `newProduct: { name, default_category_id? }` payload that creates and attaches a product)
  - `PATCH /api/v1/shopping-lists/:id/items/:itemId` — toggle checked, edit qty/note
  - `POST /api/v1/shopping-lists/:id/preview-meals` — body `{ start, length }`; returns the dialog preview per §4.3.1. Only valid for the active list.
  - `POST /api/v1/shopping-lists/:id/add-meals` — body `{ start, length, selection: [{ mealPlanId, recipeIngredientIds: [...] }] }`; performs the merge-on-add per §4.3.2 and writes `shopping_list_meal` rows. Only valid for the active list.
  - `POST /api/v1/shopping-lists/:id/complete` — set `completed_at`, create the next active list, return both ids. Only valid for the active list.
  - `GET /api/v1/meal-plans?from&to`
- These share the same service layer as the web UI; the API is a thin adapter.

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
client → server  { "op": "subscribe", "topic": "shopping-list:42" }
client → server  { "op": "mutate", "topic": "shopping-list:42",
                   "mutationId": "uuid", "type": "check",
                   "itemId": 17, "version": 4 }
server → client  { "op": "applied", "mutationId": "uuid",
                   "item": { ...new state... } }
server → all     { "op": "broadcast", "topic": "shopping-list:42",
                   "item": { ... } }
```

Topics: `shopping-list:<id>`, `meal-plan:<yyyy-ww>` (ISO week).

### 5.3 Client state

- **Most pages**: TanStack Query for fetch caching and revalidation.
- **Shopping list page**: bypasses Query for live state — a small store (Zustand or hand-rolled) backed by IndexedDB. `useShoppingList(listId)` hydrates from IndexedDB, subscribes to the WS topic, and exposes mutators that write locally → enqueue WS message → reconcile broadcasts.

### 5.4 PWA / service worker

- Web app manifest: name, icons, theme color, `display: standalone`.
- SW caches: app shell on install; recipe and shopping-list responses on first fetch; photos on demand. Cache-first for static assets, network-first with cache fallback for data.
- Targets iOS Safari and Android Chrome ("Add to Home Screen").

### 5.5 Offline mutation queue

- Each mutation: `{ id, listId, type, payload, attemptedAt }`. Persisted in IndexedDB.
- Flushed FIFO when the WS reconnects.
- Server-side idempotency: per-list ring-buffer of recent `mutationId`s; duplicates are no-ops.

## 6. Open Questions & Deferred

- **Familywall extraction path.** Decide between (a) authenticated web scrape, (b) mobile-API capture via mitmproxy, (c) screen-record + manual transcription. Investigation is Epic 11; concrete approach picked there.
- **LLM fallback for URL import.** Sites without JSON-LD (~30%) need either manual fill or an LLM-parse path. Deferred past v1.
- **Backups.** Out of scope for v1. Practical baseline: a cron-triggered `sqlite3 .backup` daily to a local NAS path.
- **Photo serving.** v1 serves photos via a Next route handler. If perf becomes a problem, revisit (CDN, image CDN, etc.).
- **Mobile camera capture.** Standard `<input type="file" accept="image/*" capture="environment">` is expected to work; verify in Epic 2.
- **Delete + concurrent edit conflict.** Default rule: delete wins. Refine in Epic 8 if a real conflict pattern emerges.
- **WS auth.** v1 is LAN-trust, no auth on `/ws`. If the deployment ever escapes the LAN, the API-token mechanism from Epic 10 extends naturally to WS upgrade.
- **Per-supermarket category overrides.** Currently a product/ingredient has a single `default_category_id` and the supermarket's ordering of categories does the rest. If real shopping experience shows that the same product genuinely belongs to different aisles in different stores, add a `product_supermarket_category` (and `ingredient_supermarket_category`) override table. Deferred unless needed.
- **Promote product → ingredient.** If a manually-added product turns out to be used in recipes, manual re-entry as an ingredient is the v1 path. A "promote" action can be added later.
- **iCal refresh policy.** v1 fetches on planner load with a 5-minute in-memory cache and a manual refresh button. A background refresh job (e.g. every 15 minutes) is a future enhancement.
- **DnD on mobile.** Drag-and-drop reorder is not always reliable on touch — Epic 3 intentionally avoids it for cross-day moves on mobile and falls back to an explicit "Verschieben" action with a date picker.
- **Remove a meal's contribution from the active list.** With `shopping_list_meal` in place we know which meal plans contributed, but we don't track per-item provenance, so undoing one meal's contribution requires either re-deriving from all remaining meals (re-run merge) or storing item-level provenance. Deferred. Workaround: user manually edits/deletes the affected items.
- **Edited meal plan after add.** If a user edits a `meal_plan` (changes recipe, portions, etc.) AFTER it has been folded into the active list, the list items do NOT update. The meal is in `shopping_list_meal` and won't reappear in the dialog. A "Mahlzeit aus Liste entfernen und neu hinzufügen" action would solve this — deferred along with the item above.

## 7. Epics

Each epic is independently mergeable. Order reflects the critical path to a usable v1; later epics layer on quality and integrations.

| # | Epic | Depends on | One-line scope |
|---|---|---|---|
| 1 | **Foundation** | — | Custom server, full schema (incl. `product`, `product_alias`, `ical_feed`), base seeds, layout/nav shell, settings shell. |
| 2 | **Recipes** | 1 | Recipe CRUD with multi-section model, inline ingredient/unit/category create, tags, photo upload, list/grid + detail, search. |
| 3 | **Meal planner (UI)** | 2 | Two-column desktop with DnD (recipe list ↔ calendar, calendar ↔ calendar), configurable `days_visible` + `start_weekday`, mobile tap-to-add fallback. |
| 4 | **Shopping list (online)** | 3 | Single active list, "Mahlzeiten hinzufügen" dialog (date + length + per-meal/per-ingredient checkboxes) with merge-on-add, supermarket UI filter, inline product create, "Liste abschließen" + history, check-off UI. |
| 5 | **Supermarkets** | 4 | Supermarket CRUD, per-supermarket category ordering, filter-and-sort on shopping list. |
| 6 | **Ingredient / product / unit / category management** | 2, 4 | Settings sub-pages: CRUD, alias management, multi-select merge, delete-with-replacement, `exclude_from_shopping_list` toggle (ingredients only). |
| 7 | **Offline shopping list (PWA)** | 4 | Manifest, service worker, IndexedDB-backed state, optimistic mutations, FIFO offline queue, offline indicator. |
| 8 | **Realtime sync** | 4, 7 | WS hub on custom server, subscribe/broadcast protocol, item versioning + LWW reconciliation. |
| 9 | **Recipe URL import** | 2 | Server-side fetch + JSON-LD `Recipe` parse, photo fetch, manual fallback. |
| 10 | **Home Assistant API** | 4 | `api_token` table + UI, bearer middleware, `/api/v1/*` endpoints. |
| 11 | **Familywall import** | 2 | Extraction investigation + one-time, idempotent CLI ingestion script. |
| 12 | **iCal calendar feeds** | 3 | `ical_feed` CRUD UI, server-side fetch + `node-ical` parse with in-memory cache, events rendered in planner. |

### 7.1 Detailed scope per epic

**Epic 1 — Foundation**
- Custom `server.ts` with Next programmatic boot + `ws` upgrade hook on `/ws` (no consumers yet — placeholder).
- Drizzle schema for every table listed in §3.2. First migration committed.
- Seed script: units (`g`, `kg`, `ml`, `l`, `EL`, `TL`, `Stück`, `Prise`) with their dimensions/factors, base categories (`Obst & Gemüse`, `Milchprodukte`, `Backwaren`, `Fleisch & Fisch`, `Tiefkühl`, `Konserven`, `Trockenwaren`, `Getränke`, `Sonstiges`).
- Layout: top nav with links to Rezepte, Plan, Einkauf, Einstellungen. Tailwind theme baseline.
- Empty `/einstellungen` page with sub-page placeholders.

**Epic 2 — Recipes**
- Pages: `/rezepte` (grid w/ search), `/rezepte/neu`, `/rezepte/[id]`, `/rezepte/[id]/bearbeiten`.
- Form: title, description (md), servings, prep/cook times, source URL, photo upload, tags.
- Section editor: add / remove / reorder sections; each section has title + markdown instructions + ingredient rows.
- Ingredient row: qty + unit + ingredient + note. Autocomplete searches `name ∪ aliases`. Inline "neu anlegen" for ingredient, unit, category (limited fields; rich edits live in Epic 6).
- Photo pipeline: upload → `sharp` resize (e.g. max 1600px long edge) → `.webp` → save under `data/photos/`.
- Search: SQLite `LIKE` on title and tag.name. FTS is a future enhancement, not v1.

**Epic 3 — Meal planner (UI)**
- Settings page entries for `planner.days_visible` (default 7) and `planner.start_weekday` (ISO 1–7, default 1=Mon).
- Desktop (≥ md):
  - Two-column layout. Left = calendar of `days_visible` days. Right = recipe list with text search + tag filter chips.
  - DnD library: `@dnd-kit/core` (lightweight, keyboard-accessible).
  - DnD operations: recipe-card → day-cell (create), meal-card → day-cell (move), meal-card within cell (reorder).
  - Click meal-card → side-panel editor (portions override, note, delete).
  - Range nav: `←` / `→` step by `days_visible`; "Heute" resets to the configured origin.
- Mobile (< md):
  - Single-column calendar. No DnD; tap day-cell → "Mahlzeit hinzufügen" → recipe-search modal → portions + note.
  - Edit a meal: tap meal-card → bottom-sheet editor. Move to other day = explicit date picker action.
- Empty days show a subtle "+" affordance on hover/tap.
- Calendar day-cells host both meals (this epic) and iCal events (Epic 12) — Epic 3 should reserve a render slot for events so Epic 12 only needs to add the data source.

**Epic 4 — Shopping list (online)**
- Pages: `/einkauf` (renders the active list), `/einkauf/verlauf` (history index), `/einkauf/[id]` (read-only view of a completed list).
- Migration seeds the initial active list row; partial unique index enforces "exactly one active".
- "Mahlzeiten hinzufügen" dialog per §4.3 — single dialog with date + length controls at the top and live-refreshing per-meal/per-ingredient checkbox preview below. Backed by `POST /api/v1/shopping-lists/:id/preview-meals` and `POST /api/v1/shopping-lists/:id/add-meals`.
- Merge-on-add algorithm per §4.3.2.
- Item rows: ingredient/product name, qty + unit, note, checkbox, edit/delete affordances.
- "Artikel hinzufügen" autocomplete searches `ingredient ∪ product` (with type label per result). Selecting an ingredient creates an item with `ingredient_id`; selecting a product creates one with `product_id`; typing a new name and confirming creates a new `product` (with optional category in the inline form) and attaches it.
- Supermarket filter dropdown in the page header; selection persists in `localStorage` (key `nomly.shopping.supermarketId`).
- "Liste abschließen" button + confirm; transactional close-and-create-next.
- Introduces the JSON endpoints under `/api/v1/shopping-lists/*` per §4.6 — used here for web-UI mutations and consumed unchanged by Epic 7's offline queue and Epic 10's HA flow.

**Epic 5 — Supermarkets**
- `/einstellungen/supermaerkte`: list + add/edit/delete.
- Per-supermarket category order: drag-and-drop list; uncategorized items always trail.
- Shopping list UI: supermarket select; when set, items group by `category` and sort by that supermarket's `sort_order`. When unset, items sort by ingredient name.

**Epic 6 — Ingredient / product / unit / category management**
- `/einstellungen/zutaten`: paginated/searchable list with columns name, aliases (chip list), default category, exclude flag.
- Edit form: rename, add/remove aliases, set default category, toggle `exclude_from_shopping_list`.
- Multi-select merge (ingredients): choose ≥2, click "zusammenführen", pick the row to keep; others' names + aliases become aliases of the kept row; all `recipe_ingredient.ingredient_id` and `shopping_list_item.ingredient_id` refs update in an atomic transaction.
- Delete (ingredient): prompt for optional replacement; if chosen, rewire references; if not, remove references (recipes and lists affected are listed in the confirm dialog).
- `/einstellungen/produkte`: analogous screen for `product` (name, aliases, default category). No "exclude" flag — products only land on lists via manual add anyway. Merge + delete-with-replacement work over `shopping_list_item.product_id` refs.
- Analogous (lighter) screens for `/einstellungen/einheiten` and `/einstellungen/kategorien` — merge on units must check for incompatible `dimension` (refuse) and align `factor` math.

**Epic 7 — Offline shopping list (PWA)**
- `public/manifest.webmanifest` + icons.
- Service worker registered from app shell; install/activate/fetch handlers per §5.4.
- IndexedDB store: `shopping_lists` (full payload per list id) + `mutation_queue`.
- `useShoppingList(id)` hook: hydrate from IDB → fetch fresh if online → reconcile → return state + mutators.
- Mutators write to IDB and POST/PATCH to JSON endpoints under `/api/v1/shopping-lists/*` (introduced here, unauthenticated for LAN-trust; Epic 10 layers bearer auth on top for HA access). Mutations queue if offline.
- "Offline" banner with queued-mutation count.
- Note: this epic does **not** introduce WebSockets. It ships a fully working offline-first experience that polls or revalidates on focus/reconnect. Epic 8 then swaps the transport to WS and adds peer push.

**Epic 8 — Realtime sync**
- WS hub: topic → set of sockets; broadcast helper.
- Mutation transport switches from HTTP (Epic 7) to WS `mutate` frames; HTTP endpoints stay live as fallback and as the HA-facing API.
- Server applies mutations transactionally, bumps `version`, broadcasts updated item to all topic subscribers.
- Client reconciler: when a broadcast arrives with `version > local.version`, replace local item; if local has uncommitted mutation for the same item, replay the local mutation on top of the broadcast.
- Heartbeat ping/pong every 30s; reconnect with exponential backoff.

**Epic 9 — Recipe URL import**
- `/rezepte/neu` gains a "Aus URL importieren" button.
- Server route fetches URL with a reasonable timeout, parses `<script type="application/ld+json">`, finds `@type: Recipe` (or recipe inside a `@graph`).
- Maps fields: `name → title`, `recipeIngredient[] → recipe_ingredient[]` (single section, parser splits qty+unit+name heuristically), `recipeInstructions → instructions` (concat as one section's markdown), `recipeYield → servings`, times via ISO 8601 → minutes, `image → photo` (download + resize).
- Validation surface: shows what was parsed; user confirms or fixes before save.

**Epic 10 — Home Assistant API**
- `/einstellungen/api-tokens`: create (token shown once), revoke.
- Auth middleware: reads `Authorization: Bearer <token>`, hashes, looks up active token. Updates `last_used_at`.
- Endpoints per §4.6. JSON-only.

**Epic 11 — Familywall import**
- Investigation phase produces a short doc on the extraction approach actually used.
- CLI: `npm run import:familywall -- <input-path>`.
- Idempotency: dedupe key on `title + source` (or content-hash); re-run inserts only new recipes.
- Outputs a summary (`N rezepte importiert, M übersprungen`).

**Epic 12 — iCal calendar feeds**
- `/einstellungen/kalender`: CRUD for `ical_feed` (Name, URL, Farbe — color picker, Aktiv-Toggle).
- Server-side fetch with `node-ical` (`fetch` from URL, parse). 5-minute in-memory cache keyed by feed id; a "Aktualisieren" button on the planner busts the cache.
- Endpoint: `GET /api/v1/ical-events?from&to` returns events from all enabled feeds, expanded for recurrence, clipped to range, tagged with `feedId` and `color`.
- Planner integration: events render in their day-cell alongside meals using the slot reserved in Epic 3; visually distinct (color bar + read-only treatment).
- Errors per feed are persisted (`last_error_*`) and surfaced as a small warning chip in the planner header — they do not block the rest of the planner.

### 7.2 Success criteria (acceptance per epic)

- **1** `npm run dev` boots the custom server; `/` renders a German layout; `db:push` applies the full schema; seed creates units and categories.
- **2** A recipe with two named sections and ten ingredients (spanning two units of the same dimension) can be created, edited, viewed, deleted; photo upload renders correctly; ingredient autocomplete finds existing entries and creates new ones.
- **3** On desktop, a recipe can be dragged from the right-hand list onto a day-cell to create a meal, and a meal can be dragged to another day to move; `days_visible` and `start_weekday` settings change the visible range; "Heute" resets to the configured origin. On mobile, tap-to-add still works and DnD is suppressed.
- **4** End-to-end on the active list: the "Mahlzeiten hinzufügen" dialog opens with date/length controls and a live preview; changing the date refreshes the preview; deselecting a meal clears its ingredients (meal checkbox follows); deselecting one ingredient leaves the meal in indeterminate state; "Alle/Keine auswählen" toggles the whole preview; confirming merges the selection (overlapping `(ingredient, dimension)` items get summed into existing items, others created fresh); re-opening the dialog with the same range now hides the already-added meals; "Liste abschließen" closes the current list and a new empty active list appears with the history link showing the prior list read-only; adding "Toilettenpapier" inline creates a reusable `product` with its category preserved; the supermarket filter dropdown changes the on-screen grouping/order without touching the DB and survives a page reload (per device).
- **5** Two supermarkets with different category orders flip the grouping/sort when toggled; both ingredient-items and product-items respect the supermarket's order.
- **6** Merging ingredients moves all references and preserves all aliases; merging products does the same over `shopping_list_item.product_id`; delete-with-replacement rewires references; `exclude_from_shopping_list` hides those ingredients from newly generated lists.
- **7** Airplane-mode mid-shop allows continued check/uncheck/qty edit; reconnect flushes the queue cleanly with no data loss.
- **8** Two browser tabs on the same list reflect each other's checks within ~1s.
- **9** A Chefkoch URL produces a complete recipe; a no-JSON-LD URL shows a clear "manual" prompt.
- **10** `curl -H "Authorization: Bearer ..."` can read the active list, check an item, and add a new product item.
- **11** Familywall data lands as recipes with sections + ingredients; a re-run produces zero duplicates.
- **12** With two iCal feeds configured (different colors) and one feed deliberately misconfigured, the planner shows valid events in their day-cells, the broken feed surfaces a warning chip, and the rest of the planner still works.

### 7.3 Cross-cutting

- **Tests.** Unit tests for server logic (smart merge + conversion, recipe scaling, alias resolution, merge transaction). At least one integration test per epic running against a temp SQLite file.
- **Migrations.** Every schema change ships a migration. No `db:push` against committed data.
- **Style.** Tailwind; component library is hand-rolled — pull in a primitive lib (shadcn-style) only if a complex component (dnd, autocomplete) gets too noisy.
- **No premature abstraction.** Build each epic concretely. Refactor when a second concrete use case appears.
- **Markdown.** Use a lightweight renderer (e.g. `marked` + `dompurify`) — no rich editor in v1.

## 8. Next step

Once this spec is approved, individual epics get their own implementation plan via the `writing-plans` skill — one plan per epic, starting with Epic 1 (Foundation). Plans go to `docs/superpowers/plans/`.
