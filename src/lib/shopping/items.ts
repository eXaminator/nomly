import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { unaccent } from "../autocomplete.ts";
import {
  category,
  ingredient,
  ingredientAlias,
  ingredientSupermarketUnavailable,
  mealPlan,
  recipe,
  recipeIngredient,
  shoppingItem,
  shoppingItemAmount,
  shoppingItemSource,
  shoppingItemStapleSource,
  shoppingItemStock,
  stapleGroup,
  unit,
} from "../../db/schema.ts";
import {
  createIngredientFromName,
  resolveByName,
  type NameCandidate,
} from "./byName.ts";
import { getStueckUnit } from "./default-unit.ts";
import type { Dimension } from "./format.ts";
import { pluralizeLabel } from "../units/label.ts";
import { sweepCheckedItems } from "./sweeper.ts";
import { loadAllUnits } from "./units-db.ts";
import { loadConversionsByIngredient } from "../units/conversions-db.ts";
import {
  aggregateContributions,
  type Contribution,
  type ConversionEdge,
  type UnitInfo,
} from "../units/convert.ts";

export type ShoppingItemSourceView = {
  sourceId: number;
  mealPlanId: number;
  mealDate: string;
  recipeId: number;
  recipeTitle: string;
  recipeIngredientId: number;
  contributedQuantity: number | null;
  contributedUnitId: number | null;
  contributedUnit: string | null;
  recipeNotes: string | null;
  /** The planned meal's own note (`meal_plan.note`), shared by every ingredient
   *  that came from this meal. Null when the meal carries no note. */
  mealNote: string | null;
};

export type ShoppingItemStapleSourceView = {
  sourceId: number;
  stapleGroupId: number;
  stapleGroupName: string;
  contributedQuantity: number | null;
  contributedUnitId: number | null;
  contributedUnit: string | null;
};

/** Tag used in shopping_item_amount.dimension when the row carries no unit. */
type AmountDimension = Dimension | "none";

/**
 * One row in the aggregated-amounts list for an item. When the user has set
 * a manual override for this dimension, `manualAmountId` carries that row's
 * id (so the editor can target it on save); otherwise the entry is derived
 * from the sources sum and `manualAmountId` is null.
 */
export type ShoppingItemAmount = {
  quantity: number | null;
  unitId: number | null;
  unitName: string | null;
  dimension: AmountDimension;
  manualAmountId: number | null;
  /** For containerized (packaging) lines: the summed contributing base amount
   *  shown in parentheses after the pack count — e.g. `12` / "Zehen" behind
   *  "2 Stück". Null on non-container lines. */
  baseQuantity?: number | null;
  baseUnitName?: string | null;
};

export type ShoppingItemManualAmount = {
  id: number;
  quantity: number | null;
  unitId: number | null;
  unitName: string | null;
  dimension: AmountDimension;
};

/** The item's single "Auf Lager" (in‑stock) line. Subtracted from the
 *  aggregated total of the matching dimension. Null when no stock is set. */
export type ShoppingItemStock = {
  quantity: number | null;
  unitId: number | null;
  unitName: string | null;
  dimension: AmountDimension;
};

export type ShoppingItemView = {
  id: number;
  /** Retained for API compatibility — always "ingredient" after the
   *  products-into-ingredients unification. */
  refType: "ingredient";
  refId: number;
  name: string;
  amounts: ShoppingItemAmount[];
  categoryId: number | null;
  categoryName: string | null;
  checked: boolean;
  checkedAt: number | null;
  note: string | null;
  sortOrder: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  unavailableSupermarketIds: number[];
  sources: ShoppingItemSourceView[];
  stapleSources: ShoppingItemStapleSourceView[];
  /** Individual user-added manual amounts (additive on top of sources). */
  manualAmounts: ShoppingItemManualAmount[];
  /** The "Auf Lager" line, subtracted from the matching-dimension total. */
  stock: ShoppingItemStock | null;
  /** The linked article's default unit (own default unit with its display
   *  spelling, else the generic "Stück" fallback). Seeds the unit pickers for
   *  new manual amounts and the "Auf Lager" stock line. */
  defaultUnitId: number | null;
  defaultUnitName: string | null;
};

