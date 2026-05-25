# Familywall ingredient merge plan

Generated 2026-05-24 from cache of 466 recipes (4,596 unique raw ingredient lines)
plus the current DB state (1,746 ingredients of which 391 originated in the Tandoor
German seed).

This document is the **manual LLM clustering** that the user requested before the
catalog code is written. Each entry is one canonical row that should exist in the
DB before `npm run familywall:import` runs. The catalog will be installed via a
familywall-specific seed step that runs after `runSeed()` (Tandoor) and before the
import.

## Entry schema

```
### <Canonical German singular>

tandoor: <food-key> | NEW

rename: from "<old name>"           — optional

category: <category>

dietary: vegan | vegetarian | meat | undecided

equipment: true                     — optional (default false, only listed when true)

aliases: comma-separated list

purchaseUnit: <unit>                — optional (default purchase unit)
subUnit: <name> (perPurchase: N)    — optional
subUnitAliases: alias1, alias2, …   — optional (aliases imply the sub-unit)

notes: ...                          — optional
```

- `tandoor:` either gives the Tandoor food-key (existing canonical) or `NEW`
  (catalog adds the row).
- `rename:` lifts non-canonical or buggy Tandoor names into German singular.
- `category:` explicit on every entry. Section headers indicate the category
  most entries in that section use; per-entry `category:` is authoritative
  and may differ.
- `dietary:` explicit on every entry. `undecided` is also explicit.
- `equipment:` `true` for items that, when referenced from a recipe, should
  default to `is_optional=true` on the recipe row (user usually owns/has
  stock — Backpapier, Einmachgläser, Alufolie). Equipment items still appear
  on shopping lists when referenced; the optional default just lets the user
  decide per-recipe whether to actually shop them. Omitted on food items.
- `aliases:` cross-language pairs, alternate spellings, and forms the matcher
  can't catch via inflection/leftover logic. Pure inflections (plurals,
  diacritics) and descriptor-prefix forms (rote Äpfel, kleine Möhre) are
  OMITTED — the parser auto-merges those via close-inflection bonus +
  leftover-token mechanism.
- `purchaseUnit:` overrides the ingredient's default purchase unit (e.g.
  `Bund` for fresh herbs, `Kolben` for corn). When omitted the ingredient
  falls back to Stück via the parser's existing quantity-default.
- `subUnitAliases:` compound-noun aliases that, when matched, imply the
  entry's `subUnit` as the unit. "1 Knoblauchzehe" → matcher resolves
  "Knoblauchzehe" → catalog says it implies Zehe, so the parsed row gets
  `subUnitId=Zehe, quantity=1` instead of needing the user to write
  "1 Zehe Knoblauch". The seed inserts each listed alias with
  `default_sub_unit_id` pointing at the sub-unit row. Listed aliases are
  implicitly also `aliases`; don't duplicate them in both fields.
- `subUnit:` per-ingredient sub-unit for ingredients sold in larger units
  but used in smaller ones (Brot ↔ Scheibe, Bacon ↔ Scheibe).
- `notes:` anything worth flagging — usually the why behind a non-obvious
  call or a pointer to a parser mechanism.

## Decisions baked into this draft

1. **Aliases are minimal.** Pure inflections (Tomaten ↔ Tomate, carrots ↔
   carrot) and descriptor prefixes (rote Äpfel, große Karotte) rely on the
   parser. Only cross-language + alternate-spelling forms listed.
2. **Paprika collapse.** Per user feedback: single `Paprika` canonical for
   fresh peppers regardless of color — color (rot/gelb/grün) goes to notes
   via leftover-tokens. `Paprikaschote` merges in. Powder variants
   (`Paprikapulver`, `Paprikapulver, edelsüß`, …) stay separate as spice
   canonicals. The `disambiguateFamilywallNames` rewriter handles the
   "1 TL Paprika" → "1 TL Paprikapulver" disambiguation.
3. **Personal-label suffixes** ("Beilage für Janine") wrapped in parens by
   `rewriteFamilywallPersonalLabels` so the personal name lands in row notes.
   `Beilage` and `Dressing` exist as canonicals.
4. **Brand names** not in any alias list — parser drops unmatched
   descriptor/brand tokens into row notes.
5. **Generic-prep phrases** ("asparagus stalks trimmed") only list the head
   word; the rest goes to notes via leftover-tokens.
6. **Generic catch-alls retained** — `Gewürze`, `Kräuter`, `Käse`, `Brühe`,
   `Saft`, `Nüsse` are real canonicals.
7. **Ready-made products** (`Tiefkühl-Pizza`, `Fertigsuppe`, `Fertiggericht`)
   kept as regular items. They behave like ingredients (consumed, auto-shop);
   "this IS the meal" is a recipe property, not an item property.
8. **Eggs** — single `Ei` canonical, no size variants.
9. **Pfirsich fix** — Tandoor's `Pfirsich` row buggy-mapped to food-pear-raw.
   Renamed to `Birne`; NEW `Pfirsich` canonical added.
10. **Unified items model** — schema, seed, and UI work for the unified
    `ingredient`/Artikel entity are done. The `product` tables are gone,
    `is_equipment` is wired through the parser, the Artikel list has the
    Alle/Lebensmittel/Haushalt/Ausrüstung filter. See "Unified items model
    — what's in place" below for specifics.

---

## Unified items model — what's in place

The schema work for this is **done** (commits in this branch). The
`ingredient` table is now the single "Artikel" entity covering everything
that might land on a shopping list: recipe ingredients, household goods
(toilet paper), and kitchen equipment (jars, parchment). The separate
`product` / `product_alias` / `product_supermarket_unavailable` tables have
been dropped. `shopping_item.product_id` and the XOR check constraint are
gone. UI/API references to "Produkte" are removed.

**Schema** (committed):
- `ingredient.is_equipment` BOOLEAN, default `false`. Migration
  `0015_ingredient_is_equipment.sql`.
- `product*` tables dropped. Migration `0016_drop_products.sql`.
- `shopping_item.ingredient_id` is now NOT NULL with `ON DELETE CASCADE`.

**Categories** (committed): the seed (`runSeed`) tops up five new
non-food categories alongside the 22 Tandoor ones — **Hygiene**,
**Drogerie**, **Haushalt**, **Küchenbedarf**, **Tiernahrung**.
Idempotent on re-run.

**`equipment: true` semantics** (wired through the parser):
- Does **NOT** skip the shopping list when referenced by a recipe.
- The familywall / URL / paste importers OR the matched catalog entry's
  `isEquipment` into the row's `isOptional` flag, so equipment items land
  on each recipe as optional by default. The user flips the row to
  non-optional per-recipe when they need to restock.
- Manual recipe edits in the UI win — the override only LIFTS to optional
  at import time, never the reverse.

**UI** (committed):
- Settings page renamed "Zutaten" → **"Artikel"**.
- The Artikel list view has filter chips: **Alle / Lebensmittel / Haushalt
  / Ausrüstung** (derived from category + `isEquipment`), plus the
  existing diet / excluded / unused filters.
- The ingredient edit form has an **Ausrüstung** toggle with explanatory
  copy about the optional-by-default behavior.
- "Produkte" navigation link removed from the settings index.

**Still future work** (this catalog plan drives it):
- `src/lib/familywall/ingredient-catalog.ts` — typed array exporting all
  the entries documented below.
- A seed step (running after `runSeed()` and before `runFamilywallImport`)
  that:
  - Renames the Tandoor canonicals listed in §RENAMES SUMMARY
  - Inserts the NEW canonicals, their aliases, sub-units, dietary class,
    category, and `is_equipment` flag
  - Handles the Paprika / Ei merges (multiple Tandoor keys → one row)
- A "recipe view: Du brauchst auch" sub-section that visually groups
  equipment-flagged rows — purely UI polish, no data work.
- A separate, prominent "Artikel hinzufügen" affordance for non-recipe
  shopping items (toilet paper, etc.) — already accessible via the
  existing add-item dialog, but worth a more visible entry point on the
  shopping list page.

---

## DROP — skip during import

Lines that should never become ingredient rows. **§HDR** = caught by the
section-header promoter committed earlier.

- §HDR: Arbeitsfläche, Beilage, Deko, Dressing, Salatdressing, Füllung, Sauce,
  Soße, Teig, Topping, Toppings, Filling, Crust, Pastry, Garnish, Marinade,
  Glasur, Guss
- §HDR: für den Guss, für den Teig, für den Käsekuchen, für die Basis, für
  die Füllung von …, für die Suppe, für die Toppings, for the Bowl, for the
  Filling, for the Granola Cups, for the Spicy Dressing, zum Bestreuen, zum
  Garnieren, zum Servieren

**Drop entirely (importer skip list):**
- *(none — all earlier drop entries have been resolved either at the
  familywall source or by routing to a real canonical; see the
  "verified not needed" paper trail below)*

**Removed from earlier drop list — verified not needed:**
- `--- Nach Wahl:`, `Außerdem:`, `--- Bällchen` — already caught by the
  existing section-header detector (`---` prefix / trailing colon).
- `peel`, `peeled`, `geschälte`, `leaves`, `Zest` — never appear as
  standalone lines in the cache; only in compounds like "Zest of 1 orange",
  "fresh thyme leaves", which the matcher routes via head + leftover-tokens.
- `red yellow`, `red green` — zero occurrences in the cache.
- `Samen, Kerne oder gehackte Nüsse` → resolves to `Kerne` + `Nüsse`
  after the conjunction split.
- `gemischtes gehacktes Trockenobst` → resolves to `Trockenobst`.
- Standalone `or` — was a single occurrence in "Baked Brie" (recipe
  `8084800_7665987`); user fixed it at the familywall source. Cache
  re-scanned and confirmed clean.
- `garbanzos or` — produced by the parser on "1 can of garbanzos or
  1 1/2 cups, drained" in "African Peanut Soup Recipe" (recipe
  `8084800_7666081`). User fixed the source to just "1 can of garbanzos,
  drained" so the row now parses cleanly. The underlying parser bug
  (trailing conjunction leaking into the name when the right-hand side
  is an alternative *quantity* rather than an alternative *ingredient*)
  is still present but no longer triggers on this dataset.
- `Für Personen`, `(Low-Carb alternativ: …)`, `Neben Linde eignen sich
  auch …` — fixed at the familywall source. Cache re-scanned, zero
  occurrences.
- `add crumbled or ground plant-based meat like soy crumbles`,
  `batch vegan gingerbread cookies` — instruction sentences that had
  leaked into ingredient lists; fixed at the familywall source. Cache
  re-scanned, zero occurrences.
- `Liebe` — was "1 Prise Liebe" joke ingredient in "Mandarinenlikör";
  user removed it at source. Cache re-scanned, zero occurrences.
- `Einkaufsliste` — was "Die Einkaufsliste für 4-6 Portionen" meta line
  in "Shakshuka mit Bärlauch"; user moved the portion info into recipe
  metadata. Cache re-scanned, zero occurrences.

**Promoted from drop list — now real items with `equipment: true`:**
`Einmachgläser`, `Gugelhupfform`, `Backform`, `Küchengarn`, `Kochspray`,
`Cooking spray for pan`. See HAUSHALT & KÜCHENBEDARF section at the end.

---

## OBST UND GEMÜSE (produce)

### Apfel

tandoor: food-apples-fuji-with-skin-raw (merging with
  food-apples-gala-with-skin-raw, food-apples-granny-smith-with-skin-raw,
  food-apples-honeycrisp-with-skin-raw — all four Tandoor keys dedupe to
  this single row)

rename: from "Äpfel"

category: Obst und Gemüse

dietary: vegan

aliases: apple, apples

subUnit: Scheibe (perPurchase: 8)

subUnitAliases: Apfelscheibe, apple slice

notes: Single canonical for all apple varieties — shopping list
  aggregates cleanly regardless of variety. Variety descriptors (Gala,
  Granny Smith, Honeycrisp, Boskoop, Jonagold, Pink Lady, Braeburn,
  Fuji, Elstar, Cox, Red Delicious) are rewritten into a paren-note by
  the familywall importer's `rewriteFamilywallAppleVarieties`
  pre-processor BEFORE parsing, so "1 Apfel Gala" → row
  `{name: "Apfel", notes: "Gala"}`. Handles all positions: variety after
  the head ("Apfel Gala"), variety before ("Pink Lady apples"), and the
  German connector form ("Apfel Sorte Boskoop" → "Apfel (Boskoop)").
  Extend `APPLE_VARIETIES` in `src/lib/familywall/transform.ts` if new
  variants appear in the cache.

### Aprikose

tandoor: food-apricots-raw

category: Obst und Gemüse

dietary: vegan

aliases: apricot

### Aprikose, getrocknet

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: getrocknete Aprikose, dried apricot, semi-dried apricot

### Artischocke

tandoor: food-artichoke-raw

category: Obst und Gemüse

dietary: vegan

aliases: artichoke, artichoke hearts, canned quartered artichoke hearts

### Aubergine

tandoor: food-eggplant-raw

category: Obst und Gemüse

dietary: vegan

aliases: eggplant, globe eggplant, large eggplant, Mini-Aubergine,
  runde Viola-Aubergine

### Austernpilz

tandoor: food-mushrooms-oyster-raw

category: Obst und Gemüse

dietary: vegan

aliases: oyster mushroom

### Avocado

tandoor: food-avocados-raw-all-commercial-varieties

category: Obst und Gemüse

dietary: vegan

aliases: reife Avocado

subUnit: Hälfte (perPurchase: 2)

subUnitAliases: Avocadohälfte, avocado half, halbe Avocado

### Babyspinat

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: baby spinach, BABY spinach, packed baby spinach, fresh baby spinach,
  Baby-Blattsalat

### Banane

tandoor: food-banana

category: Obst und Gemüse

dietary: vegan

aliases: banana, reifeBanane

subUnit: Scheibe (perPurchase: 10)

subUnitAliases: Bananenscheibe, banana slice

### Bärlauch

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: ramsons, wild garlic

purchaseUnit: Bund

### Birkenknospen

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: birch buds

notes: foraged, low frequency

### Birne

tandoor: food-pear-raw

rename: from "Pfirsich" (BUG FIX — peach name was mapped to pear key)

category: Obst und Gemüse

dietary: vegan

aliases: pear, reife Birne, feste Birne, festfleischige Birne, Poached Pears

subUnit: Scheibe (perPurchase: 8)

subUnitAliases: Birnenscheibe, pear slice

### Blattkohl

tandoor: food-collards-raw

category: Obst und Gemüse

dietary: vegan

aliases: collard greens, collards, Palmkohl

### Blattsalat

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: lettuce, leaf lettuce, shredded lettuce

### Blaubeere

tandoor: food-blueberries-raw

rename: from "Blaubeeren"

category: Obst und Gemüse

dietary: vegan

aliases: blueberry, Heidelbeere, fresh blueberries

### Blumenkohl

tandoor: food-cauliflower-raw

category: Obst und Gemüse

dietary: vegan

aliases: cauliflower, cauliflower florets, head of cauliflower

### Bohne, grün

tandoor: food-beans-snap-green-raw

rename: from "Grüne Bohnen"

category: Obst und Gemüse

dietary: vegan

aliases: green bean, snap pea, blanched snap pea

### Brennnessel

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: junge Brennnesseln, nettles, stinging nettles

### Brokkoli

tandoor: food-broccoli-raw

category: Obst und Gemüse

dietary: vegan

aliases: broccoli, broccoli floret, broccoli crown, broccoli stem,
  head broccoli, head of broccoli, Brokkoliröschen

### Brunnenkresse

tandoor: food-watercress-raw

category: Obst und Gemüse

dietary: vegan

aliases: watercress

### Butternusskürbis

tandoor: food-squash-butternut

rename: from "Kürbis Butternut"

category: Obst und Gemüse

dietary: vegan

aliases: butternut squash, butternut

### Champignon

tandoor: food-mushrooms-white-button

rename: from "Champignon weiß"

category: Obst und Gemüse

dietary: vegan

aliases: Champignons, mushroom, mushrooms, white button mushroom,
  weißer Champignon, weiße Champignons, brauner Champignon,
  braune Champignons, baby bella mushrooms, cremini mushrooms,
  Riesenchampignon, Riesenchampignons, mini portobello mushrooms,
  eher kleine Champignons

notes: Single canonical for fresh mushrooms regardless of color
  (white / brown). Color descriptors land in row notes via the
  parser's leftover-tokens path — they don't change shopping
  identity. The "Pilze" generic catch-all only owns truly generic
  cases ("gemischte Pilze"); bare "mushroom" / "Champignons" route
  here.

### Chayote

tandoor: NEW

category: Obst und Gemüse

dietary: vegan


### Chicorée

tandoor: food-endive-raw

category: Obst und Gemüse

