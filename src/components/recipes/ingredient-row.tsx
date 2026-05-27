"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowUp,
  CircleCheck,
  CircleHelp,
  CornerDownRight,
  GripVertical,
  Indent,
  Lock,
  Outdent,
  Pencil,
  RotateCw,
  Trash2,
  Unlock,
} from "lucide-react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { EditArticleDrawer } from "@/components/articles/edit-article-drawer";
import { Input } from "@/components/ui/input";
import {
  SelectSearch,
  type SelectSearchItem,
} from "@/components/ui/select-search";
import { cn } from "@/lib/cn";
import { IngredientNameInput } from "./ingredient-name-input";
import type { DraftIngredient, ImportAnnotation } from "./types";
import { ForceMatchPopover } from "./force-match-popover";

/**
 * Mirror of the server-side {@link MIN_AUTO_MATCH_SCORE} (see
 * `src/lib/recipe-import/matching.ts`). The pill selection layer uses it
 * for the "auto-pick when top match clears the gate" rule. Kept in sync
 * manually — bump both when you tune the gate.
 */
const MIN_AUTO_MATCH_SCORE = 135;

async function searchUnits(q: string): Promise<SelectSearchItem[]> {
  const r = await fetch(`/api/v1/units?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const data = (await r.json()) as {
    items: Array<{ id: number; name: string; matchedAlias?: string }>;
  };
  return data.items.map((i) => ({
    id: i.id,
    name: i.name,
    detail:
      i.matchedAlias && i.matchedAlias !== i.name ? `≈ ${i.matchedAlias}` : undefined,
  }));
}

async function createUnit(name: string): Promise<SelectSearchItem> {
  // Inline-created units default to dimension="count" since the import form
  // can't ask the user to pick a dimension. Richer edits live in Epic 7.
  const r = await fetch("/api/v1/units", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, dimension: "count" }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${r.status}`);
  }
  const data = (await r.json()) as { id: number; name: string };
  return { id: data.id, name: data.name };
}

async function loadDefaultUnits(): Promise<SelectSearchItem[]> {
  return searchUnits("");
}

type SubUnitOption = { id: number; name: string; perPurchase: number };

async function loadIngredientSubUnits(name: string): Promise<SubUnitOption[]> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return [];
  const r = await fetch("/api/v1/ingredients/sub-units", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: trimmed }),
  });
  if (!r.ok) return [];
  const data = (await r.json()) as {
    ingredientId: number | null;
    subUnits: SubUnitOption[];
  };
  return data.subUnits;
}

/**
 * Server-side candidate match. Already sorted by `score desc → matchedName
 * length desc → alphabetical` — the UI renders pills in this order without
 * re-sorting client-side.
 */
type ServerMatch = {
  ingredientId: number;
  canonicalName: string;
  matchedName: string;
  score: number;
  /** Raw text of candidate tokens NOT covered by this match — moved into the
   *  notes field when the user picks this pill. Empty when the match covers
   *  every token of the candidate. */
  uncoveredText: string;
  /** True when the underlying ingredient is flagged as equipment. The pill
   *  click and auto-select rule default `isOptional` to true on first
   *  resolution to equipment — matching the import-time behavior. */
  isEquipment: boolean;
};

/**
 * Synthetic id used inside the unit picker so global units and ingredient
 * sub-units can share `SelectSearchItem.id: number`. Positive ids are
 * global unit row ids (unit.id is always > 0); negative ids encode a
 * sub-unit by `-(subUnit.id)`. Sub-unit row ids are always > 0 too, so the
 * sign uniquely distinguishes the kinds without a separate field.
 */
function subUnitPickerId(subUnitId: number): number {
  return -subUnitId;
}
function isSubUnitPickerId(id: number): boolean {
  return id < 0;
}

/**
 * Remove each whitespace-separated token in `uncoveredText` from `name`
 * (case-insensitive, first occurrence only per token). Used when the user
 * picks a pill whose match did not cover the full name input — e.g.
 * "Paprikaschote rote" minus "rote" → "Paprikaschote". Punctuation that
 * surrounded the removed token (commas, dashes) is also tidied so the
 * resulting name doesn't read as "Paprikaschote, " or "Paprikaschote -".
 */
