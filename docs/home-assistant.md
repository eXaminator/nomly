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

# Embed token — read-only, only the recipe-iframe allow-list. Goes in the
# dashboard iframe URL.
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
card config wherever you see `?k=<embed token>` below. It's a read-only token by
construction, so that's fine.

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
`date`, `servings`. Photo URL:
`https://nomly.weingaertner.pro/api/v1/<photoPath>`.

A throwaway Markdown list to confirm it works:

```yaml
type: markdown
content: |
  {% for m in state_attr('sensor.nomly_meals','mealPlans') %}
  - **{{ m.date }}** — {{ m.recipe.title }} ({{ m.servings }} P.)
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

Replace `PASTE_EMBED_TOKEN` with your embed token.

```yaml
type: custom:config-template-card
entities:
  - sensor.nomly_meals
card:
  type: vertical-stack
  cards: |
    ${ (function () {
      var BASE = 'https://nomly.weingaertner.pro';
      var TOKEN = 'PASTE_EMBED_TOKEN';
      var FALLBACK = 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fpng.pngtree.com%2Fbackground%2F20220721%2Foriginal%2Fpngtree-empty-plate-kitchenware-kitchen-material-wooden-table-background-picture-image_1706347.jpg&f=1&nofb=1&ipt=4f167ea99981bab66b662b3cbe97fa3ebe989f98becf96927aff53368b4550f8';
      var STYLES = {
        card: [{ padding: '0' }],
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
          state_display: m.recipe.title,
          tap_action: {
            action: 'fire-dom-event',
            browser_mod: {
              service: 'browser_mod.popup',
              data: {
                title: m.recipe.title,
                content: { type: 'iframe', url: BASE + '/embed/rezepte/' + m.recipe.id + '?k=' + TOKEN, aspect_ratio: '90%' }
              }
            }
          },
          styles: STYLES,
          grid_options: { rows: 2, columns: 12 }
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
          styles: STYLES,
          grid_options: { rows: 2, columns: 12 }
        };
      }
      function header(text) { return { type: 'markdown', content: '## ' + text }; }

      var meals = (states['sensor.nomly_meals'].attributes.mealPlans) || [];
      var today = new Date().toISOString().slice(0, 10);
      var tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      var todays = meals.filter(function (m) { return m.date === today; });
      var tomorrows = meals.filter(function (m) { return m.date === tomorrow; });

      var cards = [header('Heute')];
      if (todays.length) { todays.forEach(function (m) { cards.push(tile(m)); }); }
      else { cards.push(placeholder()); }
      if (tomorrows.length) {
        cards.push(header('Morgen'));
        tomorrows.forEach(function (m) { cards.push(tile(m)); });
      }
      return cards;
    })() }
```

The tiles mirror the look of your existing `custom:button-card` (full-bleed
photo, bold meal name bottom-left, empty-plate fallback). The placeholder's
`tap_action: { action: 'none' }` makes it inert.

> Prefer Bubble Card for the popup? You can put the same `iframe` inside a
> Bubble Card pop-up, but Bubble pop-ups are keyed by a URL hash (one
> definition per hash), so they can't take a per-recipe URL dynamically.
> `browser_mod.popup` is parameterised per tap, which is why it's used here.
> The dynamic *list* (config-template-card) is independent of which popup
> mechanism you choose — swap the `tap_action` if you keep Bubble Card.

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

## Endpoint reference (added for HA)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/v1/meal-plans?from=&to=` | Meals in a date range (existing). |
| POST | `/api/v1/shopping/items` `{byName}` | Add an item (existing). |
| GET | `/api/v1/ingredients/usage?name=` | Where an ingredient is used + on-list. |
| GET | `/api/v1/shopping/store-availability` | Per-store still-needed count. |
| GET | `/embed/rezepte/<id>?k=<embed token>` | Chrome-less recipe view for the iframe. |
| GET | `/einkauf?supermarket=<id>` | Shopping list with a store preselected. |