dietary: vegan

aliases: chicory, endive

### Chilischote

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: dried red chile, dried Sichuan chile, Sichuan chile,
  red Scotch Bonnet chillies, Thai green chiles, Serrano chili, green chili,
  green chilli, Chili

notes: distinct from Chilipulver (powder) and Chiliflocken (flakes).

### Chinakohl

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: napa cabbage

### Clementine

tandoor: food-clementine-raw

category: Obst und Gemüse

dietary: vegan

aliases: clementine orange

### Cocktailtomate

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: cocktail tomato

### Cranberry

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: fresh cranberries, fresh or frozen cranberries

### Dill

tandoor: food-dill-fresh

category: Obst und Gemüse

dietary: vegan

aliases: fresh dill, dried dill weed

purchaseUnit: Bund

subUnit: Zweig (perPurchase: 15)

subUnitAliases: Dillzweig, Dillzweige, dill sprig, dill sprigs

### Eisbergsalat

tandoor: food-lettuce-iceberg-raw

category: Obst und Gemüse

dietary: vegan

aliases: iceberg lettuce

### Enoki-Pilz

tandoor: food-mushrooms-enoki-raw

category: Obst und Gemüse

dietary: vegan

aliases: enoki mushroom

### Erbse

tandoor: food-peas

rename: from "Erbsen"

category: Obst und Gemüse

dietary: vegan

aliases: pea, frozen peas, junge Erbsen, tiefgekühlte Erbsen, TK Erbsen

### Erbsensprosse

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Beet Erbsensprossen, pea sprouts

### Erdbeere

tandoor: food-strawberry

category: Obst und Gemüse

dietary: vegan

aliases: strawberry

### Feige

tandoor: food-fig-raw

category: Obst und Gemüse

dietary: vegan

aliases: fig, fresh figs

### Feige, getrocknet

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: getrocknete Feige, dried fig, fig preserves

### Feldsalat

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: lamb's lettuce, mache

### Fenchel

tandoor: food-fennel-bulb-raw

category: Obst und Gemüse

dietary: vegan

aliases: fennel, Fenchelknolle, fennel bulb, bulb fennel

### Fichtenspitze

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Fichtenzweig, spruce tip

notes: foraged, low frequency

### Frühlingszwiebel

tandoor: food-scallions

category: Obst und Gemüse

dietary: vegan

aliases: scallion, spring onion, green onion, Lauchzwiebel, scallion greens

### Granatapfel

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Granatapfelkern, pomegranate, pomegranate seed, pomegranate aril,
  arils from pomegranate

### Grapefruit

tandoor: food-grapefruit-raw

category: Obst und Gemüse

dietary: vegan


### Grünkohl

tandoor: food-kale

category: Obst und Gemüse

dietary: vegan

aliases: kale, fresh kale, geputzter Grünkohl, curly kale leaves, heads kale

### Gurke

tandoor: food-cucumber

category: Obst und Gemüse

dietary: vegan

aliases: cucumber, Salatgurke, English cucumber, Persian cucumber

### Hokkaido-Kürbis

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Hokkaido, Hokkaidokürbis, Hokkaido squash

### Himbeere

tandoor: food-raspberries

rename: from "Himbeeren"

category: Obst und Gemüse

dietary: vegan

aliases: raspberry, fische Himbeeren (typo), TK Himbeeren

### Ingwer

tandoor: food-ginger-root

category: Obst und Gemüse

dietary: vegan

aliases: ginger

notes: "frischer Ingwer", "piece ginger", "daumengroßes Stück Ingwer",
  "inch ginger" resolve via head + leftover-tokens.

### Jalapeño

tandoor: food-jalapenos

category: Obst und Gemüse

dietary: vegan

aliases: jalapeno, pickled jalapeno

### Rote Johannisbeere

tandoor: food-currants-red-and-white-raw

rename: from "Johannisbeeren, rot oder weiß"

category: Obst und Gemüse

dietary: vegan

aliases: Johannisbeere, currant, red currant, Weiße Johannisbeere,
  white currant
notes: Tandoor's food-currants-red-and-white-raw covers both red and
  white (rare); we use "Rote Johannisbeere" as canonical and surface
  "Weiße Johannisbeere" via alias.

### Schwarze Johannisbeere

tandoor: food-currants-european-black-raw

category: Obst und Gemüse

dietary: vegan

aliases: black currant

### Johannisbeere, getrocknet

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: getrocknet Johannisbeeren, dried currants

### Karotte

tandoor: food-carrots-mature-raw

rename: from "Möhre"

category: Obst und Gemüse

dietary: vegan

aliases: Möhre, carrot

notes: User uses "Karotte" 3× more than "Möhre". "Karotten", "Möhren",
  "carrots", and size/prep prefixes resolve via parser mechanisms.

### Kartoffel

tandoor: food-potatoes

category: Obst und Gemüse

dietary: vegan

aliases: potato, Backkartoffel, Drilling

notes: "festkochende Kartoffeln", "mehlige Kartoffeln", "kleine Kartoffeln"
  via leftover-tokens.

### Kirschtomate

tandoor: food-tomatoes-cherry

category: Obst und Gemüse

dietary: vegan

aliases: Cherrytomate, Cherrytomaten, cherry tomato,
  Kirchtomaten (typo)

### Kiwi

tandoor: food-kiwifruit-green-raw

category: Obst und Gemüse

dietary: vegan

aliases: kiwi fruit

### Knoblauch

tandoor: food-garlic-raw

category: Kräuter und Gewürze

dietary: vegan

aliases: garlic, Konoblauchzehen (typo), Konblauch (typo), garlic bulb

subUnit: Zehe (perPurchase: 10)

subUnitAliases: Knoblauchzehe, Knoblauchzehen, garlic clove,
  garlic cloves

notes: Tandoor seed already covers this exact pattern via
  `ingredientSubUnitTopUps` — the catalog repeats it here for
  consistency and so a future re-seed from this plan alone produces the
  same result.

### Knollensellerie

tandoor: food-celeriac-raw

category: Obst und Gemüse

dietary: vegan

aliases: celeriac, celery root

### Kochbanane, gelb

tandoor: food-plantains-yellow-raw

rename: from "gelbe Kochbanane"

category: Obst und Gemüse

dietary: vegan

aliases: yellow plantain

### Kochbanane, grün

tandoor: food-plantains-green-raw

rename: from "grüne Kochbanane"

category: Obst und Gemüse

dietary: vegan

aliases: green plantain

### Kohl

tandoor: food-cabbage-green-raw

category: Obst und Gemüse

dietary: vegan

aliases: cabbage, green cabbage, shredded cabbage, Weißkohl, white cabbage

notes: Weißkohl folded in — see ambiguity list.

### Kohlrabi

tandoor: food-kohlrabi-raw

category: Obst und Gemüse

dietary: vegan


### Koriander

tandoor: food-cilantro-raw

category: Kräuter und Gewürze

dietary: vegan

aliases: cilantro, fresh cilantro, fresh coriander, Korianderblätter,
  Handvoll Koriander, coriander leaves

purchaseUnit: Bund

subUnit: Zweig (perPurchase: 12)

subUnitAliases: Korianderzweig, Korianderzweige, cilantro sprig, cilantro sprigs, coriander sprig

notes: Koriandersamen, Koriandersaat, Korianderpulver, Korianderblatt frisch
  are separate canonicals.

### Kürbis

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Kürbisfleisch, Kürbisfruchtfleisch

notes: Catch-all only — Butternusskürbis ("butternut squash"), Winterkürbis
  ("winter squash"), Hokkaido-Kürbis ("Hokkaido squash"), Sommerkürbis
  ("yellow summer squash") are separate canonicals and own their specific
  English aliases. Bare "squash" is intentionally omitted here so it
  doesn't shadow the more specific entries via the matcher's longest-alias
  preference.

### Sommerkürbis, gelb

tandoor: food-summer-squash-yellow-raw

rename: from "gelber Sommerkürbis"

category: Obst und Gemüse

dietary: vegan

aliases: yellow summer squash

### Winterkürbis

tandoor: food-winter-squash-raw

category: Obst und Gemüse

dietary: vegan

aliases: winter squash

### Lauch

tandoor: food-leeks-raw

category: Obst und Gemüse

dietary: vegan

aliases: Porree, leek, Lauchstange

### Limette

tandoor: food-lime-raw

category: Obst und Gemüse

dietary: vegan

aliases: lime, Bio-Limette, organic lime, lime cut into wedges,
  lime zested and juiced

subUnit: Scheibe (perPurchase: 8)

subUnitAliases: Limettenscheibe, lime slice

### Mais

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Maiskolben, corn, fresh corn, frozen corn, corn kernels

purchaseUnit: Kolben

### Maniok

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Maniok-Wurzel, cassava, manioc, yuca

### Mandarine

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: mandarin, unbehandelte Bio-Mandarine

### Mango

tandoor: food-mango-raw

category: Obst und Gemüse

dietary: vegan

aliases: ripe mango

### Mangold

tandoor: food-chard-raw

category: Obst und Gemüse

dietary: vegan

aliases: chard, swiss chard

### Minze

tandoor: food-spearmint-fresh

category: Kräuter und Gewürze

dietary: vegan

aliases: Pfefferminze, mint, fresh mint, mint leaves

purchaseUnit: Bund

subUnit: Zweig (perPurchase: 12)

subUnitAliases: Minzezweig, Minzezweige, Minzzweig, Minzzweige, mint sprig, mint sprigs

### Zitronenmelisse

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: lemon balm

### Morchel

tandoor: food-mushrooms-morel-raw

category: Obst und Gemüse

dietary: vegan

aliases: morel

### Mungobohnensprosse

tandoor: food-mung-beans-sprouted-raw

rename: from "Mungobohnensprossen"

category: Obst und Gemüse

dietary: vegan

aliases: mung bean sprouts, bean sprouts

### Nektarine

tandoor: food-nectarine-raw

category: Obst und Gemüse

dietary: vegan

aliases: nectarine

### Okra

tandoor: food-okra-raw

category: Obst und Gemüse

dietary: vegan

aliases: bhindi, lady's fingers

### Orange

tandoor: food-orange-raw

category: Obst und Gemüse

dietary: vegan

aliases: kleine Orange, Bio Orange, organic orange, Orangenschale,
  orange zest, Orangenzeste, Orangenabrieb, Schale einer halben Orange,
  Bio-Orangensschale

notes: Orange peel/zest is an alias rather than a separate canonical —
  you don't buy lemon/orange zest standalone, the whole fruit is the
  shopping unit.

### Pak Choi

tandoor: food-pak-choi-raw

category: Obst und Gemüse

dietary: vegan

aliases: bok choy, head bok choy

### Paprika

tandoor: food-bell-pepper-yellow (merging with food-bell-pepper-red — both
  Tandoor rows collapse into this single canonical; the
  food-bell-pepper-red key becomes a second pointer to this same row)

rename: from "Paprika, gelb"

category: Obst und Gemüse

dietary: vegan

aliases: bell pepper, Paprikaschote, jarred roasted red pepper,
  roasted bell pepper, red Romano peppers, Paprikaschoten

