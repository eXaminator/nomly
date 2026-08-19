import type { IngredientMention } from "@/lib/markdown";
import {
  mealEmphasisFor,
  type MealEmphasis,
} from "@/lib/recipes/meal-emphasis";
import type { RecipeIngredientView } from "@/lib/recipes/types";
import type { MentionTip, MentionTips } from "./instruction-body";

/**
 * Turns a recipe's ingredient rows into the two things the prose renderer
 * needs: the {@link IngredientMention} list that
 * {@link import("@/lib/markdown").highlightIngredientMentions} underlines, and
 * the parallel {@link MentionTips} the tooltip resolves `data-mention` against.
 *
 * Rows that are the same ingredient (same catalog id, or same name when
 * unassigned) collapse into ONE mention whose tooltip stacks every entry — so
 * sugar listed twice (once for the dough, once for the topping) lights up once
 * and shows both lines, in the order the rows were passed. Equipment (pots,
 * baking paper) is excluded: it isn't food and shouldn't compete with
 * ingredients in the prose.
 *
 * A row that belongs to an alternative group pulls its WHOLE group into the
 * tooltip — the primary plus every alternative, flagged so the tooltip indents
 * them the way the ingredient list does. Matching any member shows all of
 * them: a step saying "lentils" should reveal that black lentils are an
 * accepted stand-in for the green ones, whichever spelling hit.
 *
 * With a meal in context the group also carries that meal's shopping decision
 * ({@link mealEmphasisFor}), so the tooltip can say which alternative was
 * actually bought instead of only which ones were allowed.
 *
 * Two kinds of spelling feed the matcher:
 *   - FULL spellings — the row's display name, the ingredient's canonical
 *     name, and every accrued alias. Always matched.
 *   - PARTIAL spellings — the tail of a multi-word spelling ("lentils" from
 *     "green lentils"). Only matched when the recipe makes them unambiguous;
 *     see {@link derivePartials}.
 */

/** The row fields this module needs. A structural subset of
 *  {@link RecipeIngredientView} so callers can pass recipe rows straight in. */
export type MentionRow = Pick<
  RecipeIngredientView,
  | "id"
  | "ingredientId"
  | "ingredientName"
  | "canonicalIngredientName"
  | "aliases"
  | "alternativeForId"
  | "isEquipment"
  | "quantity"
  | "quantityLow"
  | "quantifierName"
  | "quantifierValue"
  | "quantifierSource"
  | "unitLabel"
  | "notes"
  | "isOptional"
  | "fixedAmount"
  | "dietaryClass"
>;

/**
 * Minimum number of letters/digits a PARTIAL spelling must carry. Keeps short
 * filler tails ("oil", "Öl", "of") from lighting up half the prose — a partial
 * is a guess, so it has to be substantial enough to be worth it. Full
 * spellings keep their own (lower) floor in `highlightIngredientMentions`.
 */
const MIN_PARTIAL_LENGTH = 4;

/**
 * Words that never carry an ingredient's identity: articles, conjunctions,
 * prepositions and the prep/quantity chatter that accretes on catalog aliases
 * ("salt, adjust", "pepper plus divided", "Eine Prise Salz"). A partial whose
 * FIRST word is one of these is dropped, as is a partial that IS one — without
 * this, "pepper plus divided" would offer "divided" as a spelling for pepper
 * and underline every "divided" in the instructions.
 *
 * Deliberately conservative: only words that would be noise as the *head* of
 * an ingredient name. Words that can lead a real name (e.g. "Rote", "green")
 * stay out of the list — ambiguity resolution handles those instead.
 */
