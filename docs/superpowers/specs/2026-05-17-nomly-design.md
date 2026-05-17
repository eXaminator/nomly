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
| Entity naming | One canonical `name` per entity. Where useful (`ingredient`, `unit`, `category`), an `*_alias` child table provides search hits. No language tags anywhere. |
| Hosting | Self-hosted Node.js process behind a reverse proxy on the home network. |
| Stack | Next.js 16 (App Router, Turbopack), TS, Tailwind v4, better-sqlite3 + Drizzle ORM. |
| Server | Custom `server.ts` runs Next + WebSocket server on a single HTTP port. |
| Offline | Shopping list page is a PWA with IndexedDB + service worker + offline mutation queue. |
| Realtime | WebSocket pub/sub on shopping-list and meal-plan topics. |
| External API | REST under `/api/v1/...` with bearer-token auth for Home Assistant. |
| DB file | `./data/nomly.db` — WAL mode, foreign keys on. |
| Photos | `./data/photos/<uuid>.webp`, resized on upload with `sharp`. |

## 3. Domain Model

### 3.1 Naming pattern

Every entity that represents a real-world concept stores a single canonical `name` (text, language-agnostic). The UI always shows this name.

For three entity types — `ingredient`, `unit`, `category` — an additional `*_alias` table holds free-form alternate names (`(parent_id, name)`). Aliases participate in autocomplete and matching but are never displayed in lieu of the canonical name.

`recipe.title`, `tag.name`, `supermarket.name` are canonical-only — no alias table.

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
  id, title, date_from, date_to, supermarket_id (FK, nullable),
  created_at, completed_at (nullable)

shopping_list_item
  id, list_id (FK), ingredient_id (FK, nullable — null for ad-hoc items),
  custom_name (nullable; required iff ingredient_id is null),
  quantity (decimal, nullable), unit_id (FK, nullable),
  category_id (FK, nullable; snapshot of ingredient.default_category at generation),
  checked (bool, default false), checked_at (nullable),
  note (nullable), sort_order,
  version (int, monotonic — for sync conflict resolution),
  updated_at

api_token
  id, name (label), token_hash, last_used_at (nullable),
  created_at, revoked_at (nullable)

app_setting
  key (PK), value
  -- e.g. "shopping_list.default_length_days" = "7"