function subtractTokensFromName(name: string, uncoveredText: string): string {
  const toRemove = uncoveredText
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
  if (toRemove.length === 0) return name;
  const parts = name.split(/(\s+|[,;])/u);
  const remainingToRemove = new Map<string, number>();
  for (const t of toRemove) {
    remainingToRemove.set(t, (remainingToRemove.get(t) ?? 0) + 1);
  }
  const kept: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase().replace(/[.,;]+$/, "");
    const count = remainingToRemove.get(lower);
    if (count && count > 0) {
      remainingToRemove.set(lower, count - 1);
      continue;
    }
    kept.push(part);
  }
  // Tidy stranded separators: leading/trailing whitespace/punctuation and
  // double-separators left behind by the removals.
  return kept
    .join("")
    .replace(/\s*[,;]\s*[,;]\s*/g, ", ")
    .replace(/^[\s,;-]+|[\s,;-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Append a string to the notes field with a comma separator when both
 *  sides are non-empty. Trims and dedups consecutive separators. */
function appendToNotes(existing: string, addition: string): string {
  const a = existing.trim();
  const b = addition.trim();
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return `${a}, ${b}`;
}

type Props = {
  value: DraftIngredient;
  onChange: (next: DraftIngredient) => void;
  onRemove: () => void;
  /** Insert a new empty alternative attached to this row's primary group.
   *  Only callable on primary rows — alternatives can't have their own
   *  alternatives. */
  onAddAlternative?: () => void;
  /** Make this primary row an alternative of the row immediately above
   *  it. Undefined (button hidden) when not applicable — see
   *  {@link IngredientGroup} for the rules. */
  onDemote?: () => void;
  /** Swap this alternative with its primary: the alt takes over leadership,
   *  the old primary joins as an alternative. The group stays intact.
   *  Only rendered when `value.isAlternative`. */
  onPromote?: () => void;
  /** Detach an alternative to become its own standalone primary, placed
   *  right after the old group's last sibling. Only rendered when
   *  `value.isAlternative`. */
  onDetach?: () => void;
  /** Drag handle props from the parent {@link IngredientGroup}'s
   *  `useSortable`. Only passed to primary rows — alternatives ride along
   *  inside the same draggable container and don't have their own grip. */
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  /** "staple" drops the recipe-only chrome (drag handle, optional toggle,
   *  amount lock, alternatives) but keeps the full ingredient-matching flow.
   *  Defaults to the recipe layout. */
  variant?: "recipe" | "staple";
};

export function IngredientRow({
  value,
  onChange,
  onRemove,
  onAddAlternative,
  onDemote,
  onPromote,
  onDetach,
  dragAttributes,
  dragListeners,
  variant = "recipe",
}: Props) {
  const [defaultUnits, setDefaultUnits] = React.useState<SelectSearchItem[]>([]);
  React.useEffect(() => {
    void loadDefaultUnits().then(setDefaultUnits);
  }, []);
  const [editingArticleId, setEditingArticleId] = React.useState<number | null>(
    null,
  );

  // Whenever the ingredient name settles (canonicalName is set OR the typed
  // name matches an existing row), fetch that ingredient's sub-units. They
  // are merged into the unit picker via `searchUnitsAndSubUnits` below so
  // the user can pick Zehe / Zweig / … like any other unit. Debounced so
  // each keystroke doesn't fire a network round-trip.
  const [subUnitOptions, setSubUnitOptions] = React.useState<SubUnitOption[]>([]);
  const subUnitNameRef = React.useRef<string>("");
  React.useEffect(() => {
    const name = value.canonicalName ?? value.name;
    if (name === subUnitNameRef.current) return;
    subUnitNameRef.current = name;
    const handle = window.setTimeout(() => {
      void loadIngredientSubUnits(name).then((opts) => {
        if (subUnitNameRef.current === name) setSubUnitOptions(opts);
      });
    }, 200);
    return () => window.clearTimeout(handle);
  }, [value.name, value.canonicalName]);

  // Stable ref so the picker's `search` callback can read the freshest
  // sub-unit list without forcing the SelectSearch effect to re-fire.
  const subUnitOptionsRef = React.useRef(subUnitOptions);
  React.useEffect(() => {
    subUnitOptionsRef.current = subUnitOptions;
  });

  // Live candidate matches for the typed text. Debounced + abortable so a
  // slow response from "tom" can't overwrite the result for "tomatoes".
  // The seed comes from the parsed-row payload when present so an
  // import-review row renders its pills on first paint without waiting
  // for the matcher round-trip.
  const [serverMatches, setServerMatches] = React.useState<ServerMatch[]>(
    () => {
      // Import flow: server-provided candidates have full-line context
      // (incl. comma-tail). Use them verbatim.
      if (value.candidates.length > 0) {
        return value.candidates.map((c) => ({
          ingredientId: c.ingredientId,
          canonicalName: c.canonicalName,
          // Preserve the alias name the matcher actually hit on so the
          // pill UI can surface "TK Erbsen" (alias) → canonical "Erbsen",
          // rather than collapsing both to the canonical.
          matchedName: c.matchedName,
          score: c.score,
          uncoveredText: c.uncoveredText,
          isEquipment: c.isEquipment,
        }));
      }
      // Edit flow: an existing recipe row carries `selectedIngredientId`
      // (from the saved row's ingredient_id) but no candidates — we
      // didn't run the matcher at load time. Synthesize a single-entry
      // candidate so the pill UI shows the row's current link
      // ("Erbsen" displayed, linked to TK Erbsen canonical) and the
      // first-render skip in the re-match effect engages. The synthetic
      // score is high enough to never get auto-overwritten by a later
      // re-match's sticky/threshold rules.
      if (value.selectedIngredientId != null) {
        const label = value.canonicalName ?? value.name;
        return [
          {
            ingredientId: value.selectedIngredientId,
            canonicalName: value.canonicalName ?? value.name,
            matchedName: label,
            score: 999,
            // Edit-flow synthetic — no live matcher info, treat as fully
            // covered so the pill click is a no-op on name/notes.
            uncoveredText: "",
            // Equipment status is unknown at synth time; the live matcher's
            // first response will fill it in. Defaulting to false here
            // avoids accidentally flipping isOptional on initial render.
            isEquipment: false,
          },
        ];
      }
      return [];
    },
  );
  const onChangeRef = React.useRef(onChange);
  const valueRef = React.useRef(value);
  React.useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  });
  // Always re-fetch the live matcher so the pill row shows alternative
  // candidates the user could pick. The `seededNameRef` only gates the
  // auto-select side effect: while the input still equals what the row
  // was seeded with (import or edit), the row's selection is preserved —
  // typing into the input is the only signal that warrants re-evaluating
  // the selection.
  //
  // Additionally, when the live matcher (which sees only the input text,
  // never the original comma-tail) drops the currently-selected ingredient
  // from its results, we prepend it back so the user can still see and
  // re-pick it. Without this, e.g. an edit-time row linked to "TK Erbsen"
  // with input "Erbsen" would lose the TK Erbsen pill the moment the
  // matcher's narrower view came back.
  const seededNameRef = React.useRef(value.name);
  React.useEffect(() => {
    const name = value.name.trim();
    if (name.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setServerMatches([]);
      return;
    }
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/v1/ingredients/match", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: name }),
          signal: controller.signal,
        });
        if (!r.ok) return;
        const data = (await r.json()) as { matches: ServerMatch[] };
        if (controller.signal.aborted) return;
        const v = valueRef.current;
        const hasUserEdited = value.name !== seededNameRef.current;
        // Preserve the currently-selected ingredient in the pill list
        // even when the narrower live matcher didn't surface it.
        let merged: ServerMatch[] = data.matches;
        if (v.selectedIngredientId != null) {
          const stillIn = data.matches.some(
            (m) => m.ingredientId === v.selectedIngredientId,
          );
          if (!stillIn) {
            const label = v.canonicalName ?? v.name;
            merged = [
              {
                ingredientId: v.selectedIngredientId,
                canonicalName: v.canonicalName ?? v.name,
                matchedName: label,
                score: 999,
                // Synthetic pin — name/notes are already in the user's
                // intended state; treat as fully covered so re-picking
                // this pill doesn't shuffle text around.
                uncoveredText: "",
                // Equipment flag isn't surfaced by the synthetic pin path
                // (the live matcher dropped it). The user already has the
                // row in their preferred state, so default to false to
                // avoid re-flipping isOptional.
                isEquipment: false,
              },
              ...data.matches,
            ];
          }
        }
        setServerMatches(merged);
        // Auto-select rules only re-fire when the user has actually
        // edited the input. Otherwise the row's saved selection stays
        // untouched no matter what the narrower live matcher returns.
        if (hasUserEdited) {
          const next = applyAutoSelect(v, name, data.matches);
          if (
            next.selectedIngredientId !== v.selectedIngredientId ||
            next.canonicalName !== v.canonicalName ||
            next.isOptional !== v.isOptional
          ) {
            onChangeRef.current(next);
          }
        }
      } catch {
        // Aborted or network error — leave state alone.
      }
    }, 200);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [value.name]);

  /** Combined picker: ingredient's sub-units first (when present), then
   *  global units matching the query. Sub-units get negative synthetic ids;
   *  the onChange handler decodes them. */
  const searchUnitsAndSubUnits = React.useCallback(
    async (q: string): Promise<SelectSearchItem[]> => {
      const lower = q.trim().toLowerCase();
      const subItems: SelectSearchItem[] = subUnitOptionsRef.current
        .filter(
          (s) => lower.length === 0 || s.name.toLowerCase().includes(lower),
        )
        .map((s) => ({ id: subUnitPickerId(s.id), name: s.name }));
      const globalUnits = await searchUnits(q);
      return [...subItems, ...globalUnits];
    },
    [],
  );

  /** Build the items shown in the picker before the user starts typing.
   *  Sub-units always lead so a freshly-resolved ingredient (Knoblauch,
   *  Petersilie, …) surfaces "Zehe" / "Zweig" right away. */
  const defaultItemsCombined = React.useMemo<SelectSearchItem[]>(() => {
    const subItems = subUnitOptions.map((s) => ({
      id: subUnitPickerId(s.id),
      name: s.name,
    }));
    return [...subItems, ...defaultUnits];
  }, [defaultUnits, subUnitOptions]);

  /** Whichever side (unit / sub-unit) is currently set becomes the picker's
   *  selected value. */
  const pickerValue: SelectSearchItem | null = value.subUnit
    ? { id: subUnitPickerId(value.subUnit.id), name: value.subUnit.name }
    : value.unit;

  function onPickUnit(picked: SelectSearchItem | null) {
    if (!picked) {
      onChange({
        ...value,
        unit: null,
        subUnit: null,
        importAnnotation: clearAnnotationOn(value.importAnnotation, "unit"),
      });
      return;
    }
    if (isSubUnitPickerId(picked.id)) {
      onChange({
        ...value,
        unit: null,
        subUnit: { id: -picked.id, name: picked.name },
        importAnnotation: clearAnnotationOn(value.importAnnotation, "unit"),
      });
      return;
    }
    onChange({
      ...value,
      unit: { id: picked.id, name: picked.name },
      subUnit: null,
      importAnnotation: clearAnnotationOn(value.importAnnotation, "unit"),
    });
  }

  /** Click on a candidate pill: select that ingredient and delegate any
   *  tokens the match did NOT cover into the notes field. The row's
   *  display_name keeps the user's spelling minus the uncovered tokens
   *  ("Paprikaschote rote" + pick Paprikaschoten → name "Paprikaschote",
   *  note "rote"); `ingredient_id` links to the picked canonical. When
   *  uncoveredText is empty the name is preserved verbatim, matching the
   *  prior behavior for clean covers.
   *
   *  Equipment-flagged ingredients (Backpapier, Backform, …) default the
   *  row to isOptional=true on first resolution, mirroring the import-time
   *  parser behavior. A user-toggled isOptional=true is left in place;
   *  we never auto-unset. */
  function selectCandidate(c: ServerMatch) {
    const nextName = c.uncoveredText
      ? subtractTokensFromName(value.name, c.uncoveredText)
      : value.name;
    const nextNotes = c.uncoveredText
      ? appendToNotes(value.notes, c.uncoveredText)
      : value.notes;
    onChange({
      ...value,
      name: nextName,
      notes: nextNotes,
      selectedIngredientId: c.ingredientId,
      canonicalName:
        nextName.toLowerCase() === c.canonicalName.toLowerCase()
          ? null
          : c.canonicalName,
      isOptional: value.isOptional || c.isEquipment,
      // Clicking a regular candidate clears any force-match alias intent.
      addAsAlias: false,
      importAnnotation: clearAnnotationOn(value.importAnnotation, "ingredient"),
    });
  }

  /** Click on the synthetic "Neu" pill: row becomes a new-ingredient row. */
  function selectNew() {
    onChange({
      ...value,
      selectedIngredientId: null,
      canonicalName: null,
      addAsAlias: false,
    });
  }

  /** The ↻ icon on a candidate pill: copy the pill's displayed text into
   *  the name input. That's the matched alias name when an alias hit
   *  drove the candidate (so "TK Erbsen" lands in the input), or the
   *  canonical when there was no alias. Selection stays on this
   *  candidate — the sticky rule preserves it through the re-match that
   *  the text change triggers. */
  function useCanonicalInName(c: ServerMatch) {
    const label = c.matchedName || c.canonicalName;
    onChange({
      ...value,
      name: label,
      canonicalName:
        label.toLowerCase() === c.canonicalName.toLowerCase()
          ? null
          : c.canonicalName,
      selectedIngredientId: c.ingredientId,
      addAsAlias: false,
    });
  }

  /** Force-match: user pinned the row to a specific ingredient via the +
   *  picker. Optionally persists the current input as an alias on save. */
  function forceMatch(
    ingredientId: number,
    canonical: string,
    addAsAlias: boolean,
  ) {
    onChange({
      ...value,
      selectedIngredientId: ingredientId,
      canonicalName:
        value.name.toLowerCase() === canonical.toLowerCase() ? null : canonical,
      addAsAlias,
      importAnnotation: clearAnnotationOn(value.importAnnotation, "ingredient"),
    });
  }

  // When the user edits a field, the matching badge from the import is no
  // longer accurate. Drop the relevant flag — but keep the rest of the
  // annotation so the row still surfaces what hasn't been resolved.
  function clearAnnotationOn(
    annotation: ImportAnnotation | undefined,
    field: "ingredient" | "unit",
  ): ImportAnnotation | undefined {
    if (!annotation) return annotation;
    if (field === "ingredient" && annotation.ingredientIsNew) {
      const next = { ...annotation, ingredientIsNew: false };
      if (!annotationShowsAnything(next)) return undefined;
      return next;
    }
    if (field === "unit" && annotation.unitState !== "ok") {
      const next: ImportAnnotation = {
        ...annotation,
        unitState: "ok",
        rawUnit: null,
      };
      if (!annotationShowsAnything(next)) return undefined;
      return next;
    }
    return annotation;
  }

  if (variant === "staple") {
    return (
      <div className="grid items-start gap-2 grid-cols-[4rem_minmax(0,1fr)_auto] md:grid-cols-[5rem_8rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input
          inputMode="decimal"
          placeholder="Menge"
          value={value.quantity}
          onChange={(e) => onChange({ ...value, quantity: e.target.value })}
          aria-label="Menge"
          className="col-start-1 row-start-1"
        />
        <div className="col-start-2 col-span-2 row-start-1 md:col-span-1">
          <SelectSearch
            value={pickerValue}
            onChange={onPickUnit}
            search={searchUnitsAndSubUnits}
            defaultItems={defaultItemsCombined}
            placeholder="Einheit"
            onCreate={createUnit}
            createLabelPrefix="als Einheit anlegen"
          />
        </div>
        <IngredientNameInput
          value={value.name}
          onChange={(name, canonical) =>
            onChange({
              ...value,
              name,
              canonicalName:
                canonical === undefined ? value.canonicalName : canonical,
            })
          }
          placeholder="Zutat"
          className="col-start-1 col-span-3 row-start-2 md:col-start-3 md:col-span-1 md:row-start-1"
        />
        <Input
          placeholder="Notiz"
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          aria-label="Notiz"
          className="col-start-1 col-span-2 row-start-3 md:col-start-4 md:col-span-1 md:row-start-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="Zutat entfernen"
          className="col-start-3 row-start-3 self-center text-[var(--color-danger)] md:col-start-5 md:row-start-1"
        >
          <Trash2 className="size-4" />
        </Button>
        <div className="col-start-1 col-span-3 row-start-4 md:col-start-3 md:col-span-2 md:row-start-2">
          <CandidatePills
            name={value.name}
            candidates={serverMatches}
            selectedIngredientId={value.selectedIngredientId}
            selectedCanonicalName={value.canonicalName}
            addAsAlias={value.addAsAlias}
            onSelectCandidate={selectCandidate}
            onSelectNew={selectNew}
            onUseCanonical={useCanonicalInName}
            onForceMatch={forceMatch}
            onEditArticle={setEditingArticleId}
          />
        </div>
        {editingArticleId != null ? (
          <EditArticleDrawer
            ingredientId={editingArticleId}
            onClose={() => setEditingArticleId(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        // Each row carries its own vertical breathing room; the divider
        // line is drawn by the parent's `divide-y`. Symmetric `py-3` on
        // EVERY row (no first/last collapse) so the "Original:" hint and
        // the row's content always sit ≥12px clear of the divider above
        // and below — collapsing the padding made the hint touch the
        // border between rows.
        "flex items-start gap-2 py-3",
      )}
    >
      {value.isAlternative ? (
        // Alternatives ride inside the primary's draggable container, so
        // no grip on this row. The grip slot is preserved as empty space
        // so the alt's content starts at the same x as the primary's, and
        // the trailing arrow sits at the start-of-Qty column for visual
        // indent ("the arrow IS the indentation").
        <>
          <span
            aria-hidden="true"
            className="mt-1.5 inline-flex h-8 w-6 shrink-0"
          />
          <span
            aria-hidden="true"
            className="mt-1.5 inline-flex h-8 w-6 shrink-0 items-center justify-center text-[var(--color-muted-fg)]"
          >
            <CornerDownRight className="size-4" />
          </span>
        </>
      ) : (
        <button
          type="button"
          {...(dragAttributes ?? {})}
          {...(dragListeners ?? {})}
          aria-label="Zutat per Drag-and-Drop verschieben"
          title="Ziehen, um die Zutatgruppe umzuordnen oder in einen anderen Abschnitt zu verschieben"
          className="mt-1.5 inline-flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <div className="flex flex-1 min-w-0 flex-col gap-1">
    {value.isAlternative ? (
      <p className="text-xs italic text-[var(--color-muted-fg)]">
        Alternative
      </p>
    ) : null}
    {value.rawText ? (
      <p
        className="truncate text-xs text-[var(--color-muted-fg)]"
        title={value.rawText}
      >
        Original: „{value.rawText}“
      </p>
    ) : null}
    <div
      className="grid items-start gap-2 grid-cols-[4rem_minmax(0,1fr)_auto_auto_auto_auto_auto] md:grid-cols-[5rem_8rem_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto_auto_auto]"
    >
      {/* Mobile flow (3 rows): [Qty | Unit cs-4]  ·  [Name cs-5]  ·
          [Notes cs-2 | Opt | Fix | Trash]. Giving Unit the leftover row-1
          width keeps "Stück"/"Esslöffel" readable; before, a 1fr unit cell
          was getting squeezed to ~70px next to the icon buttons.
          Desktop (md+) stays a single-row 7-col grid. */}
      <Input
        inputMode="decimal"
        placeholder="Menge"
        value={value.quantity}
        onChange={(e) => onChange({ ...value, quantity: e.target.value })}
        aria-label="Menge"
      />
      <div className="col-span-4 flex flex-col gap-1 md:col-span-1 md:col-start-2 md:row-start-1">
        <SelectSearch
          value={pickerValue}
          onChange={onPickUnit}
          search={searchUnitsAndSubUnits}
          defaultItems={defaultItemsCombined}
          placeholder="Einheit"
          onCreate={createUnit}
          createLabelPrefix="als Einheit anlegen"
        />
        <UnitBadge annotation={value.importAnnotation} />
      </div>
      <IngredientNameInput
        value={value.name}
        onChange={(name, canonical) =>
          onChange({
            ...value,
            name,
            // When `canonical` is undefined, leave the existing value
            // alone (the user is still typing in-place); when it's an
            // explicit `null` the input is telling us to clear it; when
            // it's a string, an alias was picked.
            canonicalName:
              canonical === undefined ? value.canonicalName : canonical,
            importAnnotation: clearAnnotationOn(value.importAnnotation, "ingredient"),
          })
        }
        placeholder="Zutat"
        className="col-span-5 md:col-span-1 md:col-start-3 md:row-start-1"
      />
      <Input
        placeholder="Notiz (z. B. fein gehackt)"
        value={value.notes}
        onChange={(e) => onChange({ ...value, notes: e.target.value })}
        aria-label="Notiz"
        className="col-span-2 md:col-span-1 md:col-start-4 md:row-start-1"
      />
      {/* CandidatePills live in their own grid row that spans the Name +
          Notes columns on desktop (and the full mobile width). Used to
          sit inside the Name column's flex-col which constrained the
          pill row to the Name input's width and forced long suggestion
          lists to wrap awkwardly. */}
      <div className="col-span-7 md:col-span-2 md:col-start-3 md:row-start-2">
        <CandidatePills
          name={value.name}
          candidates={serverMatches}
          selectedIngredientId={value.selectedIngredientId}
          selectedCanonicalName={value.canonicalName}
          addAsAlias={value.addAsAlias}
          onSelectCandidate={selectCandidate}
          onSelectNew={selectNew}
          onUseCanonical={useCanonicalInName}
          onForceMatch={forceMatch}
          onEditArticle={setEditingArticleId}
        />
      </div>
      {editingArticleId != null ? (
        <EditArticleDrawer
          ingredientId={editingArticleId}
          onClose={() => setEditingArticleId(null)}
        />
      ) : null}
      {value.isAlternative ? (
        // Alternatives are inherently optional — they never get the
        // toggle. Reserved empty slot keeps the grid columns aligned with
        // primary rows.
        <span
          aria-hidden="true"
          className="col-start-3 h-9 w-9 md:col-start-5 md:row-start-1 md:h-11 md:w-11"
        />
      ) : (
        <Button
          variant={value.isOptional ? "secondary" : "ghost"}
          size="icon"
          onClick={() => onChange({ ...value, isOptional: !value.isOptional })}
          aria-pressed={value.isOptional}
          aria-label={
            value.isOptional
              ? "Optional-Markierung entfernen"
              : "Als optional markieren"
          }
          title={
            value.isOptional
              ? "Optional – wird im Rezept gedimmt angezeigt und beim Einkaufslisten-Aufbau übersprungen."
              : "Als optional markieren"
          }
          className="col-start-3 h-9 w-9 md:col-start-5 md:row-start-1 md:h-11 md:w-11"
        >
          {value.isOptional ? (
            <CircleHelp className="size-4" />
          ) : (
            <CircleCheck className="size-4" />
          )}
        </Button>
      )}
      <Button
        variant={value.fixedAmount ? "secondary" : "ghost"}
        size="icon"
        onClick={() => onChange({ ...value, fixedAmount: !value.fixedAmount })}
        aria-pressed={value.fixedAmount}
        aria-label={
          value.fixedAmount
            ? "Feste Menge – Portionen-Skalierung wieder aktivieren"
            : "Menge unabhängig von Portionen markieren"
        }
        title={
          value.fixedAmount
            ? "Feste Menge – wird bei geänderter Portionsanzahl nicht skaliert."
            : "Menge unabhängig von Portionen markieren (z. B. eine Prise Salz)."
        }
        className="col-start-4 h-9 w-9 md:col-start-6 md:row-start-1 md:h-11 md:w-11"
      >
        {value.fixedAmount ? (
          <Lock className="size-4" />
        ) : (
          <Unlock className="size-4" />
        )}
      </Button>
      {/* Indent/Outdent pair at col 5/7:
            - Primary with onDemote → Indent (become alt of prior)
            - Alt with onDetach → Outdent (leave the group as standalone) */}
      {value.isAlternative ? (
        onDetach ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDetach}
            aria-label="Zur eigenständigen Zutat machen"
            title="Macht diese Alternative zu einer eigenen Zutat. Sie verlässt die Gruppe und steht direkt darunter."
            className="col-start-5 h-9 w-9 md:col-start-7 md:row-start-1 md:h-11 md:w-11"
          >
            <Outdent className="size-4" />
          </Button>
        ) : (
          <span
            aria-hidden="true"
            className="col-start-5 h-9 w-9 md:col-start-7 md:row-start-1 md:h-11 md:w-11"
          />
        )
      ) : onDemote ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={onDemote}
          aria-label="Als Alternative der vorherigen Zutat einordnen"
          title="Macht diese Zutat zu einer Alternative der Zutat darüber."
          className="col-start-5 h-9 w-9 md:col-start-7 md:row-start-1 md:h-11 md:w-11"
        >
          <Indent className="size-4" />
        </Button>
      ) : (
        <span
          aria-hidden="true"
          className="col-start-5 h-9 w-9 md:col-start-7 md:row-start-1 md:h-11 md:w-11"
        />
      )}
      {/* Col 6/8: row-type-specific verb.
            - Primary with onAddAlternative → CornerDownRight (add child)
            - Alt with onPromote → ArrowUp (swap with current primary;
              keeps the group, just changes who leads) */}
      {!value.isAlternative && onAddAlternative ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={onAddAlternative}
          aria-label="Alternative hinzufügen"
          title="Eine alternative Zutat unter dieser Zutat hinzufügen. Alternativen sind immer optional."
          className="col-start-6 h-9 w-9 md:col-start-8 md:row-start-1 md:h-11 md:w-11"
        >
          <CornerDownRight className="size-4" />
        </Button>
      ) : value.isAlternative && onPromote ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={onPromote}
          aria-label="Mit Hauptzutat tauschen"
          title="Tauscht diese Alternative mit der Hauptzutat: die Alternative wird die neue Hauptzutat, die alte Hauptzutat wird zur Alternative."
          className="col-start-6 h-9 w-9 md:col-start-8 md:row-start-1 md:h-11 md:w-11"
        >
          <ArrowUp className="size-4" />
        </Button>
      ) : (
        <span
          aria-hidden="true"
          className="col-start-6 h-9 w-9 md:col-start-8 md:row-start-1 md:h-11 md:w-11"
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="Zutat entfernen"
        className="col-start-7 h-9 w-9 md:col-start-9 md:row-start-1 md:h-11 md:w-11"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
      </div>
    </div>
  );
}

/**
 * Auto-select rules applied after each match response:
 *   1. Sticky: keep the previous selectedIngredientId if it still appears
 *      in the new candidate set.
 *   2. Exact: typed text equals a candidate's canonicalName (case-insensitive).
 *   3. Above threshold: top candidate's score clears MIN_AUTO_MATCH_SCORE.
 *   4. Fallback: "Neu" (selectedIngredientId = null).
 *
 * Returns a new DraftIngredient with the selection applied. Callers should
 * compare against the previous value to avoid unnecessary onChange churn.
 */
function applyAutoSelect(
  current: DraftIngredient,
  typedName: string,
  matches: ServerMatch[],
): DraftIngredient {
  // Rule 1: sticky. We keep the selection but DON'T re-apply the equipment
  // → isOptional default: the user has had a chance to toggle it manually
  // since the original resolution, and re-asserting on every keystroke
  // would clobber that toggle.
  if (current.selectedIngredientId != null) {
    const hit = matches.find(
      (m) => m.ingredientId === current.selectedIngredientId,
    );
    if (hit) {
      return {
        ...current,
        canonicalName:
          typedName.trim().toLowerCase() === hit.canonicalName.toLowerCase()
            ? null
            : hit.canonicalName,
      };
    }
    // Previous selection vanished — clear and re-evaluate below.
  }
  const trimmedLower = typedName.trim().toLowerCase();
  // Rule 2: exact.
  const exact = matches.find(
    (m) =>
      m.canonicalName.toLowerCase() === trimmedLower ||
      m.matchedName.toLowerCase() === trimmedLower,
  );
  if (exact) {
    return {
      ...current,
      selectedIngredientId: exact.ingredientId,
      canonicalName:
        trimmedLower === exact.canonicalName.toLowerCase()
          ? null
          : exact.canonicalName,
      isOptional: current.isOptional || exact.isEquipment,
      addAsAlias: false,
    };
  }
  // Rule 3: above threshold (matches are already sorted, so matches[0] is top).
  const top = matches[0];
  if (top && top.score >= MIN_AUTO_MATCH_SCORE) {
    return {
      ...current,
      selectedIngredientId: top.ingredientId,
      canonicalName:
        trimmedLower === top.canonicalName.toLowerCase()
          ? null
          : top.canonicalName,
      isOptional: current.isOptional || top.isEquipment,
      addAsAlias: false,
    };
  }
  // Rule 4: Neu.
  return {
    ...current,
    selectedIngredientId: null,
    canonicalName: null,
    addAsAlias: false,
  };
}

function annotationShowsAnything(a: ImportAnnotation): boolean {
  return (
    a.ingredientIsNew ||
    a.unitState === "defaulted" ||
    a.unitState === "unresolved"
  );
}

/**
 * Renders the candidate pills + "Neu" fallback + force-match (+) button.
 * Pills come pre-sorted from the server (score desc → matchedName length
 * desc → alphabetical). One pill is always conceptually selected:
 *   - a real candidate when `selectedIngredientId` matches its id, or
 *   - the synthetic "Neu" pill when `selectedIngredientId` is null.
 */
function CandidatePills({
  name,
  candidates,
  selectedIngredientId,
  selectedCanonicalName,
  addAsAlias,
  onSelectCandidate,
  onSelectNew,
  onUseCanonical,
  onForceMatch,
  onEditArticle,
}: {
  name: string;
  candidates: ServerMatch[];
  selectedIngredientId: number | null;
  /** Canonical name of the currently-selected ingredient, when it differs
   *  from the row's typed text. Surfaces on the anchor pill so a force-
   *  matched row shows WHICH ingredient it's pinned to. */
  selectedCanonicalName: string | null;
  addAsAlias: boolean;
  onSelectCandidate: (c: ServerMatch) => void;
  onSelectNew: () => void;
  onUseCanonical: (c: ServerMatch) => void;
  onForceMatch: (
    ingredientId: number,
    canonical: string,
    addAsAlias: boolean,
  ) => void;
  onEditArticle: (ingredientId: number) => void;
}) {
  const trimmed = name.trim();
  // Hide the whole pill row when there's nothing to interact with — no
  // typed text + no candidates + no selection yet.
  if (
    trimmed.length === 0 &&
    candidates.length === 0 &&
    selectedIngredientId == null
  ) {
    return null;
  }
  const isNewSelected = selectedIngredientId == null;
  // The pill the force-match popover sits next to a forced ingredient that
  // isn't in the candidate list. Surface it as its own pill so the user can
  // see which ingredient the row is pinned to.
  const selectedOutOfList =
    selectedIngredientId != null &&
    !candidates.some((c) => c.ingredientId === selectedIngredientId);

  return (
    <div className="flex flex-wrap gap-1">
      {candidates.map((c) => {
        const isCurrent = c.ingredientId === selectedIngredientId;
        // The matcher carries both names: `canonicalName` is the underlying
        // identity, `matchedName` is the catalog row that actually hit
        // (often an alias). Render canonical first so the user sees WHAT
        // the row resolves to, with the alias in parens when it differs so
        // they also see WHY it matched ("Erbsen (TK Erbsen)").
        const aliasDiffers =
          c.matchedName.length > 0 &&
          c.matchedName.toLowerCase() !== c.canonicalName.toLowerCase();
        return (
          <CandidatePill
            key={c.ingredientId}
            ingredientId={c.ingredientId}
            canonicalName={c.canonicalName}
            aliasName={aliasDiffers ? c.matchedName : null}
            isSelected={isCurrent}
            onSelect={() => onSelectCandidate(c)}
            onUseCanonical={() => onUseCanonical(c)}
            onEditArticle={onEditArticle}
          />
        );
      })}
      {selectedOutOfList && selectedIngredientId != null ? (
        <span className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-[var(--color-accent)] text-xs text-[var(--color-accent-fg)]">
          <span
            className="max-w-full truncate py-0.5 pl-2 pr-1"
            title={
              addAsAlias
                ? `Diese Zeile ist fest mit einer Zutat verknüpft — "${trimmed}" wird beim Speichern als Alias hinzugefügt.`
                : "Diese Zeile ist fest mit einer Zutat verknüpft."
            }
          >
            {selectedCanonicalName ?? trimmed}
            {addAsAlias ? (
              <span className="ml-1 text-[0.65rem]">+ Alias</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => onEditArticle(selectedIngredientId)}
            className="shrink-0 rounded-full px-1.5 py-1 hover:bg-[color-mix(in_srgb,var(--color-accent-fg),var(--color-accent)_75%)]"
            title="Artikel bearbeiten"
            aria-label="Artikel bearbeiten"
          >
            <Pencil className="size-3" />
          </button>
        </span>
      ) : null}
      <NewPill
        label={trimmed.length > 0 ? `Neu: ${trimmed}` : "Neu"}
        isSelected={isNewSelected}
        disabled={trimmed.length === 0}
        onSelect={onSelectNew}
      />
      <ForceMatchPopover onPick={onForceMatch} typedName={trimmed} />
    </div>
  );
}

function CandidatePill({
  ingredientId,
  canonicalName,
  aliasName,
  isSelected,
  onSelect,
  onUseCanonical,
  onEditArticle,
}: {
  ingredientId: number;
  canonicalName: string;
  /** Alias the matcher hit on, when it differs from the canonical. Rendered
   *  in parens after the canonical so the user sees both WHAT the row
   *  resolves to and WHY it matched. `null` means the match hit the
   *  canonical directly — render just the canonical. */
  aliasName: string | null;
  isSelected: boolean;
  onSelect: () => void;
  onUseCanonical: () => void;
  onEditArticle: (ingredientId: number) => void;
}) {
  // The pill's primary action (select) keys off the canonical identity, so
  // tooltips lead with the canonical. The "↻" action copies the alias name
  // into the input (or the canonical when no alias is involved) — keep its
  // tooltip aligned with what actually lands in the field.
  const copyTarget = aliasName ?? canonicalName;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 rounded-full text-xs transition-colors",
        isSelected
          ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
          : "bg-[var(--color-muted)] text-[var(--color-fg)]",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "max-w-full truncate rounded-full py-0.5 pl-2 pr-1",
          !isSelected &&
            "hover:bg-[color-mix(in_srgb,var(--color-accent),var(--color-bg)_75%)]",
        )}
        title={
          isSelected
            ? `Aktuell ausgewählt: „${canonicalName}".`
            : `„${canonicalName}" als Zutat verwenden.`
        }
      >
        {canonicalName}
        {aliasName ? (
          <span className="ml-1 opacity-70">({aliasName})</span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={onUseCanonical}
        className={cn(
          "shrink-0 rounded-full px-1.5 py-1",
          isSelected
            ? "hover:bg-[color-mix(in_srgb,var(--color-accent-fg),var(--color-accent)_75%)]"
            : "hover:bg-[color-mix(in_srgb,var(--color-accent),var(--color-bg)_75%)]",
        )}
        title={`„${copyTarget}" in das Namensfeld übernehmen.`}
        aria-label={`„${copyTarget}" in das Namensfeld übernehmen`}
      >
        <RotateCw className="size-3" />
      </button>
      <button
        type="button"
        onClick={() => onEditArticle(ingredientId)}
        className={cn(
          "shrink-0 rounded-full px-1.5 py-1",
          isSelected
            ? "hover:bg-[color-mix(in_srgb,var(--color-accent-fg),var(--color-accent)_75%)]"
            : "hover:bg-[color-mix(in_srgb,var(--color-accent),var(--color-bg)_75%)]",
        )}
        title={`„${canonicalName}" bearbeiten.`}
        aria-label={`„${canonicalName}" bearbeiten`}
      >
        <Pencil className="size-3" />
      </button>
    </span>
  );
}

function NewPill({
  label,
  isSelected,
  disabled,
  onSelect,
}: {
  label: string;
  isSelected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border border-dashed px-2 py-0.5 text-xs transition-colors",
        isSelected
          ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),var(--color-bg)_75%)] text-[var(--color-fg)]"
          : "border-[var(--color-border)] text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)]",
        disabled && "cursor-not-allowed opacity-50",
      )}
      title={
        disabled
          ? "Erst einen Zutatennamen eingeben."
          : isSelected
            ? "Neue Zutat wird beim Speichern angelegt."
            : "Als neue Zutat speichern."
      }
    >
      + {label}
    </button>
  );
}