const FILLER_WORDS = new Set([
  // German — articles, conjunctions, prepositions
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem",
  "einer", "eines", "und", "oder", "mit", "ohne", "aus", "von", "vom", "zum",
  "zur", "für", "nach", "bei", "je", "jeweils", "davon", "dazu",
  // German — amount / prep chatter
  "etwas", "prise", "stück", "mehr", "extra", "optional", "wahlweise",
  "alternativ", "geschmack", "ca", "etwa", "evtl", "gehackt", "gehackte",
  "gehackter", "gehacktes", "gemahlen", "gemahlene", "gemahlener",
  "gerieben", "geriebene", "geriebener", "getrocknet", "getrocknete",
  "getrockneter", "frisch", "frische", "frischer", "frisches",
  // English — articles, conjunctions, prepositions
  "the", "a", "an", "and", "or", "with", "without", "of", "to", "for", "from",
  "into", "in", "on", "at", "as", "per", "each", "plus",
  // English — amount / prep chatter
  "more", "about", "approx", "adjust", "divided", "needed", "taste",
  "optional", "chopped", "minced", "sliced", "diced", "grated", "ground",
  "crushed", "peeled", "fresh", "freshly", "dried", "large", "small",
  "medium", "ripe", "raw", "cooked", "room", "temperature",
]);

