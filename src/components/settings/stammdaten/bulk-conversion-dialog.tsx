"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

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

import type { IngredientItem } from "./edit-forms/ingredient-form";

type UnitPick = { id: number; name: string };

type Props = {
  open: boolean;
  selectedItems: IngredientItem[];
  onClose: () => void;
  onApplied: () => void;
};

/**
 * Add one conversion edge (`1 from = factor × to`) to many articles at once.
 * Step 1 defines the edge; step 2 splits the selection into articles that get
 * it freshly added vs. those already carrying that `(from→to)` pair, letting
 * the user skip or overwrite each conflict (default: skip). Conflict detection
 * is purely client-side from the in-memory `conversions[]`; the server
 * re-checks before writing.
 */
export function BulkConversionDialog({
  open,
  selectedItems,
  onClose,
  onApplied,
}: Props) {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [from, setFrom] = React.useState<UnitPick | null>(null);
  const [to, setTo] = React.useState<UnitPick | null>(null);
  const [factor, setFactor] = React.useState<number | null>(1);
  const [isContainer, setIsContainer] = React.useState(false);
  // Per-conflicting-article decision; missing key defaults to "skip".
  const [decisions, setDecisions] = React.useState<
    Record<number, "skip" | "overwrite">
  >({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    // setState-in-effect: reset the staged edge whenever the dialog reopens so
    // a previous run never silently re-applies.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep(1);
    setFrom(null);
    setTo(null);
    setFactor(1);
    setIsContainer(false);
    setDecisions({});
    setError(null);
  }, [open]);

  const defineValid =
    from != null &&
    to != null &&
    from.id !== to.id &&
    factor != null &&
    factor > 0;

  // Split the selection against the chosen (from→to) pair.
  const { fresh, conflicts } = React.useMemo(() => {
    const freshItems: IngredientItem[] = [];
    const conflictItems: Array<{
      item: IngredientItem;
      current: IngredientItem["conversions"][number];
    }> = [];
    if (!from || !to) return { fresh: freshItems, conflicts: conflictItems };
    for (const item of selectedItems) {
      const current = item.conversions.find(
        (c) => c.fromUnitId === from.id && c.toUnitId === to.id,
      );
      if (current) conflictItems.push({ item, current });
      else freshItems.push(item);
    }
    return { fresh: freshItems, conflicts: conflictItems };
  }, [from, to, selectedItems]);

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

  async function apply() {
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

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Umrechnung für {selectedItems.length} Zutaten
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Eine Umrechnung definieren und auf alle ausgewählten Zutaten anwenden — als „1 ⟨von⟩ = ⟨Menge⟩ ⟨nach⟩“."
              : "Prüfen, welche Zutaten die Umrechnung neu erhalten und wie Konflikte behandelt werden."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
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
                            <DecisionChip
                              active={decision === "skip"}
                              onClick={() =>
                                setDecisions((p) => ({
                                  ...p,
                                  [item.id]: "skip",
                                }))
                              }
                              label="Überspringen"
                            />
                            <DecisionChip
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
        )}

        <DialogFooter className="gap-2">
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Abbrechen
              </Button>
              <Button onClick={goReview} disabled={!defineValid}>
                Weiter
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                disabled={saving}
              >
                Zurück
              </Button>
              <Button onClick={apply} disabled={saving || applyCount === 0}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Auf {applyCount} anwenden
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecisionChip({
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
