/**
 * Per-ingredient unit conversion engine (pure, no DB).
 *
 * Conversions form a graph: global edges (a unit's dimension factor, e.g.
 * `1 TL = 5 ml`) plus per-ingredient edges (`1 ml = 0,5 g`, `1 Glas = 100 g`).
 * The graph partitions the units an ingredient is used in into connected
 * **components**; each component becomes one shopping-list line:
 *
 *  1. **Normalize** every contribution down to the component's *base* unit
 *     (the sink — the unit no edge points away from), summing there.
 *  2. **Containerize** (only if the component has a container edge): convert the
 *     summed base total to the container unit and round **up** ("buy whole
 *     packs"). Otherwise show the base total (promoted g→kg / ml→l past 1000).
 *
 * Both phases matter separately: normalization is per-contribution and chained;
 * the ceil happens once, on the sum.
 */

import { pluralizeLabel } from "./label.ts";

export type Dimension = "mass" | "volume" | "count";

/** `1 from = factor × to`. Container edges mark `from` as the purchase unit. */
export type ConversionEdge = {
  from: number;
  to: number;
  factor: number;
  isContainer: boolean;
};

export type UnitInfo = {
  id: number;
  name: string;
  plural: string | null;
  dimension: Dimension;
  /** Dimension base (NULL when this unit *is* the base). */
  baseUnitId: number | null;
  /** `qty × factor` = quantity in the dimension base. */
  factor: number;
};

export type Contribution = { unitId: number; quantity: number | null };

export type AggregatedLine = {
  unitId: number | null;
  unitName: string;
  quantity: number | null;
  dimension: Dimension | "none";
  /**
   * When the line was containerized (rounded up to whole packs), the summed
   * pre-container total in the component's base unit — e.g. `12` / "Zehen"
   * behind a "2 Stück" line, so the display can read "2 Stück (12 Zehen)".
   * Null/absent on non-container lines (the displayed quantity already IS the
   * base total there).
   */
  baseQuantity?: number | null;
  baseUnitName?: string | null;
};

type DirectedEdge = { from: number; to: number; factor: number; isContainer: boolean };
type Adj = Map<number, Array<{ to: number; mult: number }>>;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Ceil after rounding to 6 dp so float noise on an exact multiple
 *  (32 ÷ 16 = 1.9999999998) doesn't bump 2 → 3. */
function ceilWhole(n: number): number {
  return Math.ceil(Math.round(n * 1e6) / 1e6);
}

const DIM_ORDER: Record<string, number> = { mass: 0, volume: 1, count: 2, none: 3 };

