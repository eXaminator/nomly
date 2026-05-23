# Epic 5 — Shopping list (online)

Implementation plan for the running shopping list at `/einkauf`, the "Mahlzeiten hinzufügen" dialog, the shopping-aware meal-removal confirm, and the background sweeper. Backed by the existing `shopping_item` / `shopping_item_source` schema (no migrations needed).

## Scope (from spec §4.3, §4.4, §7.1 / Epic 5)

1. **Service layer** in `src/lib/shopping/`:
   - `preview.ts` — `previewMeals(start, lengthDays)` per §4.3.1.
   - `merge.ts` — merge-on-add per §4.3.2, including reactivate-in-grace.
   - `items.ts` — list/add/patch/delete shopping items + autocomplete.
   - `byName.ts` — alias-aware ingredient/product resolution (used by manual add today, HA API in Epic 12).
   - `meals.ts` — `removeMealOnly(id)` / `removeMealAndIngredients(id)` per §4.3.3.
   - `sweeper.ts` — `sweepCheckedItems(now)` for the 24h grace cleanup.
   - `format.ts` — unit conversion + "largest sensible unit" formatter.
2. **REST endpoints** under `src/app/api/v1/shopping/`:
   - `route.ts` — `GET /api/v1/shopping`
   - `preview-meals/route.ts`, `add-meals/route.ts`
   - `items/route.ts` — `POST` add item; `GET` autocomplete (`?q=...`).
   - `items/[id]/route.ts` — `PATCH`, `DELETE`.
3. **Planner integration**:
   - `/api/v1/meal-plans/[id]/shopping-impact` — returns affected item count.
   - `DELETE /api/v1/meal-plans/[id]?mode=keep|subtract|cascade-default` — pass-through to service.
   - Replace planner's existing delete confirm in `meal-card.tsx` + `meal-editor.tsx` with a shared three-button modal whenever impact > 0.
4. **Background sweeper** in `server.mts` — boot run + 60-min interval. Defer broadcast wiring to Epic 9 (TODO comment, but call the WS hub-broadcast helper if one exists; otherwise just log).
5. **`/einkauf` page**:
   - Page + AppShell + `ShoppingList` client component.
   - `ShoppingItemRow` with check / edit / delete buttons (no swipe).
   - "Bereits auf der Liste" badge + meal-source chips routing to `/plan?from=…`.
   - Supermarket filter dropdown persisted to `localStorage`.
   - "Artikel hinzufügen" autocomplete searching `ingredient ∪ product` (with type labels).
   - "Mahlzeiten hinzufügen" dialog: date + length controls + per-meal/per-ingredient checkbox tree + live refresh. Modal on desktop, bottom-sheet on mobile.
6. **Setting**: `shopping_list.default_length_days` (default 7) under `/einstellungen/einkauf` (new lightweight page) — minimal one-field form.
7. **Tests** in `tests/shopping*.test.ts`:
   - merge: dimension grouping, sum + format, open-ended collapse, reactivate-in-grace, new vs existing item.
   - preview: scaling, optional-skip, exclude-flag-skip, alreadyOnList flag, empty meal drop.
   - meal removal: subtract preserves residue, deletes when zero, cascades sources.
   - byName: exact ingredient → ingredient mode; new name → createdProduct; ambiguity → 409 candidates.
   - sweeper: deletes only `checked=true AND checked_at < now-24h`.

## Out of scope (deferred)

- Offline / IndexedDB / SW (Epic 8).
- WebSocket mutate frames + peer broadcast (Epic 9). Sweeper deletes only log for now.
- API tokens (Epic 12); endpoints take session cookie only — they ride the existing `/api/v1` auth middleware.
- Per-supermarket "not carried" flag (deferred future epic).

## Key decisions / assumptions (presented at the end)

- Empty-quantity items: treat as "open-ended" — preserved as one row per `(ingredient, dimension)` bucket; sum if other entries have a quantity (open-ended absorbs known qty? → spec says "Open-ended lines collapse to one line" only within a bucket; if both qty and open-ended exist, keep the qty and drop the open-ended).
- Supermarket-filter "uncategorised" group: items whose category isn't in the supermarket's order render in a trailing "Sonstiges" group sorted by name.
- `category_id` snapshot at item-create time, never auto-updated when the ingredient's `default_category_id` later changes (spec §4.3.2.4).
- Delete-mode on the planner: when the meal still has shopping sources, the modal is the canonical confirm — bypassing the inline meal-card hot-trash for that case.

