# Unit-aware ingredient matching — design

- **Date:** 2026-06-02
- **Status:** Approved (pending written-spec review)
- **Author:** Steven Weingärtner (with Claude)

## Problem

The ingredient matcher (`src/lib/recipe-import/matching.ts`) scores candidates on
**name tokens only**. For products that are lexically identical to a fresh
ingredient and differ only by their container, this is ambiguous. The driving
example:

- `Tomate` (123, fresh) and `Dosentomate` (580, canned) both plausibly match
  the word "tomatoes" / "Tomaten".
- A recipe line distinguishes them by **unit**: `1 Dose/can …` = canned,
  `2 …` (count) = fresh. The matcher ignores the unit, so:
  - `1 can chopped tomatoes` is a **130–130 tie** resolved arbitrarily.
  - `2 tomatoes, chopped` (fresh) can be **mis-grabbed by a canned alias**
    (`chopped tomatoes` scores 200 vs fresh 130).

We want the **unit to disambiguate** without it being able to drag in an
otherwise-implausible ingredient.

Prior alternatives considered and rejected during brainstorming:
- **Unit as a small additive scoring bonus** — rejected: too small to overcome
  realistic name-score gaps (~70 pts); a large enough bonus is globally unsafe.
- **Hard `(name, resolved-unit)` uniqueness constraint** — rejected: cross-table
  computed uniqueness is fiddly to enforce/migrate, and the matcher already
  degrades gracefully (ranked candidates + pill re-pick). Made advisory instead.

## Goals

1. Let the parsed unit decide between name-plausible ingredients.
2. Keep the auto-match gate honest — the unit must not push an implausible
   (below-gate on name) candidate into an auto-match.
3. Allow two catalog entries to share a name, distinguished by unit, without a
   hard constraint — warn instead.
4. Generalise the hardcoded `"Stück"` default-unit fallback into a configurable
   global default.

## Non-goals

- No change to how units, conversions, or container semantics work otherwise.
- No global "catalog-health / all collisions" report (YAGNI; the inline warning
  is enough for now).
- No relaxation of canonical `ingredient.name` uniqueness — only aliases.

## Existing mechanisms this builds on

- `unit.isContainer` already exists; the parser already suppresses
  conjunction-splitting / prep-stripping when a container unit is present
  (`1 Dose chopped tomatoes` keeps "chopped" in the product name).
- `ingredient.defaultUnitId`, `ingredientAlias.defaultUnitId` (+ `…DisplayUnit`)
  already exist. The parser already resolves a missing unit via
  **`alias default → ingredient default → "Stück"`** (per the schema comment on
  `ingredient.defaultUnitId`).
- `buildIngredientCatalog` (`src/lib/recipe-import/index.ts`) already attaches a
  `defaultUnit` to each catalog entry (canonical and per-alias).
- `MIN_AUTO_MATCH_SCORE = 130` is the gate (`matching.ts`).
- An `app_setting` table already exists.
- A units-management API exists under `src/app/api/v1/units/manage`.

---

## Section 1 — Global default unit

Replace the hardcoded `"Stück"` terminal fallback with a configurable pointer.

- **Storage:** a single `app_setting` row, key `global_default_unit_id`, value =
  `unit.id`. A single pointer makes "exactly one" free — switching is just an
  overwrite; no multi-row invariant to police.
- **UX:** a checkbox column in the units-management UI. The checkbox is *checked*
  for whichever unit equals the pointer; checking another unit switches the
  pointer (no error — silent switch-over). Set it to `Stück` initially.
- **Effect:** the default-unit resolution chain becomes
  `alias default → ingredient default → **global default**`. The literal
  `"Stück"` fallback in the parser is removed in favour of the pointer.
- **Edge:** if the pointer is unset (or points at a deleted unit), behaviour
  falls back to the current literal `"Stück"` by name so nothing breaks.

## Section 2 — Non-unique aliases + advisory warning

- **Drop** the unique index on `ingredient_alias.name`. **Keep**
  `ingredient.name` (canonical) unique.
- **Advisory warning:** when creating/editing an alias whose *normalised* name
  already exists elsewhere in the catalog, show an inline warning in the
  ingredient-management UI listing the colliding entrie(s) and the **resolved
  unit** of each, so the user can set distinct units for clean disambiguation.
- The warning spans the **whole catalog namespace** — alias-vs-alias *and*
  alias-vs-canonical — because that is what the matcher sees.
- **Implementation-risk audit (planning phase):** find and fix any code that
  assumes alias names are globally unique. Known candidates:
  - the "remember this spelling" / alias-accrual insert path,
  - any `WHERE ingredient_alias.name = ?` lookup that expects ≤1 row,
  - the unique-index reliance in upsert/seed code.

## Section 3 — Matcher post-gate unit decider (score doubling)

The decider is a **rank-time score multiplier**, applied only after the gate:

