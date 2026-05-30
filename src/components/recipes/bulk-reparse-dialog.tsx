"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
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
import { ingredientToPayload, toNumberOrNull } from "./payload";
import { RecipeIngredientReadLine } from "./ingredient-read-line";
import type { NewIngredientDefaults } from "@/lib/recipes/types";

type ScanRowSummary = {
  name: string;
  canonicalName: string | null;
  quantity: number | null;
  unitLabel: string | null;
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

export function BulkReparseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
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
  const loadedRef = React.useRef(false);

  const runScan = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const r = await fetch("/api/v1/recipes/reparse-scan", { method: "POST" });
      if (!r.ok) throw new Error("scan failed");
      const data = (await r.json()) as { entries: ScanEntry[] };
      setEntries(data.entries);
      setStates(
        data.entries.map((e) => ({
          selected: false,
          editing: false,
          draft: e.proposed.map(parsedIngredientToDraft),
        })),
      );
      setExpanded(new Set());
    } catch {
      setError("Scan fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Scan once each time the dialog opens.
  React.useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      void runScan();
    }
    if (!open) {
      loadedRef.current = false;
      setEntries([]);
      setStates([]);
      setSummary(null);
    }
  }, [open, runScan]);

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
    setStates((prev) =>
      prev.map((s, idx) =>
        idx === entryIdx
          ? { ...s, draft: s.draft.filter((_, j) => j !== rowIdx) }
          : s,
      ),
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
    setStates((prev) => prev.map((s) => ({ ...s, selected: value })));
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
      if (!r.ok) throw new Error("apply failed");
      const data = (await r.json()) as {
        updatedRecipes: number;
        updatedGroups: number;
        skipped: number;
      };
      setPendingNew(null);
      // Re-scan first (it resets the summary), THEN show the result so the
      // confirmation survives the refresh.
      await runScan();
      setSummary(
        `${data.updatedGroups} Zutaten in ${data.updatedRecipes} Rezepten aktualisiert` +
          (data.skipped > 0 ? ` (${data.skipped} übersprungen)` : "") +
          ".",
      );
    } catch {
      setError("Anwenden fehlgeschlagen.");
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
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-[var(--color-muted-fg)]">
                <Loader2 className="size-4 animate-spin" /> Prüfe Rezepte…
              </div>
            ) : error ? (
              <p className="py-8 text-[var(--color-danger,#c00)]">{error}</p>
            ) : entries.length === 0 ? (
              <p className="py-8 text-[var(--color-muted-fg)]">
                {summary ?? "Keine Änderungen gefunden."}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {summary ? (
                  <p className="text-sm text-[var(--color-muted-fg)]">{summary}</p>
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
                {recipeGroups.map((g) => {
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
                      </div>
                      {isOpen ? (
                        <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                          {g.indices.map((i) => {
                            const entry = entries[i];
                            const st = states[i];
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
                                    <p
                                      className="truncate text-xs text-[var(--color-muted-fg)]"
                                      title={entry.rawLine}
                                    >
                                      Original: „{entry.rawLine}“
                                    </p>
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
                                              unitLabel={c.unitLabel}
                                              name={c.name}
                                              canonicalName={c.canonicalName}
                                              notes={c.notes}
                                              isOptional={c.isOptional}
                                              isAlternative={c.isAlternative}
                                              mappingLabel={c.canonicalName}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-[var(--color-accent)]">
                                          Neu
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                          {st.draft.map((d, k) => (
                                            <RecipeIngredientReadLine
                                              key={k}
                                              quantity={toNumberOrNull(d.quantity)}
                                              unitLabel={
                                                d.subUnit?.name ?? d.unit?.name ?? null
                                              }
                                              name={d.name}
                                              canonicalName={d.canonicalName}
                                              notes={d.notes.trim() || null}
                                              isOptional={d.isOptional}
                                              isAlternative={d.isAlternative}
                                              fixedAmount={d.fixedAmount}
                                              mappingLabel={
                                                d.unassigned
                                                  ? "nicht zugeordnet"
                                                  : d.selectedIngredientId == null
                                                    ? "neu"
                                                    : d.canonicalName ?? d.name
                                              }
                                            />
                                          ))}
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
                                    {st.draft.map((d, k) => (
                                      <IngredientRow
                                        key={d.uid}
                                        value={d}
                                        onChange={(next) => setDraftRow(i, k, next)}
                                        onRemove={() => removeDraftRow(i, k)}
                                      />
                                    ))}
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