```

### 3.3 Invariants

- An `ingredient`'s `name` and all its `ingredient_alias.name` rows are globally unique across the union — typing any of them resolves to exactly one ingredient. Same for units and categories.
- Every `recipe` has at least one `recipe_section`. A single-section recipe uses one section with `title = null` and the UI renders it flat.
- `shopping_list_item.ingredient_id` and `custom_name` are mutually exclusive (XOR): exactly one is set.
- `unit` conversions only sum within the same `dimension`. Cross-dimension entries for one ingredient render as separate lines under one ingredient header.
- `shopping_list` is a **snapshot**: subsequent meal-plan edits do not mutate an already-generated list.

## 4. Key Flows

### 4.1 Recipe creation

- "Neues Rezept" → form: Titel, Beschreibung (optional, Markdown), Portionen, Vorbereitungszeit, Kochzeit, Quelle-URL, Foto, Tags.
- One or more sections. Each section: Titel (optional) + Anleitung (Markdown) + Zutaten-Liste.
- Zutat row: Menge, Einheit, Zutat, Notiz. `Einheit` and `Zutat` are autocompletes against canonical name ∪ aliases; `Zutat neu anlegen` and `Einheit neu anlegen` available inline.
- New ingredients created inline get `default_category_id = null`; they can be categorized later from the ingredient management page.
- Save persists the recipe + sections + ingredients atomically.

### 4.2 Meal planning

- `/plan` shows the current week, Mon–Sun. Day-cells responsive (columns on desktop, rows on mobile).
- Tap a day → "Mahlzeit hinzufügen" → recipe search → set Portionen-Override (defaults to `recipe.servings`) and optional Notiz.
- Multiple meals per day list in `sort_order`. Drag to reorder, long-press to delete, tap to edit.
- "Heute"-Button springt zur aktuellen Woche.

### 4.3 Shopping list generation

- Setting `shopping_list.default_length_days` (default 7) lives in `app_setting`.
- "Neue Einkaufsliste" → Startdatum (default heute) + Länge (default = setting) + optional Supermarkt → Erstellen.
- The server:
  1. Collects `meal_plan` rows in `[start, start + length - 1]`.
  2. Expands each row to its `recipe_section.recipe_ingredient` set, scaling `quantity` by `servings_override / recipe.servings`.
  3. Drops any line where the ingredient has `exclude_from_shopping_list = true`.
  4. Groups remaining lines by `ingredient_id`, then sub-groups by `unit.dimension`.
  5. Within each `(ingredient, dimension)` bucket, converts to the base unit and sums; formats output in the largest sensible unit (`1200g → 1,2 kg`).
  6. Cross-dimension lines for the same ingredient remain separate but render under one ingredient header.
  7. Open-ended lines (null quantity) collapse to a single line per `(ingredient, unit)` with the note preserved.
- The merged result is materialized into `shopping_list_item` rows; each row snapshots `category_id` from `ingredient.default_category_id` at generation time.
- Once created, the list is decoupled from meal-plan edits.

### 4.4 Shopping in a store (offline + sync)

- `/shopping/[id]` is the offline-capable page.
- First visit (while online) caches the list payload to IndexedDB and the app shell to the service worker cache.
- Every mutation (check, uncheck, edit qty/unit/note, add ad-hoc, delete) writes to IndexedDB first and is sent to the server, queued if offline. The transport evolves across epics: Epic 7 ships with HTTP `POST`/`PATCH` to the existing REST endpoints; Epic 8 swaps to a WebSocket mutate frame on the same protocol shape and adds live peer broadcast.
- Each mutation carries a client-generated `mutationId` and the item's last-known `version`. The server applies LWW per item: a mutation with a stale `version` is reconciled (the server's current state wins for the conflicting field) and the merged state is returned (and, from Epic 8, broadcast).
- On reconnect, the queue flushes FIFO. Server idempotency dedupes by `mutationId`.
- From Epic 8 onward, all clients subscribed to the list topic receive item updates in real time.

### 4.5 Home Assistant integration

- Token issuance in settings: enter a label → token shown once → only the hash is stored.
- Endpoints under `/api/v1/`, bearer auth required:
  - `GET /api/v1/shopping-lists` — active and recent
  - `GET /api/v1/shopping-lists/:id`
  - `POST /api/v1/shopping-lists/:id/items` — add ad-hoc
  - `PATCH /api/v1/shopping-lists/:id/items/:itemId` — toggle checked, edit qty/note
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

## 7. Epics

Each epic is independently mergeable. Order reflects the critical path to a usable v1; later epics layer on quality and integrations.

| # | Epic | Depends on | One-line scope |
|---|---|---|---|
| 1 | **Foundation** | — | Custom server, full schema, base seeds, layout/nav shell, settings shell. |
| 2 | **Recipes** | 1 | Recipe CRUD with multi-section model, inline ingredient/unit/category create, tags, photo upload, list/grid + detail, search. |
| 3 | **Meal planner** | 2 | Weekly view, add/edit/delete/reorder meals (multiple per day), servings override, "today" navigation. |
| 4 | **Shopping list (online)** | 3 | Generation (start + length), smart merge + unit conversion, snapshot semantics, ad-hoc items, check-off UI, list history. |
| 5 | **Supermarkets** | 4 | Supermarket CRUD, per-supermarket category ordering, filter-and-sort on shopping list. |
| 6 | **Ingredient / unit / category management** | 2 | Settings sub-pages: CRUD, alias management, multi-select merge with main selection, delete-with-replacement, `exclude_from_shopping_list` toggle. |
| 7 | **Offline shopping list (PWA)** | 4 | Manifest, service worker, IndexedDB-backed state, optimistic mutations, FIFO offline queue, offline indicator. |
| 8 | **Realtime sync** | 4, 7 | WS hub on custom server, subscribe/broadcast protocol, item versioning + LWW reconciliation. |
| 9 | **Recipe URL import** | 2 | Server-side fetch + JSON-LD `Recipe` parse, photo fetch, manual fallback. |
| 10 | **Home Assistant API** | 4 | `api_token` table + UI, bearer middleware, `/api/v1/*` endpoints. |
| 11 | **Familywall import** | 2 | Extraction investigation + one-time, idempotent CLI ingestion script. |

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

**Epic 3 — Meal planner**
- Weekly view, Mon–Sun; left/right week navigation; "Heute" jumps to current week.
- Add meal modal: date prefilled from clicked day, recipe search (same autocomplete pattern as ingredients), portions override, note.
- Reorder via drag (desktop) and long-press-and-drag (mobile).
- "Mahlzeit löschen" with confirm.

**Epic 4 — Shopping list (online)**
- Page `/einkauf` (list of lists) + `/einkauf/[id]` (single list).
- Generation modal: start date (today default), length (setting default), optional supermarket.
- Smart merge algorithm per §4.3.
- Item rows: ingredient/custom name, qty + unit, note, checkbox, edit/delete affordances.
- Add ad-hoc item (free-text custom name, no ingredient binding required).
- List archive: completed lists move to a history section after `completed_at` is set (mark list complete button).

**Epic 5 — Supermarkets**
- `/einstellungen/supermaerkte`: list + add/edit/delete.
- Per-supermarket category order: drag-and-drop list; uncategorized items always trail.
- Shopping list UI: supermarket select; when set, items group by `category` and sort by that supermarket's `sort_order`. When unset, items sort by ingredient name.

**Epic 6 — Ingredient / unit / category management**
- `/einstellungen/zutaten`: paginated/searchable list with columns name, aliases (chip list), default category, exclude flag.
- Edit form: rename, add/remove aliases, set default category, toggle exclude flag.
- Multi-select merge: choose ≥2, click "zusammenführen", pick the row to keep, others' names + aliases become aliases of the kept row, all `recipe_ingredient.ingredient_id` refs updated. Atomic transaction.
- Delete: prompt for optional replacement; if chosen, replace references; if not, remove references (recipes affected listed in confirm dialog).
- Analogous (lighter) screens for `/einstellungen/einheiten` and `/einstellungen/kategorien`.

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
- Endpoints per §4.5. JSON-only.

**Epic 11 — Familywall import**
- Investigation phase produces a short doc on the extraction approach actually used.
- CLI: `npm run import:familywall -- <input-path>`.
- Idempotency: dedupe key on `title + source` (or content-hash); re-run inserts only new recipes.
- Outputs a summary (`N rezepte importiert, M übersprungen`).

### 7.2 Success criteria (acceptance per epic)

- **1** `npm run dev` boots the custom server; `/` renders a German layout; `db:push` applies the full schema; seed creates units and categories.
- **2** A recipe with two named sections and ten ingredients (spanning two units of the same dimension) can be created, edited, viewed, deleted; photo upload renders correctly; ingredient autocomplete finds existing entries and creates new ones.
- **3** Three meals can be planned on a single day, reordered, deleted; servings override applies; week nav works.
- **4** Generating a list across a week with overlapping recipes produces one merged item per `(ingredient, dimension)`; ad-hoc items add; checking persists; subsequent meal-plan edits do not mutate the list.
- **5** Two supermarkets with different category orders flip the grouping/sort when toggled.
- **6** Merging ingredients moves all references and preserves all aliases; delete-with-replacement rewires references; `exclude_from_shopping_list` hides those ingredients from newly generated lists.
- **7** Airplane-mode mid-shop allows continued check/uncheck/qty edit; reconnect flushes the queue cleanly with no data loss.
- **8** Two browser tabs on the same list reflect each other's checks within ~1s.
- **9** A Chefkoch URL produces a complete recipe; a no-JSON-LD URL shows a clear "manual" prompt.
- **10** `curl -H "Authorization: Bearer ..."` can read the active list, check an item, add an ad-hoc item.
- **11** Familywall data lands as recipes with sections + ingredients; a re-run produces zero duplicates.

### 7.3 Cross-cutting

- **Tests.** Unit tests for server logic (smart merge + conversion, recipe scaling, alias resolution, merge transaction). At least one integration test per epic running against a temp SQLite file.
- **Migrations.** Every schema change ships a migration. No `db:push` against committed data.
- **Style.** Tailwind; component library is hand-rolled — pull in a primitive lib (shadcn-style) only if a complex component (dnd, autocomplete) gets too noisy.
- **No premature abstraction.** Build each epic concretely. Refactor when a second concrete use case appears.
- **Markdown.** Use a lightweight renderer (e.g. `marked` + `dompurify`) — no rich editor in v1.

## 8. Next step

Once this spec is approved, individual epics get their own implementation plan via the `writing-plans` skill — one plan per epic, starting with Epic 1 (Foundation). Plans go to `docs/superpowers/plans/`.
