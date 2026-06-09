/**
 * Shared draft shapes + payload mappers for the ingredient ("article") field
 * editors. Used by the full Stammdaten editor (IngredientForm) and the create
 * dialogs (CreateArticleDialog, NewIngredientsDialog) so both produce the exact
 * same `/ingredients/manage`-style payload from the same editor UI.
 */

export type UnitPick = { id: number; name: string } | null;

/**
 * One conversion edge in the editor. Reads "1 ⟨from⟩ = ⟨factor⟩ ⟨to⟩". A
 * container edge (`isContainer`) is the "buy whole packs" rule — the per-
 * component total rounds up to whole ⟨from⟩; a non-container edge is plain
 * normalization (density: "1 ml = 0,5 g"; count breakdown: "1 Stück = 10 Zehe").
 */
export type ConversionDraft = {
  key: string;
  from: UnitPick;
  to: UnitPick;
  factor: string;
  isContainer: boolean;
};

export type AliasDraft = {
  key: string;
  name: string;
  /** Per-alias default global unit. */
  defaultUnit: UnitPick;
  /** Per-alias display rename — shown on recipe rows instead of the alias. */
  displayName: string;
};

export type ConversionPayload = {
  fromUnitId: number;
  toUnitId: number;
  factor: number;
  isContainer: boolean;
};

export type AliasesPayload = {
  aliases: string[];
  aliasUnitDefaults: Array<{
    aliasName: string;
    unitId: number;
    unitDisplay: string;
  }>;
  aliasDisplayNames: Record<string, string>;
};

function freshKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function newConversionDraft(): ConversionDraft {
  return { key: freshKey("new"), from: null, to: null, factor: "1", isContainer: false };
}

export function newAliasDraft(): AliasDraft {
  return { key: freshKey("new"), name: "", defaultUnit: null, displayName: "" };
}

export function conversionDraftsFromItem(
  conversions: Array<{
    id: number;
    fromUnitId: number;
    fromUnitName: string;
    toUnitId: number;
    toUnitName: string;
    factor: number;
    isContainer: boolean;
  }>,
): ConversionDraft[] {
  return conversions.map((c) => ({
    key: `existing-${c.id}`,
    from: { id: c.fromUnitId, name: c.fromUnitName },
    to: { id: c.toUnitId, name: c.toUnitName },
    factor: String(c.factor),
    isContainer: c.isContainer,
  }));
}

export function aliasDraftsFromItem(
  aliases: string[],
  aliasUnitDefaults: Array<{ aliasName: string; unitId: number; unitName: string }>,
  aliasDisplayNames: Record<string, string>,
): AliasDraft[] {
  const defaultsByAliasLower = new Map<string, { id: number; name: string }>();
  for (const d of aliasUnitDefaults) {
    defaultsByAliasLower.set(d.aliasName.toLowerCase(), {
      id: d.unitId,
      name: d.unitName,
    });
  }
  return aliases.map((aliasName) => ({
    key: `existing-${aliasName}`,
    name: aliasName,
    defaultUnit: defaultsByAliasLower.get(aliasName.toLowerCase()) ?? null,
    displayName: aliasDisplayNames[aliasName] ?? "",
  }));
}

/** Map editor drafts to the `conversions` payload, dropping incomplete or
 *  degenerate edges (missing units, same unit on both sides, non-positive
 *  factor). Comma decimals are accepted. */
export function conversionsToPayload(
  conversions: ConversionDraft[],
): ConversionPayload[] {
  return conversions
    .filter((c) => {
      const factor = Number(c.factor.replace(",", "."));
      return (
        c.from != null &&
        c.to != null &&
        c.from.id !== c.to.id &&
        Number.isFinite(factor) &&
        factor > 0
      );
    })
    .map((c) => ({
      fromUnitId: c.from!.id,
      toUnitId: c.to!.id,
      factor: Number(c.factor.replace(",", ".")),
      isContainer: c.isContainer,
    }));
}

/** Map alias drafts to the `aliases` / `aliasUnitDefaults` / `aliasDisplayNames`
 *  payload triplet. Blank alias names are dropped; per-alias default unit and
 *  display rename are only emitted when set. */
export function aliasesToPayload(aliases: AliasDraft[]): AliasesPayload {
  const names: string[] = [];
  const aliasUnitDefaults: AliasesPayload["aliasUnitDefaults"] = [];
  const aliasDisplayNames: Record<string, string> = {};
  for (const alias of aliases) {
    const aliasName = alias.name.trim();
    if (aliasName.length === 0) continue;
    names.push(aliasName);
    if (alias.defaultUnit) {
      aliasUnitDefaults.push({
        aliasName,
        unitId: alias.defaultUnit.id,
        // The picked spelling (a unit alias like "clove", or the canonical).
        unitDisplay: alias.defaultUnit.name,
      });
    }
    const display = alias.displayName.trim();
    if (display.length > 0) aliasDisplayNames[aliasName] = display;
  }
  return { aliases: names, aliasUnitDefaults, aliasDisplayNames };
}