```
nameScore   = scoreMatch(...)              // unchanged name-only score
qualified   = nameScore >= MIN_AUTO_MATCH_SCORE   // GATE on name score ONLY
rankScore   = unitMatches(entry, lineUnit) ? nameScore * 2 : nameScore
// rank qualified candidates by rankScore (then existing tiebreaks)
```

Rules:
1. The **gate uses the undoubled name score**. Doubling must never let a
   below-gate name match cross the threshold (prevents a weak post-comma match
   like `80 × 2 = 160` from auto-matching).
2. Among gate-clearers, any candidate whose **resolved unit equals the line's
   resolved unit** has its rank score doubled.
3. Candidates are ranked by `rankScore`; existing tiebreaks
   (canonical preference, alias length, locale name) apply within equal scores.

Properties:
- A unit-matching candidate wins whenever `2 × itsName > otherName`. With the
  shared-base-alias curation pattern (Section 4), colliding entries match the
  **same span → equal name scores**, so doubling cleanly separates them by unit.
  It is a graded heuristic, not a hard override: a non-matching candidate with
  **more than double** the name score still wins (acceptable — does not occur in
  the designed usage).
- Multi-match (≥2 candidates share the line's unit) needs no special case: all
  matchers double and rank by name within.

### Unit resolution (both sides)

- **Line unit:** the parsed explicit unit, canonicalised through unit aliases /
  plurals to a canonical `unit.id` (e.g. `can`/`tin`/`Dosen` → `Dose`). If the
  line has a quantity but **no explicit unit**, resolve to the **global default
  unit** (Section 1). (A line with neither quantity nor unit yields no unit
  signal → no doubling.)
- **Candidate unit:** `matched-alias default → ingredient default → global
  default` (the same chain, terminating at the global default).
- **Match test:** equality of canonical `unit.id`.

## Section 4 — Data-curation pattern (makes the decider effective)

The decider only disambiguates when **both** variants clear the gate on the
line's name. For `1 Dose Tomaten`, today only fresh clears (canned's
`Dosentomaten` is a weak suffix at 110). The curation pattern — *enabled* by
Section 2 — is to give the canned variant the **shared base-name alias**
(`Tomaten` / `tomatoes`) with unit `Dose`. Then both clear at ~130 and the unit
doubles the canned one. This is **data, not code**; the Section 2 warning is what
guides the user to set the distinct units. The decider deliberately never
promotes a below-gate candidate.

---

## Schema & migrations (Drizzle, auto-run, clean)

1. `app_setting`: insert/define the `global_default_unit_id` key (seed → `Stück`).
2. Drop the unique index `ingredient_alias_name_unique`. (No existing data
   conflicts — names are currently unique — so it applies cleanly on prod.)

No other schema changes: `unit.isContainer`, the `defaultUnitId` columns, and the
catalog `defaultUnit` plumbing already exist.

## Affected code (to be confirmed in the plan)

- `src/lib/recipe-import/matching.ts` — add the post-gate doubling and the
  unit-match test; thread the resolved line unit into `findIngredientCandidates`.
- `src/lib/recipe-import/index.ts` — pass the parsed/resolved line unit into the
  matcher; ensure catalog entries carry the *resolved* unit
  (alias → ingredient → global).
- `src/lib/recipe-import/ingredient.ts` — replace literal `"Stück"` fallback with
  the global default; resolve `qty + no unit → global default`.
- Units-management UI + API (`src/app/api/v1/units/manage`) — global-default
  checkbox.
- Ingredient-management UI — advisory alias-collision warning.
- Migration files + `app_setting` accessor.

## Testing

Matcher test matrix (mirrors the validated cases):

| line | line unit | expected |
|---|---|---|
| `1 can chopped tomatoes` | Dose | Dosentomate (was a tie) |
| `1 Dose Tomaten` | Dose | Dosentomate (shared alias) |
| `2 tomatoes, chopped` | Stück (global default) | Tomate (decider overrides name 200→fresh) |
| `2 Tomaten` | Stück | Tomate |
| `400 g chopped tomatoes` | g (no unit match) | Dosentomate (name fallback) |

Plus:
- **Gate-crasher guard:** a below-130 name match with a matching unit must NOT
  auto-match (doubling is rank-only).
- **Unit resolution:** `can`/`tin`/plurals → `Dose`; `qty + no unit` → global
  default; alias-default precedence over ingredient-default.
- **Multi-match:** two `Dose`-default candidates both double and rank by name.
- **Advisory warning:** saving a duplicate alias surfaces the collision +
  resolved units; does not error.

## Rollout

- Migrations are additive/clean and auto-run on container start (no manual
  steps), consistent with the live-prod constraint.
- The matcher change degrades safely: where default units are unset, the unit
  test never matches and behaviour reverts to today's name-only ranking.
- Data curation (global default = Stück; canned-variant shared aliases + units)
  is done after deploy via the management UI; the feature is inert until then.
