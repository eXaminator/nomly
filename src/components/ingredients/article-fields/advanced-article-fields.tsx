"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/cn";
import { DefaultUnitField } from "./default-unit-field";
import { ConversionsEditor } from "./conversions-editor";
import { AliasesEditor } from "./aliases-editor";
import { ExcludedSupermarketsField } from "./excluded-supermarkets-field";
import type { Supermarket } from "./excluded-supermarkets-field";
import { useCrossIngredientCollisions } from "./cross-collisions";
import {
  aliasesToPayload,
  conversionsToPayload,
  type AliasDraft,
  type ConversionDraft,
  type UnitPick,
} from "./types";

/** The four "advanced" article fields a create flow can attach to a brand-new
 *  ingredient. Held as editor drafts; mapped to the API payload with
 *  {@link advancedStateToPayload}. */
export type AdvancedArticleState = {
  defaultUnit: UnitPick;
  conversions: ConversionDraft[];
  aliases: AliasDraft[];
  excludedSupermarkets: Supermarket[];
};

export type AdvancedArticlePayload = {
  aliases: string[];
  aliasUnitDefaults: Array<{
    aliasName: string;
    unitId: number;
    unitDisplay: string;
  }>;
  aliasDisplayNames: Record<string, string>;
  conversions: Array<{
    fromUnitId: number;
    toUnitId: number;
    factor: number;
    isContainer: boolean;
  }>;
  defaultUnitId: number | null;
  defaultUnitDisplay: string | null;
  excludedSupermarketIds: number[];
};

export function emptyAdvancedArticleState(): AdvancedArticleState {
  return {
    defaultUnit: null,
    conversions: [],
    aliases: [],
    excludedSupermarkets: [],
  };
}

/** Map the advanced editor state to the `/ingredients/manage`-style payload
 *  fields. Combine with the basic fields (name, category, diet, …) at the call
 *  site. */
export function advancedStateToPayload(
  state: AdvancedArticleState,
): AdvancedArticlePayload {
  const aliasPayload = aliasesToPayload(state.aliases);
  return {
    aliases: aliasPayload.aliases,
    aliasUnitDefaults: aliasPayload.aliasUnitDefaults,
    aliasDisplayNames: aliasPayload.aliasDisplayNames,
    conversions: conversionsToPayload(state.conversions),
    defaultUnitId: state.defaultUnit?.id ?? null,
    defaultUnitDisplay: state.defaultUnit?.name ?? null,
    excludedSupermarketIds: state.excludedSupermarkets.map((s) => s.id),
  };
}

/**
 * Collapsible "Erweitert" section bundling the default-unit, conversions,
 * aliases, and excluded-supermarket editors for the new-ingredient create
 * flows. Controlled — the parent owns the {@link AdvancedArticleState}. Mirrors
 * the editors the full Stammdaten form exposes across its tabs, minus the
 * edit-only swap / rename-propagation affordances.
 *
 * Rendered borderless and full-bleed so it reads as the bottom compartment of
 * its host card/dialog: the header carries the single divider from the fields
 * above (and a second divider below itself once expanded). The host clips the
 * bottom corners and supplies the matching horizontal padding via
 * `paddingXClassName`.
 */
export function AdvancedArticleFields({
  name,
  value,
  onChange,
  defaultOpen,
  className,
  paddingXClassName = "px-3",
}: {
  /** Canonical name being created — feeds alias near-duplicate + cross-
   *  ingredient collision detection. */
  name: string;
  value: AdvancedArticleState;
  onChange: (next: AdvancedArticleState) => void;
  defaultOpen?: boolean;
  className?: string;
  /** Horizontal padding for the header + body, matched to the host container
   *  so the divider spans edge-to-edge and the header aligns with the form. */
  paddingXClassName?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen ?? false);
  // Only look up cross-ingredient collisions once the section is open — keeps
  // a batch of collapsed cards (bulk re-parse) from each firing a request.
  const crossCollisions = useCrossIngredientCollisions(
    [name, ...value.aliases.map((a) => a.name)],
    undefined,
    open,
  );

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className={cn("group", className)}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-2 border-t border-[var(--color-border)] py-2 text-sm font-medium group-open:border-b group-open:border-[var(--color-border)]",
          paddingXClassName,
        )}
      >
        Erweitert
        <ChevronDown className="size-4 text-[var(--color-muted-fg)] transition-transform group-open:rotate-180" />
      </summary>
      <div className={cn("flex flex-col gap-5 py-4", paddingXClassName)}>
        <DefaultUnitField
          value={value.defaultUnit}
          onChange={(defaultUnit) => onChange({ ...value, defaultUnit })}
        />
        <ConversionsEditor
          value={value.conversions}
          onChange={(conversions) => onChange({ ...value, conversions })}
        />
        <AliasesEditor
          value={value.aliases}
          onChange={(aliases) => onChange({ ...value, aliases })}
          name={name}
          crossCollisions={crossCollisions}
        />
        <ExcludedSupermarketsField
          value={value.excludedSupermarkets}
          onChange={(excludedSupermarkets) =>
            onChange({ ...value, excludedSupermarkets })
          }
        />
      </div>
    </details>
  );
}
