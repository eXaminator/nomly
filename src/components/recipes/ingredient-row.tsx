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
  Link2,
  Lock,
  Outdent,
  Pencil,
  Plus,
  ScanText,
  Trash2,
  Unlink,
  Unlock,
} from "lucide-react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { EditArticleDialog } from "@/components/articles/edit-article-dialog";
import type { IngredientItem } from "@/components/settings/stammdaten/edit-forms/ingredient-form";
import { Input } from "@/components/ui/input";
import {
  SelectSearch,
  type SelectSearchItem,
} from "@/components/ui/select-search";
import { cn } from "@/lib/cn";
import {
  searchUnitsWithAliases,
  resolveUnitPick,
} from "@/components/units/unit-picker";
import { IngredientNameInput } from "./ingredient-name-input";
import { liveMatchQuery, type DraftIngredient, type ImportAnnotation } from "./types";
import { ForceMatchPopover } from "./force-match-popover";

/**
 * Mirror of the server-side {@link MIN_AUTO_MATCH_SCORE} (see
 * `src/lib/recipe-import/matching.ts`). The pill selection layer uses it
 * for the "auto-pick when top match clears the gate" rule. Kept in sync
 * manually — bump both when you tune the gate.
 */
const MIN_AUTO_MATCH_SCORE = 135;

// Alias-aware: lists each unit alias (e.g. "clove") as its own option so a
// recipe line can be set to that spelling; the pick collapses to the real unit.
const searchUnits = searchUnitsWithAliases;

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

/**
 * Server-side candidate match. Already sorted by `score desc → matchedName
 * length desc → alphabetical` — the UI renders pills in this order without
 * re-sorting client-side.
 */
export type ServerMatch = {
  ingredientId: number;
  canonicalName: string;
  matchedName: string;
  score: number;
  /** Finished display name applied on pick — the matched span of the input. */
  name: string;
  /** Finished notes applied on pick — the input tokens outside the span. */
  notes: string | null;
  /** True when the underlying ingredient is flagged as equipment. The pill
   *  click and auto-select rule default `isOptional` to true on first
   *  resolution to equipment — matching the import-time behavior. */
  isEquipment: boolean;
};

