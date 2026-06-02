# Morning shopping reminder — design

**Date:** 2026-06-02
**Status:** approved

## Problem

Each morning the user wants to be told when a meal is planned for *today* that
still has **unchecked** items on the shopping list — and which supermarkets
those items can be bought from. Home Assistant (HA) owns the schedule (9am) and
the notification; nomly only needs to expose the data.

## Approach

A read-only REST endpoint that HA polls. This mirrors the existing geofence
integration (`GET /api/v1/shopping/store-availability` → HA automation) and
reuses the Bearer-token auth already enforced in `proxy.ts`. No scheduler, push
transport, or timezone config is added to nomly.

Rejected alternative: nomly sends the notification itself — needs a scheduler +
push transport + TZ config baked in, duplicating what HA already does well.

## Definition of "today"

`todayIso()` (`src/lib/meal-plans/dates.ts`) — the server's local calendar day,
the same definition the planner buckets meals by. HA does not pass a date.

## Trigger scope (decided)

Fire only for unchecked items **traceable to a meal planned for today** via
`shopping_item_source.mealPlanId` → `meal_plan.date == today`. Leftover meals
never create `shopping_item_source` rows, so they are excluded for free.

## Components

### `src/lib/shopping/today-meal-shopping.ts` (new, pure-ish helper)

`getTodayMealShoppingStatus(): TodayMealShoppingStatus`

1. `today = todayIso()`.
2. `listShoppingItems()` → keep **unchecked** items whose `sources[]` contain a
   source with `mealDate === today`.
3. Group those items by that source's `mealPlanId` →
   `{ recipeId, recipeTitle, items[] }`. An item needed by two of today's meals
   counts under both.
4. Per meal, reuse `countNeededItemsPerSupermarket()`
   (`src/lib/shopping/supermarket-availability.ts`) on that meal's unchecked
   items to get each shop's coverage count, loading shops via
   `listSupermarkets()` + `getSupermarketDetail()` (same as
   `getStoreAvailability`).

### `src/app/api/v1/shopping/today-meal-status/route.ts` (new)

`GET` → `NextResponse.json(getTodayMealShoppingStatus())`. No auth code in the
route — `proxy.ts` gates `/api/**` by a full-scope Bearer token. Mirrors
`store-availability/route.ts`.

## Response shape

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

- `supermarkets`: only shops carrying **≥1** of that meal's unchecked items,
  sorted by `carriesCount` desc, then `name` asc. (A shop carries an item when
  it isn't marked unavailable there and either the item is uncategorized or its
  category is in the shop's ordering — exactly `countNeededItemsPerSupermarket`.)
- `totalUncheckedItems`: distinct unchecked items across today's meals (an item
  shared by two meals counts once here, but under each meal in `meals[]`).
- No meal today, or all of today's items checked: `needsShopping: false`,
  `meals: []`, `totalUncheckedItems: 0`.

## Testing

Unit tests for `getTodayMealShoppingStatus()` against a migrated temp DB
(pattern from `tests/store-availability-service.test.ts`), seeding meals via the
real `createMeal` + `addMealsToList` path:

- meal today with mixed checked/unchecked items → only unchecked counted;
- a checked-off meal → `needsShopping: false`;
- leftover meal today → excluded;
- an item shared across two of today's meals → counted under both;
- per-shop coverage incl. an `ingredientSupermarketUnavailable` exception;
- no meal today → empty result.

## HA automation

Documented in `docs/home-assistant.md` §7 + endpoint-reference table: a
`rest_command` hitting the endpoint, fired by a 9am `time` trigger, with a
`needsShopping` condition and a templated notification listing each meal, its
unchecked count, and the shops (with coverage).
