# Home Assistant integration — design

Date: 2026-05-29
Status: approved (implementing autonomously)

## Goal

Wire nomly into Home Assistant (HA) so the user and his wife can, from HA:

1. **See today's + tomorrow's meals** on a dashboard, and tap a meal to view the
   full recipe **embedded in HA** (iframe), without logging into nomly in the HA
   webview.
2. **Add items to the shopping list** (voice / automation).
3. **Ask by voice**: "what do we eat today/tomorrow?" and "do we need <X> for
   anything else?".
4. Get a **geofence notification** when arriving at a supermarket — but **only if
   the list has something that store carries** — that opens the shopping list
   with that supermarket preselected.

Explicitly **out of scope for now**: iCal meal feed / native HA calendar entity;
a custom Python/HACS component; two-way native HA todo entity.

## Approach

**Thin / config-only on the HA side.** Nothing new runs long-term in HA — it is
wired with REST sensors, `rest_command`, Assist intents and zone automations.
nomly gains a small set of endpoints, an embeddable recipe view, a scoped
embed-auth path, deep links, and tightened framing headers. No new daemon.

Most data plumbing already exists:

- Meals: `GET /api/v1/meal-plans?from=&to=` already returns date, recipe id,
  title, photo, servings, diet, hasShopping.
- Add to shopping: `POST /api/v1/shopping/items` already accepts `{ byName }`.
- Per-store needed-item counts: `countNeededItemsPerSupermarket()` already exists
  and mirrors the list's visibility rules.

## Embed auth (the load-bearing decision)

`nomly.weingaertner.pro` and `home.weingaertner.pro` share the registrable
domain `weingaertner.pro`. The user does **not** want to do an OIDC login inside
the HA webview, so the embedded recipe authenticates with an **API token**, not
the OIDC session.

An `<iframe src>` can't send an `Authorization` header, so the token arrives in
the URL. Design to keep the blast radius and exposure small:

### Scoped, read-only embed token

- Add a nullable `scope` column to `api_token`: `'full' | 'embed'`, default
  `'full'` (migration applies cleanly on a live DB — see the clean-migrations
  rule).
- An `embed`-scoped token may only reach the embed allow-list:
  `/embed/**` pages and `GET /api/v1/photos/**` (recipe images). Never writes,
  never the rest of the API. Worst case if the HA config leaks: someone can view
  recipes.
- The token has **no expiry** (only `revokedAt`). It is set once in HA and never
  touched again.

### Exchange-once → cookie

1. HA embeds `…/embed/rezepte/<id>?k=<embedToken>`.
2. `proxy.ts` sees `k` on an `/embed/**` path, validates it via `verifyBearer`,
   and if the token is `embed`- (or `full`-) scoped, sets a sealed
   `__nomly_embed` cookie (iron-session `sealData`, `httpOnly`, `Secure`,
   `SameSite=Lax`), then **302-redirects to the same URL minus `k`** so the
   token leaves the visible URL / webview history.
3. Subsequent requests (the embed page, the photo) authenticate via the cookie.
4. The cookie's TTL is short (12h) — that is fine for operations, because every
   time HA opens the recipe it re-renders the iframe `src` from config (which
   still carries the token) and the cookie is re-minted transparently. **Idle
   for days → next tap self-heals.** Nothing to refresh manually.

### proxy.ts credential order (after this change)

1. Live OIDC session cookie → full access (unchanged).
2. `Authorization: Bearer` → access gated by the token's scope.
3. `?k=` on an `/embed/**` path → mint `__nomly_embed`, redirect to clean URL.
4. `__nomly_embed` cookie → embed principal (allow-list only).
5. Reject (401 for `/api/**`, redirect to login otherwise) — unchanged.

When the principal is `embed`-scoped (cookie, `?k=`, or bearer), the request
must match the embed allow-list or it is rejected.

### Framing headers

Add a `Content-Security-Policy: frame-ancestors 'self' <HA origin>` response
header. The HA origin comes from a new env var `EMBED_FRAME_ANCESTORS`
(e.g. `https://home.weingaertner.pro`); when unset it falls back to `'self'`.
Applied app-wide via `next.config.ts` `headers()` — this both **tightens**
today's wide-open framing and permits the HA embed.

## nomly-side work items

1. **Schema:** `scope` column on `api_token` (+ Drizzle migration).
2. **bearer.ts:** `verifyBearer` returns `scope`; `createApiToken(name, scope)`;
   `BearerPrincipal` carries `scope`.
