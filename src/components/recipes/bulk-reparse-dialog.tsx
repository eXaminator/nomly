"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, ScanText, Volume2, VolumeX } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { IngredientRow } from "./ingredient-row";
import { NewIngredientsDialog } from "./new-ingredients-dialog";
import { parsedIngredientToDraft, type DraftIngredient } from "./types";
import {
  addAlternativeAfter,
  addMainAfter,
  canDemote,
  demoteToAlternative,
  detachAlternative,
  moveAlternativeWithinGroup,
  promoteAlternative,
} from "./alternatives";
import {
  reparseDeletingAlternative,
  reparsePromotingAlternative,
  reparsePromotingIngredient,
  isConjunctionMember,
} from "./reparse";
import { ingredientToPayload, toNumberOrNull } from "./payload";
import { buildUnitInflector, type UnitInflector } from "./unit-inflect";
import type { UnitForm } from "@/lib/recipes/reparse-scan";
import {
  RecipeIngredientReadLine,
  type LineHighlight,
} from "./ingredient-read-line";
import { diffNotes, type NotesDiff } from "./notes-diff";
import { notesForAdoptedName } from "./alias-notes";
import type { AliasWarning, NewIngredientDefaults } from "@/lib/recipes/types";

/**
 * The edit panel's ingredient list with drag-to-reorder for alternatives.
 * Primaries are not draggable here (the bulk dialog doesn't reorder groups);
 * each group's alternatives form a nested sortable list, clamped to their own
 * group via {@link moveAlternativeWithinGroup}. Mirrors the recipe editor's
 * behaviour so both dialogs feel identical.
 */
function DraftEditList({
  rows,
  onChangeRow,
  onRemoveRow,
  onRemoveAlternative,
  onPromoteFolded,
  onPromoteFoldedIngredient,
  onMutate,
}: {
  rows: DraftIngredient[];
  onChangeRow: (rowIdx: number, next: DraftIngredient) => void;
  onRemoveRow: (rowIdx: number) => void;
  onRemoveAlternative: (rowIdx: number) => void;
  onPromoteFolded: (primaryRowIdx: number, range: [number, number]) => void;
  onPromoteFoldedIngredient: (primaryRowIdx: number, range: [number, number]) => void;
  onMutate: (fn: (rows: DraftIngredient[]) => DraftIngredient[]) => void;
}) {
  // Unique per mounted list: several entries can be in edit mode at once, so a
  // shared DndContext id would collide on the ARIA description element.
  const dndId = React.useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.uid === String(active.id));
    const to = rows.findIndex((r) => r.uid === String(over.id));
    if (from < 0 || to < 0 || !rows[from].isAlternative) return;
    onMutate((rs) => moveAlternativeWithinGroup(rs, from, to));
  }
  // Group rows by primary so each group's alternatives are their own sortable
  // sub-list. An orphan alternative (no preceding primary) starts its own
  // group and renders with its alternative chrome, matching the prior flat
  // rendering.
  const groups: { leaderIdx: number; altIdxs: number[] }[] = [];
  rows.forEach((r, k) => {
    if (r.isAlternative && groups.length > 0) {
      groups[groups.length - 1].altIdxs.push(k);
    } else {
      groups.push({ leaderIdx: k, altIdxs: [] });
    }
  });
  const leaderRow = (k: number) => {
    const d = rows[k];
    return d.isAlternative ? (
      <IngredientRow
        value={d}
        onChange={(next) => onChangeRow(k, next)}
        onRemove={() => onRemoveRow(k)}
        onPromote={() => onMutate((rs) => promoteAlternative(rs, k))}
        onDetach={() => onMutate((rs) => detachAlternative(rs, k))}
      />
    ) : (
      <IngredientRow
        value={d}
        onChange={(next) => onChangeRow(k, next)}
        onRemove={() => onRemoveRow(k)}
        onAddAlternative={() => onMutate((rs) => addAlternativeAfter(rs, k))}
        onDemote={
          canDemote(rows, k)
            ? () => onMutate((rs) => demoteToAlternative(rs, k))
            : undefined
        }
        onPromoteFolded={(range) => onPromoteFolded(k, range)}
        onPromoteFoldedIngredient={(range) => onPromoteFoldedIngredient(k, range)}
        onAddMain={() => onMutate((rs) => addMainAfter(rs, k))}
      />
    );
  };
  return (
    <DndContext
      id={`bulk-reparse-alt-dnd-${dndId}`}
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={onDragEnd}
    >
      {groups.map((g) => (
        <React.Fragment key={rows[g.leaderIdx].uid}>
          {leaderRow(g.leaderIdx)}
          <SortableContext
            items={g.altIdxs.map((k) => rows[k].uid)}
            strategy={verticalListSortingStrategy}
          >
            {g.altIdxs.map((k) => (
              <SortableDraftAltRow
                key={rows[k].uid}
                alt={rows[k]}
                onChange={(next) => onChangeRow(k, next)}
                // Removing an alternative re-parses its source line with the
                // alternative folded into the primary's note (AST-generated).
                onRemove={() => onRemoveAlternative(k)}
                onPromote={() => onMutate((rs) => promoteAlternative(rs, k))}
                onDetach={() => onMutate((rs) => detachAlternative(rs, k))}
              />
            ))}
          </SortableContext>
        </React.Fragment>
      ))}
    </DndContext>
  );
}

/** A bulk-dialog alternative wired as its own sortable item; the grip props
 *  flow into {@link IngredientRow}'s leading slot. */