export function listShoppingItems(
  options: { skipSweep?: boolean } = {},
): ShoppingItemView[] {
  // Sweep on read so stale checked items never display even when the
  // server.mts interval hasn't fired (between ticks, or in tests / one-off
  // scripts that don't boot the custom server).
  if (!options.skipSweep) sweepCheckedItems();
  const ingredientRows = db
    .select({
      id: shoppingItem.id,
      refId: shoppingItem.ingredientId,
      name: ingredient.name,
      categoryId: shoppingItem.categoryId,
      categoryName: category.name,
      checked: shoppingItem.checked,
      checkedAt: shoppingItem.checkedAt,
      note: shoppingItem.note,
      sortOrder: shoppingItem.sortOrder,
      version: shoppingItem.version,
      createdAt: shoppingItem.createdAt,
      updatedAt: shoppingItem.updatedAt,
      defaultUnitId: ingredient.defaultUnitId,
      defaultUnitDisplay: ingredient.defaultUnitDisplay,
      defaultUnitName: unit.name,
    })
    .from(shoppingItem)
    .innerJoin(ingredient, eq(ingredient.id, shoppingItem.ingredientId))
    .leftJoin(category, eq(category.id, shoppingItem.categoryId))
    .leftJoin(unit, eq(unit.id, ingredient.defaultUnitId))
    .all();

  const baseRows = ingredientRows.map((r) => ({
    ...r,
    refType: "ingredient" as const,
  }));

  const itemIds = baseRows.map((r) => r.id);
  type RawSource = ShoppingItemSourceView;
  const sourcesByItem = new Map<number, RawSource[]>();
  if (itemIds.length > 0) {
    const sources = db
      .select({
        sourceId: shoppingItemSource.id,
        itemId: shoppingItemSource.itemId,
        mealPlanId: mealPlan.id,
        mealDate: mealPlan.date,
        recipeId: recipe.id,
        recipeTitle: recipe.title,
        recipeIngredientId: shoppingItemSource.recipeIngredientId,
        contributedQuantity: shoppingItemSource.contributedQuantity,
        contributedUnit: unit.name,
        contributedUnitPlural: unit.plural,
        contributedUnitId: shoppingItemSource.contributedUnitId,
        recipeNotes: recipeIngredient.notes,
        mealNote: mealPlan.note,
      })
      .from(shoppingItemSource)
      .innerJoin(mealPlan, eq(mealPlan.id, shoppingItemSource.mealPlanId))
      .innerJoin(recipe, eq(recipe.id, mealPlan.recipeId))
      .innerJoin(
        recipeIngredient,
        eq(recipeIngredient.id, shoppingItemSource.recipeIngredientId),
      )
      .leftJoin(unit, eq(unit.id, shoppingItemSource.contributedUnitId))
      .where(inArray(shoppingItemSource.itemId, itemIds))
      .orderBy(asc(mealPlan.date), asc(recipe.title))
      .all();
    for (const s of sources) {
      const arr = sourcesByItem.get(s.itemId) ?? [];
      arr.push({
        sourceId: s.sourceId,
        mealPlanId: s.mealPlanId,
        mealDate: s.mealDate,
        recipeId: s.recipeId,
        recipeTitle: s.recipeTitle,
        recipeIngredientId: s.recipeIngredientId,
        contributedQuantity: s.contributedQuantity,
        contributedUnit: s.contributedUnit
          ? pluralizeLabel(
              { name: s.contributedUnit, plural: s.contributedUnitPlural },
              s.contributedQuantity,
            )
          : s.contributedUnit,
        contributedUnitId: s.contributedUnitId,
        recipeNotes: s.recipeNotes,
        mealNote: s.mealNote,
      });
      sourcesByItem.set(s.itemId, arr);
    }
  }

  const stapleSourcesByItem = new Map<number, ShoppingItemStapleSourceView[]>();
  if (itemIds.length > 0) {
    const rows = db
      .select({
        sourceId: shoppingItemStapleSource.id,
        itemId: shoppingItemStapleSource.itemId,
        stapleGroupId: shoppingItemStapleSource.stapleGroupId,
        stapleGroupName: stapleGroup.name,
        contributedQuantity: shoppingItemStapleSource.contributedQuantity,
        contributedUnitId: shoppingItemStapleSource.contributedUnitId,
        contributedUnit: unit.name,
        contributedUnitPlural: unit.plural,
      })
      .from(shoppingItemStapleSource)
      .innerJoin(
        stapleGroup,
        eq(stapleGroup.id, shoppingItemStapleSource.stapleGroupId),
      )
      .leftJoin(unit, eq(unit.id, shoppingItemStapleSource.contributedUnitId))
      .where(inArray(shoppingItemStapleSource.itemId, itemIds))
      .orderBy(asc(stapleGroup.sortOrder), asc(stapleGroup.name))
      .all();
    for (const r of rows) {
      const arr = stapleSourcesByItem.get(r.itemId) ?? [];
      arr.push({
        sourceId: r.sourceId,
        stapleGroupId: r.stapleGroupId,
        stapleGroupName: r.stapleGroupName,
        contributedQuantity: r.contributedQuantity,
        contributedUnitId: r.contributedUnitId,
        contributedUnit: r.contributedUnit
          ? pluralizeLabel(
              { name: r.contributedUnit, plural: r.contributedUnitPlural },
              r.contributedQuantity,
            )
          : r.contributedUnit,
      });
      stapleSourcesByItem.set(r.itemId, arr);
    }
  }

  type RawManual = {
    id: number;
    itemId: number;
    quantity: number | null;
    unitId: number | null;
    unitName: string | null;
    dimension: AmountDimension;
  };
  const manualsByItem = new Map<number, RawManual[]>();
  if (itemIds.length > 0) {
    const rows = db
      .select({
        id: shoppingItemAmount.id,
        itemId: shoppingItemAmount.itemId,
        quantity: shoppingItemAmount.quantity,
        unitId: shoppingItemAmount.unitId,
        unitName: unit.name,
        unitPlural: unit.plural,
        dimension: shoppingItemAmount.dimension,
      })
      .from(shoppingItemAmount)
      .leftJoin(unit, eq(unit.id, shoppingItemAmount.unitId))
      .where(inArray(shoppingItemAmount.itemId, itemIds))
      .all();
    for (const r of rows) {
      const arr = manualsByItem.get(r.itemId) ?? [];
      arr.push({
        id: r.id,
        itemId: r.itemId,
        quantity: r.quantity,
        unitId: r.unitId,
        unitName: r.unitName
          ? pluralizeLabel({ name: r.unitName, plural: r.unitPlural }, r.quantity)
          : r.unitName,
        dimension: r.dimension as AmountDimension,
      });
      manualsByItem.set(r.itemId, arr);
    }
  }

  const stockByItem = new Map<number, ShoppingItemStock>();
  if (itemIds.length > 0) {
    const rows = db
      .select({
        itemId: shoppingItemStock.itemId,
        quantity: shoppingItemStock.quantity,
        unitId: shoppingItemStock.unitId,
        unitName: unit.name,
        unitPlural: unit.plural,
        dimension: shoppingItemStock.dimension,
      })
      .from(shoppingItemStock)
      .leftJoin(unit, eq(unit.id, shoppingItemStock.unitId))
      .where(inArray(shoppingItemStock.itemId, itemIds))
      .all();
    for (const r of rows) {
      stockByItem.set(r.itemId, {
        quantity: r.quantity,
        unitId: r.unitId,
        unitName: r.unitName
          ? pluralizeLabel({ name: r.unitName, plural: r.unitPlural }, r.quantity)
          : r.unitName,
        dimension: r.dimension as AmountDimension,
      });
    }
  }

  // The conversion engine needs the full unit catalogue (to promote g→kg /
  // ml→l and to resolve any per-ingredient edge) — it's a small table, so load
  // it whole rather than tracking which ids were referenced.
  const unitsById = loadAllUnits();

  const ingredientIds = baseRows.map((r) => r.refId as number);
  // Per-ingredient conversion edges, keyed by ingredient id.
  const conversionsByIngredient = loadConversionsByIngredient(ingredientIds);

  const ingredientUnavailable = new Map<number, number[]>();
  if (ingredientIds.length > 0) {
    const rows = db
      .select({
        ingredientId: ingredientSupermarketUnavailable.ingredientId,
        supermarketId: ingredientSupermarketUnavailable.supermarketId,
      })
      .from(ingredientSupermarketUnavailable)
      .where(inArray(ingredientSupermarketUnavailable.ingredientId, ingredientIds))
      .all();
    for (const r of rows) {
      const arr = ingredientUnavailable.get(r.ingredientId) ?? [];
      arr.push(r.supermarketId);
      ingredientUnavailable.set(r.ingredientId, arr);
    }
  }

  const stueck = getStueckUnit();
  const all: ShoppingItemView[] = baseRows.map((r) => {
    const sources = sourcesByItem.get(r.id) ?? [];
    const stapleSources = stapleSourcesByItem.get(r.id) ?? [];
    const manuals = manualsByItem.get(r.id) ?? [];
    const contributions: ContributionInput[] = [
      ...sources.map((s) => ({
        quantity: s.contributedQuantity,
        unitId: s.contributedUnitId,
      })),
      ...stapleSources.map((s) => ({
        quantity: s.contributedQuantity,
        unitId: s.contributedUnitId,
      })),
      ...manuals.map((m) => ({ quantity: m.quantity, unitId: m.unitId })),
    ];
    const stock = stockByItem.get(r.id) ?? null;
    const subtractions: ContributionInput[] =
      stock && stock.quantity != null && stock.unitId != null
        ? [{ quantity: stock.quantity, unitId: stock.unitId }]
        : [];
    const amounts = buildAggregatedAmounts(
      contributions,
      conversionsByIngredient.get(r.refId as number) ?? [],
      unitsById,
      subtractions,
    );
    const unavailable = ingredientUnavailable.get(r.refId as number) ?? [];
    return {
      id: r.id,
      refType: r.refType,
      refId: r.refId as number,
      name: r.name,
      amounts,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      checked: !!r.checked,
      checkedAt: r.checkedAt,
      note: r.note,
      sortOrder: r.sortOrder,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      unavailableSupermarketIds: unavailable,
      sources: sources.map((s) => ({
        sourceId: s.sourceId,
        mealPlanId: s.mealPlanId,
        mealDate: s.mealDate,
        recipeId: s.recipeId,
        recipeTitle: s.recipeTitle,
        recipeIngredientId: s.recipeIngredientId,
        contributedQuantity: s.contributedQuantity,
        contributedUnitId: s.contributedUnitId,
        contributedUnit: s.contributedUnit,
        recipeNotes: s.recipeNotes,
        mealNote: s.mealNote,
      })),
      stapleSources,
      manualAmounts: manuals.map((m) => ({
        id: m.id,
        quantity: m.quantity,
        unitId: m.unitId,
        unitName: m.unitName,
        dimension: m.dimension,
      })),
      stock,
      defaultUnitId: r.defaultUnitId ?? stueck.unitId,
      defaultUnitName: r.defaultUnitId != null
        ? (r.defaultUnitDisplay ?? r.defaultUnitName)
        : stueck.unitName,
    };
  });

  all.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, "de", { sensitivity: "base" }),
  );
  return all;
}

