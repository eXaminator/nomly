"use client";

import * as React from "react";
import {
  AlertTriangle,
  Lock,
  Parentheses,
  RotateCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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

type Props = {
  value: DraftIngredient;
  onChange: (next: DraftIngredient) => void;
  onRemove: () => void;
};

export function IngredientRow({ value, onChange, onRemove }: Props) {
  const [defaultUnits, setDefaultUnits] = React.useState<SelectSearchItem[]>([]);
  React.useEffect(() => {
    void loadDefaultUnits().then(setDefaultUnits);
  }, []);

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
            next.canonicalName !== v.canonicalName
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

  /** Click on a candidate pill: select that ingredient WITHOUT replacing
   *  the typed name. The row's `display_name` keeps the user's spelling
   *  while `ingredient_id` links to the picked canonical. */
  function selectCandidate(c: ServerMatch) {
    onChange({
      ...value,
      selectedIngredientId: c.ingredientId,
      canonicalName:
        value.name.toLowerCase() === c.canonicalName.toLowerCase()
          ? null
          : c.canonicalName,
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

  return (
    <div className={cn("flex flex-col gap-1", value.isOptional && "opacity-65")}>
    {value.rawText ? (
      <p
        className="truncate text-xs text-[var(--color-muted-fg)]"
        title={value.rawText}
      >
        Original: „{value.rawText}“
      </p>
    ) : null}
    <div
      className="grid grid-cols-[5rem_8rem_1fr_auto_auto_auto] gap-2 md:grid-cols-[5rem_8rem_1fr_1fr_auto_auto_auto]"
    >
      <Input
        inputMode="decimal"
        placeholder="Menge"
        value={value.quantity}
        onChange={(e) => onChange({ ...value, quantity: e.target.value })}
        aria-label="Menge"
      />
      <div className="flex flex-col gap-1">
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
      <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
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
        />
        <CandidatePills
          name={value.name}
          candidates={serverMatches}
          selectedIngredientId={value.selectedIngredientId}
          addAsAlias={value.addAsAlias}
          onSelectCandidate={selectCandidate}
          onSelectNew={selectNew}
          onUseCanonical={useCanonicalInName}
          onForceMatch={forceMatch}
        />
      </div>
      <Input
        placeholder="Notiz (z. B. fein gehackt)"
        value={value.notes}
        onChange={(e) => onChange({ ...value, notes: e.target.value })}
        aria-label="Notiz"
        className="col-span-3 md:col-span-1"
      />
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
        className="col-start-4 md:col-start-5"
      >
        <Parentheses className="size-4" />
      </Button>
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
        className="col-start-5 md:col-start-6"
      >
        <Lock className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="Zutat entfernen"
        className="col-start-6 md:col-start-7"
      >
        <Trash2 className="size-4" />
      </Button>
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
  // Rule 1: sticky.
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
  addAsAlias,
  onSelectCandidate,
  onSelectNew,
  onUseCanonical,
  onForceMatch,
}: {
  name: string;
  candidates: ServerMatch[];
  selectedIngredientId: number | null;
  addAsAlias: boolean;
  onSelectCandidate: (c: ServerMatch) => void;
  onSelectNew: () => void;
  onUseCanonical: (c: ServerMatch) => void;
  onForceMatch: (
    ingredientId: number,
    canonical: string,
    addAsAlias: boolean,
  ) => void;
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
        // Show the alias name that the matcher actually hit on (when it
        // differs from the canonical). For most rows this is the canonical
        // itself; for alias hits ("TK Erbsen" alias → canonical "Erbsen")
        // the pill reads "TK Erbsen" so the user sees WHY a row matched.
        const label = c.matchedName || c.canonicalName;
        return (
          <CandidatePill
            key={c.ingredientId}
            label={label}
            isSelected={isCurrent}
            onSelect={() => onSelectCandidate(c)}
            onUseCanonical={() => onUseCanonical(c)}
          />
        );
      })}
      {selectedOutOfList ? (
        <button
          type="button"
          disabled
          className={cn(
            "inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs",
            "bg-[var(--color-accent)] text-[var(--color-accent-fg)] cursor-default",
          )}
          title={
            addAsAlias
              ? `Diese Zeile ist fest mit einer Zutat verknüpft — "${trimmed}" wird beim Speichern als Alias hinzugefügt.`
              : "Diese Zeile ist fest mit einer Zutat verknüpft."
          }
        >
          ⚓
          {addAsAlias ? <span className="text-[0.65rem]">+ Alias</span> : null}
        </button>
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
  label,
  isSelected,
  onSelect,
  onUseCanonical,
}: {
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  onUseCanonical: () => void;
}) {
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
            ? `Aktuell ausgewählt: „${label}".`
            : `„${label}" als Zutat verwenden.`
        }
      >
        {label}
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
        title={`„${label}" in das Namensfeld übernehmen.`}
        aria-label={`„${label}" in das Namensfeld übernehmen`}
      >
        <RotateCw className="size-3" />
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