function SortableDraftAltRow({
  alt,
  onChange,
  onRemove,
  onPromote,
  onDetach,
}: {
  alt: DraftIngredient;
  onChange: (next: DraftIngredient) => void;
  onRemove: () => void;
  onPromote: () => void;
  onDetach: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: alt.uid });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-40")}
    >
      <IngredientRow
        value={alt}
        onChange={onChange}
        onRemove={onRemove}
        onPromote={onPromote}
        onDetach={onDetach}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </div>
  );
}

/** One-line German rendering of a non-fatal alias outcome. */
function aliasWarningText(w: AliasWarning): string {
  const others = w.otherIngredientNames.map((n) => `„${n}“`).join(", ");
  return w.kind === "canonical"
    ? `Alias „${w.aliasName}“ nicht angelegt — ist bereits die Zutat ${others}`
    : `Alias „${w.aliasName}“ angelegt — kollidiert mit einem Alias von ${others}`;
}

/** The amount REPRESENTATION of one diff side — what the amount diff compares.
 *  A literal amount and a quantifier with the same effective number differ in
 *  representation (one has a `quantifierId`, the other doesn't), so they read
 *  as a change even though they render the same string. */
export type AmountRepresentation = {
  quantity: number | null;
  quantityLow: number | null;
  quantifierId: number | null;
  unitLabel: string | null;
};

/**
 * True when two amount sides differ in REPRESENTATION rather than just rendered
 * text: the tuple (quantity, quantityLow, quantifierId, unitLabel). So a
 * literal `2` vs a quantifier `zwei` (effective 2) is a change, while identical
 * quantifiers — or identical literals — are not. The unit label is compared
 * already inflected by the caller (so a pure singular/plural difference is not
 * a change).
 */
export function amountRepresentationChanged(
  cur: AmountRepresentation,
  prop: AmountRepresentation,
): boolean {
  return (
    cur.quantity !== prop.quantity ||
    cur.quantityLow !== prop.quantityLow ||
    cur.quantifierId !== prop.quantifierId ||
    (cur.unitLabel ?? "") !== (prop.unitLabel ?? "")
  );
}
/** Stable identity of a row's ingredient mapping — what the diff compares to
 *  decide if the mapping CHANGED. A catalog id for matched rows, the sentinel
 *  "new" for a to-be-created ingredient, null for unassigned. */
function currentMappingId(c: ScanRowSummary): number | "new" | null {
  return c.ingredientId;
}
function draftMappingId(d: DraftIngredient): number | "new" | null {
  if (d.unassigned) return null;
  if (d.selectedIngredientId == null) return "new";
  return d.selectedIngredientId;
}

/** Human-readable mapping label — the canonical catalog name, with the matched
 *  alias in parentheses when it differs from the canonical. */
function currentMappingLabel(c: ScanRowSummary): string {
  return c.ingredientId == null
    ? "nicht zugeordnet"
    : c.canonicalName ?? c.name;
}
function draftMappingLabel(d: DraftIngredient): string {
  if (d.unassigned) return "nicht zugeordnet";
  if (d.selectedIngredientId == null) return "neu";
  // Pull the canonical (and the alias that actually matched) from the selected
  // candidate; the draft's own `canonicalName` is nulled when it equals the
  // display span, so it can't be trusted as the canonical on its own.
  const sel = d.candidates.find((c) => c.ingredientId === d.selectedIngredientId);
  const canonical = sel?.canonicalName ?? d.canonicalName ?? d.name;
  const alias = sel?.matchedName;
  return alias && alias.toLowerCase() !== canonical.toLowerCase()
    ? `${canonical} (${alias})`
    : canonical;
}

/**
 * Per-field change flags comparing the current rows to the proposed draft
 * rows of one line-group, aligned by index. Rows present on only one side
 * (count change) are fully flagged. Used to color-highlight the diff.
 */