type ContributionInput = { quantity: number | null; unitId: number | null };

/**
 * Additive aggregation through the per-ingredient conversion graph. Source
 * contributions and manual entries are normalized to each connected
 * component's base unit and summed; a component with a container edge rounds
 * its total **up** to whole purchase units ("buy whole packs"), otherwise the
 * base total displays in its natural unit (g→kg / ml→l past 1000). See
 * {@link aggregateContributions}.
 *
 * Unit-less contributions (a bare "2" with no unit) have no graph node, so
 * they're summed separately into a single trailing dimension-"none" line.
 */
function buildAggregatedAmounts(
  contributions: ContributionInput[],
  edges: ConversionEdge[],
  unitsById: Map<number, UnitInfo>,
  subtractions: ContributionInput[] = [],
): ShoppingItemAmount[] {
  const withUnit: Contribution[] = [];
  const unitless: ContributionInput[] = [];
  for (const c of contributions) {
    if (c.unitId != null) withUnit.push({ unitId: c.unitId, quantity: c.quantity });
    else unitless.push(c);
  }

  // Only unit‑bearing stock can be removed through the conversion graph; a
  // unitless stock entry has no node to subtract against.
  const subWithUnit: Contribution[] = subtractions
    .filter((c) => c.unitId != null)
    .map((c) => ({ unitId: c.unitId as number, quantity: c.quantity }));

  const out: ShoppingItemAmount[] = aggregateContributions(
    withUnit,
    edges,
    unitsById,
    subWithUnit,
  ).map((line) => ({
    quantity: line.quantity,
    unitId: line.unitId,
    unitName: line.unitName,
    dimension: line.dimension,
    manualAmountId: null,
    baseQuantity: line.baseQuantity ?? null,
    baseUnitName: line.baseUnitName ?? null,
  }));

  if (unitless.length > 0) {
    let total = 0;
    let anyKnown = false;
    for (const c of unitless) {
      if (c.quantity != null) {
        total += c.quantity;
        anyKnown = true;
      }
    }
    out.push({
      quantity: anyKnown ? round3(total) : null,
      unitId: null,
      unitName: null,
      dimension: "none",
      manualAmountId: null,
    });
  }

  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type AddItemInput =
  | { ingredientId: number; quantity?: number | null; unitId?: number | null; note?: string | null }
  | {
      newIngredient: { name: string; defaultCategoryId?: number | null };
      quantity?: number | null;
      unitId?: number | null;
      note?: string | null;
    }
  | { byName: string; quantity?: number | null; unitId?: number | null; note?: string | null };

export type AddItemResolved = {
  mode: "ingredient" | "createdIngredient";
  refId: number;
  displayName: string;
};

export type AddItemAction = "created" | "incremented" | "reactivated";

export class ShoppingApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

const GRACE_SECONDS = 24 * 60 * 60;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Adds a single manual item to the list. Always at most one shopping_item
 * per ingredient — a fresh add against an existing item replaces the
 * manual override for the matching dimension. Reactivates a checked item
 * within the 24h grace window.
 */
export function addManualItem(input: AddItemInput): {
  item: ShoppingItemView;
  resolved: AddItemResolved;
  action: AddItemAction;
} {
  if ("byName" in input) {
    return addByName(input);
  }
  if ("ingredientId" in input) {
    return addIngredientItem(input.ingredientId, input);
  }
  const created = createIngredientFromName(
    input.newIngredient.name,
    input.newIngredient.defaultCategoryId ?? null,
  );
  return finishCreatedIngredient(created, input);
}

function addByName(
  input: Extract<AddItemInput, { byName: string }>,
): ReturnType<typeof addManualItem> {
  const res = resolveByName(input.byName);
  if (res.mode === "ambiguous") {
    throw new ShoppingApiError("ambiguous name", 409, {
      candidates: res.candidates.map((c) => candidateView(c)),
    });
  }
  if (res.mode === "match") {
    return addIngredientItem(res.candidate.id, input);
  }
  const created = createIngredientFromName(input.byName);
  return finishCreatedIngredient(created, input);
}

function candidateView(c: NameCandidate): {
  kind: "ingredient";
  id: number;
  name: string;
  matchedAlias?: string;
} {
  return { kind: c.kind, id: c.id, name: c.name, matchedAlias: c.matchedAlias };
}

function dimensionForUnitId(tx: Tx, unitId: number | null): AmountDimension {
  if (unitId == null) return "none";
  const row = tx
    .select({ d: unit.dimension })
    .from(unit)
    .where(eq(unit.id, unitId))
    .get();
  return (row?.d as AmountDimension | undefined) ?? "none";
}

function insertManualAmount(
  tx: Tx,
  input: { itemId: number; quantity: number | null; unitId: number | null },
): void {
  const dim = dimensionForUnitId(tx, input.unitId);
  tx.insert(shoppingItemAmount)
    .values({
      itemId: input.itemId,
      quantity: input.quantity,
      unitId: input.unitId,
      dimension: dim,
    })
    .run();
}

/**
 * Scale every contribution (source rows + manual rows) for one dimension
 * of `itemId` so the displayed total becomes `targetQuantity` in
 * `targetUnitId`. When the current total is zero (or every contribution
 * is open-ended), there's nothing to scale — fall back to inserting a
 * single manual amount with the target value.
 */
function scaleDimensionTo(
  tx: Tx,
  itemId: number,
  targetUnitId: number | null,
  targetQuantity: number | null,
): void {
  const dim = dimensionForUnitId(tx, targetUnitId);
  // Compute current total in base units.
  const sources = tx
    .select({
      id: shoppingItemSource.id,
      qty: shoppingItemSource.contributedQuantity,
      unitId: shoppingItemSource.contributedUnitId,
      factor: unit.factor,
      sourceDim: unit.dimension,
    })
    .from(shoppingItemSource)
    .leftJoin(unit, eq(unit.id, shoppingItemSource.contributedUnitId))
    .where(eq(shoppingItemSource.itemId, itemId))
    .all();
  const manuals = tx
    .select({
      id: shoppingItemAmount.id,
      qty: shoppingItemAmount.quantity,
      unitId: shoppingItemAmount.unitId,
      factor: unit.factor,
      dim: shoppingItemAmount.dimension,
    })
    .from(shoppingItemAmount)
    .leftJoin(unit, eq(unit.id, shoppingItemAmount.unitId))
    .where(eq(shoppingItemAmount.itemId, itemId))
    .all();

  // Filter to this dimension.
  const sourcesInDim = sources.filter((s) => {
    const sDim = (s.sourceDim as AmountDimension | null) ?? "none";
    return sDim === dim;
  });
  const manualsInDim = manuals.filter((m) => m.dim === dim);

  // Current total in base units (factor 1 == base; unitless rows count
  // their raw quantity).
  let currentBase = 0;
  let anyKnown = false;
  for (const s of sourcesInDim) {
    if (s.qty == null) continue;
    anyKnown = true;
    currentBase += s.qty * (s.factor ?? 1);
  }
  for (const m of manualsInDim) {
    if (m.qty == null) continue;
    anyKnown = true;
    currentBase += m.qty * (m.factor ?? 1);
  }

  // Compute target in base units. We need the factor of the target unit;
  // unitless target → factor 1.
  let targetFactor = 1;
  if (targetUnitId != null) {
    const t = tx
      .select({ factor: unit.factor })
      .from(unit)
      .where(eq(unit.id, targetUnitId))
      .get();
    targetFactor = t?.factor ?? 1;
  }
  const targetBase =
    targetQuantity == null ? null : targetQuantity * targetFactor;

  if (!anyKnown || currentBase === 0) {
    // Nothing to scale → replace any open-ended/manuals in this dim with a
    // single manual entry carrying the target value.
    for (const m of manualsInDim) {
      tx.delete(shoppingItemAmount).where(eq(shoppingItemAmount.id, m.id)).run();
    }
    if (targetQuantity != null) {
      tx.insert(shoppingItemAmount)
        .values({
          itemId,
          quantity: targetQuantity,
          unitId: targetUnitId,
          dimension: dim,
        })
        .run();
    }
    return;
  }

  if (targetBase == null) {
    // Edit "to open-ended" — clear known quantities. Drop manuals; null out
    // source contributions.
    for (const m of manualsInDim) {
      tx.delete(shoppingItemAmount).where(eq(shoppingItemAmount.id, m.id)).run();
    }
    if (sourcesInDim.length > 0) {
      tx.update(shoppingItemSource)
        .set({ contributedQuantity: null })
        .where(
          inArray(
            shoppingItemSource.id,
            sourcesInDim.map((s) => s.id),
          ),
        )
        .run();
    }
    return;
  }

  const factor = targetBase / currentBase;
  for (const s of sourcesInDim) {
    if (s.qty == null) continue;
    tx.update(shoppingItemSource)
      .set({ contributedQuantity: round3(s.qty * factor) })
      .where(eq(shoppingItemSource.id, s.id))
      .run();
  }
  for (const m of manualsInDim) {
    if (m.qty == null) continue;
    tx.update(shoppingItemAmount)
      .set({ quantity: round3(m.qty * factor) })
      .where(eq(shoppingItemAmount.id, m.id))
      .run();
  }
}

function addIngredientItem(
  ingredientId: number,
  input: { quantity?: number | null; unitId?: number | null; note?: string | null },
): ReturnType<typeof addManualItem> {
  return db.transaction((tx) => {
    const ing = tx
      .select({
        name: ingredient.name,
        defaultCategoryId: ingredient.defaultCategoryId,
      })
      .from(ingredient)
      .where(eq(ingredient.id, ingredientId))
      .get();
    if (!ing) throw new ShoppingApiError("ingredient not found", 404);

    const existing = findExistingForIngredient(tx, ingredientId);
    let itemId: number;
    let action: AddItemAction;
    if (!existing) {
      const sortOrder = nextSortOrder(tx);
      const created = tx
        .insert(shoppingItem)
        .values({
          ingredientId,
          quantity: null,
          unitId: null,
          categoryId: ing.defaultCategoryId ?? null,
          note: input.note ?? null,
          sortOrder,
          version: 1,
        })
        .returning({ id: shoppingItem.id })
        .all();
      itemId = created[0].id;
      action = "created";
    } else if (
      existing.checked &&
      existing.checkedAt != null &&
      Math.floor(Date.now() / 1000) - existing.checkedAt < GRACE_SECONDS
    ) {
      // Reactivate: drop any prior manual overrides (the previously-checked
      // amounts are "gone" from the user's perspective) and start over.
      tx.delete(shoppingItemAmount)
        .where(eq(shoppingItemAmount.itemId, existing.id))
        .run();
      tx.update(shoppingItem)
        .set({
          checked: false,
          checkedAt: null,
          note: input.note ?? existing.note,
          version: sql`${shoppingItem.version} + 1`,
          updatedAt: sql`unixepoch()`,
        })
        .where(eq(shoppingItem.id, existing.id))
        .run();
      itemId = existing.id;
      action = "reactivated";
    } else {
      if (input.note !== undefined) {
        tx.update(shoppingItem)
          .set({
            note: input.note ?? null,
            version: sql`${shoppingItem.version} + 1`,
            updatedAt: sql`unixepoch()`,
          })
          .where(eq(shoppingItem.id, existing.id))
          .run();
      } else {
        tx.update(shoppingItem)
          .set({
            version: sql`${shoppingItem.version} + 1`,
            updatedAt: sql`unixepoch()`,
          })
          .where(eq(shoppingItem.id, existing.id))
          .run();
      }
      itemId = existing.id;
      action = "incremented";
    }

    if (input.quantity != null || input.unitId != null) {
      insertManualAmount(tx, {
        itemId,
        quantity: input.quantity ?? null,
        unitId: input.unitId ?? null,
      });
    }

    const view = getItemView(itemId);
    if (!view) throw new ShoppingApiError("item missing after add", 500);
    return {
      item: view,
      resolved: { mode: "ingredient", refId: ingredientId, displayName: ing.name },
      action,
    };
  });
}

function finishCreatedIngredient(
  created: { id: number; name: string },
  input: { quantity?: number | null; unitId?: number | null; note?: string | null },
): ReturnType<typeof addManualItem> {
  const result = addIngredientItem(created.id, input);
  return {
    ...result,
    resolved: {
      mode: "createdIngredient",
      refId: created.id,
      displayName: created.name,
    },
  };
}

function findExistingForIngredient(
  tx: Tx,
  ingredientId: number,
): {
  id: number;
  checked: boolean;
  checkedAt: number | null;
  note: string | null;
} | null {
  const row = tx
    .select({
      id: shoppingItem.id,
      checked: shoppingItem.checked,
      checkedAt: shoppingItem.checkedAt,
      note: shoppingItem.note,
    })
    .from(shoppingItem)
    .where(eq(shoppingItem.ingredientId, ingredientId))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    checked: !!row.checked,
    checkedAt: row.checkedAt,
    note: row.note,
  };
}

