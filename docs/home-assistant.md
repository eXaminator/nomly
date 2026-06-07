# Home Assistant integration

nomly exposes everything Home Assistant (HA) needs over its existing
`/api/v1` REST API plus a chrome-less recipe embed view. There is **no custom
component to install** — wire it up with the YAML below.

This assumes nomly at `https://nomly.weingaertner.pro` and HA at
`https://home.weingaertner.pro` (same registrable domain, so the embed cookie
is same-site).

## 1. One-time setup

### Tokens

Mint two tokens (run inside the prod container, against the live DB):

```bash
# Full token — for the REST sensors / rest_commands (read + write the API).
docker compose exec nomly \
  node --experimental-transform-types --disable-warning=ExperimentalWarning \
  scripts/create-api-token.mts --name home-assistant

# Embed token — only the recipe-iframe allow-list (reads + the "Update
# vormerken" toggle). Goes in the dashboard iframe URL.
docker compose exec nomly \
  node --experimental-transform-types --disable-warning=ExperimentalWarning \
  scripts/create-api-token.mts --name home-assistant-embed --scope embed
```

Each raw token is printed **once**. The **full** token is used in
`configuration.yaml` (sensors / rest_commands), so put it in `secrets.yaml` as a
ready-to-use `Authorization` value:

```yaml
# secrets.yaml
nomly_bearer: "Bearer <full token>"
```

The **embed** token is used in a Lovelace dashboard card (the iframe URL).
Lovelace can't read `secrets.yaml`, so paste the embed token directly into the
card config wherever you see `?k=<embed token>` below. The token is confined to
the embed allow-list — recipe reads plus the harmless "Update vormerken" flag
toggle — so that's fine.

### Allow framing

Set this on the nomly container so HA may embed the recipe view (it also
tightens framing for everyone else):

```yaml
# docker-compose.yml → nomly service → environment:
EMBED_FRAME_ANCESTORS: "https://home.weingaertner.pro"
```

## 2. Meals — REST sensor (today + tomorrow)

```yaml
# configuration.yaml
rest:
  - resource_template: >-
      https://nomly.weingaertner.pro/api/v1/meal-plans?from={{ now().strftime('%Y-%m-%d') }}&to={{ (now() + timedelta(days=1)).strftime('%Y-%m-%d') }}
    headers:
      Authorization: !secret nomly_bearer   # literal "Bearer <full token>"
    scan_interval: 600
    sensor:
      - name: "Nomly meals"
        unique_id: nomly_meals
        value_template: "{{ value_json.mealPlans | length }}"
        json_attributes:
          - mealPlans
```

