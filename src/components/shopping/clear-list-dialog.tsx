"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ClearSummary = {
  meals: Array<{
    mealPlanId: number;
    mealDate: string;
    recipeId: number;
    recipeTitle: string;
    itemCount: number;
  }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (selection: {
    removeAll: boolean;
    mealPlanIds: number[];
  }) => Promise<void>;
};

export function ClearListDialog({ open, onClose, onConfirm }: Props) {
  const [summary, setSummary] = React.useState<ClearSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [selectedMeals, setSelectedMeals] = React.useState<Set<number>>(new Set());
  const [removeAll, setRemoveAll] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSummary(null);
      setSelectedMeals(new Set());
      setRemoveAll(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/v1/shopping/summary", { cache: "no-store" });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = (await res.json()) as ClearSummary;
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Fehler beim Laden");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const totalSelected = removeAll ? "alle" : selectedMeals.size;
  const submitDisabled =
    submitting || (!removeAll && selectedMeals.size === 0);

  function toggleMeal(id: number) {
    setSelectedMeals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllMeals() {
    if (!summary) return;
    if (selectedMeals.size === summary.meals.length) {
      setSelectedMeals(new Set());
    } else {
      setSelectedMeals(new Set(summary.meals.map((m) => m.mealPlanId)));
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      if (removeAll) {
        await onConfirm({ removeAll: true, mealPlanIds: [] });
      } else {
        await onConfirm({
          removeAll: false,
          mealPlanIds: Array.from(selectedMeals),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !submitting ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Liste leeren</DialogTitle>
          <DialogDescription>
            Wähle aus, was von der Liste entfernt werden soll.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={removeAll}
              onChange={(e) => setRemoveAll(e.target.checked)}
              className="size-4"
            />
            <span className="font-medium">Alles entfernen</span>
          </label>

          {loading ? (
            <p className="text-sm text-[var(--color-muted-fg)]">Lädt…</p>
          ) : summary == null ? (
            <p className="text-sm text-[var(--color-danger)]">{error ?? "Fehler"}</p>
          ) : (
            <fieldset
              disabled={removeAll}
              className={removeAll ? "opacity-40" : undefined}
            >
              {summary.meals.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-fg)]">
                  Keine Einträge auf der Liste.
                </p>
              ) : null}
              {summary.meals.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
                      Mahlzeiten
                    </h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleAllMeals}
                      disabled={removeAll}
                    >
                      {selectedMeals.size === summary.meals.length
                        ? "Keine"
                        : "Alle"}
                    </Button>
                  </div>
                  <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)]">
                    {summary.meals.map((m) => (
                      <li key={m.mealPlanId}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selectedMeals.has(m.mealPlanId)}
                            onChange={() => toggleMeal(m.mealPlanId)}
                            className="size-4"
                          />
                          <span className="flex flex-1 flex-wrap items-baseline gap-2">
                            <span className="font-medium">{m.recipeTitle}</span>
                            <span className="text-xs text-[var(--color-muted-fg)]">
                              {formatDate(m.mealDate)} · {m.itemCount}{" "}
                              {m.itemCount === 1 ? "Artikel" : "Artikel"}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </fieldset>
          )}
          {error ? (
            <p className="text-sm text-[var(--color-danger)]">{error}</p>
          ) : null}
        </DialogBody>
        <DialogFooter className="sm:items-center sm:justify-between">
          <span className="text-sm text-[var(--color-muted-fg)] sm:mr-auto">
            {totalSelected === 0 ? "Nichts ausgewählt" : null}
          </span>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button variant="danger" onClick={submit} disabled={submitDisabled}>
            {submitting ? "Entfernt…" : "Entfernen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  const weekday = dt.toLocaleDateString("de-DE", {
    weekday: "short",
    timeZone: "UTC",
  });
  const dm = dt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  return `${weekday}, ${dm}`;
}