/** Lowercased words of a spelling, punctuation dropped. */
function words(spelling: string): string[] {
  return spelling
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/** Number of letters/digits in `value` (separators don't count towards the
 *  partial-length floor). */
function significantLength(value: string): number {
  return value.replace(/[^\p{L}\p{N}]/gu, "").length;
}

/**
 * Every tail of `spelling` that starts at a later word, in the spelling's own
 * casing and separators: "extra virgin olive oil" → "virgin olive oil",
 * "olive oil", "oil"; "Cherry-Tomaten" → "Tomaten". Single-word spellings
 * yield nothing.
 *
 * Only TAILS, never heads: the identifying noun sits last in both German and
 * English ingredient names ("grüne Linsen", "green lentils"), so a leading
 * word on its own ("grüne", "green") is a descriptor, not the ingredient.
 */
function derivePartials(spelling: string): string[] {
  const starts: number[] = [];
  for (const m of spelling.matchAll(/(?<![\p{L}\p{N}])[\p{L}\p{N}]/gu)) {
    if (m.index !== undefined) starts.push(m.index);
  }
  const out: string[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    const tail = spelling.slice(starts[i]).trim();
    if (significantLength(tail) < MIN_PARTIAL_LENGTH) continue;
    const tailWords = words(tail);
    if (tailWords.length === 0) continue;
    if (FILLER_WORDS.has(tailWords[0])) continue;
    out.push(tail);
  }
  return out;
}

type Group = {
  /** Full spellings — display name, canonical name, aliases. */
  spellings: Set<string>;
  /** True when at least one member row is a primary (not an alternative).
   *  Primaries win a partial that several ingredients could claim. */
  hasPrimary: boolean;
  /** Alternative-group roots already folded into {@link tips}, so a group
   *  whose rows share a root doesn't stack it twice. */
  roots: Set<number>;
  tips: MentionTip[];
};

/** The row that heads `row`'s alternative group — itself when it's a primary. */
function rootOf(row: MentionRow): number {
  return row.alternativeForId ?? row.id;
}

function tipOf(row: MentionRow, emphasis: MealEmphasis): MentionTip {
  return {
    emphasis,
    quantity: row.quantity,
    quantityLow: row.quantityLow,
    quantifierName: row.quantifierName,
    quantifierValue: row.quantifierValue,
    quantifierSource: row.quantifierSource,
    unitLabel: row.unitLabel,
    name: row.ingredientName,
    canonicalName: row.canonicalIngredientName,
    notes: row.notes,
    isOptional: row.isOptional,
    isAlternative: row.alternativeForId != null,
    fixedAmount: row.fixedAmount,
    dietaryClass: row.dietaryClass,
  };
}

/**
 * Build the mention list + tooltip rows for a set of ingredient rows.
 *
 * Callers pass every ingredient the prose could name — for a section's
 * instructions that's the whole recipe, not just that section, because a
 * multi-section import keeps all the steps on the first section. Put the rows
 * that should lead a stacked tooltip first. Ambiguity for partial matches is
 * judged within whatever set is passed: "lentils" resolves to "green lentils"
 * only while nothing else in that set is also lentils.
 *
 * `chosenIngredientIds` is the meal's shopping decision when the recipe was
 * opened for one (`?meal=<id>`) — the row ids that meal put on the list. It
 * only marks up the tooltip; which spelling matches never depends on it.
 */
export function buildIngredientMentions(
  rows: readonly MentionRow[],
  chosenIngredientIds?: ReadonlySet<number>,
): {
  mentions: IngredientMention[];
  tips: MentionTips;
} {
  const groups: Group[] = [];
  const indexByKey = new Map<string, number>();

  const consumables = rows.filter((r) => !r.isEquipment);
  // Alternative groups, keyed by the primary's row id. Primaries sort ahead of
  // their alternatives so the tooltip reads top-down like the ingredient list
  // even if the caller handed us the rows out of order.
  const membersByRoot = new Map<number, MentionRow[]>();
  for (const row of consumables) {
    const root = rootOf(row);
    const members = membersByRoot.get(root) ?? [];
    members.push(row);
    membersByRoot.set(root, members);
  }
  for (const members of membersByRoot.values()) {
    members.sort(
      (a, b) =>
        Number(a.alternativeForId != null) - Number(b.alternativeForId != null),
    );
  }

  for (const row of consumables) {
    const key =
      row.ingredientId != null
        ? `id:${row.ingredientId}`
        : `name:${row.ingredientName.toLowerCase()}`;
    let gi = indexByKey.get(key);
    if (gi === undefined) {
      gi = groups.length;
      indexByKey.set(key, gi);
      groups.push({
        spellings: new Set(),
        hasPrimary: false,
        roots: new Set(),
        tips: [],
      });
    }
    const group = groups[gi];
    if (row.alternativeForId == null) group.hasPrimary = true;
    for (const s of [
      row.ingredientName,
      row.canonicalIngredientName,
      ...row.aliases,
    ]) {
      const spelling = s?.trim();
      if (spelling) group.spellings.add(spelling);
    }
    // Spellings stay this ingredient's own — only the tooltip widens. The
    // whole alternative group goes in, so hitting either "green lentils" or
    // "black lentils" reveals both, and each mention keeps resolving to the
    // ingredient the prose actually named.
    const root = rootOf(row);
    if (!group.roots.has(root)) {
      group.roots.add(root);
      const members = membersByRoot.get(root) ?? [row];
      for (const member of members) {
        group.tips.push(
          tipOf(member, mealEmphasisFor(member, members, chosenIngredientIds)),
        );
      }
    }
  }

  // Full spellings are authoritative: a partial that collides with one is
  // dropped, so "Öl" listed in its own right always wins over the tail of
  // "Olivenöl".
  const fullSpellings = new Set<string>();
  for (const g of groups) {
    for (const s of g.spellings) fullSpellings.add(s.toLowerCase());
  }

  // partialLower → { claiming groups, first spelling seen (for the regex) }.
  const claims = new Map<string, { groups: Set<number>; text: string }>();
  groups.forEach((group, gi) => {
    for (const spelling of group.spellings) {
      for (const partial of derivePartials(spelling)) {
        const lower = partial.toLowerCase();
        if (fullSpellings.has(lower)) continue;
        const claim = claims.get(lower);
        if (claim) claim.groups.add(gi);
        else claims.set(lower, { groups: new Set([gi]), text: partial });
      }
    }
  });

  const extraSpellings = new Map<number, string[]>();
  for (const { groups: claimants, text } of claims.values()) {
    // Unambiguous outright, or ambiguous but claimed by exactly one PRIMARY:
    // "lentils" still resolves to the primary "green lentils" when its own
    // alternative "black lentils" is the only other claimant.
    const primaries = [...claimants].filter((gi) => groups[gi].hasPrimary);
    const winner =
      claimants.size === 1
        ? [...claimants][0]
        : primaries.length === 1
          ? primaries[0]
          : null;
    if (winner === null) continue;
    const list = extraSpellings.get(winner) ?? [];
    list.push(text);
    extraSpellings.set(winner, list);
  }

  return {
    mentions: groups.map((g, index) => ({
      spellings: [...g.spellings, ...(extraSpellings.get(index) ?? [])],
      id: String(index),
    })),
    tips: groups.map((g) => g.tips),
  };
}
