"use client";

import * as React from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { SelectSearch } from "@/components/ui/select-search";
import {
  resolveUnitPick,
  searchUnitsWithAliases as searchUnits,
} from "@/components/units/unit-picker";
import { cn } from "@/lib/cn";

import type { IngredientItem } from "./edit-forms/ingredient-form";

type UnitPick = { id: number; name: string };
type Conversion = IngredientItem["conversions"][number];

type Props = {
  open: boolean;
  selectedItems: IngredientItem[];
  onClose: () => void;
  onApplied: () => void;
};

/** Distinct conversion shared by ≥1 selected article (exact tuple match). */
type ConversionGroup = {
  key: string;
  fromUnitId: number;
  fromUnitName: string;
  toUnitId: number;
  toUnitName: string;
  factor: number;
  isContainer: boolean;
  articleIds: number[];
  articleNames: string[];
};

function groupKey(c: Pick<Conversion, "fromUnitId" | "toUnitId" | "factor" | "isContainer">) {
  return `${c.fromUnitId}|${c.toUnitId}|${c.factor}|${c.isContainer}`;
}

/** Collapse the selection's conversions into one entry per exact tuple. */
function groupConversions(items: IngredientItem[]): ConversionGroup[] {
  const map = new Map<string, ConversionGroup>();
  for (const item of items) {
    for (const c of item.conversions) {
      const key = groupKey(c);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          fromUnitId: c.fromUnitId,
          fromUnitName: c.fromUnitName,
          toUnitId: c.toUnitId,
          toUnitName: c.toUnitName,
          factor: c.factor,
          isContainer: c.isContainer,
          articleIds: [],
          articleNames: [],
        };
        map.set(key, g);
      }
      g.articleIds.push(item.id);
      g.articleNames.push(item.name);
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.fromUnitName.localeCompare(b.fromUnitName, "de") ||
      a.toUnitName.localeCompare(b.toUnitName, "de") ||
      a.factor - b.factor,
  );
}