function nextSortOrder(tx: Tx): number {
  const row = tx
    .select({ max: sql<number | null>`MAX(${shoppingItem.sortOrder})` })
    .from(shoppingItem)
    .get();
  return (row?.max ?? -1) + 1;
}

export type PatchInput = {
  checked?: boolean;
  note?: string | null;
};

export type PatchOptions = {
  /**
   * Client-side wall-clock at the moment the user toggled the item (ms epoch).
   * When provided, gates the write: if the row's `updatedAt` is newer than
   * this timestamp, the patch is a no-op and the current row is returned.
   * Only the `checked` field is gated — non-checked patches apply
   * unconditionally even when `clientStampedAt` is present.
   */
  clientStampedAt?: number;
};

/**
 * Updates only the item-level fields (checked / note). Amount edits go
 * through `setItemAmount` / `deleteItemAmount` so each manual override
 * targets a specific dimension.
 */
export function patchItem(
  id: number,
  patch: PatchInput,
  options: PatchOptions = {},
): ShoppingItemView {
  const existing = db
    .select({
      id: shoppingItem.id,
      checked: shoppingItem.checked,
      updatedAt: shoppingItem.updatedAt,
    })
    .from(shoppingItem)
    .where(eq(shoppingItem.id, id))
    .get();
  if (!existing) throw new ShoppingApiError("item not found", 404);

  const wantsCheckedChange = Object.prototype.hasOwnProperty.call(patch, "checked");
  const clientTs = options.clientStampedAt;

  // LWW gate: only for toggles, only when a client timestamp is supplied.
  if (wantsCheckedChange && clientTs != null) {
    const clientSeconds = Math.floor(clientTs / 1000);
    if (clientSeconds < existing.updatedAt) {
      // Skip the sweep so a stale-checkedAt row (the very thing this gate
      // protects) doesn't get GC'd as we return its current state.
      const v = getItemView(id, { skipSweep: true });
      if (!v) throw new ShoppingApiError("item not found", 404);
      return v;
    }
  }

  const set: Partial<typeof shoppingItem.$inferInsert> = {};
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Cap the client timestamp at "now" so a clock-skewed device cannot
  // lock the row against legitimate future writes.
  const cappedClientSeconds =
    clientTs != null ? Math.min(Math.floor(clientTs / 1000), nowSeconds) : null;

  if (wantsCheckedChange) {
    set.checked = patch.checked;
    set.checkedAt = patch.checked
      ? (cappedClientSeconds ?? nowSeconds)
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "note")) {
    set.note = patch.note ?? null;
  }
  if (Object.keys(set).length === 0) {
    const v = getItemView(id, { skipSweep: true });
    if (!v) throw new ShoppingApiError("item not found", 404);
    return v;
  }

  // updatedAt is the LWW comparison field. Stamp with the (capped) client
  // time only when this patch carries a check toggle — note-only patches
  // must not lower updatedAt below "now" via a stale client timestamp.
  const stamp = wantsCheckedChange ? (cappedClientSeconds ?? nowSeconds) : nowSeconds;

  db.update(shoppingItem)
    .set({
      ...set,
      version: sql`${shoppingItem.version} + 1`,
      updatedAt: stamp,
    })
    .where(eq(shoppingItem.id, id))
    .run();
  // Skip sweep on the post-update read: when the client legitimately stamps
  // an old (capped) checkedAt — say from a delayed offline replay — the
  // sweep would 86 the row before we can return its view.
  const view = getItemView(id, { skipSweep: true });
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