function computeHighlights(
  current: ScanRowSummary[],
  draft: DraftIngredient[],
  inflect: UnitInflector,
): {
  current: LineHighlight[];
  proposed: LineHighlight[];
  /** Word-level notes diff per row pair (undefined when the notes are equal
   *  or the row exists on one side only) — lets the read lines tint only
   *  the changed words instead of the whole notes string. */
  notesDiffs: (NotesDiff | undefined)[];
} {
  const n = Math.max(current.length, draft.length);
  const cur: LineHighlight[] = [];
  const prop: LineHighlight[] = [];
  const notesDiffs: (NotesDiff | undefined)[] = [];
  const ALL: LineHighlight = {
    amount: true,
    name: true,
    notes: true,
    mapping: true,
    optional: true,
    alternative: true,
  };
  for (let k = 0; k < n; k++) {
    const c = current[k];
    const d = draft[k];
    if (!c) {
      prop.push(ALL); // added row
      notesDiffs.push(undefined);
      continue;
    }
    if (!d) {
      cur.push(ALL); // removed row
      notesDiffs.push(undefined);
      continue;
    }
    // A carried alternative the re-parse drops is, by default, being deleted —
    // its current/proposed values are identical, so the normal field-by-field
    // diff finds nothing. Show it as a removed row: fully red on the CURRENT
    // side; the PROPOSED side is struck through (no red), so it reads as "going
    // away". "Keep" clears this (it's then preserved). The struck styling is
    // applied via the read-line's `struck` prop in the proposed render.
    if (d.carriedRemovable && !d.keep) {
      cur.push(ALL);
      prop.push({});
      notesDiffs.push(undefined);
      continue;
    }
    const flags: LineHighlight = {
      // Compare the amount REPRESENTATION (quantity, quantityLow, quantifierId,
      // inflected unit label), not just the rendered string: a literal `2` and a
      // quantifier `zwei` (effective 2) read the same but differ in
      // representation, so that's a change. The unit label is pre-inflected by
      // quantity on both sides so a pure singular/plural difference is NOT a
      // change. An unassigned draft is pure text — its amount is dropped on
      // save, so compare it as fully empty (mirrors the masked current side).
      amount: amountRepresentationChanged(
        {
          quantity: c.quantity,
          quantityLow: c.quantityLow,
          quantifierId: c.quantifierId,
          unitLabel: inflect(c.unitLabel, c.quantity),
        },
        d.unassigned
          ? { quantity: null, quantityLow: null, quantifierId: null, unitLabel: null }
          : {
              quantity: toNumberOrNull(d.quantity),
              quantityLow: d.isRange ? toNumberOrNull(d.quantityLow) : null,
              quantifierId: d.quantifierId,
              unitLabel: inflect(d.unit?.name ?? null, toNumberOrNull(d.quantity)),
            },
      ),
      name: c.name.trim() !== d.name.trim(),
      notes: (c.notes ?? "").trim() !== d.notes.trim(),
      // Identity comparison, not label text: "Brauner Zucker" vs the lowercased
      // source span "brauner Zucker" is the SAME ingredient, not a change.
      mapping: currentMappingId(c) !== draftMappingId(d),
      // Optional ⇄ required is otherwise invisible (no amount/name/notes change).
      optional: c.isOptional !== (d.unassigned ? false : d.isOptional),
      // Alternative ⇄ main: tints the indent icon so a (manual) alternative the
      // re-parse promotes to a main ingredient is visible.
      alternative: c.isAlternative !== (d.unassigned ? false : d.isAlternative),
    };
    cur.push(flags);
    prop.push(flags);
    notesDiffs.push(
      flags.notes ? diffNotes(c.notes, d.notes.trim() || null) : undefined,
    );
  }
  return { current: cur, proposed: prop, notesDiffs };
}

type ScanRowSummary = {
  ingredientId: number | null;
  name: string;
  canonicalName: string | null;
  quantity: number | null;
  quantityLow: number | null;
  quantifierId: number | null;
  quantifierName: string | null;
  quantifierValue: number | null;
  quantifierSource: string | null;
  unitLabel: string | null;
  displayFraction: boolean;
  notes: string | null;
  isOptional: boolean;
  isAlternative: boolean;
};
type ScanEntry = {
  recipeId: number;
  title: string;
  sectionId: number;
  rawLine: string;
  currentRowIds: number[];
  current: ScanRowSummary[];
  proposed: Parameters<typeof parsedIngredientToDraft>[0][];
};
type EntryState = { selected: boolean; editing: boolean; draft: DraftIngredient[] };

type MutedItem = {
  id: number;
  recipeId: number;
  recipeTitle: string;
  rawLine: string | null;
};