3. **token:create script:** `--scope full|embed` flag (default `full`).
4. **Embed session lib** (`src/lib/embed-session.ts`): seal/unseal the
   `__nomly_embed` cookie payload `{ tokenId, scope, issuedAt }`, with a
   liveness check; cookie name `__nomly_embed`.
5. **proxy.ts:** the credential order + allow-list + scope enforcement above.
6. **Route-group restructure** so the embed view has no app chrome:
   - Root `app/layout.tsx` keeps `<html>/<body>`, theme, metadata, viewport.
   - New `app/(app)/layout.tsx` carries `RegisterSW`, `PullToRefresh`,
     `AppShell`.
   - Move `page.tsx`, `einkauf/`, `einstellungen/`, `plan/`, `rezepte/`,
     `offline/` under `app/(app)/` (URLs unchanged — route groups don't affect
     the path). `api/` and asset routes stay put.
7. **Shared `RecipeDetail` component:** extract the recipe body from
   `app/(app)/rezepte/[id]/page.tsx` into
   `src/components/recipes/recipe-detail.tsx`, parameterised by `showEdit`.
   The normal page renders it with `showEdit`; the embed renders it without.
8. **Embed page:** `app/embed/rezepte/[id]/page.tsx` — renders `RecipeDetail`
   (no edit button, `mealPlanId=null` so the upcoming-uses affordance is off),
   under the bare root layout.
9. **Shopping deep link:** `GET /einkauf?supermarket=<id>` — `ShoppingListView`
   reads the param on mount and, when it matches a known store, selects it
   (taking precedence over the localStorage default).
10. **Ingredient-usage query:** `GET /api/v1/ingredients/usage?name=<text>` →
    resolves the name (`resolveByName`), then returns the upcoming planned meals
    (date ≥ today) whose recipes use it and whether it's on the current list.
    Shape:
    ```jsonc
    { "match": "exact|substring|ambiguous|none",
      "ingredient": { "id": 1, "name": "Tomaten" } | null,
      "candidates": [ … ],            // when ambiguous
      "onShoppingList": true,
      "upcomingMeals": [ { "mealPlanId": 9, "date": "2026-05-31",
                           "recipeId": 4, "recipeTitle": "…" } ] }
    ```
11. **Store-availability query:** `GET /api/v1/shopping/store-availability` →
    `{ "<supermarketId>": <uncheckedCarriedCount>, … }`, built from
    `listShoppingItems()` + supermarket categories via
    `countNeededItemsPerSupermarket()`.
12. **Docs:** `docs/home-assistant.md` with the HA-side YAML (REST sensor,
    `rest_command`, Assist `intent_script`s, zone automation gated on
    store-availability, dashboard card with the popup-iframe), and the
    one-time setup (`npm run token:create -- --name home-assistant --scope
    embed`).

## HA-side wiring (documented, not code in this repo)

- **Meals sensor:** REST sensor polling `meal-plans?from={today}&to={tomorrow}`
  with `Authorization: Bearer <full-or-read token>`; meals exposed as
  attributes; a dashboard card lists them; tapping opens a browser_mod / webpage
  popup with `…/embed/rezepte/<id>?k=<embed token>`.
- **Add to shopping:** `rest_command` POSTing `{ byName }`; wired to an Assist
  sentence ("setz <item> auf die Einkaufsliste") and/or automations.
- **Voice "what do we eat":** `intent_script` reading the meals sensor.
- **Voice "do we need X":** `rest_command` with `return_response: true` hitting
  `ingredients/usage`; spoken from the response. (Free-form phrasing optionally
  via an LLM Assist agent calling it as a tool.)
- **Geofence:** zone-enter automation → call `store-availability` (rest_command,
  `return_response`) → only notify if that store's count > 0 → notification
  action opens `…/einkauf?supermarket=<id>`.

## Testing

- Unit (vitest, TDD): embed-session seal/unseal + liveness; embed allow-list /
  scope authorization helper; ingredient-usage service; store-availability
  assembly.
- Integration: `npm run typecheck`, `npm run test`, and **`npm run build`**
  (catches RSC client/server boundary errors that tsc/vitest miss — required by
  the run-next-build rule, especially given the layout restructure).

## Risks / notes

- Embed token in HA config is the one unavoidable at-rest copy; read-only scope
  bounds it.
- Route-group move is the highest-risk change (RSC boundaries) — covered by the
  build gate.
- `proxy.ts` runs DB-backed `verifyBearer` today, so the new DB-backed embed
  checks there are consistent with the existing runtime.
