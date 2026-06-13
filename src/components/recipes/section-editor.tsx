"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Loader2,
  Plus,
  Split,
  Trash2,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Textarea } from "@/components/ui/textarea";
import { IngredientRow } from "./ingredient-row";
import {
  reparseGroupAt,
  reparseDeletingAlternative,
  reparsePromotingAlternative,
  isConjunctionMember,
} from "./reparse";
import {
  emptyIngredient,
  parsedIngredientToDraft,
  type DraftIngredient,
  type DraftSection,
  type ParsedIngredientResponse,
} from "./types";
import {
  addAlternativeAfter,
  promoteAlternative as applyPromoteAlternative,
  detachAlternative as applyDetachAlternative,
  demoteToAlternative as applyDemoteToAlternative,
} from "./alternatives";

/**
 * Read the clipboard with a short timeout so a hanging permission prompt
 * (Firefox / Safari / http://localhost in some browsers) doesn't lock the
 * dialog. Returns null on any failure — the textarea acts as a manual
 * fallback either way.
 */
async function tryReadClipboard(timeoutMs = 800): Promise<string | null> {
  if (!navigator.clipboard?.readText) return null;
  try {
    const text = await Promise.race([
      navigator.clipboard.readText(),
      new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
    return typeof text === "string" && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export type ParsedSectionGroupResponse = {
  title: string | null;
  ingredients: ParsedIngredientResponse[];
};

type Props = {
  section: DraftSection;
  index: number;
  total: number;
  onChange: (next: DraftSection) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  /** Called by the paste flow when the pasted text contained section
   *  headers ("Für den Teig:", "FÜR DIE FÜLLUNG"). Receives one DraftSection
   *  per additional section to append AFTER this one. */
  onAppendSections?: (sections: DraftSection[]) => void;
  /** Split this section before the given flat ingredient index: that row and
   *  everything below it move into a fresh section inserted right after this
   *  one. Triggered from the affordance on the border between two groups. */
  onSplit?: (ingredientIndex: number) => void;
};

/**
 * A draft row counts as "blank" when it has no name and no quantity — i.e.
 * the placeholder row the section starts with. Paste should replace those
 * rather than appending below them so the user doesn't end up with an empty
 * row above the freshly-parsed entries.
 */
function isBlankDraft(d: DraftIngredient): boolean {
  return d.name.trim().length === 0 && d.quantity.trim().length === 0;
}

export function SectionEditor({
  section,
  index,
  total,
  onChange,
  onRemove,
  onMove,
  onAppendSections,
  onSplit,
}: Props) {
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [pasting, setPasting] = React.useState(false);
  const [pasteError, setPasteError] = React.useState<string | null>(null);
  const [pasteInfo, setPasteInfo] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  function setIngredient(i: number, next: DraftIngredient) {
    const ings = section.ingredients.slice();
    // Alternatives are ALWAYS optional. The IngredientRow's Optional
    // toggle is locked when `value.isAlternative`, but defensive
    // normalization here covers any other code path that might mutate
    // the flag (e.g. live-matcher auto-resolution to an equipment item,
    // or a future paste flow). Keeps the form state and persistence
    // invariants aligned.
    ings[i] = next.isAlternative ? { ...next, isOptional: true } : next;
    onChange({ ...section, ingredients: ings });
  }

  /** Re-parse one row from its original source line, replacing it (and any
   *  alternatives expanded from the same line) with freshly parsed rows. */
  async function reparseAt(i: number) {
    const next = await reparseGroupAt(section.ingredients, i);
    onChange({ ...section, ingredients: next });
  }

  /** Promote a folded alternative (a "create alternative" chip) on the primary
   *  at `primaryIdx` to its own row by re-parsing the line with that range
   *  emitted. */
  async function promoteFoldedAlternative(primaryIdx: number, range: [number, number]) {
    let next: DraftIngredient[] | null = null;
    try {
      next = await reparsePromotingAlternative(section.ingredients, primaryIdx, range);
    } catch {
      next = null;
    }
    if (next) onChange({ ...section, ingredients: next });
  }

  function addIngredient() {
    onChange({
      ...section,
      ingredients: [...section.ingredients, emptyIngredient()],
    });
  }

  // Pending uid of a row inserted via the divider button, focused once its
  // IngredientRow has mounted. Mirrors recipe-form's scrollToSectionUid.
  const [focusIngredientUid, setFocusIngredientUid] = React.useState<
    string | null
  >(null);
  React.useEffect(() => {
    if (!focusIngredientUid) return;
    const row = document.getElementById(`ingredient-row-${focusIngredientUid}`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
      row.querySelector("input")?.focus();
    }
    // Consume the trigger so a re-render doesn't steal focus again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusIngredientUid(null);
  }, [focusIngredientUid]);

  /** Insert an empty row before the primary at `i` — i.e. on the divider
   *  between two groups, where the button sits. Inserting before a primary
   *  can never land inside an alternatives group. */
  function insertIngredientAt(i: number) {
    const fresh = emptyIngredient();
    const ings = section.ingredients.slice();
    ings.splice(i, 0, fresh);
    onChange({ ...section, ingredients: ings });
    setFocusIngredientUid(fresh.uid);
  }

  /**
   * Find the row index of the primary that owns the row at `i`. Returns `i`
   * itself when the row is already a primary. Maintains the invariant that
   * alternatives always sit directly after their primary (which the
   * server-side write path also assumes).
   */
  function findPrimaryIndex(i: number): number {
    let j = i;
    while (j > 0 && section.ingredients[j].isAlternative) j -= 1;
    return j;
  }

  /** Index of the LAST row in the alternative group rooted at `primaryIdx`. */
  function lastInGroup(primaryIdx: number): number {
    let j = primaryIdx;
    while (
      j + 1 < section.ingredients.length &&
      section.ingredients[j + 1].isAlternative
    )
      j += 1;
    return j;
  }

  function addAlternative(afterIdx: number) {
    onChange({
      ...section,
      ingredients: addAlternativeAfter(section.ingredients, afterIdx),
    });
  }

  /**
   * Swap an alternative with its primary: the alternative becomes the new
   * primary; the old primary becomes an alternative alongside any other
   * siblings. The group stays intact, just under a different leader. The
   * inverse-by-position action is {@link detachAlternative}, which removes
   * the alt from the group instead of trading places.
   */
  function promoteAlternative(altIdx: number) {
    onChange({
      ...section,
      ingredients: applyPromoteAlternative(section.ingredients, altIdx),
    });
  }

  /**
   * Detach an alternative: it becomes a standalone primary, positioned
   * right after the old group's last sibling. The previous primary and
   * any remaining siblings stay grouped under that primary. Inverse of
   * {@link demoteToAlternative}.
   */
  function detachAlternative(altIdx: number) {
    onChange({
      ...section,
      ingredients: applyDetachAlternative(section.ingredients, altIdx),
    });
  }

  /**
   * Demote a primary row into an alternative of the row immediately above
   * it (joining whatever group that row is part of). Inverse of
   * {@link detachAlternative}. No-op when:
   *   - this is the first row in the section (no prior to attach to)
   *   - this row already is an alternative
   *   - this row has its own alternatives that would be orphaned by the
   *     depth-1 invariant — the user has to detach those first
   */
  function demoteToAlternative(i: number) {
    onChange({
      ...section,
      ingredients: applyDemoteToAlternative(section.ingredients, i),
    });
  }

  // Confirm dialog for "delete a primary that has alternatives". Holds the
  // index of the row pending deletion; null when no confirm is open.
  const [pendingDeletePrimary, setPendingDeletePrimary] = React.useState<
    number | null
  >(null);

  async function requestRemove(i: number) {
    const row = section.ingredients[i];
    if (row.isAlternative || isConjunctionMember(section.ingredients, i)) {
      // An alternative — or a conjunction main ("Salz und Pfeffer") — is deleted
      // by RE-PARSING its source line with it folded into a sibling's note (AST-
      // generated, never string-concatenated), leaving a chip to re-add it.
      // Falls back to a plain remove when there's no source line/range.
      let next: DraftIngredient[] | null = null;
      try {
        next = await reparseDeletingAlternative(section.ingredients, i);
      } catch {
        next = null;
      }
      if (!next) {
        next = section.ingredients.slice();
        next.splice(i, 1);
      }
      onChange({ ...section, ingredients: next });
      return;
    }
    // Primary: cascade-aware.
    const last = lastInGroup(i);
    if (last === i) {
      // No alternatives — drop the primary as-is.
      const ings = section.ingredients.slice();
      ings.splice(i, 1);
      onChange({ ...section, ingredients: ings });
      return;
    }
    setPendingDeletePrimary(i);
  }

  function confirmDeletePrimaryAll() {
    if (pendingDeletePrimary === null) return;
    const primaryIdx = pendingDeletePrimary;
    const last = lastInGroup(primaryIdx);
    const ings = section.ingredients.slice();
    ings.splice(primaryIdx, last - primaryIdx + 1);
    onChange({ ...section, ingredients: ings });
    setPendingDeletePrimary(null);
  }

  function confirmDeletePrimaryKeepAlts() {
    if (pendingDeletePrimary === null) return;
    const primaryIdx = pendingDeletePrimary;
    const last = lastInGroup(primaryIdx);
    const ings = section.ingredients.slice();
    // Promote the first alternative (immediately following the deleted
    // primary) to primary; the rest stay attached to it.
    const newPrimary: DraftIngredient = {
      ...ings[primaryIdx + 1],
      isAlternative: false,
    };
    ings.splice(primaryIdx, last - primaryIdx + 1, newPrimary, ...ings.slice(primaryIdx + 2, last + 1));
    onChange({ ...section, ingredients: ings });
    setPendingDeletePrimary(null);
  }

  async function openPasteDialog() {
    setPasteError(null);
    setPasteInfo(null);
    setPasteText("");
    setPasteOpen(true);
    // Best-effort: try to pre-fill from the clipboard so the common case
    // works in one click. The user can paste / edit manually otherwise.
    const text = await tryReadClipboard();
    if (text) {
      setPasteText(text);
    } else {
      // Hand the focus to the textarea so Ctrl/Cmd+V works directly.
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  async function submitPaste() {
    setPasteError(null);
    setPasteInfo(null);
    const text = pasteText.trim();
    if (text.length === 0) {
      setPasteError("Bitte Text einfügen.");
      return;
    }
    setPasting(true);
    try {
      const res = await fetch("/api/v1/ingredients/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        items: ParsedIngredientResponse[];
        sections?: ParsedSectionGroupResponse[];
      };
      if (data.items.length === 0) {
        setPasteError("Konnte keine Zutaten erkennen.");
        return;
      }

      // Section-aware path: when the paste contained section headers
      // ("Für den Teig:", "FÜR DIE FÜLLUNG"), the response carries one
      // ParsedSectionGroup per detected header.
      const groups = data.sections ?? [
        { title: null, ingredients: data.items },
      ];

      const firstGroup = groups[0];
      const firstDrafts = firstGroup.ingredients.map(parsedIngredientToDraft);
      const keep = section.ingredients.filter((i) => !isBlankDraft(i));
      const updatedFirst: DraftSection = {
        ...section,
        // Inherit the first group's title only when the current section has
        // no title yet — avoids surprising the user by renaming a labelled
        // section just because they pasted text starting with a header.
        title:
          section.title.trim().length === 0 && firstGroup.title
            ? firstGroup.title
            : section.title,
        ingredients: [...keep, ...firstDrafts],
      };
      onChange(updatedFirst);

      const extraGroups = groups.slice(1);
      if (extraGroups.length > 0 && onAppendSections) {
        const extras: DraftSection[] = extraGroups.map((g) => ({
          uid: crypto.randomUUID(),
          title: g.title ?? "",
          instructions: "",
          ingredients: g.ingredients.map(parsedIngredientToDraft),
        }));
        onAppendSections(extras);
      }

      const totalDrafts = data.items.length;
      setPasteOpen(false);
      setPasteInfo(
        extraGroups.length > 0
          ? `${totalDrafts} Zutaten in ${groups.length} Abschnitte eingefügt.`
          : `${totalDrafts} Zutat${totalDrafts === 1 ? "" : "en"} eingefügt.`,
      );
      window.setTimeout(() => setPasteInfo(null), 3000);
    } catch (e) {
      setPasteError(
        e instanceof Error ? e.message : "Einfügen fehlgeschlagen.",
      );
    } finally {
      setPasting(false);
    }
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 md:p-6">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <Label htmlFor={`section-title-${section.uid}`} className="sr-only">
            Abschnittstitel
          </Label>
          <Input
            id={`section-title-${section.uid}`}
            placeholder={`Abschnitt ${index + 1} (optional, z. B. „Teig")`}
            value={section.title}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="Nach oben"
          className="h-9 w-9 md:h-11 md:w-11"
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label="Nach unten"
          className="h-9 w-9 md:h-11 md:w-11"
        >
          <ArrowDown className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={total === 1}
          aria-label="Abschnitt entfernen"
          className="h-9 w-9 md:h-11 md:w-11"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        <Label htmlFor={`section-ingredients-${section.uid}`}>Zutaten</Label>
        <SortableContext
          // Each draggable here is a GROUP (primary + its alternatives), keyed
          // by the primary's uid, so dragging the primary's grip moves the
          // whole block. Alternatives are a separate nested sortable list
          // inside the group (see IngredientGroup) so they can be reordered
          // among themselves without leaving the group.
          items={buildGroups(section.ingredients).map((g) => g.primary.uid)}
          strategy={verticalListSortingStrategy}
        >
          <IngredientDropZone
            id={section.uid}
            isEmpty={section.ingredients.length === 0}
          >
            {buildGroups(section.ingredients).map((g) => {
              // Demote is only meaningful when there's a prior row to
              // attach this primary to AND this primary has no alts that
              // would be orphaned. The button is suppressed entirely in
              // those cases (cleaner than a disabled icon).
              const canDemote =
                g.primaryIdx > 0 && g.alternatives.length === 0;
              return (
                <IngredientGroup
                  key={g.primary.uid}
                  group={g}
                  onChange={setIngredient}
                  onRemove={requestRemove}
                  onReparse={reparseAt}
                  onAddAlternative={() => addAlternative(g.primaryIdx)}
                  onDemote={
                    canDemote ? () => demoteToAlternative(g.primaryIdx) : undefined
                  }
                  onPromote={promoteAlternative}
                  onDetach={detachAlternative}
                  onPromoteFolded={(range) => promoteFoldedAlternative(g.primaryIdx, range)}
                  onSplitAbove={
                    onSplit && g.primaryIdx > 0
                      ? () => onSplit(g.primaryIdx)
                      : undefined
                  }
                  onInsertAbove={
                    g.primaryIdx > 0
                      ? () => insertIngredientAt(g.primaryIdx)
                      : undefined
                  }
                />
              );
            })}
          </IngredientDropZone>
        </SortableContext>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addIngredient}
          >
            <Plus className="size-4" />
            Zutat hinzufügen
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openPasteDialog}
            title="Öffnet ein Eingabefeld — Text einfügen, dann parsen."
          >
            <ClipboardPaste className="size-4" />
            Aus Zwischenablage einfügen
          </Button>
          {pasteInfo ? (
            <span className="text-xs text-[var(--color-success)]">
              {pasteInfo}
            </span>
          ) : null}
        </div>
      </div>

      <Dialog
        open={pendingDeletePrimary !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeletePrimary(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hauptzutat mit Alternativen löschen</DialogTitle>
            <DialogDescription>
              {pendingDeletePrimary !== null
                ? `„${section.ingredients[pendingDeletePrimary]?.name || "Diese Zutat"}" hat ${
                    lastInGroup(pendingDeletePrimary) - pendingDeletePrimary
                  } Alternative(n). Was soll mit ihnen passieren?`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Abbrechen
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="danger"
              onClick={confirmDeletePrimaryAll}
            >
              <Trash2 className="size-4" />
              Alle löschen
            </Button>
            <Button type="button" onClick={confirmDeletePrimaryKeepAlts}>
              Alternativen behalten
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zutaten aus Text einfügen</DialogTitle>
            <DialogDescription>
              Eine Zutat pro Zeile. HTML-Tabellen aus Rezeptseiten
              (Chefkoch &amp; Co.) werden ebenfalls erkannt — Menge und Name
              auf separaten Zeilen werden zusammengefügt.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <Textarea
              ref={textareaRef}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={10}
              placeholder={"500 g Mehl\n2 Eier\nSalz"}
              autoFocus
            />
            {pasteError ? (
              <p className="text-sm text-[var(--color-danger)]">{pasteError}</p>
            ) : null}
          </DialogBody>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pasting}>
                Abbrechen
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={submitPaste}
              disabled={pasting || pasteText.trim().length === 0}
            >
              {pasting ? <Loader2 className="size-4 animate-spin" /> : null}
              Parsen &amp; Einfügen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-4">
        <Label htmlFor={`section-instructions-${section.uid}`}>
          Anleitung (Markdown)
        </Label>
        <MarkdownEditor
          id={`section-instructions-${section.uid}`}
          rows={8}
          placeholder="1. ..."
          value={section.instructions}
          onChange={(instructions) => onChange({ ...section, instructions })}
          className="mt-1.5"
        />
      </div>
    </div>
  );
}

/**
 * Walk the flat ingredients array (in display order) and produce one
 * descriptor per primary + its trailing alternatives. The primary's index
 * in the original array is preserved so callbacks can map back to the
 * flat state.
 */
type IngredientGroupShape = {
  primary: DraftIngredient;
  primaryIdx: number;
  alternatives: DraftIngredient[];
};

function buildGroups(ingredients: DraftIngredient[]): IngredientGroupShape[] {
  const groups: IngredientGroupShape[] = [];
  for (let i = 0; i < ingredients.length; i++) {
    const ing = ingredients[i];
    if (ing.isAlternative && groups.length > 0) {
      groups[groups.length - 1].alternatives.push(ing);
    } else {
      // First row OR an alternative orphaned at the top of a section
      // (defensively treated as a primary so the array stays well-shaped).
      groups.push({ primary: ing, primaryIdx: i, alternatives: [] });
    }
  }
  return groups;
}

/**
 * One draggable unit: a primary row plus any alternatives below it. The
 * `useSortable` hook is owned here (not on individual rows) so the whole
 * block follows the cursor during a drag, and so the alternatives don't
 * appear in the section's sortable index as standalone items.
 */
function IngredientGroup({
  group,
  onChange,
  onRemove,
  onReparse,
  onAddAlternative,
  onDemote,
  onPromote,
  onDetach,
  onPromoteFolded,
  onSplitAbove,
  onInsertAbove,
}: {
  group: IngredientGroupShape;
  onChange: (flatIdx: number, next: DraftIngredient) => void;
  onRemove: (flatIdx: number) => void;
  onReparse: (flatIdx: number) => void | Promise<void>;
  onAddAlternative: () => void;
  /** Promote one of the primary's folded (unmatched) alternatives to a row. */
  onPromoteFolded: (range: [number, number]) => void;
  /** Make this primary an alternative of the row immediately above it.
   *  Undefined when the primary is the first row of the section or has
   *  its own alternatives (which would be orphaned). */
  onDemote?: () => void;
  /** Swap an alternative with its primary: the alt takes over as leader,
   *  the old primary becomes an alternative beside the other siblings.
   *  The group stays intact, just under different leadership. */
  onPromote: (flatIdx: number) => void;
  /** Detach an alternative to become its own primary, leaving the old
   *  group intact and stepping out to a position right after it. */
  onDetach: (flatIdx: number) => void;
  /** Split the section right above this group. Undefined on the first
   *  group (nothing above to split off). */
  onSplitAbove?: () => void;
  /** Insert a fresh ingredient row right above this group — on the same
   *  divider as the split button. Undefined on the first group. */
  onInsertAbove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.primary.uid });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        // py-2 widens only the gaps at the group's outer edges — i.e. around
        // the between-groups divider where the split button sits — while the
        // primary↔alternative dividers inside the group keep the tighter
        // row padding.
        "relative divide-y divide-[var(--color-border)] py-2",
        isDragging && "z-10 opacity-40",
      )}
    >
      {/* Insert + split affordances, always visible, straddling the divider
          above this group as absolute overlays — out of flow, so they can
          never reflow the list (cf. the candidate-pill hover-flicker fix).
          Rendered as the FIRST children: Tailwind v4's divide-y puts a
          border-BOTTOM on every non-last child, so as last children they
          would strip the rows' :last-child status and paint a stray second
          line under the final row; as first children the only side effect is
          a border-bottom on the buttons themselves, which their own 1px full
          border makes a visual no-op. Hidden while the group is dragged. */}
      {onInsertAbove && !isDragging ? (
        <button
          type="button"
          onClick={onInsertAbove}
          className={cn(
            "absolute right-12 top-0 z-10 -translate-y-1/2",
            "inline-flex items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 text-[var(--color-muted-fg)]",
            "transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]",
          )}
          title="Zutat hier einfügen — eine leere Zeile erscheint an dieser Stelle."
          aria-label="Zutat hier einfügen"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {onSplitAbove && !isDragging ? (
        <button
          type="button"
          onClick={onSplitAbove}
          className={cn(
            "absolute right-3 top-0 z-10 -translate-y-1/2",
            "inline-flex items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 text-[var(--color-muted-fg)]",
            "transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]",
          )}
          title="Abschnitt hier teilen — die Zeilen ab hier wandern in einen neuen Abschnitt."
          aria-label="Abschnitt hier teilen"
        >
          <Split className="size-3.5 rotate-90" aria-hidden />
        </button>
      ) : null}
      <IngredientRow
        value={group.primary}
        onChange={(next) => onChange(group.primaryIdx, next)}
        onRemove={() => onRemove(group.primaryIdx)}
        onReparse={() => onReparse(group.primaryIdx)}
        onAddAlternative={onAddAlternative}
        onDemote={onDemote}
        onPromoteFolded={onPromoteFolded}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
      {/* Alternatives form their own nested sortable list so they can be
          reordered among themselves (within this group only). The drag is
          handled by the same DndContext in recipe-form; its onDragEnd routes
          an alternative `active.id` through moveAlternativeWithinGroup. */}
      <SortableContext
        items={group.alternatives.map((alt) => alt.uid)}
        strategy={verticalListSortingStrategy}
      >
        {group.alternatives.map((alt, j) => {
          const flatIdx = group.primaryIdx + 1 + j;
          return (
            <SortableAlternativeRow
              key={alt.uid}
              alt={alt}
              onChange={(next) => onChange(flatIdx, next)}
              onRemove={() => onRemove(flatIdx)}
              onReparse={() => onReparse(flatIdx)}
              onPromote={() => onPromote(flatIdx)}
              onDetach={() => onDetach(flatIdx)}
            />
          );
        })}
      </SortableContext>
    </div>
  );
}

/**
 * One alternative row wired as its own sortable item so its grip can reorder
 * it within the group. The grip props flow into {@link IngredientRow}, which
 * renders a handle on the leading slot only when they're present.
 */
function SortableAlternativeRow({
  alt,
  onChange,
  onRemove,
  onReparse,
  onPromote,
  onDetach,
}: {
  alt: DraftIngredient;
  onChange: (next: DraftIngredient) => void;
  onRemove: () => void;
  onReparse: () => void;
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
        onReparse={onReparse}
        onPromote={onPromote}
        onDetach={onDetach}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </div>
  );
}

/**
 * Wraps the ingredient list as a drop target so dragged ingredients can land
 * in this section even when it has no rows yet (no SortableItem to hit). The
 * droppable id matches `section.uid`; the recipe-form handler treats an `over`
 * id matching a section as "append to that section".
 */
function IngredientDropZone({
  id,
  isEmpty,
  children,
}: {
  id: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: "section" } });
  return (
    <div
      ref={setNodeRef}
      id={`section-ingredients-${id}`}
      className={cn(
        // `divide-y` draws a horizontal rule between rows; each
        // IngredientRow contributes its own py-3 so the rule sits centred
        // in a comfortable gap.
        "transition-colors divide-y divide-[var(--color-border)]",
        isEmpty &&
          "min-h-14 border border-dashed border-[var(--color-border)] p-2 text-center text-xs text-[var(--color-muted-fg)]",
        isOver &&
          "bg-[color-mix(in_srgb,var(--color-accent),var(--color-bg)_85%)] ring-1 ring-[var(--color-accent)]",
      )}
    >
      {isEmpty ? (
        <p className="py-2">Zutaten hier ablegen oder „Zutat hinzufügen“.</p>
      ) : (
        children
      )}
    </div>
  );
}