export function BulkReparseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<ScanEntry[]>([]);
  const [states, setStates] = React.useState<EntryState[]>([]);
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());
  const [applying, setApplying] = React.useState(false);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [pendingNew, setPendingNew] = React.useState<{
    newNames: string[];
  } | null>(null);
  const [unitForms, setUnitForms] = React.useState<UnitForm[]>([]);
  const inflect = React.useMemo(() => buildUnitInflector(unitForms), [unitForms]);
  // Fraction-display flag by unit id — the proposed rows carry only a unit id,
  // so this lets the diff render them as fractions to match the current side.
  const fractionByUnitId = React.useMemo(
    () => new Map(unitForms.map((u) => [u.id, u.displayFraction])),
    [unitForms],
  );
  const loadedRef = React.useRef(false);
  const scanAbortRef = React.useRef<AbortController | null>(null);

  // Muting. Local sets hide items muted during this session without a rescan
  // (the scan already excludes server-side mutes on reopen). The "Muted" tab
  // is fed by the GET endpoint.
  const [view, setView] = React.useState<"open" | "muted">("open");
  const [mutedRecipes, setMutedRecipes] = React.useState<Set<number>>(new Set());
  const [mutedLines, setMutedLines] = React.useState<Set<string>>(new Set());
  const [mutedList, setMutedList] = React.useState<MutedItem[]>([]);
  const [mutedLoading, setMutedLoading] = React.useState(false);

  const lineKey = (recipeId: number, rawLine: string) => `${recipeId}\n${rawLine}`;

  const loadMuted = React.useCallback(async () => {
    setMutedLoading(true);
    try {
      const r = await fetch("/api/v1/recipes/reparse-mutes");
      if (r.ok) {
        const data = (await r.json()) as { mutes: MutedItem[] };
        setMutedList(data.mutes);
      }
    } catch {
      // non-critical
    } finally {
      setMutedLoading(false);
    }
  }, []);

  async function muteLine(i: number) {
    const e = entries[i];
    setMutedLines((p) => new Set(p).add(lineKey(e.recipeId, e.rawLine)));
    setEntryState(i, { selected: false });
    await fetch("/api/v1/recipes/reparse-mutes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId: e.recipeId, rawLine: e.rawLine }),
    }).catch(() => {});
    void loadMuted();
  }

  async function muteRecipe(recipeId: number, indices: number[]) {
    setMutedRecipes((p) => new Set(p).add(recipeId));
    setStates((prev) =>
      prev.map((s, idx) => (indices.includes(idx) ? { ...s, selected: false } : s)),
    );
    await fetch("/api/v1/recipes/reparse-mutes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId }),
    }).catch(() => {});
    void loadMuted();
  }

  async function unmute(m: MutedItem) {
    await fetch(`/api/v1/recipes/reparse-mutes/${m.id}`, { method: "DELETE" }).catch(
      () => {},
    );
    setMutedList((p) => p.filter((x) => x.id !== m.id));
    // Allow it back into the open list (it's still in `entries`); a full
    // resurface for never-loaded items happens on the next scan.
    if (m.rawLine == null) {
      setMutedRecipes((p) => {
        const n = new Set(p);
        n.delete(m.recipeId);
        return n;
      });
    } else {
      setMutedLines((p) => {
        const n = new Set(p);
        n.delete(lineKey(m.recipeId, m.rawLine!));
        return n;
      });
    }
  }

  async function unmuteAll() {
    const r = await fetch("/api/v1/recipes/reparse-mutes", {
      method: "DELETE",
    }).catch(() => null);
    // Only mirror the clear locally if the server actually cleared — otherwise
    // we'd hide mutes that are still persisted (same caution as single unmute).
    if (!r || !r.ok) return;
    setMutedList([]);
    setMutedRecipes(new Set());
    setMutedLines(new Set());
  }

  const runScan = React.useCallback(async () => {
    // Cancel any in-flight scan before starting a new one. Aborting the fetch
    // also disconnects the request, which the server honors to stop scanning.
    scanAbortRef.current?.abort();
    const ac = new AbortController();
    scanAbortRef.current = ac;
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const r = await fetch("/api/v1/recipes/reparse-scan", {
        method: "POST",
        signal: ac.signal,
      });
      if (!r.ok) throw new Error("scan failed");
      const data = (await r.json()) as {
        entries: ScanEntry[];
        unitForms?: UnitForm[];
      };
      setEntries(data.entries);
      setUnitForms(data.unitForms ?? []);
      setStates(
        data.entries.map((e) => ({
          selected: false,
          editing: false,
          draft: e.proposed.map(parsedIngredientToDraft),
        })),
      );
      setExpanded(new Set());
    } catch {
      // An aborted scan (dialog closed / re-scan) isn't an error.
      if (!ac.signal.aborted) setError("Scan fehlgeschlagen.");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  // Scan once each time the dialog opens; abort the in-flight scan on close.
  React.useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      setView("open");
      setMutedRecipes(new Set());
      setMutedLines(new Set());
      void runScan();
      void loadMuted();
    }
    if (!open) {
      loadedRef.current = false;
      scanAbortRef.current?.abort();
      setEntries([]);
      setStates([]);
      setSummary(null);
      setMutedList([]);
    }
  }, [open, runScan, loadMuted]);

  // Group entry indices by recipe, preserving scan order.
  const recipeGroups = React.useMemo(() => {
    const order: number[] = [];
    const byRecipe = new Map<number, { title: string; indices: number[] }>();
    entries.forEach((e, i) => {
      let g = byRecipe.get(e.recipeId);
      if (!g) {
        g = { title: e.title, indices: [] };
        byRecipe.set(e.recipeId, g);
        order.push(e.recipeId);
      }
      g.indices.push(i);
    });
    return order.map((id) => ({ recipeId: id, ...byRecipe.get(id)! }));
  }, [entries]);

  // Groups with locally-muted recipes/lines removed (the "Offen" tab view).
  const visibleGroups = React.useMemo(
    () =>
      recipeGroups
        .filter((g) => !mutedRecipes.has(g.recipeId))
        .map((g) => ({
          ...g,
          indices: g.indices.filter(
            (i) => !mutedLines.has(lineKey(entries[i].recipeId, entries[i].rawLine)),
          ),
        }))
        .filter((g) => g.indices.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recipeGroups, mutedRecipes, mutedLines, entries],
  );

  const selectedCount = states.filter((s) => s.selected).length;
  const selectedRecipeCount = new Set(
    entries.filter((_, i) => states[i]?.selected).map((e) => e.recipeId),
  ).size;

  function setEntryState(i: number, patch: Partial<EntryState>) {
    setStates((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function setDraftRow(entryIdx: number, rowIdx: number, next: DraftIngredient) {
    setStates((prev) =>
      prev.map((s, idx) =>
        idx === entryIdx
          ? { ...s, draft: s.draft.map((d, j) => (j === rowIdx ? next : d)) }
          : s,
      ),
    );
  }
  function removeDraftRow(entryIdx: number, rowIdx: number) {
    const rows = states[entryIdx]?.draft;
    // A conjunction main ("Salz und Pfeffer") deletes like an alternative: fold
    // into a sibling + chip, via re-parse. A lone main is a plain remove.
    if (rows && isConjunctionMember(rows, rowIdx)) {
      void removeAlternative(entryIdx, rowIdx);
      return;
    }
    setStates((prev) =>
      prev.map((s, idx) =>
        idx === entryIdx
          ? { ...s, draft: s.draft.filter((_, j) => j !== rowIdx) }
          : s,
      ),
    );
  }
  /** Delete an alternative by RE-PARSING its source line with the alternative
   *  folded into the primary's note (the AST regenerates the note). Falls back
   *  to a plain remove when there's no source line/range. */
  async function removeAlternative(entryIdx: number, rowIdx: number) {
    const rows = states[entryIdx]?.draft;
    if (!rows) return;
    let next: DraftIngredient[] | null = null;
    try {
      next = await reparseDeletingAlternative(rows, rowIdx);
    } catch {
      next = null;
    }
    if (!next) {
      next = rows.slice();
      next.splice(rowIdx, 1);
    }
    setEntryState(entryIdx, { draft: next });
  }
  /** Promote a folded alternative (a "create alternative" chip) to its own row
   *  by re-parsing the primary's line with that range emitted. */
  async function promoteFoldedAlternative(
    entryIdx: number,
    primaryRowIdx: number,
    range: [number, number],
  ) {
    const rows = states[entryIdx]?.draft;
    if (!rows) return;
    let next: DraftIngredient[] | null = null;
    try {
      next = await reparsePromotingAlternative(rows, primaryRowIdx, range);
    } catch {
      next = null;
    }
    if (next) setEntryState(entryIdx, { draft: next });
  }
  /** Promote a folded ingredient (a "+ add ingredient" pill) to its own MAIN row
   *  by re-parsing the primary's line with that range emitted. */
  async function promoteFoldedIngredient(
    entryIdx: number,
    primaryRowIdx: number,
    range: [number, number],
  ) {
    const rows = states[entryIdx]?.draft;
    if (!rows) return;
    let next: DraftIngredient[] | null = null;
    try {
      next = await reparsePromotingIngredient(rows, primaryRowIdx, range);
    } catch {
      next = null;
    }
    if (next) setEntryState(entryIdx, { draft: next });
  }
  /** Replace an entry's whole draft array via a pure transform — used by the
   *  alternative-management actions (add / promote / detach / demote). */
  function mutateDraft(
    entryIdx: number,
    fn: (rows: DraftIngredient[]) => DraftIngredient[],
  ) {
    setStates((prev) =>
      prev.map((s, idx) =>
        idx === entryIdx ? { ...s, draft: fn(s.draft) } : s,
      ),
    );
  }
  /** Keep the row's ORIGINAL display name (instead of the parser's proposed
   *  alias) and remember it as an alias of the matched ingredient on apply.
   *  Toggling off reverts the name to the proposed alias. Selects the entry so
   *  the choice actually gets written. */
  function toggleOriginalAsAlias(
    entryIdx: number,
    rowIdx: number,
    originalName: string,
  ) {
    setStates((prev) =>
      prev.map((s, idx) => {
        if (idx !== entryIdx) return s;
        return {
          ...s,
          selected: true,
          draft: s.draft.map((d, j) => {
            if (j !== rowIdx) return d;
            const sel = d.candidates.find(
              (c) => c.ingredientId === d.selectedIngredientId,
            );
            if (d.addAsAlias) {
              // Undo: restore the parser's proposed alias name AND its note (the
              // peeled words come back to the note now that the shorter alias is
              // the name again).
              return {
                ...d,
                name: sel?.name ?? d.name,
                notes: sel?.notes ?? d.notes,
                addAsAlias: false,
              };
            }
            // Keep the original spelling as the name. The words it carries beyond
            // the matched alias were peeled into the note — drop them so they
            // aren't duplicated in both the name and the note.
            const aliasName = sel?.name ?? d.name;
            return {
              ...d,
              name: originalName,
              notes: notesForAdoptedName(d.notes, originalName, aliasName) ?? "",
              addAsAlias: true,
            };
          }),
        };
      }),
    );
  }
  function toggleRecipe(indices: number[], value: boolean) {
    setStates((prev) =>
      prev.map((s, idx) => (indices.includes(idx) ? { ...s, selected: value } : s)),
    );
  }
  function toggleExpand(recipeId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  }
  function setAll(value: boolean) {
    // Only (de)select currently-visible entries — never re-select a muted one.
    const visibleIdx = new Set(visibleGroups.flatMap((g) => g.indices));
    setStates((prev) =>
      prev.map((s, idx) => (visibleIdx.has(idx) ? { ...s, selected: value } : s)),
    );
  }

  /** Collect the selected entries' final rows, grouped by recipe, plus the
   *  set of unmapped (new) ingredient names. */
  function collectSelection() {
    const recipes = new Map<
      number,
      { recipeId: number; replacements: { replaceRowIds: number[]; rows: unknown[] }[] }
    >();
    const newNames = new Set<string>();
    entries.forEach((e, i) => {
      if (!states[i]?.selected) return;
      const rows = states[i].draft
        // A carried alternative is dropped unless the user toggled "keep".
        .filter((d) => !d.carriedRemovable || d.keep)
        .map(ingredientToPayload)
        .filter((r): r is NonNullable<typeof r> => r !== null);
      for (const row of rows) {
        if (row.ingredientId == null && !row.unassigned) newNames.add(row.ingredientName);
      }
      let g = recipes.get(e.recipeId);
      if (!g) {
        g = { recipeId: e.recipeId, replacements: [] };
        recipes.set(e.recipeId, g);
      }
      g.replacements.push({ replaceRowIds: e.currentRowIds, rows });
    });
    return { recipes: [...recipes.values()], newNames: [...newNames] };
  }

  async function onApplyClick() {
    const { newNames } = collectSelection();
    if (newNames.length === 0) {
      await doApply([]);
      return;
    }
    // Check which are genuinely new (some may now exist as canonical/alias).
    const r = await fetch("/api/v1/ingredients/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ names: newNames }),
    });
    const data = r.ok ? ((await r.json()) as { newNames: string[] }) : { newNames: [] };
    if (data.newNames.length > 0) {
      setPendingNew({ newNames: data.newNames });
    } else {
      await doApply([]);
    }
  }

  async function doApply(newIngredientDefaults: NewIngredientDefaults[]) {
    setApplying(true);
    setError(null);
    setSummary(null);
    try {
      const { recipes } = collectSelection();
      const r = await fetch("/api/v1/recipes/reparse-apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipes,
          ...(newIngredientDefaults.length > 0 ? { newIngredientDefaults } : {}),
        }),
      });
      if (r.status === 409) {
        // Stale: a selected line's rows changed since the scan (recipe edited
        // elsewhere). The server applied NOTHING. Deselect the stale lines,
        // name them, and let the user re-apply the still-valid rest.
        const data = (await r.json().catch(() => null)) as {
          stale?: { recipeId: number; replaceRowIds: number[] }[];
        } | null;
        const staleIds = new Set(
          (data?.stale ?? []).flatMap((s) => s.replaceRowIds),
        );
        const isStale = (e: ScanEntry) =>
          e.currentRowIds.some((id) => staleIds.has(id));
        const staleLines = entries
          .filter(isStale)
          .map((e) => `${e.title}: „${e.rawLine}“`);
        setStates((prev) =>
          prev.map((s, i) =>
            entries[i] && isStale(entries[i]) ? { ...s, selected: false } : s,
          ),
        );
        setPendingNew(null);
        setSummary(
          `Nichts angewendet — diese Zeilen wurden zwischenzeitlich geändert und sind jetzt abgewählt: ${staleLines.join("; ")}. ` +
            "Den Rest erneut anwenden; für die abgewählten Zeilen den Dialog neu öffnen.",
        );
        return;
      }
      if (!r.ok) throw new Error("apply failed");
      const data = (await r.json().catch(() => null)) as {
        aliasWarnings?: AliasWarning[];
      } | null;
      setPendingNew(null);
      // The DB changed — drop the router cache so recipe pages re-render.
      router.refresh();
      const warnings = data?.aliasWarnings ?? [];
      if (warnings.length > 0) {
        // Everything was applied, but some alias requests had conflicts.
        // Keep the dialog open on the (now empty) list to show them instead
        // of closing as if nothing were noteworthy.
        setEntries([]);
        setStates([]);
        setSummary(
          `Änderungen angewendet. ${warnings.map(aliasWarningText).join(" · ")}`,
        );
        return;
      }
      // Saved — close the dialog. Reopening triggers a fresh scan (the open
      // effect resets loadedRef), so there's no need to re-run the parse here.
      onOpenChange(false);
    } catch {
      setError(
        "Anwenden fehlgeschlagen — es wurde nichts gespeichert. Die Auswahl kann erneut angewendet werden.",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-5xl sm:max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Alle Rezepte neu parsen</DialogTitle>
            <DialogDescription>
              Wendet den aktuellen Parser auf die Original-Zutatenzeilen aller
              Rezepte an. Es werden nur Zeilen mit tatsächlichen Änderungen
              gelistet. Wähle aus, was übernommen werden soll — manuelle
              Änderungen an nicht gewählten Zeilen bleiben unangetastet.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex-1 overflow-y-auto">
            <div className="mb-3 flex items-center gap-1 border-b border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => setView("open")}
                className={cn(
                  "-mb-px border-b-2 px-3 py-1.5 text-sm",
                  view === "open"
                    ? "border-[var(--color-accent)] font-medium"
                    : "border-transparent text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
                )}
              >
                Offen
              </button>
              <button
                type="button"
                onClick={() => setView("muted")}
                className={cn(
                  "-mb-px flex items-center gap-1 border-b-2 px-3 py-1.5 text-sm",
                  view === "muted"
                    ? "border-[var(--color-accent)] font-medium"
                    : "border-transparent text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
                )}
              >
                <VolumeX className="size-3.5" />
                Stummgeschaltet
                {mutedList.length > 0 ? ` (${mutedList.length})` : ""}
              </button>
            </div>
            {view === "muted" ? (
              mutedLoading ? (
                <div className="flex items-center gap-2 py-8 text-[var(--color-muted-fg)]">
                  <Loader2 className="size-4 animate-spin" /> Lädt…
                </div>
              ) : mutedList.length === 0 ? (
                <p className="py-8 text-[var(--color-muted-fg)]">
                  Nichts stummgeschaltet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void unmuteAll()}
                    >
                      <Volume2 className="size-4" /> Alle aufheben
                    </Button>
                  </div>
                  <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
                    {mutedList.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{m.recipeTitle}</p>
                          <p className="truncate text-xs text-[var(--color-muted-fg)]">
                            {m.rawLine == null ? "Ganzes Rezept" : `„${m.rawLine}“`}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void unmute(m)}
                        >
                          <Volume2 className="size-4" /> Aufheben
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ) : loading ? (
              <div className="flex items-center gap-2 py-8 text-[var(--color-muted-fg)]">
                <Loader2 className="size-4 animate-spin" /> Prüfe Rezepte…
              </div>
            ) : error && visibleGroups.length === 0 ? (
              <p className="py-8 text-[var(--color-danger,#c00)]">{error}</p>
            ) : visibleGroups.length === 0 ? (
              <p className="py-8 text-[var(--color-muted-fg)]">
                {summary ??
                  (entries.length === 0
                    ? "Keine Änderungen gefunden."
                    : "Alle Änderungen stummgeschaltet.")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {error ? (
                  <p className="text-sm text-[var(--color-danger,#c00)]">{error}</p>
                ) : null}
                {summary ? (
                  // In-list summary = the stale-apply notice (warnings clear
                  // the list first) — render it as a warning, not muted text.
                  <p className="text-sm text-[var(--color-danger,#c00)]">{summary}</p>
                ) : null}
                <div className="flex items-center gap-3 text-sm">
                  <button
                    type="button"
                    className="text-[var(--color-accent)] hover:underline"
                    onClick={() => setAll(true)}
                  >
                    Alle auswählen
                  </button>
                  <button
                    type="button"
                    className="text-[var(--color-accent)] hover:underline"
                    onClick={() => setAll(false)}
                  >
                    Alle abwählen
                  </button>
                </div>
                {visibleGroups.map((g) => {
                  const allSel = g.indices.every((i) => states[i]?.selected);
                  const someSel = g.indices.some((i) => states[i]?.selected);
                  const isOpen = expanded.has(g.recipeId);
                  return (
                    <div
                      key={g.recipeId}
                      className="rounded-[var(--radius)] border border-[var(--color-border)]"
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--color-accent)]"
                          checked={allSel}
                          ref={(el) => {
                            if (el) el.indeterminate = someSel && !allSel;
                          }}
                          onChange={(e) => toggleRecipe(g.indices, e.target.checked)}
                        />
                        <button
                          type="button"
                          className="flex flex-1 items-center gap-1 text-left font-medium"
                          onClick={() => toggleExpand(g.recipeId)}
                        >
                          {isOpen ? (
                            <ChevronDown className="size-4 shrink-0" />
                          ) : (
                            <ChevronRight className="size-4 shrink-0" />
                          )}
                          <span className="truncate">{g.title}</span>
                          <span className="ml-1 text-xs text-[var(--color-muted-fg)]">
                            ({g.indices.length})
                          </span>
                        </button>
                        <button
                          type="button"
                          className="shrink-0 rounded p-1 text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
                          title="Ganzes Rezept stummschalten"
                          aria-label={`${g.title} stummschalten`}
                          onClick={() => void muteRecipe(g.recipeId, g.indices)}
                        >
                          <VolumeX className="size-4" />
                        </button>
                      </div>
                      {isOpen ? (
                        <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                          {g.indices.map((i) => {
                            const entry = entries[i];
                            const st = states[i];
                            const hi = computeHighlights(
                              entry.current,
                              st.draft,
                              inflect,
                            );
                            // The freshly-parsed proposal (what the draft started
                            // as). "Dirty" means the user manually edited it, so
                            // the original side offers a reparse/revert button.
                            const pristine = entry.proposed.map(parsedIngredientToDraft);
                            const dirty =
                              JSON.stringify(st.draft) !== JSON.stringify(pristine);
                            return (
                              <div key={i} className="flex flex-col gap-2 px-3 py-2">
                                <div className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    className="mt-1 size-4 accent-[var(--color-accent)]"
                                    checked={st.selected}
                                    onChange={(e) =>
                                      setEntryState(i, { selected: e.target.checked })
                                    }
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <p
                                        className="min-w-0 flex-1 truncate text-xs text-[var(--color-muted-fg)]"
                                        title={entry.rawLine}
                                      >
                                        Original: „{entry.rawLine}“
                                      </p>
                                      {dirty ? (
                                        <button
                                          type="button"
                                          className="shrink-0 rounded p-1 text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
                                          title="Aus der Originalzeile neu parsen (verwirft die manuellen Änderungen)."
                                          aria-label="Aus Originalzeile neu parsen"
                                          onClick={() =>
                                            setEntryState(i, { draft: pristine })
                                          }
                                        >
                                          <ScanText className="size-3.5" />
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        className="shrink-0 rounded p-1 text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
                                        title="Diese Zeile stummschalten"
                                        aria-label="Zeile stummschalten"
                                        onClick={() => void muteLine(i)}
                                      >
                                        <VolumeX className="size-3.5" />
                                      </button>
                                    </div>
                                    <div className="mt-1 grid gap-3 text-sm md:grid-cols-2">
                                      <div>
                                        <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-[var(--color-muted-fg)]">
                                          Aktuell
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                          {entry.current.map((c, k) => (
                                            <RecipeIngredientReadLine
                                              key={k}
                                              quantity={c.quantity}
                                              quantityLow={c.quantityLow}
                                              quantifierName={c.quantifierName}
                                              quantifierValue={c.quantifierValue}
                                              quantifierSource={c.quantifierSource}
                                              quantifierTooltip
                                              unitLabel={inflect(
                                                c.unitLabel,
                                                c.quantity ?? c.quantifierValue,
                                              )}
                                              displayFraction={c.displayFraction}
                                              name={c.name}
                                              canonicalName={c.canonicalName}
                                              notes={c.notes}
                                              isOptional={c.isOptional}
                                              isAlternative={c.isAlternative}
                                              mappingLabel={currentMappingLabel(c)}
                                              highlight={hi.current[k]}
                                              tone="removed"
                                              notesDiff={hi.notesDiffs[k]?.current}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-[var(--color-accent)]">
                                          Neu
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                          {st.draft.map((d, k) => {
                                            const cur = entry.current[k];
                                            const isMatched =
                                              !d.unassigned &&
                                              d.selectedIngredientId != null &&
                                              cur != null;
                                            // Offer "keep original + alias" when
                                            // the parser renamed a matched row;
                                            // keep showing it (as an undo) once
                                            // chosen.
                                            const showAlias =
                                              isMatched &&
                                              (d.addAsAlias ||
                                                cur.name.trim() !== d.name.trim());
                                            return (
                                              <div
                                                key={k}
                                                className="flex flex-col gap-0.5"
                                              >
                                                <RecipeIngredientReadLine
                                                  // Unassigned drafts are pure
                                                  // text — the amount is dropped
                                                  // on save, so don't preview it.
                                                  quantity={
                                                    d.unassigned
                                                      ? null
                                                      : toNumberOrNull(d.quantity)
                                                  }
                                                  quantityLow={
                                                    d.unassigned || !d.isRange
                                                      ? null
                                                      : toNumberOrNull(d.quantityLow)
                                                  }
                                                  quantifierName={
                                                    d.unassigned
                                                      ? null
                                                      : (d.quantifierName ?? null)
                                                  }
                                                  quantifierValue={
                                                    d.unassigned
                                                      ? null
                                                      : (d.quantifierValue ?? null)
                                                  }
                                                  quantifierSource={
                                                    d.unassigned
                                                      ? null
                                                      : (d.quantifierSource ?? null)
                                                  }
                                                  unitSource={
                                                    d.unassigned
                                                      ? null
                                                      : (d.rawUnit ?? null)
                                                  }
                                                  quantifierTooltip
                                                  unitLabel={
                                                    d.unassigned
                                                      ? null
                                                      : inflect(
                                                          d.unit?.name ?? null,
                                                          toNumberOrNull(d.quantity) ??
                                                            (d.quantifierValue ?? null),
                                                        )
                                                  }
                                                  displayFraction={
                                                    d.unit?.id != null
                                                      ? (fractionByUnitId.get(
                                                          d.unit.id,
                                                        ) ?? false)
                                                      : false
                                                  }
                                                  name={d.name}
                                                  canonicalName={d.canonicalName}
                                                  notes={d.notes.trim() || null}
                                                  isOptional={d.isOptional}
                                                  isAlternative={d.isAlternative}
                                                  fixedAmount={d.fixedAmount}
                                                  highlight={hi.proposed[k]}
                                                  tone="added"
                                                  struck={d.carriedRemovable && !d.keep}
                                                  mappingLabel={draftMappingLabel(d)}
                                                  notesDiff={hi.notesDiffs[k]?.proposed}
                                                />
                                                {d.carriedRemovable ? (
                                                  <button
                                                    type="button"
                                                    className="self-start text-xs text-[var(--color-accent)] hover:underline"
                                                    onClick={() =>
                                                      setDraftRow(i, k, {
                                                        ...d,
                                                        keep: !d.keep,
                                                      })
                                                    }
                                                  >
                                                    {d.keep
                                                      ? "↩ Alternative doch entfernen"
                                                      : "Alternative behalten (nicht entfernen)"}
                                                  </button>
                                                ) : null}
                                                {showAlias ? (
                                                  <button
                                                    type="button"
                                                    className="self-start text-xs text-[var(--color-accent)] hover:underline"
                                                    onClick={() =>
                                                      toggleOriginalAsAlias(
                                                        i,
                                                        k,
                                                        cur.name,
                                                      )
                                                    }
                                                  >
                                                    {d.addAsAlias
                                                      ? `↩ „${cur.name}“ doch nicht als Alias`
                                                      : `„${cur.name}“ behalten & als Alias übernehmen`}
                                                  </button>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      className="mt-1 text-xs text-[var(--color-accent)] hover:underline"
                                      onClick={() =>
                                        setEntryState(i, { editing: !st.editing })
                                      }
                                    >
                                      {st.editing ? "Bearbeitung schließen" : "Bearbeiten"}
                                    </button>
                                  </div>
                                </div>
                                {st.editing ? (
                                  // Full-width edit panel (outside the checkbox
                                  // column) on a distinct background so the
                                  // non-selected candidate pills (which use the
                                  // muted background) stay visible.
                                  <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                                    <DraftEditList
                                      rows={st.draft}
                                      onChangeRow={(k, next) => setDraftRow(i, k, next)}
                                      onRemoveRow={(k) => removeDraftRow(i, k)}
                                      onRemoveAlternative={(k) => removeAlternative(i, k)}
                                      onPromoteFolded={(k, range) => promoteFoldedAlternative(i, k, range)}
                                      onPromoteFoldedIngredient={(k, range) =>
                                        promoteFoldedIngredient(i, k, range)
                                      }
                                      onMutate={(fn) => mutateDraft(i, fn)}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </DialogBody>
          <DialogFooter className="flex items-center justify-between gap-2">
            <span className="text-sm text-[var(--color-muted-fg)]">
              {selectedCount} Änderungen in {selectedRecipeCount} Rezepten ausgewählt
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Schließen
              </Button>
              <Button
                onClick={onApplyClick}
                disabled={selectedCount === 0 || applying}
              >
                {applying ? <Loader2 className="size-4 animate-spin" /> : null}
                Auswahl anwenden
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NewIngredientsDialog
        open={pendingNew !== null}
        newNames={pendingNew?.newNames ?? []}
        saving={applying}
        onCancel={() => setPendingNew(null)}
        onConfirm={(defaults) => void doApply(defaults)}
      />
    </>
  );
}
