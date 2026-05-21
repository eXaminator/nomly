/**
 * Heuristic "are these probably the same thing?" clustering for stammdaten
 * rows. Detects German plurals and other near-duplicates ("Tomate" / "Tomaten",
 * "Möhre" / "Moehre", "Spaghetti" / "Spagetti") and groups them so the user
 * can merge in one click.
 *
 * The clustering is conservative on purpose — we'd rather miss a few real
 * duplicates than offer to merge "Salz" into "Salami". Threshold and the
 * plural-suffix list were tuned against a Tandoor + Familywall sample set.
 */

export type ProposalItem = {
  id: number;
  name: string;
  aliases: string[];
  /** Recipes / shopping-list entries / etc. referencing this row. Used to
   * pick the default winner when the user opens the dialog. */
  refCount: number;
};

export type ProposalCluster = {
  /** Synthetic id for UI keys; not stable across runs. */
  id: string;
  items: ProposalItem[];
  /** Default winner id — most aliases first, then most refs, then lowest id. */
  defaultWinnerId: number;
};

const SIMILARITY_THRESHOLD = 0.82;

const PLURAL_SUFFIXES = [
  "en",
  "er",
  "es",
  "in",
  "innen",
  "chen",
  "lein",
  "s",
  "n",
  "e",
];

/**
 * Length-gap fast-reject for the pairwise loop. Has to be at least as long
 * as the longest plural suffix, otherwise pairs like "Lehrer" vs
 * "Lehrerinnen" (Δ=5) would never even reach the plural-suffix check.
 */
const LENGTH_GAP_MAX = Math.max(
  4,
  ...PLURAL_SUFFIXES.map((s) => s.length),
);

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Levenshtein distance. Two-row DP — O(m·n) time, O(min(m,n)) space.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // ensure b is the shorter so the row vectors stay small
  if (a.length < b.length) {
    [a, b] = [b, a];
  }
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Returns a similarity score in [0, 1]. 1 means identical (after
 * normalization), 0 means totally different. Combines a plural-suffix
 * rule (prefix + plural ending bumps to 0.95) with an edit-distance ratio.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (Math.abs(a.length - b.length) > LENGTH_GAP_MAX) return 0;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (longer.startsWith(shorter)) {
    const suffix = longer.slice(shorter.length);
    if (PLURAL_SUFFIXES.includes(suffix)) return 0.95;
  }

  const dist = editDistance(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/**
 * Cluster items whose normalized names are similar enough to be probable
 * duplicates. Each returned cluster contains at least two items.
 *
 * Algorithm: pairwise similarity with a length-gap fast-reject, union-find
 * for transitive closure (A~B, B~C → {A,B,C} in one cluster).
 */
export function findMergeClusters(
  items: ProposalItem[],
): ProposalCluster[] {
  if (items.length < 2) return [];
  const normalized = items.map((i) => normalize(i.name));

  const parent = items.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(x: number, y: number) {
    const px = find(x);
    const py = find(y);
    if (px !== py) parent[px] = py;
  }

  for (let i = 0; i < items.length; i++) {
    const ni = normalized[i];
    if (ni.length === 0) continue;
    for (let j = i + 1; j < items.length; j++) {
      const nj = normalized[j];
      if (nj.length === 0) continue;
      if (Math.abs(ni.length - nj.length) > LENGTH_GAP_MAX) continue;
      if (similarity(ni, nj) >= SIMILARITY_THRESHOLD) {
        union(i, j);
      }
    }
  }

  const buckets = new Map<number, ProposalItem[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const list = buckets.get(root);
    if (list) list.push(items[i]);
    else buckets.set(root, [items[i]]);
  }

  const clusters: ProposalCluster[] = [];
  for (const [root, members] of buckets) {
    if (members.length < 2) continue;
    // Sort so the default winner is first and the list reads sensibly.
    const sorted = members.slice().sort((a, b) => {
      if (b.aliases.length !== a.aliases.length) {
        return b.aliases.length - a.aliases.length;
      }
      if (b.refCount !== a.refCount) return b.refCount - a.refCount;
      return a.id - b.id;
    });
    clusters.push({
      id: `c${root}`,
      items: sorted,
      defaultWinnerId: sorted[0].id,
    });
  }
  // Bigger clusters first; tie-broken by max aliases inside.
  clusters.sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    const aMax = Math.max(...a.items.map((i) => i.aliases.length));
    const bMax = Math.max(...b.items.map((i) => i.aliases.length));
    return bMax - aMax;
  });
  return clusters;
}