export type SetAmountInput = {
  quantity: number | null;
  unitId: number | null;
};

/**
 * Set the displayed amount for one dimension to `quantity` of `unitId` by
 * proportionally scaling whatever already contributes (source rows + manual
 * amounts). Removing a contributing meal later will subtract its (already
 * scaled) share from the total, so edits compose cleanly with deletions.
 *
 * When no contribution exists yet for the dimension, a fresh manual amount
 * carries the typed value — same effect as `addItemAmount`.
 */
export function setItemAmount(
  itemId: number,
  input: SetAmountInput,
): ShoppingItemView {
  const exists = db
    .select({ id: shoppingItem.id })
    .from(shoppingItem)
    .where(eq(shoppingItem.id, itemId))
    .get();
  if (!exists) throw new ShoppingApiError("item not found", 404);

  db.transaction((tx) => {
    scaleDimensionTo(tx, itemId, input.unitId, input.quantity);
    tx.update(shoppingItem)
      .set({
        version: sql`${shoppingItem.version} + 1`,
        updatedAt: sql`unixepoch()`,
      })
      .where(eq(shoppingItem.id, itemId))
      .run();
  });
  const view = getItemView(itemId);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

export type SetStockInput = { quantity: number | null; unitId: number | null };

/** Insert or replace the single "Auf Lager" row for an item. */
function upsertStock(tx: Tx, itemId: number, input: SetStockInput): void {
  const dim = dimensionForUnitId(tx, input.unitId);
  const existing = tx
    .select({ id: shoppingItemStock.id })
    .from(shoppingItemStock)
    .where(eq(shoppingItemStock.itemId, itemId))
    .get();
  if (existing) {
    tx.update(shoppingItemStock)
      .set({
        quantity: input.quantity,
        unitId: input.unitId,
        dimension: dim,
        updatedAt: sql`unixepoch()`,
      })
      .where(eq(shoppingItemStock.itemId, itemId))
      .run();
  } else {
    tx.insert(shoppingItemStock)
      .values({
        itemId,
        quantity: input.quantity,
        unitId: input.unitId,
        dimension: dim,
      })
      .run();
  }
}

/**
 * Set the "Auf Lager" (in‑stock) amount for an item. The amount is subtracted
 * from the matching-dimension aggregated total on read. A null `quantity`
 * clears the stock row instead (same as {@link clearItemStock}).
 */
export function setItemStock(itemId: number, input: SetStockInput): ShoppingItemView {
  const exists = db
    .select({ id: shoppingItem.id })
    .from(shoppingItem)
    .where(eq(shoppingItem.id, itemId))
    .get();
  if (!exists) throw new ShoppingApiError("item not found", 404);

  db.transaction((tx) => {
    if (input.quantity == null) {
      tx.delete(shoppingItemStock).where(eq(shoppingItemStock.itemId, itemId)).run();
    } else {
      upsertStock(tx, itemId, input);
    }
    tx.update(shoppingItem)
      .set({ version: sql`${shoppingItem.version} + 1`, updatedAt: sql`unixepoch()` })
      .where(eq(shoppingItem.id, itemId))
      .run();
  });
  const view = getItemView(itemId);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

/** Remove the "Auf Lager" row for an item (no-op when none exists). */
export function clearItemStock(itemId: number): ShoppingItemView {
  const exists = db
    .select({ id: shoppingItem.id })
    .from(shoppingItem)
    .where(eq(shoppingItem.id, itemId))
    .get();
  if (!exists) throw new ShoppingApiError("item not found", 404);
  db.transaction((tx) => {
    tx.delete(shoppingItemStock).where(eq(shoppingItemStock.itemId, itemId)).run();
    tx.update(shoppingItem)
      .set({ version: sql`${shoppingItem.version} + 1`, updatedAt: sql`unixepoch()` })
      .where(eq(shoppingItem.id, itemId))
      .run();
  });
  const view = getItemView(itemId);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

export type StockBatchEntry = {
  itemId: number;
  quantity: number | null;
  unitId: number | null;
};

/**
 * Apply many "Auf Lager" edits at once (the whole-list stock check). An entry
 * with a null quantity clears that item's stock; others upsert. Items that
 * don't exist are skipped. Returns the refreshed list.
 */
export function setStockBatch(entries: StockBatchEntry[]): ShoppingItemView[] {
  db.transaction((tx) => {
    const touched = new Set<number>();
    for (const e of entries) {
      const exists = tx
        .select({ id: shoppingItem.id })
        .from(shoppingItem)
        .where(eq(shoppingItem.id, e.itemId))
        .get();
      if (!exists) continue;
      if (e.quantity == null) {
        tx.delete(shoppingItemStock).where(eq(shoppingItemStock.itemId, e.itemId)).run();
      } else {
        upsertStock(tx, e.itemId, { quantity: e.quantity, unitId: e.unitId });
      }
      touched.add(e.itemId);
    }
    for (const itemId of touched) {
      tx.update(shoppingItem)
        .set({ version: sql`${shoppingItem.version} + 1`, updatedAt: sql`unixepoch()` })
        .where(eq(shoppingItem.id, itemId))
        .run();
    }
  });
  return listShoppingItems();
}

/**
 * Always inserts a new manual amount row, regardless of whether the
 * dimension already has contributions. Used by the row editor's "Weitere
 * Menge" button to add on top of existing amounts.
 */
export function addItemAmount(
  itemId: number,
  input: SetAmountInput,
): ShoppingItemView {
  const exists = db
    .select({ id: shoppingItem.id })
    .from(shoppingItem)
    .where(eq(shoppingItem.id, itemId))
    .get();
  if (!exists) throw new ShoppingApiError("item not found", 404);

  db.transaction((tx) => {
    insertManualAmount(tx, {
      itemId,
      quantity: input.quantity,
      unitId: input.unitId,
    });
    tx.update(shoppingItem)
      .set({
        version: sql`${shoppingItem.version} + 1`,
        updatedAt: sql`unixepoch()`,
      })
      .where(eq(shoppingItem.id, itemId))
      .run();
  });
  const view = getItemView(itemId);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

/**
 * Update the contributed quantity of a single recipe-derived source row.
 * Used by the row editor's per-source inputs so the user can adjust a meal's
 * specific contribution without scaling the whole dimension.
 */
export function setSourceQuantity(
  itemId: number,
  sourceId: number,
  quantity: number | null,
): ShoppingItemView {
  const row = db
    .select({ id: shoppingItemSource.id })
    .from(shoppingItemSource)
    .where(
      and(
        eq(shoppingItemSource.id, sourceId),
        eq(shoppingItemSource.itemId, itemId),
      ),
    )
    .get();
  if (!row) throw new ShoppingApiError("source not found", 404);
  db.transaction((tx) => {
    tx.update(shoppingItemSource)
      .set({ contributedQuantity: quantity })
      .where(eq(shoppingItemSource.id, sourceId))
      .run();
    tx.update(shoppingItem)
      .set({
        version: sql`${shoppingItem.version} + 1`,
        updatedAt: sql`unixepoch()`,
      })
      .where(eq(shoppingItem.id, itemId))
      .run();
  });
  const view = getItemView(itemId);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

/**
 * Update the quantity of a specific manual amount row. Used by the row
 * editor's per-manual inputs.
 */
export function setManualAmountQuantity(
  itemId: number,
  amountId: number,
  quantity: number | null,
): ShoppingItemView {
  const row = db
    .select({ id: shoppingItemAmount.id })
    .from(shoppingItemAmount)
    .where(
      and(
        eq(shoppingItemAmount.id, amountId),
        eq(shoppingItemAmount.itemId, itemId),
      ),
    )
    .get();
  if (!row) throw new ShoppingApiError("amount not found", 404);
  db.transaction((tx) => {
    tx.update(shoppingItemAmount)
      .set({ quantity })
      .where(eq(shoppingItemAmount.id, amountId))
      .run();
    tx.update(shoppingItem)
      .set({
        version: sql`${shoppingItem.version} + 1`,
        updatedAt: sql`unixepoch()`,
      })
      .where(eq(shoppingItem.id, itemId))
      .run();
  });
  const view = getItemView(itemId);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

/**
 * Remove a single recipe-derived source row. Different from the meal-level
 * subtract (which drops every source for a given meal) — this targets one
 * specific contribution so the user can prune individual amounts from the
 * editor without un-planning the meal.
 */
export function deleteSource(itemId: number, sourceId: number): ShoppingItemView {
  const row = db
    .select({ id: shoppingItemSource.id })
    .from(shoppingItemSource)
    .where(
      and(
        eq(shoppingItemSource.id, sourceId),
        eq(shoppingItemSource.itemId, itemId),
      ),
    )
    .get();
  if (!row) throw new ShoppingApiError("source not found", 404);
  db.transaction((tx) => {
    tx.delete(shoppingItemSource).where(eq(shoppingItemSource.id, sourceId)).run();
    tx.update(shoppingItem)
      .set({
        version: sql`${shoppingItem.version} + 1`,
        updatedAt: sql`unixepoch()`,
      })
      .where(eq(shoppingItem.id, itemId))
      .run();
  });
  const view = getItemView(itemId);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

/**
 * Remove a single staple-group source contribution from this item. The
 * group itself is untouched — this only prunes the contribution from the
 * running list. Mirrors `deleteSource` for meal sources.
 */
export function deleteStapleSource(
  itemId: number,
  sourceId: number,
): ShoppingItemView {
  const row = db
    .select({ id: shoppingItemStapleSource.id })
    .from(shoppingItemStapleSource)
    .where(
      and(
        eq(shoppingItemStapleSource.id, sourceId),
        eq(shoppingItemStapleSource.itemId, itemId),
      ),
    )
    .get();
  if (!row) throw new ShoppingApiError("source not found", 404);
  db.transaction((tx) => {
    tx.delete(shoppingItemStapleSource)
      .where(eq(shoppingItemStapleSource.id, sourceId))
      .run();
    tx.update(shoppingItem)
      .set({
        version: sql`${shoppingItem.version} + 1`,
        updatedAt: sql`unixepoch()`,
      })
      .where(eq(shoppingItem.id, itemId))
      .run();
  });
  const view = getItemView(itemId);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

export function deleteItemAmount(itemId: number, amountId: number): ShoppingItemView {
  const row = db
    .select({ id: shoppingItemAmount.id })
    .from(shoppingItemAmount)
    .where(
      and(
        eq(shoppingItemAmount.id, amountId),
        eq(shoppingItemAmount.itemId, itemId),
      ),
    )
    .get();
  if (!row) throw new ShoppingApiError("amount not found", 404);
  db.transaction((tx) => {
    tx.delete(shoppingItemAmount).where(eq(shoppingItemAmount.id, amountId)).run();
    tx.update(shoppingItem)
      .set({
        version: sql`${shoppingItem.version} + 1`,
        updatedAt: sql`unixepoch()`,
      })
      .where(eq(shoppingItem.id, itemId))
      .run();
  });
  const view = getItemView(itemId);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

export function deleteItem(id: number): void {
  const res = db.delete(shoppingItem).where(eq(shoppingItem.id, id)).run();
  if (res.changes === 0) throw new ShoppingApiError("item not found", 404);
}

/**
 * Drop every item from the running list. Cascades to `shopping_item_source`
 * and `shopping_item_amount`, so contributing meals become eligible to
 * reappear in the "Mahlzeiten hinzufügen" preview without the "Bereits auf
 * der Liste" badge.
 */
export function clearAllItems(): { deletedCount: number } {
  const result = db.delete(shoppingItem).run();
  return { deletedCount: result.changes };
}

export function getItemView(
  id: number,
  options: { skipSweep?: boolean } = {},
): ShoppingItemView | null {
  const items = listShoppingItems(options);
  return items.find((i) => i.id === id) ?? null;
}

/**
 * Autocomplete for the "Artikel hinzufügen" form. Returns up to 20 hits
 * over `ingredient` ordered by relevance (exact-prefix wins, then substring).
 */
export type AutocompleteHit = {
  kind: "ingredient";
  id: number;
  name: string;
  matchedAlias?: string;
  /** The article's default category name, for display in pickers/pills. */
  categoryName?: string | null;
  /** Resolved default unit for a manual add — the article's own default unit
   *  (with its display spelling) or the generic "Stück" fallback. Never null
   *  unless even "Stück" is missing from the catalogue. */
  defaultUnitId?: number | null;
  defaultUnitName?: string | null;
};

const ESCAPE_LIKE = (s: string) => s.replace(/[%_]/g, "\\$&");

export function autocompleteItems(rawQuery: string): AutocompleteHit[] {
  const q = rawQuery.trim();
  if (q.length === 0) return [];
  // Match against `unaccent(name)` below, so the pattern must be unaccented
  // too — otherwise typing an accented character (e.g. "Brö") can never match
  // the accent-stripped column ("brotchen").
  const pattern = `%${ESCAPE_LIKE(unaccent(q))}%`;

  const hits: AutocompleteHit[] = [];
  const seen = new Set<string>();
  const push = (h: AutocompleteHit) => {
    const key = `${h.kind}:${h.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(h);
  };

  // Resolved once: the "Stück" fallback for articles with no own default unit.
  const stueck = getStueckUnit();
  const resolveDefaultUnit = (
    defaultUnitId: number | null,
    defaultUnitDisplay: string | null,
    unitName: string | null,
  ): { defaultUnitId: number | null; defaultUnitName: string | null } =>
    defaultUnitId != null
      ? { defaultUnitId, defaultUnitName: defaultUnitDisplay ?? unitName }
      : { defaultUnitId: stueck.unitId, defaultUnitName: stueck.unitName };

  const ing = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      categoryName: category.name,
      defaultUnitId: ingredient.defaultUnitId,
      defaultUnitDisplay: ingredient.defaultUnitDisplay,
      defaultUnitName: unit.name,
    })
    .from(ingredient)
    .leftJoin(category, eq(category.id, ingredient.defaultCategoryId))
    .leftJoin(unit, eq(unit.id, ingredient.defaultUnitId))
    .where(sql`unaccent(${ingredient.name}) LIKE ${pattern}`)
    .orderBy(asc(ingredient.name))
    .limit(20)
    .all();
  for (const r of ing)
    push({
      kind: "ingredient",
      id: r.id,
      name: r.name,
      categoryName: r.categoryName,
      ...resolveDefaultUnit(r.defaultUnitId, r.defaultUnitDisplay, r.defaultUnitName),
    });

  const ingA = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      alias: ingredientAlias.name,
      categoryName: category.name,
      defaultUnitId: ingredient.defaultUnitId,
      defaultUnitDisplay: ingredient.defaultUnitDisplay,
      defaultUnitName: unit.name,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .leftJoin(category, eq(category.id, ingredient.defaultCategoryId))
    .leftJoin(unit, eq(unit.id, ingredient.defaultUnitId))
    .where(sql`unaccent(${ingredientAlias.name}) LIKE ${pattern}`)
    .orderBy(asc(ingredientAlias.name))
    .limit(20)
    .all();
  for (const r of ingA)
    push({
      kind: "ingredient",
      id: r.id,
      name: r.name,
      matchedAlias: r.alias,
      categoryName: r.categoryName,
      ...resolveDefaultUnit(r.defaultUnitId, r.defaultUnitDisplay, r.defaultUnitName),
    });

  return hits.slice(0, 20);
}