notes: Single canonical for fresh bell peppers regardless of color per user
  feedback. Color descriptors ("rote Paprika", "gelbe Paprika", "grüne
  Paprika", "kleine Paprika") resolve via parser leftover-tokens — color
  ends up as a note on the ingredient row. Tandoor seed needs both
  food-bell-pepper-yellow and food-bell-pepper-red to dedupe to this row.

### Pastinake

tandoor: food-parsnips-raw

category: Obst und Gemüse

dietary: vegan

aliases: parsnip

### Peperoni

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: rote Peperoni, peperoncini, pepperoncini, Italian peperoncini

### Petersilie

tandoor: food-parsley

category: Kräuter und Gewürze

dietary: vegan

aliases: parsley, Italian parsley, flat-leaf parsley, curly parsley

purchaseUnit: Bund

subUnit: Zweig (perPurchase: 12)

subUnitAliases: Petersilienzweig, Petersilienzweige, parsley sprig, parsley sprigs

notes: getrocknete Petersilie is a separate Tandoor canonical. Descriptor
  prefixes (fresh, glatte, krause, snipped, Gehakte) via leftover-tokens.
  Tandoor seed wires Zweig as sub-unit.

### Petersilienwurzel

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: parsley root

### Pfifferling

tandoor: food-mushrooms-chanterelle-raw

category: Obst und Gemüse

dietary: vegan

aliases: chanterelle

### Pfirsich

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: peach, reife Pfirsiche, feste reife Pfirsiche, yellow peaches

notes: NEW canonical replaces buggy Tandoor row (which was renamed to Birne).

### Pflaumentomate

tandoor: food-tomatoes-plum

category: Obst und Gemüse

dietary: vegan

aliases: plum tomato, San Marzano

### Pilze

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: gemischte Pilze, Waldpilze, mixed mushrooms

notes: Catch-all for truly generic "mixed / forest mushrooms".
  Bare singular "mushroom" / plural "mushrooms" / "Champignons" all
  route to the `Champignon` canonical (the white button is the
  default English-language interpretation). Recipe lines that
  qualify "mushrooms" with a preference (e.g. "mushrooms preferably a
  mix of cultivated and wild") should ideally be fixed at source by
  wrapping the qualifier in parens so the parser's paren-as-notes
  mechanism captures it as a note.

### Preiselbeere

tandoor: food-cranberries-raw

category: Obst und Gemüse

dietary: vegan

aliases: lingonberry

### Radicchio

tandoor: food-radicchio-raw

category: Obst und Gemüse

dietary: vegan


### Radieschen

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: radish, watermelon radish

### Rettich

tandoor: food-radish-raw

category: Obst und Gemüse

dietary: vegan

aliases: daikon, white radish

### Rhabarber

tandoor: food-rhubarb-raw

category: Obst und Gemüse

dietary: vegan

aliases: rhubarb

### Romana-Salatherz

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Romana Salatherz, romaine heart

### Romatomate

tandoor: food-tomato-roma

category: Obst und Gemüse

dietary: vegan

aliases: roma tomato

### Römersalat

tandoor: food-lettuce-romaine-green-raw

category: Obst und Gemüse

dietary: vegan

aliases: romaine lettuce, romaine

### Rosenkohl

tandoor: food-brussels-sprouts-raw

category: Obst und Gemüse

dietary: vegan

aliases: brussels, brussels sprouts

### Rosmarin

tandoor: food-rosemary-fresh

category: Kräuter und Gewürze

dietary: vegan

aliases: rosemary, fresh rosemary, stems of fresh rosemary

purchaseUnit: Bund

subUnit: Zweig (perPurchase: 8)

subUnitAliases: Rosmarinzweig, Rosmarinzweige, rosemary sprig, rosemary sprigs

### Rotblättriger Salat

tandoor: food-lettuce-leaf-red-raw

category: Obst und Gemüse

dietary: vegan

aliases: red leaf lettuce

### Rote Bete

tandoor: food-beets-raw

rename: from "Rüben"

category: Obst und Gemüse

dietary: vegan

aliases: rote Beete, Bete, beet, beetroot, golden beet, Rüben

notes: Tandoor's "Rüben" was generic; renamed to "Rote Bete" since user's
  recipes always mean beetroot. Generic Rübe (turnip) stays separate.

### Rote Chili

tandoor: food-peppers-hot-chili-red-raw

category: Obst und Gemüse

dietary: vegan

aliases: rote Chilischote, kleine rote Chilischote, red chili pepper

### Rote Zwiebel

tandoor: food-onions-red

category: Obst und Gemüse

dietary: vegan

aliases: red onion

### Rotkohl

tandoor: food-cabbage-red-raw

category: Obst und Gemüse

dietary: vegan

aliases: red cabbage, Rotkraut

### Rübe

tandoor: food-turnip-raw

category: Obst und Gemüse

dietary: vegan

aliases: turnip

### Rucola

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: arugula, rocket, baby arugula

### Schalotte

tandoor: food-shallots-raw

category: Obst und Gemüse

dietary: vegan

aliases: shallot, extra-large shallot

### Schlehe

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Schlehen, sloe, blackthorn berry

### Schmorgurke

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Schmorgurken

### Sellerie

tandoor: food-celery-raw

category: Obst und Gemüse

dietary: vegan

aliases: celery, Stange Staudensellerie, Selleriesalat, Staudensellerie

subUnit: Stange (perPurchase: 10)

subUnitAliases: Selleriestange, celery stalk, Stange Sellerie, Stange Staudensellerie

### Shiitake

tandoor: food-mushrooms-shiitake

category: Obst und Gemüse

dietary: vegan

aliases: Shitake, Shitake-Pilz, Shiitakepilz, shiitake mushroom

### Shiitake, getrocknet

tandoor: food-mushrooms-shiitake-dried

category: Obst und Gemüse

dietary: vegan

aliases: dried shiitake

### Steinpilz

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: getrocknete Steinpilze, dried porcini, porcini, cep

### Spargel, grün

tandoor: food-asparagus-green

rename: from "Spargel grün"

category: Obst und Gemüse

dietary: vegan

aliases: asparagus, green asparagus, Spargelspitzen

subUnit: Stange (perPurchase: 15)

subUnitAliases: Spargelstange, asparagus spear, Stange Spargel

### Spargel, weiß

tandoor: food-asparagus-white

rename: from "Weißer Spargel"

category: Obst und Gemüse

dietary: vegan

aliases: white asparagus

subUnit: Stange (perPurchase: 15)

subUnitAliases: Spargelstange weiß, white asparagus spear

### Spinat

tandoor: food-spinach-raw

category: Obst und Gemüse

dietary: vegan

aliases: spinach, fresh spinach, frozen spinach, Blattspinat,
  junger frischer Blattspinat, Tiefkühl-Blattspinat, Tk Blattspinat

### Spitzkohl

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: pointed cabbage, sweetheart cabbage

### Stachelbeere

tandoor: food-gooseberries-raw

category: Obst und Gemüse

dietary: vegan

aliases: Stachelbeeren, gooseberry

### Steckrübe

tandoor: food-rutabaga-raw

category: Obst und Gemüse

dietary: vegan

aliases: swede, rutabaga

### Süßkartoffel

tandoor: food-sweet-potatoes-orange-raw

category: Obst und Gemüse

dietary: vegan

aliases: sweet potato, yam

### Thymian

tandoor: food-thyme-fresh

category: Kräuter und Gewürze

dietary: vegan

aliases: thyme, fresh thyme, Thymianblättchen

purchaseUnit: Bund

subUnit: Zweig (perPurchase: 10)

subUnitAliases: Thymianzweig, Thymianzweige, thyme sprig, thyme sprigs

notes: getrockneter Thymian is separate.

### Tomate

tandoor: food-tomatoes-raw

category: Obst und Gemüse

dietary: vegan

aliases: tomato, Fleischtomate

notes: variants (Kirschtomate, Romatomate, Pflaumentomate, Cocktailtomate,
  Traubentomate) are separate canonicals. Canned variants: Dosentomate,
  passierte Tomaten, Stückige Tomaten, Flammengeröstete Dosentomaten,
  Tomatenmark, getrocknete Tomate.

### Topinambur

tandoor: food-jerusalem-artichokes-raw

category: Obst und Gemüse

dietary: vegan

aliases: Jerusalem artichoke, sunchoke

### Traubentomate

tandoor: food-tomatoes-grape

category: Obst und Gemüse

dietary: vegan

aliases: grape tomato

### Wassermelone

tandoor: food-watermelon-raw

category: Obst und Gemüse

dietary: vegan

aliases: watermelon

### Weintraube

tandoor: food-grapes-raw

category: Obst und Gemüse

dietary: vegan

aliases: Weintrauben, grape, grüne und rote Trauben, table grape

### Weiße Zwiebel

tandoor: food-onions-white-raw

category: Obst und Gemüse

dietary: vegan

aliases: white onion

### Weißdornfrucht

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: hawthorn berry

### Wirsing

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: savoy cabbage, Tiefkühl-Wirsing

### Yukon Gold Kartoffel

tandoor: food-yukon-gold-potatoes

category: Obst und Gemüse

dietary: vegan

aliases: Yukon Gold potato

### Zitrone

tandoor: food-lemon-raw (merging with food-lemon-peel-raw — peel/zest is
  not a separate shopping unit, you buy the whole lemon)

category: Obst und Gemüse

dietary: vegan

aliases: lemon, Bio-Zitrone, organic lemon, unbehandelte Zitrone,
  bio Zitrone, boiled lemon, Zitronenschale, lemon zest, Zitronenzesten,
  lemon peel

subUnit: Scheibe (perPurchase: 8)

subUnitAliases: Zitronenscheibe, lemon slice, Scheibe Zitrone

### Zucchini

tandoor: food-summer-squash-green-zucchini-raw

category: Obst und Gemüse

dietary: vegan

aliases: courgette

### Zwiebel

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: onion, Gemüsezwiebel

notes: plurals/inflections and size prefixes auto-resolve.

### Gelbe Zwiebel

tandoor: food-onions-yellow-raw

category: Obst und Gemüse

dietary: vegan

aliases: yellow onion

### Röstzwiebel

tandoor: NEW

category: Obst und Gemüse

dietary: vegan

aliases: Röstzwiebeln, fried onions, crispy fried onions

---

## FLEISCH (meat)

### Bacon

tandoor: food-pork-bacon-cooked

category: Fleisch

dietary: meat

aliases: Speckwürfel, Frühstücksspeck

subUnit: Scheibe (perPurchase: 12)

subUnitAliases: Scheibe Bacon, bacon slice, slices bacon, bacon strip, Baconscheibe

### Pancetta

tandoor: NEW

category: Fleisch

dietary: meat


### Hackfleisch

tandoor: NEW

category: Fleisch

dietary: meat

aliases: Hack, ground meat, meat beef

notes: Generic catch-all; `Rinderhack` (owns "ground beef") and
  `Schweinehack` are separate.

### Schweinehack

tandoor: NEW

category: Fleisch

dietary: meat

aliases: ground pork

### Hähnchenbrust

tandoor: food-chicken-breast

category: Fleisch

dietary: meat

aliases: Hähnchenbrustfilet, chicken breast

### Hähnchenflügel

tandoor: food-chicken-wing

category: Fleisch

dietary: meat

aliases: chicken wing

### Hähnchenkeule

tandoor: food-chicken-drumstick

category: Fleisch

dietary: meat

aliases: chicken drumstick, drumstick

### Hähnchenschenkel

tandoor: food-chicken-thigh

category: Fleisch

dietary: meat

aliases: chicken thigh

### Lammragout

tandoor: NEW

category: Fleisch

dietary: meat

aliases: lamb stew meat, lamb

### Nürnberger Rostbratwurst

tandoor: NEW

category: Fleisch

dietary: meat

aliases: Nürnberger Rostbratwürste

### Würstchen

tandoor: NEW

category: Fleisch

dietary: meat

aliases: Bratwürstchen, sausage

### Prosciutto

tandoor: NEW

category: Fleisch

dietary: meat

aliases: Parma ham

### Rindernacken

tandoor: food-beef-chuck-roast-boneless-choice-raw

category: Fleisch

dietary: meat

aliases: beef chuck roast, beef chuck

### Rinderhack

tandoor: food-beef-ground-80pct-lean-meat-20pct-fat-raw

category: Fleisch

dietary: meat

aliases: ground beef, beef ground 80%

### Rindersteak

tandoor: food-beef-flank-steak-boneless-choice-raw

category: Fleisch

dietary: meat

aliases: flank steak

### Ribeye Steak (ohne Knochen)

tandoor: food-beef-ribeye-steak-boneless

category: Fleisch

dietary: meat

aliases: ribeye

### Schinken

tandoor: food-ham

category: Fleisch

dietary: meat

aliases: ham, Kochschinken

subUnit: Scheibe (perPurchase: 10)

subUnitAliases: Schinkenscheibe, Scheibe Schinken, slice of ham, ham slice, Scheibe Kochschinken

### Kasseler

tandoor: NEW

category: Fleisch

dietary: meat

aliases: Kasseleraufschnitt, smoked pork loin

### Schweineschulter

tandoor: NEW

category: Fleisch

dietary: meat

aliases: pork shoulder, Schweinenacken

### Corned Beef

tandoor: NEW

category: Fleisch

dietary: meat


### Rinderbrust

tandoor: NEW

category: Fleisch

dietary: meat

aliases: beef brisket, brisket

### Ochsenzunge

tandoor: NEW

category: Fleisch

dietary: meat

aliases: ox tongue

notes: low frequency

### Gänseschmalz

tandoor: NEW

category: Fleisch

dietary: meat

aliases: goose fat, lard

### Eichel-Wurst

tandoor: NEW

category: Fleisch

dietary: meat

aliases: acorn sausage

notes: foraged-style, low frequency

---

## FISCH UND MEERESFRÜCHTE (fish & seafood)

### Kabeljaufilet

tandoor: food-fish-cod-atlantic-raw

category: Fisch und Meeresfrüchte

dietary: meat

aliases: cod, cod fillet

### Lachsfilet

tandoor: food-fish-salmon-pink-raw

category: Fisch und Meeresfrüchte

dietary: meat

aliases: salmon, salmon fillet, smoked salmon, Räucherlachs

### Schellfischfilet

tandoor: food-fish-haddock-raw

category: Fisch und Meeresfrüchte

dietary: meat

aliases: haddock

### Tintenfisch

tandoor: food-mollusks-squid-mixed-species-raw

category: Fisch und Meeresfrüchte

dietary: meat

aliases: squid, calamari

---

## MOLKEREIPRODUKTE (dairy)

### Butter

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: kalte Butter, weiche Butter, flüssige Butter, geschmolzene Butter

notes: Tandoor has ungesalzene/gesalzene Butter; keep all three.

### Buttermilch

tandoor: food-buttermilk-whole

category: Molkereiprodukte

dietary: vegetarian

aliases: buttermilk

### Buttermilch (fettarm)

tandoor: food-buttermilk-low-fat

category: Molkereiprodukte

dietary: vegetarian

aliases: low-fat buttermilk

### Butterschmalz

tandoor: food-butter-clarified

category: Molkereiprodukte

dietary: vegetarian

aliases: clarified butter

### Crème fraîche

tandoor: food-creme-fraiche

category: Molkereiprodukte

dietary: vegetarian

aliases: creme fraiche

### Crème légère

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: light cream

### Doppelrahmfrischkäse

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: double cream cheese

### Ei

tandoor: food-eggs-large (merging with food-eggs-medium, food-egg-yolk-raw,
  food-egg-white-raw — four Tandoor keys dedupe to this single row)

rename: from "Ei (L)"

category: Molkereiprodukte

dietary: vegetarian

aliases: egg, eggs, Eier, Eiern, Bio-Ei, Bio-Eier, Ei (L), Ei (M),
  Ei (Gr. M), Eigelb, egg yolk, Eiweiß, egg white

notes: Single canonical, no size variants. Eigelb and Eiweiß are
  aliases because the shopping unit is the whole egg either way — a
  recipe needing 3 Eigelb still requires 3 Eier to be bought. The
  recipe view preserves "Eigelb" / "Eiweiß" via `displayName` so the
  cooking instructions remain clear.

### Eiersatz

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: egg replacer, vegan egg

### Entrahmte Milch

tandoor: food-milk-nonfat

category: Molkereiprodukte

dietary: vegetarian

aliases: skim milk, non-fat milk

### Fettarme Milch

tandoor: food-milk-lowfat (merging with food-milk-reduced-fat — German
  retail and user practice treats 1% and 2% milk as the same shopping
  category)

category: Molkereiprodukte

dietary: vegetarian

aliases: 1% milk, low-fat milk, Fettreduzierte Milch, 2% milk,
  reduced-fat milk

### Frischkäse

tandoor: food-cream-cheese

category: Molkereiprodukte

dietary: vegetarian

aliases: cream cheese

### Hafercuisine

tandoor: NEW

category: Molkereiprodukte

dietary: vegan

aliases: Hafer Cuisine, oat cuisine, oat cooking cream

### Hafersahne

tandoor: NEW

category: Molkereiprodukte

dietary: vegan

aliases: oat cream

### Hafermilch

tandoor: food-oat-milk-unsweetened-refrigerated

category: Molkereiprodukte

dietary: vegan

aliases: oat milk, Haferdrink, oat drink

### Halb und halb

tandoor: food-cream-half-and-half

category: Molkereiprodukte

dietary: vegetarian

aliases: half-and-half

### Joghurt

tandoor: food-yogurt-plain-whole-milk

rename: from "Joghurt (3,8% Fett)"

category: Molkereiprodukte

dietary: vegetarian

aliases: Naturjoghurt, plain yogurt, whole-milk yogurt, Vollmilchjoghurt,
  fettarmer Joghurt

### Griechischer Joghurt (Vollmilch)

tandoor: food-yogurt-greek-plain-whole-milk

category: Molkereiprodukte

dietary: vegetarian

aliases: Greek yogurt, plain Greek yogurt, griechischer Joghurt

### Sahnejoghurt

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: cream yogurt

### Mango-Joghurt

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: mango yogurt

### Magermilch-Joghurt

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: non-fat yogurt

### Sojajoghurt

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: soy yogurt, Soja-Skyr, Skyr

### Veganer Joghurt

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: pflanzlicher Joghurt, vegan yogurt, unsweetened soya yogurt

### Körniger Frischkäse

tandoor: food-cheese-cottage-lowfat-2-milkfat

category: Molkereiprodukte

dietary: vegetarian

aliases: cottage cheese

### Quark

tandoor: food-curd-creamed

category: Molkereiprodukte

dietary: vegetarian

aliases: Quark 40%, Speisequark

### Magerquark

tandoor: food-nonfat-curd

category: Molkereiprodukte

dietary: vegetarian

aliases: low-fat quark, fat-free quark

### Quarkersatz

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: veganer Quark, vegan quark

### Kräuterquark

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: herb quark

### Mascarpone

tandoor: food-mascarpone

category: Molkereiprodukte

dietary: vegetarian


### Milch

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: milk, full-fat milk

### Vollmilch

tandoor: food-milk-whole

category: Molkereiprodukte

dietary: vegetarian

aliases: whole milk

### Mandelmilch

tandoor: food-almond-milk-unsweetened-plain-refrigerated (merging with
  food-almond-milk-unsweetened-plain-shelf-stable — refrigerated and
  shelf-stable variants are the same shopping item)

rename: from "Ungesüßte Mandelmilch"

category: Molkereiprodukte

dietary: vegan

aliases: almond milk, plain unsweetened almond milk, Mandeldrink,
  Mandelmilch (haltbar), shelf-stable almond milk

### Pflanzenmilch

tandoor: NEW

category: Molkereiprodukte

dietary: vegan

aliases: pflanzliche Milch, Pflanzendrink, plant-based milk

### Pflanzensahne

tandoor: NEW

category: Molkereiprodukte

dietary: vegan

aliases: pflanzliche Sahne, Pflanzencreme, vegan cream, vegane Schlagsahne,
  vegane Kochsahne

### Pflanzlicher Schmand

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: vegan schmand, vegan sour cream

### Sahne

tandoor: food-cream-heavy

category: Molkereiprodukte

dietary: vegetarian

aliases: heavy cream, heavy whipping cream, whipping cream, Schlagsahne,
  Schlagcreme

### Saure Sahne

tandoor: food-cream-sour

category: Molkereiprodukte

dietary: vegetarian

aliases: sour cream, Sauerrahm

### Sojacuisine

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: soy cooking cream

### Sojamilch

tandoor: food-soy-milk

rename: from "Milch, Soja-"

category: Molkereiprodukte

dietary: vegan

aliases: soy milk

### Sojasahne

tandoor: NEW

category: Molkereiprodukte

dietary: vegan

aliases: soy cream

### Schmand

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: smetana, German sour cream

notes: distinct from Saure Sahne (lower fat).

### Vegane Butter

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: vegan butter, geschmolzene pflanzliche Butter, pflanzliche Butter

### Kräuterbutter

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: herb butter, Bärlauchbutter

### Vegane Margarine

tandoor: NEW

category: Molkereiprodukte

dietary: vegan

aliases: vegan margarine

### Margarine

tandoor: NEW

category: Molkereiprodukte

dietary: vegan

aliases: plant butter

### Ungesalzene Butter

tandoor: food-butter-unsalted

category: Molkereiprodukte

dietary: vegetarian

aliases: unsalted butter

### Gesalzene Butter

tandoor: food-butter-salted

category: Molkereiprodukte

dietary: vegetarian

aliases: salted butter

### Sahnesteif

tandoor: NEW

category: Molkereiprodukte

dietary: vegetarian

aliases: cream stiffener, whipped cream stabilizer

### Kondensmilch

tandoor: food-milk-evaporated-whole

category: Konserven

dietary: vegetarian

aliases: evaporated milk

### Gezuckerte Kondensmilch

tandoor: food-milk-condensed-sweetened

category: Konserven

dietary: vegetarian

aliases: sweetened condensed milk

---

## KÄSE (cheese)

### Mozzarella

tandoor: NEW

category: Käse

dietary: vegetarian


### Veganer Mozzarella

tandoor: NEW

category: Käse

dietary: vegan

aliases: vegan mozzarella, Veganer Pizza-Käse, vegan pizza cheese

### Fettreduzierter Mozzarella

tandoor: food-cheese-mozzarella-part-skim

category: Käse

dietary: vegetarian

aliases: low-fat mozzarella

### Parmesan

tandoor: food-cheese-parmesan-grated

category: Käse

dietary: vegetarian

aliases: Parmesan rind

### Veganer Parmesan

tandoor: NEW

category: Käse

dietary: vegan

aliases: vegan parmesan

### Feta

tandoor: food-cheese-feta

category: Käse

dietary: vegetarian

aliases: crumbled feta, cremiger Feta, Schafskäse

### Veganer Feta

tandoor: NEW

category: Käse

dietary: vegan

aliases: vegan feta

### Cheddar

tandoor: food-cheese-cheddar

rename: category change from Molkereiprodukte to Käse

category: Käse

dietary: vegetarian

aliases: sharp cheddar

subUnit: Scheibe (perPurchase: 8)

subUnitAliases: Cheddarscheibe, slice of cheddar, cheddar slice

### Brie

tandoor: food-cheese-brie

category: Käse

dietary: vegetarian


### Camembert

tandoor: food-cheese-camembert

category: Käse

dietary: vegetarian


### Gouda

tandoor: food-cheese-gouda

category: Käse

dietary: vegetarian


subUnit: Scheibe (perPurchase: 8)

subUnitAliases: Goudascheibe, slice of gouda, gouda slice

### Gruyère

tandoor: food-cheese-gruyere

category: Käse

dietary: vegetarian

aliases: gruyere

### Bergkäse

tandoor: NEW

category: Käse

dietary: vegetarian

aliases: Alpkäse, mountain cheese

### Emmentaler

tandoor: NEW

category: Käse

dietary: vegetarian

aliases: emmenthaler, swiss-style cheese

### Halloumi

tandoor: NEW

category: Käse

dietary: vegetarian

aliases: Halloumi-Käse

### Grillkäse

tandoor: NEW

category: Käse

dietary: vegetarian

aliases: grilling cheese

### Raclette

tandoor: food-cheese-raclette

category: Käse

dietary: vegetarian


### Ricotta

tandoor: food-cheese-ricotta-whole-milk

category: Käse

dietary: vegetarian


### Cashew-Ricotta

tandoor: NEW

category: Käse

dietary: vegan

aliases: cashew ricotta

### Schweizer Käse

tandoor: food-cheese-swiss

category: Käse

dietary: vegetarian

aliases: swiss cheese

### Burrata

tandoor: NEW

category: Käse

dietary: vegetarian

aliases: Kugel Burrata

### Käse

tandoor: NEW

category: Käse

dietary: vegetarian

aliases: cheese

notes: catch-all when no specific cheese given.

### Käse Cotija

tandoor: food-cheese-cotija

category: Käse

dietary: vegetarian

aliases: Cotija, cotija, queso cotija

### Käse Monterey Jack

tandoor: food-cheese-monterey-jack

category: Käse

dietary: vegetarian

aliases: Monterey Jack

### Pepper Jack

tandoor: NEW

category: Käse

dietary: vegetarian


### Colby (Käse)

tandoor: food-cheese-colby

category: Käse

dietary: vegetarian

aliases: colby

### Colby Jack (Käse)

tandoor: food-cheese-colby-jack

category: Käse

dietary: vegetarian

aliases: colby jack

### Paneer

tandoor: food-cheese-paneer

category: Käse

dietary: vegetarian


### Queso Fresco

tandoor: food-cheese-queso-fresco

category: Käse

dietary: vegetarian


### Fontina

tandoor: food-cheese-fontina

category: Käse

dietary: vegetarian


### Gorgonzola

tandoor: NEW

category: Käse

dietary: vegetarian


### Provolone

tandoor: NEW

category: Käse

dietary: vegetarian


### Taleggio

tandoor: NEW

category: Käse

dietary: vegetarian


### Ziegenkäse

tandoor: NEW

category: Käse

dietary: vegetarian

aliases: goat cheese, log goat cheese, fresh goat cheese

### Kashkaval

tandoor: NEW

category: Käse

dietary: vegetarian

aliases: Kaschkawal

### Veganer Reibekäse

tandoor: NEW

category: Käse

dietary: vegan

aliases: vegan shredded cheese

---

## KRÄUTER UND GEWÜRZE (herbs & spices)

### Salz

tandoor: food-salt

category: Kräuter und Gewürze

dietary: vegan

aliases: salt, fine salt, fine table salt, table salt, kosher salt, sea salt,
  Meersalz, Steinsalz, Fichtensalz, Rauchsalz, Kristallsalz, Kräutersalz,
  Fleur de sel, coarse sea salt, Pinch of salt, Eine Prise Salz,
  salt adjust !, salt more

### Schwarzer Pfeffer

tandoor: food-spices-pepper-black

category: Kräuter und Gewürze

dietary: vegan

aliases: pepper, black pepper, Pfeffer, gemahlener Pfeffer,
  fresh cracked peppercorns, ground black pepper, pepper plus divided

### Weißer Pfeffer

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: white pepper, ground white pepper

### Pfefferkörner

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: peppercorns

### Grüne Pfefferkörner

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: green peppercorns

### Sichuan-Pfeffer

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: Sichuan peppercorns, szechuan peppercorns

### Cayenne Pfeffer

tandoor: food-spices-pepper-red-or-cayenne

category: Kräuter und Gewürze

dietary: vegan

aliases: cayenne, Cayennepfeffer, cayenne pepper, cayenne more

### Paprikapulver

tandoor: food-spices-paprika

rename: from "Paprika" (Tandoor's "Paprika" was the powder)

category: Kräuter und Gewürze

dietary: vegan

aliases: paprika powder,
  Paprika (when preceded by spoon-unit; handled by the disambiguateFamilywallNames pre-processor)

### Paprikapulver, edelsüß

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: edelsüßes Paprikapulver, Paprikapulver süß, sweet paprika

### Paprikapulver, rosenscharf

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: paprika rosenscharf, hot paprika

### Paprikapulver, geräuchert

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: geräuchertes Paprikapulver, smoked paprika

### Chilipulver

tandoor: food-spices-chili-powder

category: Kräuter und Gewürze

dietary: vegan

aliases: chili powder, chilli powder, ancho powder, chipotle powder

### Chiliflocken

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: chili flakes, Aleppo chili flakes, dried chilli flakes,
  red pepper flakes

### Rote Paprika-Flocke

tandoor: food-red-pepper-dried

category: Kräuter und Gewürze

dietary: vegan

aliases: red pepper dried

### Aleppo Pfeffer

tandoor: food-pepper-aleppo

category: Kräuter und Gewürze

dietary: vegan

aliases: Aleppo pepper

### Piment

tandoor: food-spices-allspice-ground

category: Kräuter und Gewürze

dietary: vegan

aliases: allspice, ground allspice

### Piment d'Espelette

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: espelette pepper, Piment d‘Espelette

### Zimt

tandoor: food-ground-cinnamon

category: Kräuter und Gewürze

dietary: vegan

aliases: cinnamon, ground cinnamon, Zimtpulver, Ceylon Zimt

### Zimtstange

tandoor: food-cinnamon-sticks-cinnamon

category: Kräuter und Gewürze

dietary: vegan

aliases: cinnamon stick

### Nelken

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: cloves, whole cloves

### Nelke gemahlen

tandoor: food-cloves-ground

category: Kräuter und Gewürze

dietary: vegan

aliases: ground cloves, Nelkenpulver

### Lorbeerblatt

tandoor: food-bay-leaf

category: Kräuter und Gewürze

dietary: vegan

aliases: bay leaf

### Muskatnuss

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: Muskat, nutmeg, fresh nutmeg, geriebene Muskatnuss

### Gemahlene Muskatnuss

tandoor: food-spices-nutmeg-ground

category: Kräuter und Gewürze

dietary: vegan

aliases: ground nutmeg

### Vanille

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: Vanille-Pulver, Bourbon-Vanillepulver, gemahlene Vanille, vanilla

### Vanilleextrakt

tandoor: food-vanilla-extract

category: Kräuter und Gewürze

dietary: vegan

aliases: vanilla extract, reines Vanilleextrakt

### Vanilleschote

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: Vanillestange, Vanille-Schote, vanilla bean, vanilla pod

### Vanillepaste

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: vanilla paste

### Vanillezucker

tandoor: NEW

category: Backen

dietary: vegan

aliases: vanilla sugar

### Vanillearoma

tandoor: NEW

category: Backen

dietary: vegan

aliases: vanilla aroma, vanilla flavor

### Vanillepuddingpulver

tandoor: NEW

category: Backen

dietary: vegetarian

aliases: vanilla pudding mix

### Knoblauchpulver

tandoor: food-garlic-powder

category: Kräuter und Gewürze

dietary: vegan

aliases: garlic powder, granulated garlic

### Zwiebelpulver

tandoor: food-spices-onion-powder

category: Kräuter und Gewürze

dietary: vegan

aliases: onion powder

### Zwiebelflocken, getrocknet

tandoor: food-onions-dehydrated-flakes

category: Kräuter und Gewürze

dietary: vegan

aliases: dehydrated onion flakes, dried onion flakes

### Kreuzkümmel

tandoor: food-cumin-ground

category: Kräuter und Gewürze

dietary: vegan

aliases: cumin, ground cumin, gemahlener Kreuzkümmel, Kreuzkümmelpulver

### Kreuzkümmelsamen

tandoor: food-spices-cumin-seed

category: Kräuter und Gewürze

dietary: vegan

aliases: cumin seed, whole cumin

### Kümmel

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: gemahlener Kümmel, caraway, caraway seed

notes: distinct from Kreuzkümmel (cumin).

### Koriandersamen

tandoor: food-spices-coriander-seed

category: Kräuter und Gewürze

dietary: vegan

aliases: coriander seed, Koriandersaat, whole coriander

### Korianderpulver

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: ground coriander, gemahlener Koriander, coriander powder, coriander

### Korianderblatt, frisch

tandoor: food-spices-coriander-leaves-raw

category: Kräuter und Gewürze

dietary: vegan

aliases: fresh coriander leaf

### Kurkuma

tandoor: food-spices-turmeric-ground

rename: from "gemahlenes Kurkuma"

category: Kräuter und Gewürze

dietary: vegan

aliases: Kurkumapulver, turmeric, ground turmeric, turmeric powder

### Garam Masala

tandoor: food-garam-masala

category: Kräuter und Gewürze

dietary: vegan

aliases: Garamasala, Gara Massala

### Currypulver

tandoor: food-spices-curry-powder

category: Kräuter und Gewürze

dietary: vegan

aliases: curry powder, Curry, karibisches Currypulver, mildes Currypulver,
  Madras Curry Pulver

### Kardamom

tandoor: food-cardamom

category: Kräuter und Gewürze

dietary: vegan

aliases: Kardamomkapseln, cardamom, cardamom pod, ground cardamom

### Fenchelsamen

tandoor: food-spices-fennel-seed

category: Kräuter und Gewürze

dietary: vegan

aliases: fennel seed

### Anis

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: anise, gemahlenen Anis

### Sternanis

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: star anise

### Wacholderbeere

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: Wacholderbeeren, juniper berry

### Bockshornkleesamen

tandoor: food-spices-fenugreek-seed

category: Kräuter und Gewürze

dietary: vegan

aliases: Bockshornklee, fenugreek seed, fenugreek

### Bockshornkleeblätter

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: dried fenugreek leaves, fenugreek leaves, kasuri methi

### Bohnenkraut gemahlen

tandoor: food-spices-savory-ground

category: Kräuter und Gewürze

dietary: vegan

aliases: savory ground, summer savory

### Estragon, gerebelt

tandoor: food-spices-tarragon-dried

category: Kräuter und Gewürze

dietary: vegan

aliases: tarragon, dried tarragon

### Majoran

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: marjoram, fresh marjoram

### Majoran, getrocknet

tandoor: food-spices-marjoram-dried

rename: from "getrockneter Majoran"

category: Kräuter und Gewürze

dietary: vegan

aliases: dried marjoram

### Oregano

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: Mexican oregano

### Oregano, getrocknet

tandoor: food-spices-oregano-dried

rename: from "getrockneter Oregano"

category: Kräuter und Gewürze

dietary: vegan

aliases: dried oregano

### Rosmarin, getrocknet

tandoor: food-spices-rosemary-dried

rename: from "getrockneter Rosmarin"

category: Kräuter und Gewürze

dietary: vegan

aliases: dried rosemary

### Thymian, getrocknet

tandoor: food-spices-thyme-dried

rename: from "getrockneter Thymian"

category: Kräuter und Gewürze

dietary: vegan

aliases: dried thyme

### Basilikum, getrocknet

tandoor: food-spices-basil-dried

rename: from "Basilikum getrocknet"

category: Kräuter und Gewürze

dietary: vegan

aliases: dried basil

### Basilikum

tandoor: food-basil-fresh

category: Kräuter und Gewürze

dietary: vegan

aliases: basil, fresh basil

purchaseUnit: Bund

subUnit: Zweig (perPurchase: 10)

subUnitAliases: Basilikumzweig, Basilikumzweige, basil sprig, basil sprigs

notes: Tandoor seed wires Zweig as sub-unit.

### Salbei

tandoor: food-spices-sage-ground

category: Kräuter und Gewürze

dietary: vegan

aliases: sage

purchaseUnit: Bund

subUnit: Blatt (perPurchase: 15)

subUnitAliases: Salbeiblatt, sage leaf

### Schnittlauch

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: chives, fresh chives

purchaseUnit: Bund

### Zitronengras

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: lemongrass

### Kaffir-Limettenblätter

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: kaffir lime leaves, makrut lime leaves

### Petersilie, getrocknet

tandoor: food-spices-parsley-dried

rename: from "getrocknete Petersilie"

category: Kräuter und Gewürze

dietary: vegan

aliases: dried parsley

### Minze, getrocknet

tandoor: food-spearmint-dried

rename: from "getrocknete Minze"

category: Kräuter und Gewürze

dietary: vegan

aliases: dried mint

### Mohn

tandoor: food-spices-poppy-seed

category: Kräuter und Gewürze

dietary: vegan

aliases: Mohnsamen, poppy seed

### Schwarzkümmel

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: nigella, black cumin, kalonji

### Kala Namak

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: black salt

### Safran

tandoor: food-spices-saffron

rename: from "Saffran" (spelling fix)

category: Kräuter und Gewürze

dietary: vegan

aliases: saffron

### Sumach

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: sumac

### Advieh

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan


### Amchur

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: mango powder

### Macis

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: mace

### Lebkuchengewürz

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: gingerbread spice mix

### Bratapfelgewürz

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: apple pie spice, baked apple spice

### Spekulatiusgewürz

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: speculaas spice

### Chinese five-spice

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: Fünf-Gewürze-Pulver, five spice powder

### Aegean Spice Blend

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: Aegean Spice Blend for dusting

### Old Bay Seasoning

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: old bay

### Italian Seasoning

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: italienische Kräuter, italian herbs

### Taco Seasoning

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan


### Raz-el-Hanout

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: ras el hanout

### Pul Biber

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: Turkish red pepper flakes

### Gochugaru

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: Korean chili flakes

### Birkenblättergewürz

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: getrocknete Birkenblätter, birch leaf spice

notes: foraged, low frequency.

### Liquid Smoke

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan


### Lavendel

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: dried lavender, lavender

### Mastix

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: mastic

### Senfsamen

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: mustard seed, helle Senfkörner, black mustard seed, Senfkorn

### Kapern

tandoor: food-capers-canned

rename: from "eingelegte Kapern"

category: Kräuter und Gewürze

dietary: vegan

aliases: capers, pickled capers

### Gewürze

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: spice, spices, gemischte gehackte Kräuter, seasoning, mixed spices

notes: catch-all when user doesn't specify which spice.

### Kräuter

tandoor: NEW

category: Kräuter und Gewürze

dietary: vegan

aliases: herbs, Kräuter der Wahl, getrocknete Kräuter, frische Kräuter,
  Kräuter nach Wahl, mixed herbs, fresh soft herbs

notes: catch-all. Specific named herbs are separate canonicals.

---

## SOßEN (condiments & sauces)

### Senf

tandoor: food-mustard

category: Soßen

dietary: vegan

aliases: mustard, Dijon mustard, Dijonsenf, mittelscharfer Senf,
  körniger Senf, whole-grain mustard, prepared mustard

### Ketchup

tandoor: food-ketchup

category: Soßen

dietary: vegan

aliases: tomato ketchup

### Mayonnaise

tandoor: food-mayonnaise-regular

category: Soßen

dietary: vegetarian

aliases: mayo

### Vegane Mayonnaise

tandoor: NEW

category: Soßen

dietary: vegan

aliases: vegan mayonnaise, veg. Mayo

### Tomatenmark

tandoor: food-tomato-paste-canned

category: Konserven

dietary: vegan

aliases: tomato paste, Toma­ten­mark (soft hyphen)

### Paprikamark

tandoor: NEW

category: Soßen

dietary: vegan

aliases: pepper paste, Turkish red pepper paste

### Ajvar

tandoor: NEW

category: Soßen

dietary: vegan


### Tomatensauce

tandoor: NEW

category: Soßen

dietary: vegan

aliases: Tomatensoße, tomato sauce, marinara, jar marinara, pasta sauce

### Pesto Rosso

tandoor: NEW

category: Soßen

dietary: vegetarian

aliases: red pesto, sun-dried tomato pesto

### Pesto

tandoor: food-pesto

category: Soßen

dietary: vegetarian

aliases: prepared pesto

### Bärlauchpesto

tandoor: NEW

category: Soßen

dietary: vegetarian

aliases: wild garlic pesto

### Sojasauce

tandoor: food-soy-sauce

category: Soßen

dietary: vegan

aliases: Sojasoße, soy sauce, dunkle Sojasauce, helle Sojasauce,
  glutenfreie Sojasoße, tamari, light soy sauce, dark soy sauce

### Sriracha

tandoor: food-sauce-sriracha

category: Soßen

dietary: vegan

aliases: scharfe Sauce, hot sauce

### Worcestersauce

tandoor: food-worcestershire-sauce

category: Soßen

dietary: meat

aliases: Worcestershire, Worcestershire sauce

notes: traditionally contains anchovies. User can mark vegan variant later.

### Fischsauce

tandoor: food-sauce-fish-ready-to-serve

category: Soßen

dietary: meat

aliases: fish sauce

### Hoisin-Sauce

tandoor: food-hoisin-sauce

category: Soßen

dietary: vegan

aliases: hoisin sauce

### BBQ-Sauce

tandoor: NEW

category: Soßen

dietary: vegan

aliases: BBQ sauce, barbecue sauce

### Austernsauce

tandoor: food-oyster-sauce

category: Soßen

dietary: meat

aliases: oyster sauce

### Doenjang

tandoor: NEW

category: Soßen

dietary: vegan

aliases: Korean soy bean paste

### Miso

tandoor: food-miso

category: Soßen

dietary: vegan

aliases: Misopaste, helle Misopaste, sweet white miso, Hatcho Miso,
  white miso, red miso

### Ketjap Manis

tandoor: NEW

category: Soßen

dietary: vegan

aliases: kecap manis

### Sambal Oelek

tandoor: food-sambal-oelek

category: Soßen

dietary: vegan

aliases: Sambalolek, sambal, chili paste

### Gochujang Paste

tandoor: food-gochujang-paste

category: Soßen

dietary: vegan


### Gochujang Sauce

tandoor: food-gochujang-sauce

category: Soßen

dietary: vegan


### Chili Crisp

tandoor: NEW

category: Soßen

dietary: vegan

aliases: chiu chow chilli oil, Sichuan chili crisp, chile crisp,
  Sichuan chili bean paste

### Tamarindenpaste

tandoor: food-tamarind-stir-fry-paste

category: Soßen

dietary: vegan

aliases: tamarind paste

### Granatapfelmelasse

tandoor: food-pomegranate-molasses

category: Soßen

dietary: vegan

aliases: pomegranate molasses

### Knoblauchpaste

tandoor: food-garlic-paste

category: Soßen

dietary: vegan

aliases: garlic paste

### Ingwer-Knoblauchpaste

tandoor: food-ginger-garlic-paste

category: Soßen

dietary: vegan

aliases: ginger garlic paste

### Ingwerpaste

tandoor: food-ginger-paste

category: Soßen

dietary: vegan

aliases: ginger paste

### Gemüsebrühe

tandoor: food-vegetable-broth-bouillon

category: Soßen

dietary: vegan

aliases: vegetable broth, veggie broth, vegetable stock, Gemüsefond,
  veganer Gemüsefond, Brühe

### Gemüsebrühpulver

tandoor: NEW

category: Soßen

dietary: vegan

aliases: vegetable bouillon powder, vegetable stock cubes,
  Würfel Gemüsebrühe

### Hühner-Fond

tandoor: food-soup-stock-chicken

category: Soßen

dietary: meat

aliases: chicken broth, chicken stock

### Fleischbrühe

tandoor: NEW

category: Soßen

dietary: meat

aliases: beef broth, beef stock

### Salsa

tandoor: food-salsa

category: Konserven

dietary: vegan


### Marmite

tandoor: NEW

category: Soßen

dietary: vegan


### Harissa

tandoor: NEW

category: Soßen

dietary: vegan

aliases: harissa paste

### Meerrettich-Sauce

tandoor: NEW

category: Soßen

dietary: vegetarian

aliases: Horseradish sauce, preserved horseradish, Meerrettich

### Erdnussbutter cremig

tandoor: food-peanut-butter-creamy

category: Soßen

dietary: vegan

aliases: Erdnussmus, peanut butter, cremiges Erdnussmus,
  creamy peanut butter, stückige Erdnussbutter, Erdnussbutter

### Mandelbutter (cremig)

tandoor: food-almond-butter-creamy

category: Soßen

dietary: vegan

aliases: Mandelmus, Mandelmuß, almond butter

### Cashewmus

tandoor: NEW

category: Soßen

dietary: vegan

aliases: cashew butter

### Eichelmus

tandoor: NEW

category: Soßen

dietary: vegan

aliases: acorn butter

notes: foraged, low frequency.

### Tsatsiki

tandoor: NEW

category: Soßen

dietary: vegetarian

aliases: tzatziki

### Aioli

tandoor: NEW

category: Soßen

dietary: vegetarian

aliases: garlic mayonnaise

### Veganes Aioli

tandoor: NEW

category: Soßen

dietary: vegan

aliases: vegan aioli

### Hummus

tandoor: NEW

category: Aufstrich herzhaft

dietary: vegan

aliases: prepared hummus, Aufstrich or Humus

### Tahini

tandoor: food-tahini

category: Aufstrich herzhaft

dietary: vegan

aliases: Tahin, Sesampaste, Chinese sesame paste

### Coconut Aminos

tandoor: NEW

category: Soßen

dietary: vegan


### Salatdressing

tandoor: NEW

category: Soßen

dietary: vegan

aliases: salad dressing, vinaigrette

notes: standalone promoted to section header by §HDR. Catalog row exists for
  "1 EL Salatdressing" style usage.

### Dressing

tandoor: NEW

category: Soßen

dietary: vegan


notes: standalone promoted to header by §HDR. Personal-label suffix lines
  ("Dressing Janine") rewritten by rewriteFamilywallPersonalLabels.

### Beilage

tandoor: NEW

category: Obst und Gemüse

dietary: undecided

aliases: side dish

notes: standalone promoted to header by §HDR. With personal-name suffix
  ("Beilage für Janine") rewritten so the suffix lands in notes.

---

## ESSIG UND ÖL (vinegar & oil)

### Olivenöl

tandoor: food-olive-oil

category: Essig und Öl

dietary: vegan

aliases: olive oil, extra-virgin olive oil, EVOO, mildes Olivenöl,
  gutes Olivenöl, Oli­ven­öl (soft hyphen)

### Rapsöl

tandoor: food-canola-oil

category: Essig und Öl

dietary: vegan

aliases: canola oil

### Sonnenblumenöl

tandoor: food-sunflower-oil

category: Essig und Öl

dietary: vegan

aliases: sunflower oil

### Kokosöl

tandoor: food-coconut-oil

rename: from "Kokosnussöl"

category: Essig und Öl

dietary: vegan

aliases: natives Kokosöl, coconut oil, virgin coconut oil

### Sesamöl

tandoor: food-sesame-oil

category: Essig und Öl

dietary: vegan

aliases: sesame oil, geröstetes Sesamöl, toasted sesame oil

### Erdnussöl

tandoor: food-peanut-oil

category: Essig und Öl

dietary: vegan

aliases: peanut oil, Erdnussöl hitzebeständig, groundnut oil

### Pflanzenöl

tandoor: NEW

category: Essig und Öl

dietary: vegan

aliases: vegetable oil, Neutrales Pflanzenöl, neutrales Speiseöl,
  neutral oil, Speiseöl, Öl, oil, oil divided, frying oil, Bratöl

### Distelöl

tandoor: food-safflower-oil

category: Essig und Öl

dietary: vegan

aliases: safflower oil

### Walnussöl

tandoor: NEW

category: Essig und Öl

dietary: vegan

aliases: walnut oil

### Haselnussöl

tandoor: NEW

category: Essig und Öl

dietary: vegan

aliases: hazelnut oil

### Traubenkernöl

tandoor: NEW

category: Essig und Öl

dietary: vegan

aliases: grapeseed oil

### Kürbiskernöl

tandoor: NEW

category: Essig und Öl

dietary: vegan

aliases: pumpkin seed oil

### Ghee

tandoor: food-ghee-clarified-butter

category: Essig und Öl

dietary: vegetarian


### Essig

tandoor: food-vinegar

category: Essig und Öl

dietary: vegan

aliases: vinegar, Schuss Essig, weißer Essig, Tafelessig, white vinegar

### Apfelessig

tandoor: food-vinegar-cider

rename: from "Essig, Apfel-"

category: Essig und Öl

dietary: vegan

aliases: apple cider vinegar, cider vinegar

### Balsamicoessig

tandoor: food-vinegar-balsamic

rename: from "Essig Balsamico"

category: Essig und Öl

dietary: vegan

aliases: balsamic vinegar, Balsamico, Aceto Balsamico, dunkler Balsamico,
  Apfel Balsam

### Reisessig

tandoor: food-vinegar-rice

rename: from "Reis-Essig"

category: Essig und Öl

dietary: vegan

aliases: rice vinegar, Chinkiang vinegar, Chinkiang black vinegar,
  black vinegar

### Champagner-Essig

tandoor: food-vinegar-champagne

rename: from "Champanger-Essig" (spelling fix)

category: Essig und Öl

dietary: vegan

aliases: champagne vinegar

### Sherry-Essig

tandoor: NEW

category: Essig und Öl

dietary: vegan

aliases: sherry vinegar

### Chardonnay-Essig

tandoor: NEW

category: Essig und Öl

dietary: vegan

aliases: Chardonnay vinegar

### Weißweinessig

tandoor: food-vinegar-white-wine

rename: from "Weißwein-Essig"

category: Essig und Öl

dietary: vegan

aliases: white wine vinegar, milder Weißweinessig

### Rotweinessig

tandoor: food-vinegar-red-wine

category: Essig und Öl

dietary: vegan

aliases: red wine vinegar

### Fichtenspitzen-Essig

tandoor: NEW

category: Essig und Öl

dietary: vegan

aliases: spruce tip vinegar

---

## BACKEN (baking)

### Mehl

tandoor: NEW

category: Backen

dietary: vegan

aliases: flour, plain flour, EL Mehl

notes: Generic catch-all. The more specific `Allzweckmehl` owns the
  "all-purpose flour" alias.

### Weizenmehl

tandoor: food-flour-wheat-all-purpose-unenriched-unbleached

rename: from "Weizenmehl 405"

category: Backen

dietary: vegan

aliases: wheat flour, Type 405 flour

### Allzweckmehl

tandoor: food-flour-wheat-all-purpose

category: Backen

dietary: vegan

aliases: all-purpose flour, bread flour

### Mehl 00

tandoor: food-flour-00

category: Backen

dietary: vegan

aliases: 00 flour, Italian 00 flour

### Vollkornmehl

tandoor: food-flour-wheat-whole-grain-unenriched

category: Backen

dietary: vegan

aliases: whole wheat flour, whole-grain flour

### Dinkelmehl

tandoor: food-spelt-flour-white

category: Backen

dietary: vegan

aliases: spelt flour, helles Dinkelmehl

### Dinkelvollkornmehl

tandoor: food-flour-spelt-whole-grain

category: Backen

dietary: vegan

aliases: whole spelt flour

### Roggenmehl

tandoor: food-flour-rye

category: Backen

dietary: vegan

aliases: rye flour

### Hafervollkornmehl

tandoor: food-flour-oat-whole-grain

category: Backen

dietary: vegan

aliases: oat flour, whole-grain oat flour

### Kuchenmehl

tandoor: food-wheat-flour-white-cake-enriched

category: Backen

dietary: vegan

aliases: cake flour, soft wheat flour

### Mehlgrieß

tandoor: food-flour-semolina-coarse-and-semi-coarse

rename: from "Mehlgrieß (grob und halb grob)"

category: Backen

dietary: vegan

aliases: semolina, Hartweizengries, durum semolina

### Mehlmais

tandoor: food-flour-corn

category: Backen

dietary: vegan

aliases: cornmeal, corn flour, masa, barley flour

### Mandelmehl

tandoor: food-flour-almond

rename: from "Mandeln gemahlen"

category: Backen

dietary: vegan

aliases: almond flour, almond meal, ground almonds

### Kichererbsenmehl

tandoor: NEW

category: Backen

dietary: vegan

aliases: chickpea flour, gram flour, besan

### Kokosmehl

tandoor: NEW

category: Backen

dietary: vegan

aliases: coconut flour

### Sojamehl

tandoor: NEW

category: Backen

dietary: vegan

aliases: soy flour

### Buchweizenmehl

tandoor: food-flour-buckwheat

category: Cerealien

dietary: vegan

aliases: buckwheat flour

### Kamut-Mehl

tandoor: NEW

category: Backen

dietary: vegan

aliases: kamut flour

### Leinsamenmehl

tandoor: NEW

category: Backen

dietary: vegan

aliases: flax meal, ground flax, entöltes Gold-Leinsamenmehl

### Helles glutenfreies Mehl

tandoor: NEW

category: Backen

dietary: vegan

aliases: light gluten-free flour blend

### Spätzlemehl

tandoor: NEW

category: Backen

dietary: vegan

aliases: Spätzle Mehl, Spätzle-Mehl

### Backpulver

tandoor: food-leavening-agents-baking-powder

category: Backwaren

dietary: vegan

aliases: baking powder, Low Carb Backpulver, Weinstein-Backpulver,
  Weinsteinbackpulver

### Natron

tandoor: food-leavening-agents-baking-soda

category: Backen

dietary: vegan

aliases: Backnatron, baking soda, sodium bicarbonate

### Weinstein

tandoor: food-cream-of-tartar

category: Backen

dietary: vegan

aliases: cream of tartar

### Hefe

tandoor: food-yeast

category: Backen

dietary: vegan

aliases: yeast, instant dry yeast, frische Hefe, Frischhefe, dry yeast,
  Würfel Hefe, Würfel frische Hefe, Trockenhefe

### Sauerteig-Anstellgut

tandoor: NEW

category: Backen

dietary: vegan

aliases: sourdough starter

### Zucker

tandoor: food-sugars

category: Backen

dietary: vegan

aliases: sugar, granulated sugar, white sugar, organic cane sugar,
  weißer Zucker, caster sugar, Kristallzucker

### Brauner Zucker

tandoor: food-sugars-brown

category: Backen

dietary: vegan

aliases: brown sugar, light brown soft sugar, packed brown sugar

### Rohrohrzucker

tandoor: NEW

category: Backen

dietary: vegan

aliases: cane sugar, raw cane sugar

### Vollrohrzucker

tandoor: NEW

category: Backen

dietary: vegan

aliases: whole cane sugar, jaggery

### Kokosblütenzucker

tandoor: NEW

category: Backen

dietary: vegan

aliases: Kokosnusszucker, coconut sugar

### Puderzucker

tandoor: food-powdered-sugar

category: Backen

dietary: vegan

aliases: powdered sugar, confectioners' sugar, icing sugar

### Mandel

tandoor: food-nuts-almonds-whole-raw

category: Backen

dietary: vegan

aliases: Mandeln, almond, raw almonds, Mandelkern

### Mandelblättchen

tandoor: NEW

category: Backen

dietary: vegan

aliases: Mandelblätter, Mandelflocken, sliced almonds, flaked almonds,
  Gehobelte Mandeln

### Mandelstifte

tandoor: NEW

category: Backen

dietary: vegan

aliases: slivered almonds

### Schokolade

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: chocolate, dark chocolate, semisweet chocolate,
  vegane dunkle Schokolade, vegane Zartbitterschokolade,
  Zartbitterschokolade, 70% chocolate

### Schokoladenchips

tandoor: food-chocolate-chips

category: Backen

dietary: vegetarian

aliases: chocolate chips, Schoko-Chips, Schokodrops, dunkle Schokochips,
  Schokochunks, semi-sweet chocolate chips, dark chocolate chips

### Weiße Schokolade

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: white chocolate, white chocolate chips, weiße Kuvertüre

### Vollmilch-Schokolade

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: milk chocolate, Vollmilch-Kuvertüre

### Zartbitter-Kuvertüre

tandoor: NEW

category: Backen

dietary: vegan

aliases: dark chocolate couverture

### Kakaopulver

tandoor: NEW

category: Backen

dietary: vegan

aliases: Kakao, cocoa powder, schwach entöltes Kakaopulver,
  entfettetes Kakaopulver, dunkles Kakaopulver, Backkakao

### Ungesüßtes Kakaopulver

tandoor: food-cocoa-dry-powder-unsweetened

category: Backen

dietary: vegan

aliases: unsweetened cocoa powder

### Honig

tandoor: food-honey

category: Aufstrich süß

dietary: vegetarian

aliases: honey, flüssiger Honig, Bio-Honig, Akazienhonig, heller Honig,
  clover honey, raw honey

### Ahornsirup

tandoor: food-syrups-maple

category: Aufstrich süß

dietary: vegan

aliases: maple syrup, maple extract, golden syrup

### Agavendicksaft

tandoor: food-syrup-agave

category: Aufstrich süß

dietary: vegan

aliases: agave syrup, agave nectar, Agavensirup

### Melasse

tandoor: food-molasses

category: Aufstrich süß

dietary: vegan

aliases: molasses, dark molasses, unsulphered molasses, dark corn syrup,
  black treacle

### Sirup

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: syrup

### Granatapfelsirup

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: pomegranate syrup

### Kokossirup

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: coconut syrup

### Rosensirup

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: rose syrup

### Rosenwasser

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: rose water, orange blossom water

### Zuckerrübensirup

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: beet syrup

### Fichtensirup

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: spruce syrup

### Marzipan

tandoor: NEW

category: Backen

dietary: vegetarian

aliases: Marzipan Rohmasse, Marzipanrohmasse, almond paste

### Kuvertüre

tandoor: NEW

category: Backen

dietary: vegetarian

aliases: couverture, baking chocolate

### Agar-Agar

tandoor: NEW

category: Backen

dietary: vegan

aliases: agar

### Speisestärke

tandoor: NEW

category: Backen

dietary: vegan

aliases: Stärke, cornflour

### Maisstärke

tandoor: food-cornstarch

category: Backen

dietary: vegan

aliases: cornstarch, corn starch

### Kartoffelstärke

tandoor: NEW

category: Backen

dietary: vegan

aliases: potato starch, potato flour

### Lebensmittelfarbe, rot

tandoor: NEW

category: Backen

dietary: vegan

aliases: liquid red food coloring, red food coloring gel, red food coloring,
  rote Lebensmittelfarbe, red food dye

### Lebensmittelfarbe, gold

tandoor: NEW

category: Backen

dietary: vegan

aliases: Goldenes Lebensmittelfarbe Puder, gold food coloring powder,
  edible gold dust, goldene Lebensmittelfarbe

### Blattgold, essbar

tandoor: NEW

category: Backen

dietary: vegan

aliases: Blattgold, Edible gold leaf, edible gold flakes, gold leaf
notes: real gold sheets used as decoration — different product from gold
  food-coloring powder (`Lebensmittelfarbe, gold`).

---

## TROCKENWAREN (dry goods)

### Walnuss

tandoor: food-nuts-walnuts-raw

rename: from "Walnüsse"

category: Trockenwaren

dietary: vegan

aliases: walnut, Walnusshälften, Walnusskern

### Haselnuss

tandoor: food-hazelnuts

rename: from "Haselnüsse"

category: Trockenwaren

dietary: vegan

aliases: hazelnut, Haselnusskern, ganze Haselnuss

### Pistazie

tandoor: food-pistachio-nuts-unsalted

rename: from "Pistazien"

category: Trockenwaren

dietary: vegan

aliases: pistachio, shelled pistachios, roasted pistachios, Pistazienkern,
  pistachio kernel

### Pistazie, gesalzen

tandoor: food-pistachio-nuts-salted

rename: from "gesalzene Pistazien"

category: Trockenwaren

dietary: vegan

aliases: salted pistachios

### Cashewkerne

tandoor: food-cashews-raw

category: Trockenwaren

dietary: vegan

aliases: cashews, cashew nut, Cashew Nüsse, dry roasted cashews

### Geröstete Cashewnüsse

tandoor: food-cashews-roasted

category: Trockenwaren

dietary: vegan

aliases: roasted cashews

### Cashewnüsse, gesalzen

tandoor: food-cashews-salted

rename: from "Cashewnüsse, geröstet, gesalzen"

category: Trockenwaren

dietary: vegan

aliases: salted cashews

### Erdnüsse

tandoor: food-peanuts-unroasted

category: Trockenwaren

dietary: vegan

aliases: peanut, unsalted peanuts, Erdnusskern, gesalzene Erdnüsse

### Geröstete Erdnüsse

tandoor: food-peanuts-roasted-unsalted

category: Trockenwaren

dietary: vegan

aliases: roasted peanuts

### Erdnüsse, geröstet & gesalzen

tandoor: food-peanuts-roasted-salted

rename: from "geröstete und gesalzene Erdnüsse"

category: Trockenwaren

dietary: vegan

aliases: roasted salted peanuts

### Pecannuss

tandoor: food-pecans-unroasted

rename: from "Pecannüsse"

category: Trockenwaren

dietary: vegan

aliases: pecan, Pecannusskern, Pekannüsse, Pekankern

### Macadamianuss

tandoor: food-nuts-macadamia-nuts-dry-roasted-without-salt-added

rename: from "Macadamianüsse"

category: Trockenwaren

dietary: vegan

aliases: macadamia nut

### Pinienkerne

tandoor: food-pine-nuts

category: Trockenwaren

dietary: vegan

aliases: pine nut, geröstete Pinienkerne

### Sonnenblumenkerne

tandoor: food-seeds-sunflower-kernel-raw

category: Trockenwaren

dietary: vegan

aliases: sunflower seed, geröstete Sonnenblumenkerne

### Kürbiskerne

tandoor: food-seeds-pumpkin-raw

category: Trockenwaren

dietary: vegan

aliases: pumpkin seed, pepitas, raw pepitas, roasted pepitas,
  geröstete Kürbiskerne

### Sesam

tandoor: food-sesame-seeds

rename: from "Sesamsamen"

category: Trockenwaren

dietary: vegan

aliases: sesame seed, weißer Sesam, Sesamsaat, gerösteter Sesam

### Schwarzer Sesam

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: black sesame seed

### Chiasamen

tandoor: food-chia-seeds

category: Trockenwaren

dietary: vegan

aliases: chia seed

### Leinsamen

tandoor: food-flax-seeds

category: Backen

dietary: vegan

aliases: flax seed, Leinsamen gemahlen, geschrotete Leinsamen,
  goldene Leinsamen

notes: Whole-seed canonical. The prepared form `Leinsamenmehl` owns
  "ground flax" / "flax meal".

### Hanfsamen

tandoor: food-seeds-hemp-seed

category: Trockenwaren

dietary: vegan

aliases: hemp seed

### Flohsamenschalen

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: Flohsamenschalenpulver, psyllium husk, psyllium

### Rosine

tandoor: food-raisins

rename: from "Rosinen"

category: Trockenwaren

dietary: vegan

aliases: raisin, golden raisin, Sultaninen, sultana

### Quinoa

tandoor: food-quinoa-uncooked

category: Trockenwaren

dietary: vegan


### Reis

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: rice, white rice, Reis Trockengewicht, brown rice or white rice

notes: variants are separate canonicals.

### Jasminreis

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: jasmine rice

### Basmatireis

tandoor: food-basmati-rice

category: Trockenwaren

dietary: vegan

aliases: basmati rice

### Langkornreis

tandoor: food-rice-white-long-grain-raw

category: Nudeln

dietary: vegan

aliases: long-grain rice

### Wildreis

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: wild rice

### Milchreis

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: pudding rice, short grain rice

### Risottoreis

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: arborio, risotto rice

### Sushireis

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: trockener Sushi-Reis, sushi rice

### Bulgur

tandoor: food-bulgur-dry

category: Trockenwaren

dietary: vegan


### Couscous

tandoor: food-couscous-dry

category: Trockenwaren

dietary: vegan


### Emmer

tandoor: food-farro

category: Trockenwaren

dietary: vegan

aliases: farro, pearled farro

### Graupen

tandoor: food-barley-pearled-raw

category: Trockenwaren

dietary: vegan

aliases: pearled barley, barley

### Hirse

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: millet

### Vollkornhirse

tandoor: food-millet-whole-grain

category: Cerealien

dietary: vegan

aliases: whole-grain millet

### Buchweizen

tandoor: food-buckwheat-whole-grain

category: Trockenwaren

dietary: vegan

aliases: buckwheat

### Linsen

tandoor: food-lentils-raw

category: Trockenwaren

dietary: vegan

aliases: brown lentil, dried lentil, braune Linsen,
  trockene grüne oder braune Linsen

### Berglinsen

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: mountain lentils

### Beluga-Linsen

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: Belugalinsen, beluga lentils, black lentils, caviar lentils

### Rote Linsen

tandoor: food-lentils-pink-or-red-raw

category: Trockenwaren

dietary: vegan

aliases: red lentils

### Chana Dal

tandoor: food-chana-dal-split-chick-peas

category: Trockenwaren

dietary: vegan


### Spalterbsen

tandoor: food-peas-green-split-raw

category: Trockenwaren

dietary: vegan

aliases: split peas, green split peas

### Hefeflocken

tandoor: food-nutritional-yeast-flakes

rename: from "Nährhefeflocken"

category: Backwaren

dietary: vegan

aliases: nutritional yeast flakes, nutritional yeast, Algen-Flocken

### Schmelzflocken

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: oat flakes, soft oat flakes

### Haferflocken

tandoor: NEW

category: Cerealien

dietary: vegan

aliases: oats, rolled oats, old-fashioned rolled oats, quick oats,
  zarte Haferflocken, Haferkleie

### Kernige Haferflocken

tandoor: food-oats-whole-grain-rolled-old-fashioned

category: Cerealien

dietary: vegan

aliases: whole-grain rolled oats

### Cornflakes

tandoor: NEW

category: Cerealien

dietary: vegan

aliases: corn flakes, cereal

### Müsli

tandoor: NEW

category: Cerealien

dietary: vegan

aliases: Vollkorn-Nuss-Müsli, granola, muesli

### Amaranth

tandoor: NEW

category: Cerealien

dietary: vegan

aliases: gepuffter Amaranth, puffed amaranth

### Farina-Mehl

tandoor: food-cereals-farina-unenriched

category: Cerealien

dietary: vegan

aliases: farina

### Getrocknete Algen

tandoor: food-seaweed-dried

category: Trockenwaren

dietary: vegan

aliases: dried seaweed, nori, kombu, wakame

### Bambusfasern

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: bamboo fiber

### Marone

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: Maronen, gegarte gehackte Maronen, gekochte Maronen,
  vorgegarte Marone, chestnuts

### Dattel

tandoor: food-date-dried

rename: from "Dattel getrocknet"

category: Trockenwaren

dietary: vegan

aliases: Datteln, Medjool-Dattel, medjool date, pitted Medjool date,
  getrockneteDattel, entkernte Dattel

### Dattelmus

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: Dattelpaste, date paste, date syrup, Dattelsirup

### Backpflaume

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: prune, dried plum, Agen prunes stones removed and coarsely chopped

### Sauerkirsche

tandoor: NEW

category: Konserven

dietary: vegan

aliases: Schattenmorellen Sauerkirschen, sour cherries

### Kirsche, getrocknet

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: getrocknete Kirschen, dried cherries, glacé cherries

### Goji-Beere, getrocknet

tandoor: food-goji-berries-dried

rename: from "Gojibeeren getrocknet"

category: Trockenwaren

dietary: vegan

aliases: goji berries, dried goji berries

### Cranberry, getrocknet

tandoor: food-cranberries-dried

rename: from "Getrocknete Cranberries"

category: Trockenwaren

dietary: vegan

aliases: dried cranberries

### Kokosflocken

tandoor: food-coconut-meat-dried-desiccated-sweetened-flaked

rename: from "Kokosnussflocken"

category: Trockenwaren

dietary: vegan

aliases: Kokosraspeln, coconut flakes, shredded coconut,
  unsweetened shredded coconut, desiccated coconut

### Xanthangummi

tandoor: food-xanthan-gum

category: Trockenwaren

dietary: vegan

aliases: xanthan gum

### Cantuccini

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: biscotti

### Amarettini

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: amaretti

### Löffelbiskuit

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: ladyfingers, savoiardi

### Spekulatius

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: Spekulatiuskekse, speculaas

### Spekulatiuscreme

tandoor: NEW

category: Aufstrich süß

dietary: vegetarian

aliases: speculaas spread

### Oreo

tandoor: NEW

category: Süßigkeiten

dietary: vegan

aliases: Oreo Kekse, Oreos

### Kekse

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: cookies, biscuits, graham crackers

### Maistortilla

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: Mais Tortillas, corn tortillas, tortillas

### Panko

tandoor: NEW

category: Backen

dietary: vegetarian

aliases: panko breadcrumbs

### Nüsse

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: nuts, Nussmischung, gemischte gehackte Nüsse, mixed nuts,
  Handvoll Nüsse

notes: catch-all when no specific nut given.

### Kerne

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: Samen, Saaten, seeds, kernels, Samen und Kerne, Kerne und Samen,
  seeds and kernels, mixed seeds

notes: catch-all for unspecified seeds/kernels. The line "Samen, Kerne
  oder gehackte Nüsse" splits on "oder" → "Samen, Kerne" resolves here,
  "gehackte Nüsse" resolves to `Nüsse`.

### Trockenobst

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: dried fruit, gemischtes Trockenobst, mixed dried fruit,
  dried fruits, gemischtes gehacktes Trockenobst

notes: catch-all when no specific dried fruit given. Specific dried fruits
  (Aprikose getrocknet, Feige getrocknet, Cranberry getrocknet,
  Goji-Beere getrocknet, Kirsche getrocknet, Dattel, Backpflaume, Rosine)
  remain separate canonicals.

### Kichererbsen, getrocknet

tandoor: NEW

category: Trockenwaren

dietary: vegan

aliases: dried chickpeas

---

## NUDELN (pasta)

### Nudeln

tandoor: food-pasta-dry-unenriched

category: Nudeln

dietary: vegan

aliases: pasta, dry pasta

### Penne

tandoor: NEW

category: Nudeln

dietary: vegan

aliases: penne pasta

### Spaghetti

tandoor: NEW

category: Nudeln

dietary: vegan


### Makkaroni

tandoor: NEW

category: Nudeln

dietary: vegan

aliases: macaroni

### Lasagneplatten

tandoor: NEW

category: Nudeln

dietary: vegan

aliases: Lasagne-Blätter, lasagna sheets, lasagna noodles

purchaseUnit: Packung

subUnit: Platte (perPurchase: 16)

subUnitAliases: Lasagne-Platte, lasagna sheet, Platte Lasagne

### Cannelloni

tandoor: NEW

category: Nudeln

dietary: vegan


### Tortellini

tandoor: NEW

category: Nudeln

dietary: vegetarian

aliases: fresh cheese tortellini

### Eiernudeln

tandoor: food-noodles-egg-dry

category: Nudeln

dietary: vegetarian

aliases: egg noodles, dried Chinese wheat noodles

### Reisnudeln

tandoor: food-rice-noodles-dry

category: Nudeln

dietary: vegan

aliases: rice noodles, schmale Reisnudel, breite Reisnudeln

### Reisnudeln gekocht

tandoor: food-rice-noodles-cooked

rename: from "gekochte Reisnudeln"

category: Nudeln

dietary: vegan

aliases: cooked rice noodles

### Sobanudeln

tandoor: NEW

category: Nudeln

dietary: vegan

aliases: soba noodles

### Ramen

tandoor: NEW

category: Nudeln

dietary: vegan

aliases: ramen noodles

### Glasnudeln

tandoor: food-noodles-chinese-cellophane

category: Nudeln

dietary: vegan

aliases: glass noodles, cellophane noodles, dangmyeon

### Konjaknudeln

tandoor: NEW

category: Nudeln

dietary: vegan

aliases: shirataki, konjac noodles

### Gnocchi

tandoor: NEW

category: Nudeln

dietary: vegetarian

aliases: potato gnocchi, uncooked gnocchi

### Schupfnudel

tandoor: NEW

category: Nudeln

dietary: vegetarian

aliases: Schupfnudeln, potato dumplings

### Spätzle

tandoor: NEW

category: Nudeln

dietary: vegetarian

aliases: German egg noodles, spaetzle

### Kloß

tandoor: NEW

category: Nudeln

dietary: vegan

aliases: Klöße, Knödel, German potato dumplings

### Nudelsauce (Rot)

tandoor: food-pasta-sauce-red

category: Soßen

dietary: vegan

aliases: red pasta sauce

---

## KONSERVEN (canned)

### Dosentomate

tandoor: food-tomatoes-canned

category: Konserven

dietary: vegan

aliases: Dosentomaten, can chopped tomatoes, can crushed tomatoes,
  can fire roasted tomatoes, can whole peeled tomatoes,
  can diced fire roasted tomatoes, tin chopped tomatoes,
  tin of chopped tomatoes, ganze Tomaten aus der Dose, gehackte Tomaten

### Passierte Tomaten

tandoor: food-tomato-puree-canned

category: Konserven

dietary: vegan

aliases: tomato puree, crushed tomatoes, crushed or diced tomatoes

### Stückige Tomaten (Konserve)

tandoor: food-tomatoes-crushed-canned

category: Konserven

dietary: vegan

aliases: diced tomatoes, diced tomatoes with juices, stückige Tomaten

### Flammengeröstete Dosentomaten

tandoor: food-fire-roasted-crushed-tomatoes

category: Konserven

dietary: vegan

aliases: fire-roasted crushed tomatoes, chopped fire-roasted tomatoes

### Getrocknete Tomate

tandoor: food-tomatoes-sun-dried

category: Konserven

dietary: vegan

aliases: sun-dried tomatoes

### Dosenmais

tandoor: food-corn-canned

category: Konserven

dietary: vegan

aliases: canned corn

### Schwarze Bohnen

tandoor: food-black-beans-from-canned-fat-added

category: Konserven

dietary: vegan

aliases: black beans, canned black beans, no-salt-added black beans

### Weiße Bohnen

tandoor: food-white-beans-from-canned-no-added-fat

category: Konserven

dietary: vegan

aliases: white beans, cannellini beans, butter beans, Butterbohnen,
  tin of butter beans

### Dunkle Kidneybohnen

tandoor: food-beans-dried-dark-red-kidney

rename: from "getrocknete, dunkelrote Kidneybohnen"

category: Konserven

dietary: vegan

aliases: dark red kidney beans

### Helle Kidneybohnen

tandoor: food-beans-dried-light-red-kidney

rename: from "getrocknete, hellrote Kidneybohnen"

category: Konserven

dietary: vegan

aliases: light red kidney beans, Kidneybohnen, kidney beans

### Pintobohnen

tandoor: NEW

category: Konserven

dietary: vegan

aliases: pinto beans

### Kichererbsen

tandoor: food-chickpeas-canned-no-added-fat

category: Konserven

dietary: vegan

aliases: chickpeas, garbanzos, cooked chickpeas, Kichererbsen aus der Dose

### Mandarinen aus der Dose

tandoor: food-orange-mandarin-canned

category: Konserven

dietary: vegan

aliases: canned mandarin oranges

### Sauerkraut

tandoor: food-sauerkraut

category: Konserven

dietary: vegan


### Schwarze Olive

tandoor: food-olives-black

rename: from "Oliven schwarz"

category: Konserven

dietary: vegan

aliases: black olives, schwarze Oliven

### Kalamata-Oliven

tandoor: NEW

category: Konserven

dietary: vegan

aliases: kalamata olives, kalamata, pitted green olives

### Kokosnussmilch

tandoor: food-canned-coconut-milk

category: Konserven

dietary: vegan

aliases: Kokosmilch, coconut milk, full-fat coconut milk,
  ungesüßte Kokosmilch

### Eingelegte Gurke

tandoor: food-cucumber-pickled

rename: from "Gurke eingelegt"

category: Konserven

dietary: vegan

aliases: pickled cucumber, Saure Gurken

### Tunfisch

tandoor: food-tuna-canned

category: Konserven

dietary: meat

aliases: Thunfisch, tuna, canned tuna

### Sardellenfilet

tandoor: food-fish-anchovy-european-canned-in-oil-drained-solids

category: Konserven

dietary: meat

aliases: anchovy, anchovy fillet

### Sardinen

tandoor: food-fish-sardines-canned

rename: from "Sardinenkonserven"

category: Konserven

dietary: meat

aliases: sardines, canned sardines

### Fertigsuppe

tandoor: NEW

category: Konserven

dietary: undecided

aliases: ready-made soup, canned soup, fertige Suppe

notes: placeholder for ready-made-meal recipes. See ambiguity list.

---

## TIEFKÜHL (frozen)

### Vanilleeis

tandoor: food-ice-cream-vanilla

category: Tiefkühl

dietary: vegetarian

aliases: vanilla ice cream

### Tiefkühl-Beerenmischung

tandoor: NEW

category: Tiefkühl

dietary: vegan

aliases: TK-Beerenmischung, frozen berries, mixed frozen berries,
  tiefgefrorene Früchte

### Tiefkühl-Pizza

tandoor: NEW

category: Tiefkühl

dietary: vegetarian

aliases: frozen pizza

### Tiefkühl-Lasagne

tandoor: NEW

category: Tiefkühl

dietary: vegetarian

aliases: frozen lasagna

### Tiefkühl-Gemüsedumplings

tandoor: NEW

category: Tiefkühl

dietary: vegan

aliases: TK-Gemüsedumplings, frozen vegetable dumplings

### Fertiggericht

tandoor: NEW

category: Tiefkühl

dietary: undecided

aliases: ready meal, ready-made meal, microwave meal

notes: placeholder for ready-made-meal recipes.

---

## BACKWAREN (bakery)

### Brot

tandoor: NEW

category: Backwaren

dietary: vegan

aliases: bread, altes Brot, day-old bread, Sauerteigbrot, sourdough

subUnit: Scheibe (perPurchase: 20)

subUnitAliases: Brotscheibe, Scheibe Brot, slice of bread, bread slice

### Vollkornbrot

tandoor: food-bread-whole-wheat-commercially-prepared

category: Backwaren

dietary: vegan

aliases: whole-wheat bread, Pumpernickel

subUnit: Scheibe (perPurchase: 20)

subUnitAliases: Scheibe Vollkornbrot, whole-wheat slice, Vollkornbrotscheibe

### Weißbrot

tandoor: food-bread-white-commercially-prepared

category: Backwaren

dietary: vegan

aliases: white bread, slices whole-wheat sandwich bread

subUnit: Scheibe (perPurchase: 20)

subUnitAliases: Scheibe Weißbrot, white bread slice, Weißbrotscheibe

### Sandwichbrot

tandoor: NEW

category: Backwaren

dietary: vegan

aliases: Sandwich-Brot, sandwich bread, slices rye bread,
  slices toasted brioche sourdough

subUnit: Scheibe (perPurchase: 16)

subUnitAliases: Sandwichscheibe, sandwich bread slice

### Baguette

tandoor: NEW

category: Backwaren

dietary: vegan

aliases: Ciabatta, French bread

subUnit: Scheibe (perPurchase: 12)

subUnitAliases: Baguettescheibe, baguette slice, Scheibe Baguette

### Brötchen

tandoor: NEW

category: Backwaren

dietary: vegan

aliases: roll, dinner roll, Burgerbrötchen, hamburger bun,
  pull-apart dinner roll, Hotdogbrötchen, hot dog bun,
  trockene Brötchen vom Vortag, Waldsemmeln

### Pita-Brot

tandoor: NEW

category: Backwaren

dietary: vegan

aliases: pita, pita bread, naan

### Toastbrot

tandoor: NEW

category: Backwaren

dietary: vegan

aliases: toast, toasted sourdough

subUnit: Scheibe (perPurchase: 24)

subUnitAliases: Toastscheibe, Toastbrotscheibe, slice of toast, Scheibe Toastbrot

### Croutons

tandoor: NEW

category: Backwaren

dietary: vegan

aliases: geröstete Brotwürfel

### Semmelbrösel

tandoor: food-plain-breadcrumbs-plain

category: Backwaren

dietary: vegan

aliases: breadcrumbs, plain breadcrumbs

### Weizengluten

tandoor: food-vital-wheat-gluten

category: Backwaren

dietary: vegan

aliases: vital wheat gluten, Seitan-Fix

### Phyllo

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: phyllo dough, filo dough, Filoteig

subUnit: Blatt (perPurchase: 16)

subUnitAliases: Phyllo-Blatt, Blatt Filoteig, phyllo sheet, filo sheet

### Blätterteig

tandoor: food-puff-pastry-frozen

rename: from "Blätterteig, gefroren"

category: Tiefkühl

dietary: vegetarian

aliases: Blätterteig aus dem Kühlregal, puff pastry

subUnit: Rolle (perPurchase: 1)

### Quiche-/Tarteteig

tandoor: NEW

category: Kühltheke

dietary: vegetarian

aliases: Quicheteig, Tarte-Teig, Tartteig, quiche dough, pie crust,
  shortcrust pastry, Pâte Sucrée

### Pizzateig

tandoor: NEW

category: Kühltheke

dietary: vegetarian

aliases: Pizza- oder Brotteige, pizza dough

### Hefeteig

tandoor: NEW

category: Kühltheke

dietary: vegetarian

aliases: yeast dough

### Flammkuchenteig

tandoor: NEW

category: Kühltheke

dietary: vegetarian

aliases: tarte flambée dough

---

## KÜHLTHEKE (refrigerator section)

### Tofu

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: Tofu natur, block tofu, plain tofu

notes: Generic catch-all. The more specific `Fester Tofu` owns the
  "firm tofu" alias.

### Räuchertofu

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: smoked tofu

### Fester Tofu

tandoor: food-tofu-hard

category: Kühltheke

dietary: vegan

aliases: firm tofu

### Seidentofu

tandoor: food-tofu-silken

category: Kühltheke

dietary: vegan

aliases: silken tofu

### Besonders harter Tofu

tandoor: food-tofu-extra-firm

category: Kühltheke

dietary: vegan

aliases: extra firm tofu, extra-firm tofu

### Tempeh

tandoor: food-tempeh

category: Kühltheke

dietary: vegan


### Jackfruit

tandoor: NEW

category: Kühltheke

dietary: vegan


### Curry-Tofu

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: curry-flavored tofu

### Sojagranulat

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: Sojaschnetzel, Sonnenblumenhack, soy granulate, TVP,
  textured vegetable protein

### Veganes Hackfleisch

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: plant-based ground meat, vegan ground meat

### Veganes Würstchen

tandoor: NEW

category: Kühltheke

dietary: vegan

aliases: veg. Würstchen, vegan sausage, vegetarian sausage

### Chorizo

tandoor: food-sausage-chorizo

category: Kühltheke

dietary: meat


---

## ALKOHOL (alcohol)

### Rotwein

tandoor: food-wine-red

category: Alkohol

dietary: undecided

aliases: red wine, veganer Rotwein

### Weißwein

tandoor: food-wine-white

category: Alkohol

dietary: undecided

aliases: white wine, dry white wine, Weißwein trocken, veganer Weißwein

### Reiswein

tandoor: food-wine-rice

category: Alkohol

dietary: undecided

aliases: rice wine

### Sake

tandoor: NEW

category: Alkohol

dietary: undecided


### Shaoxing Wine

tandoor: NEW

category: Alkohol

dietary: undecided


### Bier

tandoor: NEW

category: Alkohol

dietary: vegan

aliases: beer, Ale oder Lager, ale, lager

### Cider

tandoor: NEW

category: Alkohol

dietary: undecided

aliases: hard cider

### Wodka

tandoor: NEW

category: Alkohol

dietary: vegan

aliases: vodka, klarer Schnaps

### Rum

tandoor: NEW

category: Alkohol

dietary: vegan


### Bourbon

tandoor: NEW

category: Alkohol

dietary: vegan


### Brandy

tandoor: NEW

category: Alkohol

dietary: vegan

aliases: Armagnac

### Amaretto

tandoor: NEW

category: Alkohol

dietary: vegetarian


### Portwein

tandoor: NEW

category: Alkohol

dietary: undecided

aliases: port, port wine

### Sherry

tandoor: NEW

category: Alkohol

dietary: undecided

aliases: dark sherry

### Noilly Prat

tandoor: NEW

category: Alkohol

dietary: undecided

aliases: dry vermouth, vermouth

### Likör

tandoor: NEW

category: Alkohol

dietary: undecided

aliases: liqueur

### Orangenlikör

tandoor: NEW

category: Alkohol

dietary: undecided

aliases: Cointreau, Grand Marnier, orange liqueur, Triple Sec

### Eierlikör

tandoor: NEW

category: Alkohol

dietary: vegetarian

aliases: eggnog liqueur

---

## SÄFTE (juices / beverages)

### Wasser

tandoor: food-beverages-water-tap-drinking

category: Säfte

dietary: vegan

aliases: water, tepid water, very hot water, boiling water, Mineralwasser,
  Sprudelwasser

### Apfelsaft

tandoor: food-apple-juice

category: Säfte

dietary: vegan

aliases: apple juice

### Orangensaft

tandoor: food-orange-juice

category: Säfte

dietary: vegan

aliases: orange juice, O-Saft

### Limettensaft

tandoor: food-lime-juice

category: Säfte

dietary: vegan

aliases: lime juice

### Zitronensaft

tandoor: food-lemon-juice

category: Säfte

dietary: vegan

aliases: lemon juice

### Grapefruitsaft

tandoor: food-grapefruit-juice

category: Säfte

dietary: vegan

aliases: grapefruit juice

### Blutorangensaft

tandoor: food-blood-orange-juice

category: Säfte

dietary: vegan

aliases: blood orange juice

### Granatapfelsaft

tandoor: food-pomegranate-juice

category: Säfte

dietary: vegan

aliases: pomegranate juice

### Ananassaft

tandoor: NEW

category: Säfte

dietary: vegan

aliases: pineapple juice

### Birnensaft

tandoor: NEW

category: Säfte

dietary: vegan

aliases: pear juice

### Möhrensaft

tandoor: NEW

category: Säfte

dietary: vegan

aliases: carrot juice

### Traubensaft

tandoor: NEW

category: Säfte

dietary: vegan

aliases: grape juice

### Mangonektar

tandoor: food-mango-nectar-canned

category: Säfte

dietary: vegan

aliases: mango nectar

### Kokosnussmilch-Getränk

tandoor: food-coconut-milk

category: Säfte

dietary: vegan

aliases: coconut milk drink

### Kokosnusswasser

tandoor: food-coconut-water-unsweetened

category: Säfte

dietary: vegan

aliases: coconut water

### Saft

tandoor: NEW

category: Säfte

dietary: vegan

aliases: juice

notes: generic catch-all.

---

## KAFFEE UND TEE (coffee & tea)

### Kaffee

tandoor: NEW

category: Kaffee und Tee

dietary: vegan

aliases: coffee, brewed coffee, instant coffee, lösliches Kaffeepulver,
  Espresso, Kaffeebohnen

### Tee

tandoor: NEW

category: Kaffee und Tee

dietary: vegan

aliases: tea, Früchtetee, fruit tea, roter Früchtetee, Teebeutel, tea bag

---

## AUFSTRICH SÜSS (sweet spreads)

### Marmelade

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: jam, preserves

### Erdbeermarmelade

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: strawberry jam

### Himbeermarmelade

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: Himbeerkonfitüre, raspberry jam

### Aprikosenkonfitüre

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: apricot jam, apricot preserves

### Pflaumenmus

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: plum butter, Zwetschgenmus

### Apfelmus

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: Apfelmark, applesauce

### Johannisbeergelee

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: currant jelly

### Nutella

tandoor: NEW

category: Aufstrich süß

dietary: vegetarian

aliases: hazelnut spread, chocolate hazelnut spread

### Rote Grütze

tandoor: NEW

category: Aufstrich süß

dietary: vegan

aliases: Rote Grütze o.ä, red fruit pudding

---

## SÜSSIGKEITEN (sweets / confectionery)

### Karamell

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: caramel, dulce de leche, Karamellfilet

### Simple Syrup

tandoor: NEW

category: Süßigkeiten

dietary: vegan

aliases: Simple Syrup Glaze

### Ingwer, kandiert

tandoor: food-ginger-crystallized

category: Süßigkeiten

dietary: vegan

aliases: candied ginger, stem ginger balls in syrup, candied peel

### Schoko Mokkabohne

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: chocolate mocha bean

### Lebkuchen

tandoor: NEW

category: Süßigkeiten

dietary: vegetarian

aliases: gingerbread

---

## HYGIENE (personal care)

### Toilettenpapier

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: toilet paper, Klopapier, TP

### Taschentücher

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: tissues, Papiertaschentücher

### Zahnpasta

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: toothpaste, Zahncreme

### Zahnbürste

tandoor: NEW

category: Hygiene

dietary: undecided

equipment: true

aliases: toothbrush

### Zahnseide

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: dental floss, floss

### Mundwasser

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: mouthwash

### Shampoo

tandoor: NEW

category: Hygiene

dietary: undecided


### Spülung

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: conditioner, hair conditioner, Haarspülung

### Duschgel

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: shower gel, body wash

### Handseife

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: hand soap, Seife, soap

### Deodorant

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: deo, Deo

### Rasierschaum

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: shaving cream, shaving foam, Rasiergel

### Rasierklingen

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: razor blades, Rasierer, razor

### Wattestäbchen

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: cotton swabs, Q-tips

### Wattepads

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: cotton pads, Watte

### Sonnencreme

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: sunscreen, sunblock, Sonnenschutz

### Handcreme

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: hand cream, hand lotion

### Bodylotion

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: body lotion, Körperlotion

### Tampons

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: Tampon, tampon

### Damenbinden

tandoor: NEW

category: Hygiene

dietary: undecided

aliases: pads, sanitary pads, Binden

---

## DROGERIE (medicine & first aid)

### Pflaster

tandoor: NEW

category: Drogerie

dietary: undecided

aliases: bandages, band-aids, Wundpflaster

### Schmerzmittel

tandoor: NEW

category: Drogerie

dietary: undecided

aliases: painkillers, Ibuprofen, Paracetamol, Aspirin

### Vitamin D3

tandoor: NEW

category: Drogerie

dietary: undecided

aliases: vitamin D, vitamin D supplement, Vitamin D Tropfen, D3-Tropfen

### Vitamin B12

tandoor: NEW

category: Drogerie

dietary: undecided

aliases: B12 supplement, Cobalamin

### Hustensaft

tandoor: NEW

category: Drogerie

dietary: undecided

aliases: cough syrup

### Halsbonbons

tandoor: NEW

category: Drogerie

dietary: undecided

aliases: throat lozenges, Hustenbonbons

### Nasenspray

tandoor: NEW

category: Drogerie

dietary: undecided

aliases: nasal spray

### Fieberthermometer

tandoor: NEW

category: Drogerie

dietary: undecided

equipment: true

aliases: thermometer

---

## HAUSHALT (cleaning & household consumables)

### Spülmittel

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: dish soap, washing-up liquid, Geschirrspülmittel

### Geschirrspültabs

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: dishwasher tabs, dishwasher pods, Geschirrspülpulver

### Waschmittel

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: laundry detergent, Vollwaschmittel, Color-Waschmittel

### Weichspüler

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: fabric softener

### Allzweckreiniger

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: all-purpose cleaner, Universalreiniger

### Glasreiniger

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: glass cleaner, window cleaner, Fensterreiniger

### Badreiniger

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: bathroom cleaner

### WC-Reiniger

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: toilet cleaner, Toilettenreiniger

### Küchenrolle

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: paper towels, Papierhandtücher

### Müllbeutel

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: bin bags, Müllsäcke, garbage bags, trash bags

### Schwamm

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: sponge, Spülschwamm

### Putzlappen

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: cleaning cloth, Spüllappen

### Mikrofasertuch

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: microfiber cloth

### Geschirrtuch

tandoor: NEW

category: Haushalt

dietary: undecided

aliases: tea towel, dish towel

---

## KÜCHENBEDARF (kitchen equipment & consumables — recipe-adjacent)

All items in this section default to `equipment: true` — they show up in
recipes but get auto-marked as optional, since the user usually has stock.

### Backpapier

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: parchment paper, baking paper

### Frischhaltefolie

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: cling film, plastic wrap, Klarsichtfolie

### Alufolie

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: aluminum foil, tin foil, Aluminiumfolie

### Gefrierbeutel

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: freezer bags, Zipper-Beutel, Ziploc

### Einmachgläser

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: mason jars, canning jars, preserving jars, Einweckgläser

### Küchengarn

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: kitchen twine, butcher's twine, cooking string

### Zahnstocher

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: toothpicks, cocktail picks, Cocktailspieße

### Holzspieß

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: Holzspieße, wooden skewers, Schaschlikspieße, bamboo skewers

### Backform

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: baking pan, baking dish, Auflaufform

### Springform

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: springform pan

### Gugelhupfform

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: bundt pan, Bundt-Form

### Kochspray

tandoor: NEW

category: Küchenbedarf

dietary: undecided

equipment: true

aliases: cooking spray, Cooking spray for pan, oil spray, Ölspray

---

## TIERNAHRUNG (pet supplies)

No pet-food canonicals are present in the familywall cache — this section
exists as a starter set the user can extend. All entries default to
`dietary: undecided` since pet-food composition (meat / vegan-pet-food)
varies by brand and isn't relevant to the household's diet planning.

### Katzenfutter

tandoor: NEW

category: Tiernahrung

dietary: undecided

aliases: cat food

### Katzenfutter, trocken

tandoor: NEW

category: Tiernahrung

dietary: undecided

aliases: Trockenfutter Katze, dry cat food

### Katzenfutter, nass

tandoor: NEW

category: Tiernahrung

dietary: undecided

aliases: Nassfutter Katze, wet cat food

### Katzenstreu

tandoor: NEW

category: Tiernahrung

dietary: undecided

aliases: cat litter

### Hundefutter

tandoor: NEW

category: Tiernahrung

dietary: undecided

aliases: dog food

### Hundeleckerli

tandoor: NEW

category: Tiernahrung

dietary: undecided

aliases: Hundeleckerchen, dog treats

### Vogelfutter

tandoor: NEW

category: Tiernahrung

dietary: undecided

aliases: bird food, bird seed

---

# RENAMES SUMMARY

For reference — pulled from each entry's `rename:` field above. Listed by
Tandoor food-key with old → new name.

| food-key | old | new |
|---|---|---|
| food-apples-fuji-with-skin-raw + food-apples-gala-with-skin-raw + food-apples-granny-smith-with-skin-raw + food-apples-honeycrisp-with-skin-raw | Äpfel / Apfel Gala / Apfel Granny Smith / Apfel Honeycrisp | Apfel (collapsed) |
| food-peas | Erbsen | Erbse |
| food-carrots-mature-raw | Möhre | Karotte |
| food-raspberries | Himbeeren | Himbeere |
| food-blueberries-raw | Blaubeeren | Blaubeere |
| food-pear-raw | Pfirsich (buggy) | Birne |
| food-date-dried | Dattel getrocknet | Dattel |
| food-squash-butternut | Kürbis Butternut | Butternusskürbis |
| food-asparagus-white | Weißer Spargel | Spargel, weiß |
| food-asparagus-green | Spargel grün | Spargel, grün |
| food-soy-milk | Milch, Soja- | Sojamilch |
| food-vinegar-cider | Essig, Apfel- | Apfelessig |
| food-vinegar-balsamic | Essig Balsamico | Balsamicoessig |
| food-vinegar-rice | Reis-Essig | Reisessig |
| food-vinegar-white-wine | Weißwein-Essig | Weißweinessig |
| food-vinegar-champagne | Champanger-Essig | Champagner-Essig |
| food-spices-saffron | Saffran | Safran |
| food-beets-raw | Rüben | Rote Bete |
| food-spices-turmeric-ground | gemahlenes Kurkuma | Kurkuma |
| food-flour-almond | Mandeln gemahlen | Mandelmehl |
| food-nutritional-yeast-flakes | Nährhefeflocken | Hefeflocken |
| food-nuts-walnuts-raw | Walnüsse | Walnuss |
| food-hazelnuts | Haselnüsse | Haselnuss |
| food-pistachio-nuts-unsalted | Pistazien | Pistazie |
| food-pecans-unroasted | Pecannüsse | Pecannuss |
| food-nuts-macadamia-… | Macadamianüsse | Macadamianuss |
| food-sesame-seeds | Sesamsamen | Sesam |
| food-raisins | Rosinen | Rosine |
| food-goji-berries-dried | Gojibeeren getrocknet | Goji-Beere, getrocknet |
| food-cranberries-dried | Getrocknete Cranberries | Cranberry, getrocknet |
| food-coconut-meat-…-flaked | Kokosnussflocken | Kokosflocken |
| food-beans-dried-dark-red-kidney | getrocknete, dunkelrote Kidneybohnen | Dunkle Kidneybohnen |
| food-beans-dried-light-red-kidney | getrocknete, hellrote Kidneybohnen | Helle Kidneybohnen |
| food-olives-black | Oliven schwarz | Schwarze Olive |
| food-cucumber-pickled | Gurke eingelegt | Eingelegte Gurke |
| food-fish-sardines-canned | Sardinenkonserven | Sardinen |
| food-eggs-large + food-eggs-medium + food-egg-yolk-raw + food-egg-white-raw | Ei (L) / Ei (M) / Eigelb / Eiweiß | Ei (merged) |
| food-coconut-oil | Kokosnussöl | Kokosöl |
| food-pistachio-nuts-salted | gesalzene Pistazien | Pistazie, gesalzen |
| food-cashews-salted | Cashewnüsse, geröstet, gesalzen | Cashewnüsse, gesalzen |
| food-peanuts-roasted-salted | geröstete und gesalzene Erdnüsse | Erdnüsse, geröstet & gesalzen |
| food-rice-noodles-cooked | gekochte Reisnudeln | Reisnudeln gekocht |
| food-summer-squash-yellow-raw | gelber Sommerkürbis | Sommerkürbis, gelb |
| food-plantains-yellow-raw | gelbe Kochbanane | Kochbanane, gelb |
| food-plantains-green-raw | grüne Kochbanane | Kochbanane, grün |
| food-yogurt-plain-whole-milk | Joghurt (3,8% Fett) | Joghurt |
| food-almond-milk-unsweetened-plain-refrigerated + food-almond-milk-unsweetened-plain-shelf-stable | Ungesüßte Mandelmilch / Mandelmilch (haltbar) | Mandelmilch (merged) |
| food-milk-lowfat + food-milk-reduced-fat | Fettarme Milch / Fettreduzierte Milch | Fettarme Milch (merged) |
| food-lemon-raw + food-lemon-peel-raw | Zitrone / Zitronenschale | Zitrone (merged, peel as alias) |
| food-currants-red-and-white-raw | Johannisbeeren, rot oder weiß | Rote Johannisbeere |
| food-flour-wheat-all-purpose-unenriched-unbleached | Weizenmehl 405 | Weizenmehl |
| food-flour-semolina-coarse-and-semi-coarse | Mehlgrieß (grob und halb grob) | Mehlgrieß |
| food-mushrooms-white-button | Champignon weiß | Champignon, weiß |
| food-puff-pastry-frozen | Blätterteig, gefroren | Blätterteig |
| food-tomato-paste-canned | (category change to Konserven only) | — |
| food-cheese-cheddar | (category change to Käse only) | — |
| food-mung-beans-sprouted-raw | Mungobohnensprossen | Mungobohnensprosse |
| food-spices-marjoram-dried | getrockneter Majoran | Majoran, getrocknet |
| food-spices-oregano-dried | getrockneter Oregano | Oregano, getrocknet |
| food-spices-rosemary-dried | getrockneter Rosmarin | Rosmarin, getrocknet |
| food-spices-thyme-dried | getrockneter Thymian | Thymian, getrocknet |
| food-spices-basil-dried | Basilikum getrocknet | Basilikum, getrocknet |
| food-spices-parsley-dried | getrocknete Petersilie | Petersilie, getrocknet |
| food-spearmint-dried | getrocknete Minze | Minze, getrocknet |
| food-capers-canned | eingelegte Kapern | Kapern |
| food-spices-paprika | Paprika (powder) | Paprikapulver |
| food-bell-pepper-yellow + food-bell-pepper-red | Paprika, gelb / Paprika, rot | Paprika (collapsed) |

---

# AMBIGUOUS — needs user decision

1. **Products vs ingredients** — `Tiefkühl-Pizza`, `Tiefkühl-Lasagne`,
   `Fertigsuppe`, `Fertiggericht` are placeholders for ready-made meals.
   Flagged for future architecture work.

2. ~~**Blattspinat vs Spinat**~~ — resolved: Blattspinat is now an
   alias of Spinat.

3. **Blaubeere vs Heidelbeere** — Heidelbeere aliased to Blaubeere.

4. **Weißkohl vs Kohl** — Weißkohl aliased to Kohl.

5. **Haferdrink vs Hafermilch** — aliased together.

6. **Worcestersauce dietary** — marked `meat` (traditional contains
   anchovies). User can mark vegan variant if needed.

7. **Foraged niche items** (`junge noch geschlossene Erlenkätzchen`, `Blätter
   Waldziest`, `Schlehen-Punsch`, `Honigsuppe`) — not in catalog. They'll
   fall through as new ingredients during import.

8. **Beilage** — category defaulted to `Obst und Gemüse` (placeholder),
   `dietary: undecided`. User may want both fields different.

9. **`Maisstärke` vs `Speisestärke` vs `Kartoffelstärke`** — three
   canonicals. `Speisestärke` is the generic catch-all. Confirm wiring.

10. **`Kühltheke` vs `Molkereiprodukte` for plant-based items** — vegan
    cream/butter/yogurt mostly routed to Kühltheke. Tandoor splits some
    differently. Confirm OK.

11. **Tortillas (Mais Tortillas)** — currently in Trockenwaren. Could be
    Backwaren. Confirm.

12. **Wine/sake/sherry/port dietary** — marked `undecided` because fining
    agents vary by producer. User can set explicit values per row.

13. **Auto-merge threshold** — matcher's MIN_AUTO_MATCH_SCORE (135) means
    1-token entries hitting a 2+ token candidate without full coverage
    score 130 (just below). Cases at this threshold include "rote Paprika"
    → "Paprika" + note "rote". May need a parser-tuning pass or explicit
    descriptor-prefix aliases if these don't auto-resolve cleanly. User
    has indicated the parser already handles these via prep-word stripping;
    confirming with a few test runs is the next step.

14. **Paprika collapse** — single `Paprika` canonical for fresh peppers
    (colors via leftover-tokens). Two Tandoor rows (food-bell-pepper-yellow,
    food-bell-pepper-red) dedupe to the same row. The seed loader needs
    to handle this; document it in the catalog code.

---

# Implementation status

**Done (in this branch):**
- ✅ `ingredient.is_equipment` column + migration
- ✅ Four non-food categories (Hygiene, Drogerie, Haushalt, Küchenbedarf)
  seeded by `runSeed`
- ✅ Parser propagates `is_equipment` through the catalog → matcher → row
  `isOptional` default
- ✅ Familywall importer pre-processors (paprika disambiguator,
  personal-label rewrites, section-header promoter)
- ✅ `product` / `product_alias` / `product_supermarket_unavailable`
  tables dropped; `shopping_item.product_id` removed; all product UI/API
  code removed
- ✅ Stammdaten rename: "Zutaten" → "Artikel", filter chips for
  Lebensmittel/Haushalt/Ausrüstung, Ausrüstung toggle in edit form
- ✅ Section-keyword promoter handles Beilage/Dressing/Sauce/Teig/Füllung/
  Topping/etc.

**Still to build (this plan drives the work):**

1. **Catalog file** `src/lib/familywall/ingredient-catalog.ts` — typed
   array of entries with the shape:
   ```
   {
     tandoor: "food-key" | null,        // null = NEW
     rename: { from: "..." } | null,
     canonicalName: string,
     category: string,
     dietary: "vegan" | "vegetarian" | "meat" | null,
     equipment: boolean,
     aliases: string[],
     subUnit: { name, perPurchase } | null,
   }
   ```

2. **Catalog seed step** running after `runSeed()` and before
   `runFamilywallImport`. Must handle four update modes:
   - **NEW**: insert ingredient + aliases + sub-units
   - **Tandoor anchor**: only add aliases + sub-units; canonical exists
   - **Rename**: UPDATE the Tandoor canonical's name, then add aliases
   - **Merge**: Paprika (food-bell-pepper-yellow + food-bell-pepper-red
     → one row), Ei (food-eggs-large + food-eggs-medium → one row), and
     Apfel (food-apples-fuji-* + food-apples-gala-* +
     food-apples-granny-smith-* + food-apples-honeycrisp-* → one row) —
     multiple Tandoor keys map to the same DB row.

3. **Alias-uniqueness validation**: `ingredient_alias.name_unique` is
   global. Walk the catalog at load time, surface collisions as errors
   rather than swallowing them; we want to know if a 689-entry catalog
   contains a clashing alias.

4. **Drop-list filter**: **no longer needed** — all original drop
   entries have been resolved at the familywall source or routed to
   real canonicals. The header-promoter handles every §HDR case. If a
   regression introduces new noise, add a drop step then; for now,
   skip.

5. **Estimated volume**: ~280 NEW canonicals + ~110 Tandoor anchors
   needing aliases/category-changes + ~62 renames + ~25 sub-unit
   additions + ~30 entries in drop/skip list.