function UnitBadge({
  annotation,
}: {
  annotation: ImportAnnotation | undefined;
}) {
  if (!annotation) return null;
  if (annotation.unitState === "unresolved") {
    return (
      <span
        className="inline-flex w-fit items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--color-danger),var(--color-bg)_82%)] px-2 py-0.5 text-xs font-medium text-[var(--color-danger)]"
        title={
          annotation.rawUnit
            ? `„${annotation.rawUnit}" konnte keiner bekannten Einheit zugeordnet werden. Wähle eine passende Einheit oder leg sie neu an.`
            : undefined
        }
      >
        <AlertTriangle className="size-3" />
        Einheit „{annotation.rawUnit}“ unbekannt
      </span>
    );
  }
  if (annotation.unitState === "defaulted") {
    return (
      <span
        className="inline-flex w-fit items-center gap-1 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-fg)]"
        title="Es wurde keine Einheit erkannt — Standard ‚Stück'."
      >
        Standard: Stück
      </span>
    );
  }
  if (annotation.unitState === "ok" && annotation.rawUnit) {
    return (
      <span
        className="inline-flex w-fit max-w-full items-center gap-1 truncate rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-fg)]"
        title={`Importiert als „${annotation.rawUnit}".`}
      >
        {annotation.rawUnit}
      </span>
    );
  }
  return null;
}