export function aggregateContributions(
  contributions: Contribution[],
  edges: ConversionEdge[],
  units: Map<number, UnitInfo>,
  /**
   * "Auf Lager" stock to remove from the total. Each is converted to its
   * component's base unit and subtracted from the summed contributions before
   * containerization, with the per-component remainder clamped at zero.
   * Subtractions never create a line on their own — a stock entry whose unit
   * shares no component with a positive contribution has no visible effect.
   */
  subtractions: Contribution[] = [],
): AggregatedLine[] {
  // 1. Node set: contribution + subtraction units + edge endpoints, closed over
  //    global base chains so a unit's dimension base is part of the same graph.
  const nodes = new Set<number>();
  for (const c of contributions) nodes.add(c.unitId);
  for (const c of subtractions) nodes.add(c.unitId);
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  let added = true;
  while (added) {
    added = false;
    for (const id of [...nodes]) {
      const u = units.get(id);
      if (u?.baseUnitId != null && !nodes.has(u.baseUnitId)) {
        nodes.add(u.baseUnitId);
        added = true;
      }
    }
  }

  // 2. Directed edges (point toward the base): global U→base, plus the
  //    per-ingredient edges as given.
  const directed: DirectedEdge[] = [];
  for (const id of nodes) {
    const u = units.get(id);
    if (u?.baseUnitId != null && nodes.has(u.baseUnitId)) {
      directed.push({ from: id, to: u.baseUnitId, factor: u.factor, isContainer: false });
    }
  }
  for (const e of edges) directed.push({ ...e });

  // 3. Undirected adjacency with multiplicative factors (q_a × mult = q_b).
  const adj: Adj = new Map();
  const link = (a: number, b: number, mult: number) => {
    const list = adj.get(a) ?? [];
    list.push({ to: b, mult });
    adj.set(a, list);
  };
  for (const e of directed) {
    if (e.factor <= 0) continue;
    link(e.from, e.to, e.factor); // 1 from = factor to
    link(e.to, e.from, 1 / e.factor);
  }
  for (const id of nodes) if (!adj.has(id)) adj.set(id, []);

  // outgoing count in the directed sense → sinks are the component bases.
  const outgoing = new Map<number, number>();
  for (const id of nodes) outgoing.set(id, 0);
  for (const e of directed) {
    if (e.factor <= 0) continue;
    outgoing.set(e.from, (outgoing.get(e.from) ?? 0) + 1);
  }

  // 4. Connected components.
  const seen = new Set<number>();
  const components: number[][] = [];
  for (const id of nodes) {
    if (seen.has(id)) continue;
    const comp: number[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const n = queue.shift()!;
      comp.push(n);
      for (const nb of adj.get(n) ?? []) {
        if (!seen.has(nb.to)) {
          seen.add(nb.to);
          queue.push(nb.to);
        }
      }
    }
    components.push(comp);
  }

  // factor m such that q_from × m = q_to, via BFS over `adj` (small graphs).
  const convert = (from: number, to: number): number | null => {
    if (from === to) return 1;
    const visited = new Set<number>([from]);
    const queue: Array<{ id: number; mult: number }> = [{ id: from, mult: 1 }];
    while (queue.length) {
      const { id, mult } = queue.shift()!;
      for (const nb of adj.get(id) ?? []) {
        if (visited.has(nb.to)) continue;
        const m = mult * nb.mult;
        if (nb.to === to) return m;
        visited.add(nb.to);
        queue.push({ id: nb.to, mult: m });
      }
    }
    return null;
  };

  const contribByUnit = new Map<number, Contribution[]>();
  for (const c of contributions) {
    const list = contribByUnit.get(c.unitId) ?? [];
    list.push(c);
    contribByUnit.set(c.unitId, list);
  }

  const subByUnit = new Map<number, Contribution[]>();
  for (const c of subtractions) {
    const list = subByUnit.get(c.unitId) ?? [];
    list.push(c);
    subByUnit.set(c.unitId, list);
  }

  const lines: AggregatedLine[] = [];
  for (const comp of components) {
    // Only emit a line if the component actually carries a contribution.
    const hasContribution = comp.some((id) => contribByUnit.has(id));
    if (!hasContribution) continue;

    // base = the sink (no outgoing). Deterministic fallback: lowest id.
    const sinks = comp.filter((id) => (outgoing.get(id) ?? 0) === 0);
    const base = (sinks.length ? sinks : comp).slice().sort((a, b) => a - b)[0];

    // sum every contribution converted to base.
    let sum = 0;
    let anyKnown = false;
    for (const id of comp) {
      for (const c of contribByUnit.get(id) ?? []) {
        if (c.quantity == null) continue;
        const m = convert(id, base);
        if (m == null) continue;
        sum += c.quantity * m;
        anyKnown = true;
      }
    }
    // Subtract any "Auf Lager" stock in this component (converted to base),
    // clamping the remainder at zero. Only meaningful when the positive total
    // is known — stock can't be removed from an open-ended (null) total.
    if (anyKnown) {
      let stock = 0;
      for (const id of comp) {
        for (const c of subByUnit.get(id) ?? []) {
          if (c.quantity == null) continue;
          const m = convert(id, base);
          if (m == null) continue;
          stock += c.quantity * m;
        }
      }
      if (stock > 0) sum = Math.max(0, sum - stock);
    }
    const baseTotal = anyKnown ? sum : null;

    // container = `from` of a container edge in this component (≤1 by design).
    const compSet = new Set(comp);
    const containerEdge = edges
      .filter((e) => e.isContainer && compSet.has(e.from) && compSet.has(e.to))
      .sort((a, b) => a.from - b.from)[0];

    if (containerEdge) {
      const container = units.get(containerEdge.from);
      const toContainer = convert(base, containerEdge.from);
      const qty =
        baseTotal == null || toContainer == null ? null : ceilWhole(baseTotal * toContainer);
      // Surface the summed base total (the contributing sub-units) so the
      // display can read "2 Stück (12 Zehen)" — the pack count rounds up, the
      // parenthetical shows what actually accrued.
      const baseUnit = units.get(base);
      lines.push({
        unitId: containerEdge.from,
        unitName: container ? pluralizeLabel(container, qty) : String(containerEdge.from),
        quantity: qty,
        dimension: container?.dimension ?? "none",
        baseQuantity: baseTotal == null ? null : round3(baseTotal),
        baseUnitName: baseUnit ? pluralizeLabel(baseUnit, baseTotal) : null,
      });
      continue;
    }

    const { unit, qty } = chooseDisplay(base, baseTotal, units);
    lines.push({
      unitId: unit?.id ?? null,
      unitName: unit ? pluralizeLabel(unit, qty) : "",
      quantity: qty,
      dimension: unit?.dimension ?? "none",
    });
  }

  lines.sort(
    (a, b) =>
      (DIM_ORDER[a.dimension] ?? 9) - (DIM_ORDER[b.dimension] ?? 9) ||
      (a.unitId ?? 0) - (b.unitId ?? 0),
  );
  return lines;
}

/** Show the base total in the base unit, promoting to a larger same-dimension
 *  unit (g→kg, ml→l) once the total reaches 1000 — mirrors the prior shopping
 *  display rule. */
function chooseDisplay(
  baseId: number,
  baseTotal: number | null,
  units: Map<number, UnitInfo>,
): { unit: UnitInfo | undefined; qty: number | null } {
  const base = units.get(baseId);
  if (baseTotal == null) return { unit: base, qty: null };
  if (base && base.baseUnitId == null && base.factor === 1 && baseTotal >= 1000) {
    const larger = [...units.values()]
      .filter((u) => u.dimension === base.dimension && u.factor > 1)
      .sort((a, b) => b.factor - a.factor);
    for (const u of larger) {
      if (baseTotal / u.factor >= 1) return { unit: u, qty: round3(baseTotal / u.factor) };
    }
  }
  return { unit: base, qty: round3(baseTotal) };
}