function articlesLabel(names: string[]): string {
  const shown = names.slice(0, 5);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest} weitere` : shown.join(", ");
}

/**
 * Bulk conversion editor for multiple selected articles. Two tabs:
 *  - **Hinzufügen**: define one edge and apply it, resolving per-article
 *    conflicts (skip/overwrite).
 *  - **Bearbeiten**: the conversions the selection already carries, grouped by
 *    exact tuple; edit the factor/container or delete each group's edge across
 *    every article that shares it.
 *
 * The dialog keeps a local working copy of the articles so edits/deletes are
 * reflected immediately; on close, if anything changed, it refreshes the list.
 */
export function BulkConversionDialog({
  open,
  selectedItems,
  onClose,
  onApplied,
}: Props) {
  const [tab, setTab] = React.useState<"add" | "edit">("add");
  // Local working copy — edits/deletes mutate this so both tabs stay in sync
  // without a round-trip; the real list refreshes on close.
  const [items, setItems] = React.useState<IngredientItem[]>(selectedItems);
  const [dirty, setDirty] = React.useState(false);

  // --- add tab state ---
  const [step, setStep] = React.useState<1 | 2>(1);
  const [from, setFrom] = React.useState<UnitPick | null>(null);
  const [to, setTo] = React.useState<UnitPick | null>(null);
  const [factor, setFactor] = React.useState<number | null>(1);
  const [isContainer, setIsContainer] = React.useState(false);
  const [decisions, setDecisions] = React.useState<
    Record<number, "skip" | "overwrite">
  >({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // --- edit tab state ---
  const [drafts, setDrafts] = React.useState<
    Record<string, { factor: number | null; isContainer: boolean }>
  >({});
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [editError, setEditError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    // setState-in-effect: reset everything whenever the dialog reopens so a
    // previous run never silently re-applies.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab("add");
    setItems(selectedItems);
    setDirty(false);
    setStep(1);
    setFrom(null);
    setTo(null);
    setFactor(1);
    setIsContainer(false);
    setDecisions({});
    setSaving(false);
    setError(null);
    setDrafts({});
    setBusyKey(null);
    setEditError(null);
  }, [open, selectedItems]);

  const groups = React.useMemo(() => groupConversions(items), [items]);

  function handleClose() {
    if (dirty) onApplied();
    onClose();
  }

  // --- add tab logic ---
  const defineValid =
    from != null &&
    to != null &&
    from.id !== to.id &&
    factor != null &&
    factor > 0;

  const { fresh, conflicts } = React.useMemo(() => {
    const freshItems: IngredientItem[] = [];
    const conflictItems: Array<{ item: IngredientItem; current: Conversion }> =
      [];
    if (!from || !to) return { fresh: freshItems, conflicts: conflictItems };
    for (const item of items) {
      const current = item.conversions.find(
        (c) => c.fromUnitId === from.id && c.toUnitId === to.id,
      );
      if (current) conflictItems.push({ item, current });
      else freshItems.push(item);
    }
    return { fresh: freshItems, conflicts: conflictItems };
  }, [from, to, items]);

  const overwriteCount = conflicts.filter(
    (c) => decisions[c.item.id] === "overwrite",
  ).length;
  const applyCount = fresh.length + overwriteCount;

  function goReview() {
    if (!defineValid) return;
    setDecisions({});
    setError(null);
    setStep(2);
  }

  function applyLocalEdit(
    articleIds: number[],
    fromUnitId: number,
    toUnitId: number,
    nextFactor: number,
    nextContainer: boolean,
  ) {
    const idSet = new Set(articleIds);
    setItems((prev) =>
      prev.map((it) =>
        idSet.has(it.id)
          ? {
              ...it,
              conversions: it.conversions.map((c) =>
                c.fromUnitId === fromUnitId && c.toUnitId === toUnitId
                  ? { ...c, factor: nextFactor, isContainer: nextContainer }
                  : c,
              ),
            }
          : it,
      ),
    );
  }

  async function applyAdd() {
    if (!from || !to || factor == null) return;
    setSaving(true);
    setError(null);
    try {
      const addIds = fresh.map((i) => i.id);
      const overwriteIds = conflicts
        .filter((c) => decisions[c.item.id] === "overwrite")
        .map((c) => c.item.id);
      const res = await fetch("/api/v1/ingredients/bulk-conversions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromUnitId: from.id,
          toUnitId: to.id,
          factor,
          isContainer,
          addIds,
          overwriteIds,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onApplied();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  // --- edit tab logic ---
  async function saveGroup(g: ConversionGroup) {
    const draft = drafts[g.key] ?? { factor: g.factor, isContainer: g.isContainer };
    if (draft.factor == null || draft.factor <= 0) return;
    setBusyKey(g.key);
    setEditError(null);
    try {
      const res = await fetch("/api/v1/ingredients/bulk-conversions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromUnitId: g.fromUnitId,
          toUnitId: g.toUnitId,
          factor: draft.factor,
          isContainer: draft.isContainer,
          addIds: [],
          overwriteIds: g.articleIds,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      applyLocalEdit(
        g.articleIds,
        g.fromUnitId,
        g.toUnitId,
        draft.factor,
        draft.isContainer,
      );
      setDrafts({});
      setDirty(true);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteGroup(g: ConversionGroup) {
    setBusyKey(g.key);
    setEditError(null);
    try {
      const res = await fetch("/api/v1/ingredients/bulk-conversions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromUnitId: g.fromUnitId,
          toUnitId: g.toUnitId,
          ids: g.articleIds,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const idSet = new Set(g.articleIds);
      setItems((prev) =>
        prev.map((it) =>
          idSet.has(it.id)
            ? {
                ...it,
                conversions: it.conversions.filter(
                  (c) =>
                    !(c.fromUnitId === g.fromUnitId && c.toUnitId === g.toUnitId),
                ),
              }
            : it,
        ),
      );
      setDrafts({});
      setDirty(true);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? handleClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Umrechnungen für {items.length} Zutaten</DialogTitle>
          <DialogDescription>
            {tab === "add"
              ? "Eine Umrechnung definieren und auf alle ausgewählten Zutaten anwenden — als „1 ⟨von⟩ = ⟨Menge⟩ ⟨nach⟩“."
              : "Vorhandene Umrechnungen der Auswahl — gruppiert nach gleicher Umrechnung — bearbeiten oder entfernen."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b border-[var(--color-border)]">
          <TabButton
            active={tab === "add"}
            onClick={() => setTab("add")}
            label="Hinzufügen"
          />
          <TabButton
            active={tab === "edit"}
            onClick={() => setTab("edit")}
            label="Bearbeiten"
          />
        </div>

        {tab === "add" ? (
          step === 1 ? (
            <DialogBody className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-fg)]">
                <span className="shrink-0">1</span>
                <div className="min-w-0 flex-1">
                  <SelectSearch
                    value={from}
                    onChange={(p) => setFrom(resolveUnitPick(p))}
                    search={searchUnits}
                    placeholder="von Einheit"
                  />
                </div>
                <span className="shrink-0">=</span>
                <div className="w-20">
                  <NumberInput
                    value={factor}
                    onChange={setFactor}
                    min={0.0001}
                    decimal
                    aria-label="Faktor"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <SelectSearch
                    value={to}
                    onChange={(p) => setTo(resolveUnitPick(p))}
                    search={searchUnits}
                    placeholder="nach Einheit"
                  />
                </div>
              </div>
              {from && to && from.id === to.id ? (
                <p className="text-xs text-[var(--color-danger)]">
                  Von- und Nach-Einheit müssen verschieden sein.
                </p>
              ) : null}
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-muted-fg)]">
                <Checkbox
                  checked={isContainer}
                  onCheckedChange={(v) => setIsContainer(Boolean(v))}
                />
                Gebinde (auf ganze ⟨von⟩ aufrunden)
              </label>
            </DialogBody>
          ) : (
            <DialogBody className="flex flex-col gap-4">
              <p className="text-sm">
                <span className="font-medium">{fresh.length}</span>{" "}
                {fresh.length === 1 ? "Zutat erhält" : "Zutaten erhalten"} die
                Umrechnung neu
                {from && to ? (
                  <span className="text-[var(--color-muted-fg)]">
                    {" "}
                    (1 {from.name} = {factor} {to.name}
                    {isContainer ? ", Gebinde" : ""})
                  </span>
                ) : null}
                .
              </p>
              {conflicts.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">
                    {conflicts.length}{" "}
                    {conflicts.length === 1 ? "Konflikt" : "Konflikte"} — bereits
                    vorhandene Umrechnung:
                  </p>
                  <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
                    {conflicts.map(({ item, current }) => {
                      const decision = decisions[item.id] ?? "skip";
                      return (
                        <li
                          key={item.id}
                          className="flex flex-col gap-1.5 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">
                              {item.name}
                            </span>
                            <div className="flex gap-1">
                              <Chip
                                active={decision === "skip"}
                                onClick={() =>
                                  setDecisions((p) => ({
                                    ...p,
                                    [item.id]: "skip",
                                  }))
                                }
                                label="Überspringen"
                              />
                              <Chip
                                active={decision === "overwrite"}
                                onClick={() =>
                                  setDecisions((p) => ({
                                    ...p,
                                    [item.id]: "overwrite",
                                  }))
                                }
                                label="Überschreiben"
                              />
                            </div>
                          </div>
                          <span className="text-xs text-[var(--color-muted-fg)]">
                            aktuell: 1 {current.fromUnitName} = {current.factor}{" "}
                            {current.toUnitName}
                            {current.isContainer ? ", Gebinde" : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {error ? (
                <p className="text-sm text-[var(--color-danger)]">{error}</p>
              ) : null}
            </DialogBody>
          )
        ) : (
          <DialogBody className="flex flex-col gap-3">
            {groups.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-fg)]">
                Keine Umrechnungen vorhanden.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
                {groups.map((g) => {
                  const draft =
                    drafts[g.key] ?? {
                      factor: g.factor,
                      isContainer: g.isContainer,
                    };
                  const changed =
                    draft.factor !== g.factor ||
                    draft.isContainer !== g.isContainer;
                  const validFactor = draft.factor != null && draft.factor > 0;
                  const busy = busyKey === g.key;
                  return (
                    <li key={g.key} className="flex flex-col gap-2 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-fg)]">
                        <span className="shrink-0">1 {g.fromUnitName}</span>
                        <span className="shrink-0">=</span>
                        <div className="w-20">
                          <NumberInput
                            value={draft.factor}
                            onChange={(n) =>
                              setDrafts((p) => ({
                                ...p,
                                [g.key]: { ...draft, factor: n },
                              }))
                            }
                            min={0.0001}
                            decimal
                            aria-label={`Faktor ${g.fromUnitName} → ${g.toUnitName}`}
                          />
                        </div>
                        <span className="shrink-0 text-[var(--color-fg)]">
                          {g.toUnitName}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="ml-auto"
                          disabled={busy}
                          onClick={() => deleteGroup(g)}
                          aria-label="Umrechnung entfernen"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-muted-fg)]">
                        <Checkbox
                          checked={draft.isContainer}
                          onCheckedChange={(v) =>
                            setDrafts((p) => ({
                              ...p,
                              [g.key]: { ...draft, isContainer: Boolean(v) },
                            }))
                          }
                        />
                        Gebinde (auf ganze ⟨von⟩ aufrunden)
                      </label>
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-muted-fg)]">
                          {g.articleIds.length}{" "}
                          {g.articleIds.length === 1 ? "Artikel" : "Artikel"}:{" "}
                          {articlesLabel(g.articleNames)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || !changed || !validFactor}
                          onClick={() => saveGroup(g)}
                        >
                          {busy ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : null}
                          Speichern
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {editError ? (
              <p className="text-sm text-[var(--color-danger)]">{editError}</p>
            ) : null}
          </DialogBody>
        )}

        <DialogFooter className="gap-2">
          {tab === "add" && step === 1 ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Abbrechen
              </Button>
              <Button onClick={goReview} disabled={!defineValid}>
                Weiter
              </Button>
            </>
          ) : tab === "add" && step === 2 ? (
            <>
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                disabled={saving}
              >
                Zurück
              </Button>
              <Button onClick={applyAdd} disabled={saving || applyCount === 0}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Auf {applyCount} anwenden
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={handleClose}>
              Schließen
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
        active
          ? "border-[var(--color-accent)] font-medium text-[var(--color-fg)]"
          : "border-transparent text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
      )}
    >
      {label}
    </button>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-2.5 py-1 text-xs transition-colors " +
        (active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
          : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
      }
    >
      {label}
    </button>
  );
}