> `resource_template` is re-evaluated each `scan_interval`, so the `from`/`to`
> dates roll over at midnight on their own. `!secret nomly_bearer` is the literal
> string `Bearer <full token>` (the base URL isn't a secret, so it stays inline —
> `!secret` can't be used mid-template anyway).

The sensor's **state** is the meal count; the `mealPlans` **attribute** is the
full array. Each meal exposes `recipe.id`, `recipe.title`, `recipe.photoPath`,
`date`, `servings`, `note` (the free-text note on the planned meal, `null` when
unset), and `isLeftover`. Photo URL:
`https://nomly.weingaertner.pro/api/v1/<photoPath>`.

`isLeftover` is `true` for a leftover day ("we're eating this again"). These
meals are intentionally excluded from the shopping list and ingredient timing —
surface them with a label rather than hiding them, so the dashboard still shows
what's for dinner.

A throwaway Markdown list to confirm it works (leftovers get a "♻︎ Reste" tag):

```yaml
type: markdown
content: |
  {% for m in state_attr('sensor.nomly_meals','mealPlans') %}
  - **{{ m.date }}** — {{ m.recipe.title }} ({{ m.servings }} P.){% if m.isLeftover %} — ♻︎ Reste{% endif %}
  {% endfor %}
```

## 2b. Dynamic meals card — one button per meal, no limit

Renders a **"Heute"** header followed by every meal planned for today, then a
**"Morgen"** header + tomorrow's meals — each an image tile that opens the
recipe in a popup on tap. No fixed meal count. If today has nothing, a
do-nothing placeholder tile shows instead; if tomorrow has nothing, the whole
"Morgen" area is omitted. Uses
[`config-template-card`](https://github.com/iantrich/config-template-card),
[`button-card`](https://github.com/custom-cards/button-card) and
[`browser_mod`](https://github.com/thomasloven/hass-browser_mod) (all HACS).

Replace `PASTE_EMBED_TOKEN` with your embed token. Note the `cards: |-` block
scalar: the `-` strips the trailing newline, which config-template-card requires
(it expects the value to end in `}` — a plain `|` leaves a `\n` and throws
"Unexpected token '}'").

```yaml
type: custom:config-template-card
entities:
  - sensor.nomly_meals
card:
  type: vertical-stack
  cards: |-
    ${ (function () {
      var BASE = 'https://nomly.weingaertner.pro';
      var TOKEN = 'PASTE_EMBED_TOKEN';
      var FALLBACK = 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fpng.pngtree.com%2Fbackground%2F20220721%2Foriginal%2Fpngtree-empty-plate-kitchenware-kitchen-material-wooden-table-background-picture-image_1706347.jpg&f=1&nofb=1&ipt=4f167ea99981bab66b662b3cbe97fa3ebe989f98becf96927aff53368b4550f8';
      var TILE_HEIGHT = '120px';
      var STYLES = {
        card: [{ padding: '0' }, { height: TILE_HEIGHT }],
        grid: [{ 'grid-template-rows': '1fr min-content' }],
        img_cell: [{ 'align-self': 'start' }, { 'justify-self': 'start' }, { 'text-align': 'start' }],
        entity_picture: [{ width: '100%' }, { height: '100%' }, { 'object-fit': 'cover' }],
        state: [{ 'font-weight': 'bold' }, { 'place-self': 'start' }, { padding: '1em .5em' }]
      };
      function tile(m) {
        return {
          type: 'custom:button-card',
          show_name: false,
          show_state: true,
          show_entity_picture: true,
          entity_picture: m.recipe.photoPath ? (BASE + '/api/v1/' + m.recipe.photoPath) : FALLBACK,
          // Leftover days are tagged so the tile reads "♻︎ Reste · <title>".
          state_display: (m.isLeftover ? '♻︎ Reste · ' : '') + m.recipe.title,
          tap_action: {
            action: 'fire-dom-event',
            browser_mod: {
              service: 'browser_mod.popup',
              data: {
                // &meal=<id> → ingredient "used elsewhere this week" popovers.
                // &title=0   → hide the recipe name in the iframe (the popup
                //              header already shows it).
                // No aspect_ratio: the iframe card's #root (the aspect-ratio
                // box) is overridden via card-mod to fill the full dialog
                // height (height:100% collapses to 0 here, so use a dvh calc).
                content: { type: 'iframe', url: BASE + '/embed/rezepte/' + m.recipe.id + '?k=' + TOKEN + '&meal=' + m.id + '&title=0', card_mod: { style: ':host{display:block} ha-card{height:auto} #root{padding-top:0 !important; height: calc(100dvh - 70px) !important;}' } },
                title: m.recipe.title,
                // Size the popup: HA's dialog is a WebAwesome <wa-dialog> two
                // shadow-roots deep, so we use card-mod's `$` to pierce into
                // ha-dialog's shadow and set wa-dialog's own --width/--height.
                // 1060px → the iframe lands ~1043px, just over the recipe's
                // 1024px (lg) breakpoint, so ingredients + instructions sit
                // side-by-side. (The iframe is ~17px narrower than the dialog,
                // so ~1030px would still stack.) 100dvh = full viewport height.
                card_mod: { style: { 'ha-dialog$': 'wa-dialog { --width: min(96vw, 1060px) !important; --height: 100dvh !important; }' } }
              }
            }
          },
          styles: STYLES
        };
      }
      function placeholder() {
        return {
          type: 'custom:button-card',
          show_name: false,
          show_state: true,
          show_entity_picture: true,
          entity_picture: FALLBACK,
          state_display: 'Kein Essen geplant',
          tap_action: { action: 'none' },
          styles: STYLES
        };
      }
      function localISO(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }
      function fmt(d) {
        return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' }).replace(',', '');
      }
      function header(label, d) {
        return { type: 'heading', heading: label + ' – ' + fmt(d), heading_style: 'title' };
      }

      var s = states['sensor.nomly_meals'];
      if (!s) { return [{ type: 'markdown', content: '⚠️ `sensor.nomly_meals` nicht gefunden — REST-Sensor anlegen (Abschnitt 2) und neu laden.' }]; }
      var meals = (s.attributes && s.attributes.mealPlans) || [];
      var todayD = new Date();
      var tomorrowD = new Date(Date.now() + 864e5);
      var today = localISO(todayD);
      var tomorrow = localISO(tomorrowD);
      var todays = meals.filter(function (m) { return m.date === today; });
      var tomorrows = meals.filter(function (m) { return m.date === tomorrow; });

      var cards = [header('Heute', todayD)];
      if (todays.length) { todays.forEach(function (m) { cards.push(tile(m)); }); }
      else { cards.push(placeholder()); }
      if (tomorrows.length) {
        cards.push(header('Morgen', tomorrowD));
        tomorrows.forEach(function (m) { cards.push(tile(m)); });
      }
      return cards;
    })() }
```

The tiles mirror the look of your existing `custom:button-card` (full-bleed
photo, bold meal name bottom-left, empty-plate fallback). The placeholder's
`tap_action: { action: 'none' }` makes it inert. Each meal also carries
`m.note` (the planner's free-text note, `null` when unset) — e.g. to surface it
on the tile:

```js
state_display: (m.isLeftover ? '♻︎ Reste · ' : '') + m.recipe.title + (m.note ? ' — ' + m.note : ''),
```

> **Tile height:** `grid_options: { rows: 2 }` only sizes a card when it sits
> directly in a Sections-view grid — inside this `vertical-stack` it's ignored.
> So the height is set explicitly via `TILE_HEIGHT` (`120px` ≈ the old 2-row
> size); change that one variable to taste.

The day headers use the native **Heading card** (`type: heading`) — the plain
section header you can also add from the dashboard UI — with the weekday + date
(e.g. "Heute – Fr. 29. Mai"). Date math is in **local** time so it can't drift a
day near midnight.

**Popup size** is the fiddly bit, because recent HA renders the popup as a
**WebAwesome `<wa-dialog>` nested two shadow-roots deep** (inside `ha-dialog`,
inside `browser-mod-popup`). Its width is driven by `wa-dialog`'s own `--width`
variable — *not* `--mdc-dialog-*`, and not reachable by browser_mod's `style` /
`popup_styles` (those can only reach `ha-dialog`, and `--width` doesn't inherit
across the boundary). The working lever is **card-mod's `$` shadow-pierce**:
`card_mod.style` keyed `ha-dialog$` injects a stylesheet *into* ha-dialog's
shadow, where `wa-dialog { --width; --height }` finally lands. `1060px` puts the
**iframe** at ~1043px — just over the recipe's `lg` (1024px) breakpoint — so the
ingredients and instructions render **side-by-side**. Note the iframe is ~17px
narrower than the dialog, so a ~1030px dialog would still stack. For height, the
dialog is set to `100dvh` and the iframe card's `#root` (its aspect-ratio box) is
overridden via card-mod to `height: calc(100dvh - 70px)` so the recipe **fills
the full viewport height** with no aspect-ratio letterboxing — `height: 100%`
collapses to 0 through the slotted shadow chain, so a `dvh` calc is used instead.
Requires card-mod installed (HACS). On mobile the popup is near-full-width and
the recipe stacks to one column.

**Meal context + de-duplicated title** come from the iframe URL params:
`&meal=<m.id>` turns on the per-ingredient "used elsewhere this week" popovers
(needs nomly's embed allow-list to permit that read — shipped), and `&title=0`
hides the recipe name inside the iframe so it isn't duplicated under the popup's
own header (which keeps the title + close button).

> Prefer Bubble Card for the popup? You can put the same `iframe` inside a
> Bubble Card pop-up, but Bubble pop-ups are keyed by a URL hash (one
> definition per hash), so they can't take a per-recipe URL dynamically.
> `browser_mod.popup` is parameterised per tap, which is why it's used here.
> The dynamic *list* (config-template-card) is independent of which popup
> mechanism you choose — swap the `tap_action` if you keep Bubble Card.

### Iframe shows an error?

- **"Refused to display … frame-ancestors 'self'"** — `EMBED_FRAME_ANCESTORS`
  isn't set to your HA origin on the nomly container (or it wasn't restarted).
  Set `EMBED_FRAME_ANCESTORS: "https://home.weingaertner.pro"` and recreate the
  container.
- **Error points at your `auth.…` / OIDC domain** — the `?k=` token isn't a
  valid **embed**-scoped token, so the page redirected to login and the IdP
  refuses framing. Mint an `embed`-scoped token and use that.
- **Blank / 404** — check the recipe id exists and the base URL is reachable
  from the device.

## 3. Recipe in an iframe (tap a meal)

The embed view lives at
`https://nomly.weingaertner.pro/embed/rezepte/<recipeId>?k=<embed token>`.
proxy.ts swaps `?k=` for a short-lived `__nomly_embed` cookie and strips the
token from the URL; it self-heals on every open, so the token in the dashboard
config is the only thing you set, once.

Easiest: a **Webpage card** pointed at that URL, or a popup via
[`browser_mod`](https://github.com/thomasloven/hass-browser_mod):

```yaml
# tap_action on a meal button/card
tap_action:
  action: fire-dom-event
  browser_mod:
    service: browser_mod.popup
    data:
      title: "{{ meal.recipe.title }}"
      content:
        type: iframe
        url: "https://nomly.weingaertner.pro/embed/rezepte/{{ meal.recipe.id }}?k=<embed token>"
        aspect_ratio: 75%
```

## 4. Add to the shopping list

```yaml
# configuration.yaml
rest_command:
  nomly_add_item:
    url: "https://nomly.weingaertner.pro/api/v1/shopping/items"
    method: POST
    headers:
      Authorization: !secret nomly_bearer
      Content-Type: "application/json"
    payload: '{"byName": "{{ item }}"}'
```

Call `rest_command.nomly_add_item` with `item: "Milch"` from an automation or
an Assist sentence ("setz {item} auf die Einkaufsliste").

## 5. Voice (Assist)

### "Was essen wir heute / morgen?"

```yaml
# configuration.yaml
intent_script:
  NomlyMealsToday:
    speech:
      text: >-
        {% set ms = state_attr('sensor.nomly_meals','mealPlans')
           | selectattr('date','eq', now().strftime('%Y-%m-%d')) | list %}
        {% if ms %}Heute gibt es {{ ms | map(attribute='recipe.title') | join(' und ') }}.
        {% else %}Für heute ist nichts geplant.{% endif %}
```

Add a matching custom sentence under `custom_sentences/de/`.

### "Brauchen wir noch <X>?"

```yaml
rest_command:
  nomly_ingredient_usage:
    url: "https://nomly.weingaertner.pro/api/v1/ingredients/usage?name={{ item }}"
    method: GET
    headers:
      Authorization: !secret nomly_bearer

intent_script:
  NomlyIngredientUsage:
    speech:
      text: >-
        {% set r = (states.rest_command... ) %}  # use the response variable
        ...
```

> HA's `rest_command` supports `response_variable` (set `return_response`); the
> intent's `speech.text` then reads `match`, `onShoppingList` and
> `upcomingMeals` from the response. For free-form phrasing, expose
> `NomlyIngredientUsage` as a tool to an LLM Assist agent instead of fixed
> sentences.

## 6. Geofence notification (only if the store has something)

On entering a supermarket zone, query availability and notify **only when that
store's `neededCount > 0`**; the tap opens the list with the store preselected.

```yaml
rest_command:
  nomly_store_availability:
    url: "https://nomly.weingaertner.pro/api/v1/shopping/store-availability"
    method: GET
    headers:
      Authorization: !secret nomly_bearer

automation:
  - alias: "Nomly — Einkauf bei Edeka"
    trigger:
      - platform: zone
        entity_id: person.me
        zone: zone.edeka
        event: enter
    action:
      - service: rest_command.nomly_store_availability
        response_variable: avail
      - variables:
          edeka: >-
            {{ (avail.content.supermarkets
               | selectattr('name','eq','Edeka') | first) | default({}) }}
      - condition: template
        value_template: "{{ (edeka.neededCount | default(0)) > 0 }}"
      - service: notify.mobile_app_phone
        data:
          title: "Einkaufsliste"
          message: "{{ edeka.neededCount }} Artikel bei Edeka"
          data:
            url: "https://nomly.weingaertner.pro/einkauf?supermarket={{ edeka.id }}"
```

(`response_variable` requires a recent HA; `avail.content` holds the parsed
JSON. Match the store by `name` or by hard-coding its `id`.)

## 7. Morning reminder (today's meal still needs shopping)

Each morning at 9am, notify when a meal is planned for **today** that still has
**unchecked** items on the list — naming each meal, how many items are left, and
which supermarkets carry them.

`GET /api/v1/shopping/today-meal-status` returns exactly that, already scoped to
today (server-local day) and to items traceable to today's meals (leftovers
excluded):

```json
{
  "date": "2026-06-02",
  "needsShopping": true,
  "totalUncheckedItems": 4,
  "meals": [
    {
      "mealPlanId": 123,
      "recipeId": 45,
      "recipeTitle": "Spaghetti Bolognese",
      "uncheckedItemCount": 3,
      "items": [{ "name": "Hackfleisch" }, { "name": "Zwiebeln" }, { "name": "Tomaten" }],
      "supermarkets": [
        { "id": 1, "name": "ASDA",  "carriesCount": 3 },
        { "id": 2, "name": "Tesco", "carriesCount": 3 },
        { "id": 3, "name": "CoOp",  "carriesCount": 2 }
      ]
    }
  ]
}
```

`supermarkets` lists only shops carrying ≥1 of that meal's unchecked items,
sorted by `carriesCount` (most-covering first), so the notification can say
which shop gets you the most in one trip.

```yaml
# configuration.yaml
rest_command:
  nomly_today_meal_status:
    url: "https://nomly.weingaertner.pro/api/v1/shopping/today-meal-status"
    method: GET
    headers:
      Authorization: !secret nomly_bearer

automation:
  - alias: "Nomly — Morgendliche Einkaufserinnerung"
    trigger:
      - platform: time
        at: "09:00:00"
    action:
      - service: rest_command.nomly_today_meal_status
        response_variable: status
      - condition: template
        value_template: "{{ status.content.needsShopping }}"
      - service: notify.mobile_app_phone
        data:
          title: "Einkauf für heute"
          # One line per meal, e.g.:
          #   3 Artikel für „Spaghetti Bolognese“ — ASDA (3), Tesco (3), CoOp (2)
          message: >-
            {% set ns = namespace(lines=[]) %}
            {% for m in status.content.meals %}
              {% set shops = namespace(parts=[]) %}
              {% for s in m.supermarkets %}
                {% set shops.parts = shops.parts + [s.name ~ ' (' ~ s.carriesCount ~ ')'] %}
              {% endfor %}
              {% set line = m.uncheckedItemCount ~ ' Artikel für „' ~ m.recipeTitle ~ '“'
                 ~ (' — ' ~ (shops.parts | join(', ')) if shops.parts else '') %}
              {% set ns.lines = ns.lines + [line] %}
            {% endfor %}
            {{ ns.lines | join('\n') }}
          data:
            url: "https://nomly.weingaertner.pro/einkauf"
```

> The `message` template needs only `needsShopping`, `meals[].recipeTitle`,
> `meals[].uncheckedItemCount`, and `meals[].supermarkets[]`. For a simpler line
> that drops the per-shop counts:
>
> ```jinja
> {% set ns = namespace(lines=[]) %}
> {% for m in status.content.meals %}
>   {% set ns.lines = ns.lines + [m.uncheckedItemCount ~ ' Artikel für „' ~ m.recipeTitle
>      ~ '“ — ' ~ (m.supermarkets | map(attribute='name') | join(', '))] %}
> {% endfor %}
> {{ ns.lines | join('\n') }}
> ```
>
> `response_variable` requires a recent HA; `status.content` holds the parsed
> JSON. The `time` trigger fires in HA's own timezone, and the endpoint's
> "today" is the nomly server's local day — keep both in the same timezone (they
> already are for a single-household setup).

## Endpoint reference (added for HA)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/v1/meal-plans?from=&to=` | Meals in a date range. Each carries `note` and `isLeftover`. |
| POST | `/api/v1/shopping/items` `{byName}` | Add an item (existing). |
| GET | `/api/v1/ingredients/usage?name=` | Where an ingredient is used + on-list. |
| GET | `/api/v1/shopping/store-availability` | Per-store still-needed count. |
| GET | `/api/v1/shopping/today-meal-status` | Today's meals still needing shopping + per-shop coverage. |
| GET | `/embed/rezepte/<id>?k=<embed token>` | Chrome-less recipe view for the iframe. Includes the "Update vormerken" toggle. |
| PATCH | `/api/v1/recipes/<id>/needs-update` | Toggle the "Update vormerken" flag — the embed scope's only write. |
| GET | `/einkauf?supermarket=<id>` | Shopping list with a store preselected (persists as the default). |
| GET | `/einkauf?supermarket=all` | Shopping list with the store filter reset to "Alle Supermärkte" (clears the stored default). |