type Props = {
  value: DraftIngredient;
  onChange: (next: DraftIngredient) => void;
  onRemove: () => void;
  /** Re-parse this row from its original source line (`rawText`), replacing
   *  it (and any alternatives expanded from the same line) with freshly
   *  parsed rows. Only wired when the row carries a `rawText`. */
  onReparse?: () => void | Promise<void>;
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
  onReparse,
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

  const [reparsing, setReparsing] = React.useState(false);

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
          name: c.name,
          notes: c.notes,
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
            // Edit-flow synthetic — carry the row's current name/notes so
            // clicking this pill is a no-op on name/notes.
            name: value.name,
            notes: value.notes,
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
  // Text the live matcher runs against — see {@link liveMatchQuery} for how a
  // row's query is chosen (primary: full source line for context; alternative:
  // its own fragment, so it doesn't inherit the primary's candidates).
  // It stays fixed when the user clicks between pills (a pill click only
  // changes name/notes, never this query), so the pills don't drift or drop
  // notes. It updates ONLY when the user types in the name field — that's the
  // signal they're redefining the ingredient, so the matcher follows the
  // typed text from then on.
  const [matchText, setMatchText] = React.useState(() => liveMatchQuery(value));
  // Bumped to force a live-matcher re-fetch without changing `matchText` —
  // e.g. after the linked article is edited in place, so renamed
  // aliases/display names refresh in the candidate pills.
  const [matchRefresh, setMatchRefresh] = React.useState(0);
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
    const text = matchText.trim();
    if (text.length < 2) {
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
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        if (!r.ok) return;
        const data = (await r.json()) as { matches: ServerMatch[] };
        if (controller.signal.aborted) return;
        const v = valueRef.current;
        const hasUserEdited = value.name !== seededNameRef.current;
        // Store the raw matcher results only. The currently-selected
        // ingredient is surfaced at render time (`CandidatePills` synthesizes
        // a chip for it when the matcher didn't return it), so a stale
        // selection can never leave a mislabeled pin behind in this state.
        setServerMatches(data.matches);
        // Auto-select rules only re-fire when the user has actually
        // edited the input. Otherwise the row's saved selection stays
        // untouched no matter what the narrower live matcher returns.
        if (hasUserEdited) {
          const next = applyAutoSelect(v, text, data.matches);
          if (
            next.selectedIngredientId !== v.selectedIngredientId ||
            next.canonicalName !== v.canonicalName ||
            next.isOptional !== v.isOptional ||
            (next.pinnedByUser ?? false) !== (v.pinnedByUser ?? false)
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
  }, [matchText, matchRefresh]);

  // Called after the in-place article editor saves. Reflect the change in this
  // row immediately: patch the displayed canonical name if this row is linked
  // to the edited article, and re-run the matcher so pills pick up renamed
  // aliases/display names. Auto-select stays untouched (the name field didn't
  // change, so the effect's `hasUserEdited` gate is false).
  const handleArticleSaved = React.useCallback(
    (updated: IngredientItem) => {
      const v = valueRef.current;
      if (
        v.selectedIngredientId != null &&
        updated.id === v.selectedIngredientId &&
        updated.name !== v.canonicalName
      ) {
        onChangeRef.current({ ...v, canonicalName: updated.name });
      }
      setMatchRefresh((n) => n + 1);
    },
    [],
  );

  /** Global-unit picker. Former ingredient sub-units are now global units, so
   *  they surface here like any other unit. */
  const pickerValue: SelectSearchItem | null = value.unit;

  function onPickUnit(picked: SelectSearchItem | null) {
    onChange({
      ...value,
      // Collapse an alias pick to the real unit id while keeping the chosen
      // spelling as the display name → the row shows e.g. "clove".
      unit: resolveUnitPick(picked),
      importAnnotation: clearAnnotationOn(value.importAnnotation, "unit"),
    });
  }

  /** Click on a candidate pill: replace the row's name + notes with the
   *  candidate's finished values (computed server-side from the matched
   *  span) and link the ingredient. Pure replace — idempotent, so
   *  re-clicking or switching pills never accumulates leftover notes
   *  ("Paprikaschote rote" + pick Paprikaschoten → name "Paprikaschote",
   *  note "rote"). `ingredient_id` links to the picked canonical.
   *
   *  Equipment-flagged ingredients (Backpapier, Backform, …) default the
   *  row to isOptional=true on first resolution, mirroring the import-time
   *  parser behavior. A user-toggled isOptional=true is left in place;
   *  we never auto-unset. */
  function selectCandidate(c: ServerMatch) {
    onChange({
      ...value,
      name: c.name,
      notes: c.notes ?? "",
      selectedIngredientId: c.ingredientId,
      canonicalName:
        c.name.toLowerCase() === c.canonicalName.toLowerCase()
          ? null
          : c.canonicalName,
      // Remember the spelling this pick is REPLACING (keep an import's source
      // span if we already have one) so the alias toggle can offer it.
      originalName:
        value.originalName ?? (value.name.trim() || undefined),
      isOptional: value.isOptional || c.isEquipment,
      // Clicking a regular candidate clears any force-match alias intent and
      // any "Nicht zugeordnet" state.
      addAsAlias: false,
      unassigned: false,
      // Manual pin: from here, typing keeps this selection (sticky).
      pinnedByUser: true,
      importAnnotation: clearAnnotationOn(value.importAnnotation, "ingredient"),
    });
  }

  /** Name-field change. Two sources, distinguished by `pickedIngredientId`:
   *   - autocomplete pick (id present): the user chose a specific ingredient
   *     by name → select it as the new best match and CLEAR any manual pin
   *     (a fresh name supersedes a prior pill pin).
   *   - free typing (no id): follow the text; leave any manual pin intact so
   *     a previously-pinned selection survives editing, while an unpinned row
   *     re-evaluates to the best match (handled in the live-match effect).
   *  Either way the matcher query follows the typed/picked text. */
  function handleNameChange(
    name: string,
    canonical?: string | null,
    pickedIngredientId?: number,
  ) {
    setMatchText(name);
    if (pickedIngredientId !== undefined) {
      onChange({
        ...value,
        name,
        selectedIngredientId: pickedIngredientId,
        canonicalName: canonical ?? null,
        // A fresh name supersedes any remembered original spelling.
        originalName: undefined,
        pinnedByUser: false,
        addAsAlias: false,
        unassigned: false,
        importAnnotation: clearAnnotationOn(value.importAnnotation, "ingredient"),
      });
      return;
    }
    onChange({
      ...value,
      name,
      canonicalName: canonical === undefined ? value.canonicalName : canonical,
      // Typing redefines the name → drop the remembered original spelling.
      originalName: undefined,
      importAnnotation: clearAnnotationOn(value.importAnnotation, "ingredient"),
    });
  }

  /** Click on the synthetic "Neu" pill: row becomes a new-ingredient row. */
  function selectNew() {
    onChange({
      ...value,
      selectedIngredientId: null,
      canonicalName: null,
      originalName: undefined,
      addAsAlias: false,
      unassigned: false,
      // Deliberate "create new" choice — sticky against re-matching on typing.
      pinnedByUser: true,
    });
  }

  /** Free-text toggle (the link/unlink button in the row actions): flip the
   *  row between a linked article and free text, WITHOUT discarding anything.
   *  Quantity, unit, name, notes and the matched selection are all preserved
   *  (just hidden while free-text is active), so an accidental click is undone
   *  by clicking again. Deliberately does NOT clear the selection the way the
   *  old "Nicht zugeordnet" pill did. */
  function toggleFreeText() {
    onChange({ ...value, unassigned: !value.unassigned });
  }

  /** The unlink button on the "Original" box: take the whole original line
   *  verbatim into the name and make the row free text. A one-shot transform
   *  (distinct from the reversible toggle); undo it with the reparse button. */
  function useOriginalAsFreeText() {
    const raw = (value.rawText ?? "").trim();
    setMatchText(raw);
    onChange({
      ...value,
      name: raw,
      // The whole line lives in the (single) free-text field now — clear the
      // separate note so it isn't stored/shown twice. Reversible via reparse.
      notes: "",
      unassigned: true,
      importAnnotation: clearAnnotationOn(value.importAnnotation, "ingredient"),
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
      // Force-match keeps the current name as the display + alias intent; any
      // remembered import-original no longer applies to this manual choice.
      originalName: undefined,
      unassigned: false,
      // Explicit force-match — sticky against re-matching on typing.
      pinnedByUser: true,
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
            search={searchUnits}
            defaultItems={defaultUnits}
            placeholder="Einheit"
            onCreate={createUnit}
            createLabelPrefix="als Einheit anlegen"
          />
        </div>
        <IngredientNameInput
          value={value.name}
          onChange={(name, canonical, pickedIngredientId) =>
            handleNameChange(name, canonical, pickedIngredientId)
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
            originalName={value.originalName ?? null}
            addAsAlias={value.addAsAlias}
            onSelectCandidate={selectCandidate}
            onSelectNew={selectNew}
            onForceMatch={forceMatch}
            onEditArticle={setEditingArticleId}
          />
        </div>
        {editingArticleId != null ? (
          <EditArticleDialog
            ingredientId={editingArticleId}
            onClose={() => setEditingArticleId(null)}
            onSaved={handleArticleSaved}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      // Stable DOM handle so the section editor can focus a freshly
      // inserted row's first input after it mounts.
      id={`ingredient-row-${value.uid}`}
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
        // The whole group rides inside the primary's draggable container.
        // When the parent also wires this alternative as its own sortable
        // (drag props present), the leading slot becomes a grip for
        // reordering alternatives among themselves; otherwise it stays empty
        // so the alt's content lines up under the primary's. The trailing
        // arrow sits at the start-of-Qty column for the visual indent.
        <>
          {dragListeners ? (
            <button
              type="button"
              {...(dragAttributes ?? {})}
              {...(dragListeners ?? {})}
              aria-label="Alternative per Drag-and-Drop umordnen"
              title="Ziehen, um die Reihenfolge der Alternativen zu ändern"
              className="mt-1.5 inline-flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </button>
          ) : (
            <span
              aria-hidden="true"
              className="mt-1.5 inline-flex h-8 w-6 shrink-0"
            />
          )}
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
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {value.rawText ? (
          // Boxed, indented (it sits inside the fields column) original line:
          // the source text plus two actions — reparse → linked, or drop the
          // whole text in as free text.
          <div className="inline-flex max-w-full items-center gap-1 self-start rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] py-0.5 pl-2 pr-1">
            <p
              className="truncate text-xs text-[var(--color-muted-fg)]"
              title={value.rawText}
            >
              <span className="opacity-70">Original:</span> {value.rawText}
            </p>
            {onReparse ? (
              <button
                type="button"
                onClick={() => {
                  if (reparsing) return;
                  setReparsing(true);
                  void Promise.resolve(onReparse()).finally(() =>
                    setReparsing(false),
                  );
                }}
                disabled={reparsing}
                className="shrink-0 rounded p-1 text-[var(--color-muted-fg)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)] disabled:opacity-50"
                title="Neu parsen und verknüpfen (verwirft manuelle Änderungen dieser Zeile)."
                aria-label="Aus Originalzeile neu parsen"
              >
                <ScanText
                  className={cn("size-3.5", reparsing && "animate-spin")}
                />
              </button>
            ) : null}
            <button
              type="button"
              onClick={useOriginalAsFreeText}
              className="shrink-0 rounded p-1 text-[var(--color-muted-fg)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
              title="Originaltext unverändert als Freitext übernehmen (ohne Artikel)."
              aria-label="Originaltext als Freitext übernehmen"
            >
              <Unlink className="size-3.5" />
            </button>
          </div>
        ) : null}

        {value.unassigned ? (
          // Free-text row: a single (growing) field holding the whole line.
          // No quantity, unit, note or matching — the link/unlink toggle flips
          // back without losing the hidden quantity/unit/note/selection
          // (non-destructive).
          <div className="flex items-start gap-2">
            <Input
              placeholder="Freie Angabe (z. B. „etwas zum Garnieren“)"
              value={value.name}
              onChange={(e) => {
                setMatchText(e.target.value);
                onChange({ ...value, name: e.target.value });
              }}
              aria-label="Freie Angabe"
              className="min-w-0 flex-1"
            />
            <FreeTextToggle
              active
              onToggle={toggleFreeText}
              className="h-9 w-9 md:h-11 md:w-11"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label="Zutat entfernen"
              className="h-9 w-9 md:h-11 md:w-11"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="grid items-start gap-2 grid-cols-[4rem_minmax(0,1fr)_auto_auto_auto_auto_auto_auto] md:grid-cols-[5rem_8rem_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto_auto_auto_auto]">
            {/* Mobile flow: [Qty | Unit] · [Name] · [Notes | actions]. Desktop
                (md+) is a single row; the trailing actions end with the
                free-text toggle and delete. */}
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
                search={searchUnits}
                defaultItems={defaultUnits}
                placeholder="Einheit"
                onCreate={createUnit}
                createLabelPrefix="als Einheit anlegen"
              />
              <UnitBadge annotation={value.importAnnotation} />
            </div>
            <IngredientNameInput
              value={value.name}
              onChange={(name, canonical, pickedIngredientId) =>
                handleNameChange(name, canonical, pickedIngredientId)
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
            {/* CandidatePills span the Name + Notes columns on desktop and the
                full mobile width. */}
            <div className="col-span-8 md:col-span-2 md:col-start-3 md:row-start-2">
              <CandidatePills
                name={value.name}
                candidates={serverMatches}
                selectedIngredientId={value.selectedIngredientId}
                selectedCanonicalName={value.canonicalName}
                originalName={value.originalName ?? null}
                addAsAlias={value.addAsAlias}
                onSelectCandidate={selectCandidate}
                onSelectNew={selectNew}
                onForceMatch={forceMatch}
                onEditArticle={setEditingArticleId}
              />
            </div>
            {value.isAlternative ? (
              // Alternatives are inherently optional — no toggle. Reserved
              // empty slot keeps the columns aligned with primary rows.
              <span
                aria-hidden="true"
                className="col-start-3 h-9 w-9 md:col-start-5 md:row-start-1 md:h-11 md:w-11"
              />
            ) : (
              <Button
                variant={value.isOptional ? "secondary" : "ghost"}
                size="icon"
                onClick={() =>
                  onChange({ ...value, isOptional: !value.isOptional })
                }
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
              onClick={() =>
                onChange({ ...value, fixedAmount: !value.fixedAmount })
              }
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
            {/* Indent/Outdent pair. */}
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
            {/* Add-alternative / promote. */}
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
            {/* Free-text toggle — last action before delete. Alternatives can't
                be free text, so they reserve the slot to stay aligned. */}
            {value.isAlternative ? (
              <span
                aria-hidden="true"
                className="col-start-7 h-9 w-9 md:col-start-9 md:row-start-1 md:h-11 md:w-11"
              />
            ) : (
              <FreeTextToggle
                active={false}
                onToggle={toggleFreeText}
                className="col-start-7 h-9 w-9 md:col-start-9 md:row-start-1 md:h-11 md:w-11"
              />
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label="Zutat entfernen"
              className="col-start-8 h-9 w-9 md:col-start-10 md:row-start-1 md:h-11 md:w-11"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
        {editingArticleId != null ? (
          <EditArticleDialog
            ingredientId={editingArticleId}
            onClose={() => setEditingArticleId(null)}
            onSaved={handleArticleSaved}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The candidate (if any) whose canonical name OR matched alias equals the
 * typed text case-insensitively — i.e. an EXACT name collision with an
 * existing ingredient. This is the condition under which a brand-new
 * ingredient with that name is impossible: `ingredient.name` is unique, and
 * the recipe-save resolver (`resolveIngredient`) links such a name to the
 * existing row regardless of any client-side "Neu" intent. Used both to
 * auto-bind the row and to disable the "Neu" pill so the user can't make a
 * "create new" choice the backend would silently override.
 */
export function findExactMatch(
  typedName: string,
  matches: ServerMatch[],
): ServerMatch | undefined {
  const trimmedLower = typedName.trim().toLowerCase();
  if (trimmedLower.length === 0) return undefined;
  return matches.find(
    (m) =>
      m.canonicalName.toLowerCase() === trimmedLower ||
      m.matchedName.toLowerCase() === trimmedLower,
  );
}

/**
 * Auto-select rules applied after each match response:
 *   1. Sticky: keep the previous selectedIngredientId if it still appears
 *      in the new candidate set. A deliberate "Neu" pin stays new — UNLESS
 *      the typed name now EXACTLY collides with an existing ingredient/alias
 *      (a duplicate name can't be created), in which case it yields to Rule 2.
 *   2. Exact: typed text equals a candidate's canonicalName (case-insensitive).
 *   3. Above threshold: top candidate's score clears MIN_AUTO_MATCH_SCORE.
 *   4. Fallback: "Neu" (selectedIngredientId = null).
 *
 * Returns a new DraftIngredient with the selection applied. Callers should
 * compare against the previous value to avoid unnecessary onChange churn.
 */
export function applyAutoSelect(
  current: DraftIngredient,
  typedName: string,
  matches: ServerMatch[],
): DraftIngredient {
  // Rule 0: an explicitly "Nicht zugeordnet" row is sticky. The user opted
  // out of article matching, so typing must not silently re-link it — they
  // re-link by clicking a candidate or the "Neu" pill.
  if (current.unassigned) return current;
  // Rule 1: sticky ONLY when the user manually pinned this row (clicked a
  // candidate pill / force-match / ↻ / "Neu"). A pinned selection survives
  // typing; we keep it but DON'T re-apply the equipment → isOptional default
  // (the user may have toggled it since). An UNPINNED row — including an
  // import auto-resolution — falls through to re-evaluate the best match as
  // the text changes.
  if (current.pinnedByUser) {
    // Deliberate "Neu" pin (pinned with no selection): stay a new-ingredient
    // row. Typing / a fresh match response must NOT silently re-bind it to a
    // candidate — otherwise it stops counting as new on save and the
    // new-ingredient enrichment dialog never opens. EXCEPTION: an exact
    // name/alias collision can't become a new ingredient (unique name; the
    // save resolver links to the existing row anyway), so it falls through to
    // Rule 2 and binds the match — keeping the row honest about what saves.
    if (current.selectedIngredientId == null) {
      if (!findExactMatch(typedName, matches)) return current;
    } else {
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
      // Pinned selection vanished from the results — clear and re-evaluate.
    }
  }
  const trimmedLower = typedName.trim().toLowerCase();
  // Rule 2: exact.
  const exact = findExactMatch(typedName, matches);
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
      // Auto-selected from the typed text — no longer a manual pin.
      pinnedByUser: false,
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
      pinnedByUser: false,
    };
  }
  // Rule 4: Neu.
  return {
    ...current,
    selectedIngredientId: null,
    canonicalName: null,
    addAsAlias: false,
    pinnedByUser: false,
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
 * Renders the candidate chips (max 3) + the "Neu" chip (when the name is a
 * valid new ingredient) + the force-match (+) popover. Chips are plain text:
 * clicking selects the candidate (which fills the name); the edit-article
 * pencil is revealed on hover. Candidates come pre-sorted from the server.
 */
function CandidatePills({
  name,
  candidates,
  selectedIngredientId,
  selectedCanonicalName,
  originalName,
  addAsAlias,
  onSelectCandidate,
  onSelectNew,
  onForceMatch,
  onEditArticle,
}: {
  name: string;
  candidates: ServerMatch[];
  selectedIngredientId: number | null;
  /** Canonical name of the currently-selected ingredient, used to synthesize
   *  its chip when the matcher didn't return it (e.g. a force-match to an
   *  off-list ingredient). Null when the name IS the canonical. */
  selectedCanonicalName: string | null;
  /** The user's original spelling before an auto-match/pill replaced the
   *  display name. Used as the alias spelling shown on the selected chip when
   *  "als Alias" is active. Null when there's none. */
  originalName: string | null;
  addAsAlias: boolean;
  onSelectCandidate: (c: ServerMatch) => void;
  onSelectNew: () => void;
  onForceMatch: (
    ingredientId: number,
    canonical: string,
    addAsAlias: boolean,
  ) => void;
  onEditArticle: (ingredientId: number) => void;
}) {
  const trimmed = name.trim();
  // Nothing to interact with yet.
  if (
    trimmed.length === 0 &&
    candidates.length === 0 &&
    selectedIngredientId == null
  ) {
    return null;
  }
  const isNewSelected = selectedIngredientId == null;
  // "Neu" is offered only when it's a real option: a non-empty name that does
  // NOT already exist. An exact name/alias collision can't become a new
  // ingredient (unique name; the save resolver links to the existing row), so
  // the chip is hidden entirely rather than shown disabled. Computed over the
  // real matcher results only — never the synthesized selected chip below.
  const exactMatch = findExactMatch(trimmed, candidates);
  const showNew = trimmed.length > 0 && exactMatch == null;

  // At most 3 candidate chips, but always keep the selected one visible. When
  // the matcher didn't return the selection (a force-match to an off-list
  // ingredient, or a narrower live-match view), synthesize a chip for it from
  // the row's current selection — tied to `selectedIngredientId`, so it can
  // never go stale the way a stored synthetic pin could.
  let display = candidates.slice(0, 3);
  if (
    selectedIngredientId != null &&
    !display.some((c) => c.ingredientId === selectedIngredientId)
  ) {
    const sel = candidates.find((c) => c.ingredientId === selectedIngredientId);
    if (sel) {
      display = [sel, ...display.slice(0, 2)];
    } else {
      const canonical = selectedCanonicalName ?? trimmed;
      display = [
        {
          ingredientId: selectedIngredientId,
          canonicalName: canonical,
          matchedName: canonical,
          score: 999,
          name: trimmed,
          notes: null,
          isEquipment: false,
        },
        ...display.slice(0, 2),
      ];
    }
  }

  // Spelling that would be saved as an alias when "als Alias" is active: the
  // user's original spelling, else the current name.
  const aliasSpelling = (originalName?.trim() || trimmed).trim();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {display.map((c) => {
        const isCurrent = c.ingredientId === selectedIngredientId;
        // `canonicalName` is the identity; `matchedName` is the catalog row
        // that hit (often an alias) — shown in parens so the user sees WHY it
        // matched ("Erbsen (TK Erbsen)").
        const aliasFromMatch =
          c.matchedName.length > 0 &&
          c.matchedName.toLowerCase() !== c.canonicalName.toLowerCase()
            ? c.matchedName
            : null;
        // On the selected chip, when "als Alias" is on, surface the kept
        // spelling in parens with a small "+" (replaces the old "+ Alias").
        const markAsAlias =
          isCurrent &&
          addAsAlias &&
          aliasSpelling.length > 0 &&
          aliasSpelling.toLowerCase() !== c.canonicalName.toLowerCase();
        return (
          <CandidatePill
            key={c.ingredientId}
            ingredientId={c.ingredientId}
            canonicalName={c.canonicalName}
            aliasName={markAsAlias ? aliasSpelling : aliasFromMatch}
            markAsAlias={markAsAlias}
            isSelected={isCurrent}
            onSelect={() => onSelectCandidate(c)}
            onEditArticle={onEditArticle}
          />
        );
      })}
      {showNew ? (
        <NewPill
          label={`Neu: ${trimmed}`}
          isSelected={isNewSelected}
          onSelect={onSelectNew}
        />
      ) : null}
      <ForceMatchPopover onPick={onForceMatch} typedName={trimmed} />
    </div>
  );
}

function CandidatePill({
  ingredientId,
  canonicalName,
  aliasName,
  markAsAlias,
  isSelected,
  onSelect,
  onEditArticle,
}: {
  ingredientId: number;
  canonicalName: string;
  /** Alias the matcher hit on (or the spelling to be kept as an alias),
   *  rendered in parens after the canonical. `null` → render just canonical. */
  aliasName: string | null;
  /** Show a small "+" after the name meaning "this spelling will be saved as
   *  an alias on save" — used on the selected chip when force-match's alias
   *  option is active. */
  markAsAlias: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onEditArticle: (ingredientId: number) => void;
}) {
  return (
    <span
      className={cn(
        "group relative inline-flex max-w-full items-center overflow-hidden rounded-full text-xs transition-colors",
        isSelected
          ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
          : "bg-[var(--color-muted)] text-[var(--color-fg)]",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "max-w-full truncate py-0.5 pl-2.5 pr-2",
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
        {markAsAlias ? (
          <Plus
            className="ml-1 inline size-3 align-[-2px]"
            aria-label="wird als Alias gespeichert"
          />
        ) : null}
      </button>
      {/* Edit-article: revealed on hover as an OVERLAY over the chip's right
          end (out of flow, painted on the chip's own background). It must
          never widen the chip: on the last pill of a wrapped line the extra
          width pushes the pill to the next line, out from under the cursor —
          an endless wrap/unwrap flicker. On touch (no hover) it sits
          statically in the row and stays visible; the background matches the
          chip there, so the explicit bg classes are harmless. */}
      <button
        type="button"
        onClick={() => onEditArticle(ingredientId)}
        className={cn(
          "absolute inset-y-0 right-0 hidden items-center pl-1.5 pr-2 group-hover:flex",
          "[@media(hover:none)]:static [@media(hover:none)]:flex [@media(hover:none)]:shrink-0",
          isSelected
            ? "bg-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent-fg),var(--color-accent)_75%)]"
            : "bg-[var(--color-muted)] hover:bg-[color-mix(in_srgb,var(--color-accent),var(--color-bg)_75%)]",
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
  onSelect,
}: {
  label: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border border-dashed px-2 py-0.5 text-xs transition-colors",
        isSelected
          ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),var(--color-bg)_75%)] text-[var(--color-fg)]"
          : "border-[var(--color-border)] text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)]",
      )}
      title={
        isSelected
          ? "Neue Zutat wird beim Speichern angelegt."
          : "Als neue Zutat speichern."
      }
    >
      + {label}
    </button>
  );
}

/**
 * Link/unlink toggle that flips a row between a linked article and free text.
 * Non-destructive — the row's quantity, unit and matched selection are kept
 * (hidden) while free-text is active, so toggling back restores them. Replaces
 * the old "Nicht zugeordnet" pill.
 */
function FreeTextToggle({
  active,
  onToggle,
  className,
}: {
  active: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={
        active ? "Wieder mit einem Artikel verknüpfen" : "Als Freitext ohne Artikel"
      }
      title={
        active
          ? "Freitext aktiv – klicken, um die Zeile wieder mit einem Artikel zu verknüpfen."
          : "Als Freitext ohne Artikel (ohne Menge/Einheit, kommt nicht auf die Einkaufsliste)."
      }
      className={className}
    >
      {active ? <Unlink className="size-4" /> : <Link2 className="size-4" />}
    </Button>
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

