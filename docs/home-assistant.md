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

Each raw token is printed **once**. Store both in HA's `secrets.yaml`:

```yaml
# secrets.yaml
nomly_base: "https://nomly.weingaertner.pro"
nomly_token: "<full token>"
nomly_embed_token: "<embed token>"
```

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
      {{ states('input_text.nomly_base') if false else
         '__BASE__/api/v1/meal-plans?from=' ~ now().strftime('%Y-%m-%d')
         ~ '&to=' ~ (now() + timedelta(days=1)).strftime('%Y-%m-%d') }}
    headers:
      Authorization: !secret nomly_token_bearer   # "Bearer <full token>"
    scan_interval: 900
    sensor:
      - name: "Nomly meals"
        unique_id: nomly_meals
        value_template: "{{ value_json.mealPlans | length }}"
        json_attributes:
          - mealPlans
```

> Replace `__BASE__` with `https://nomly.weingaertner.pro`. HA's REST sensor
> can't read `!secret` inside `resource_template`, so hard-code the base URL
> here (it isn't a secret). Add a `nomly_token_bearer` secret containing the
> literal `Bearer <full token>`.

Each meal exposes `recipe.id`, `recipe.title`, `recipe.photoPath`, `date`,
`servings`. Photo URL: `https://nomly.weingaertner.pro/api/v1/<photoPath>`.

A simple dashboard list (Markdown card):

```yaml
type: markdown
content: |
  {% for m in state_attr('sensor.nomly_meals','mealPlans') %}
  - **{{ m.date }}** — {{ m.recipe.title }} ({{ m.servings }} P.)
  {% endfor %}
```

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
      Authorization: !secret nomly_token_bearer
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
      Authorization: !secret nomly_token_bearer

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
      Authorization: !secret nomly_token_bearer

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
