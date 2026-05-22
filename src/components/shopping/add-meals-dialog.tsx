"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PreviewMeal, PreviewIngredient } from "@/lib/shopping/preview";
import { formatQty } from "@/lib/shopping/format";
import { previewMeals as apiPreview, addMealsToList } from "./api";

type Props = {
  open: boolean;
  defaultLengthDays: number;
  today: string;
  onClose: () => void;
  onAdded: () => void;
};

type SelectionState = Map<number, Set<number>>;

export function AddMealsDialog({
  open,
  defaultLengthDays,
  today,
  onClose,
  onAdded,
}: Props) {
  const [start, setStart] = React.useState(today);
  const [length, setLength] = React.useState(defaultLengthDays);
  const [meals, setMeals] = React.useState<PreviewMeal[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // selection: per-meal set of recipeIngredientIds that are checked.
  const [selection, setSelection] = React.useState<SelectionState>(new Map());

  React.useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMeals(null);
      setError(null);
      setSelection(new Map());
      return;
    }
    // Reset to defaults each time the dialog opens.
    setStart(today);
    setLength(defaultLengthDays);
  }, [open, today, defaultLengthDays]);

  // Server fetch as the external synchronisation source — setState in the
  // effect body is intentional here (loading/error scaffolding).
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    apiPreview(start, length)
      .then((rows) => {
        if (cancelled) return;
        setMeals(rows);
        // Default selection: new-meal non-optional ingredients are checked;
        // optional lines stay unchecked so the user has to opt in. Meals
        // already on the list start fully unchecked.
        const sel = new Map<number, Set<number>>();
        for (const m of rows) {
          if (m.alreadyOnList) {
            sel.set(m.mealPlanId, new Set());
            continue;
          }
          sel.set(
            m.mealPlanId,
            new Set(
              m.ingredients
                .filter((i) => !i.isOptional)
                .map((i) => i.recipeIngredientId),
            ),
          );
        }
        setSelection(sel);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Fehler beim Laden");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, start, length]);

  function toggleIngredient(mealId: number, riId: number) {
    setSelection((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(mealId) ?? []);
      if (set.has(riId)) set.delete(riId);
      else set.add(riId);
      next.set(mealId, set);
      return next;
    });
  }

  function toggleMeal(meal: PreviewMeal) {
    setSelection((prev) => {
      const next = new Map(prev);
      const existing = next.get(meal.mealPlanId) ?? new Set();
      const all = meal.ingredients.map((i) => i.recipeIngredientId);
      const allChecked = all.every((id) => existing.has(id));
      next.set(
        meal.mealPlanId,
        allChecked ? new Set() : new Set(all),
      );
      return next;
    });
  }

  function toggleAll(check: boolean) {
    if (!meals) return;
    const next = new Map<number, Set<number>>();
    for (const m of meals) {
      next.set(
        m.mealPlanId,
        check ? new Set(m.ingredients.map((i) => i.recipeIngredientId)) : new Set(),
      );
    }
    setSelection(next);
  }

  const totalSelected = React.useMemo(() => {
    let n = 0;
    for (const set of selection.values()) n += set.size;
    return n;
  }, [selection]);

  async function onSubmit() {
    if (!meals || totalSelected === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const sel = Array.from(selection.entries())
        .filter(([, set]) => set.size > 0)
        .map(([mealPlanId, set]) => ({
          mealPlanId,
          recipeIngredientIds: Array.from(set),
        }));
      await addMealsToList(sel);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !submitting ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mahlzeiten hinzufügen</DialogTitle>
          <DialogDescription>
            Wähle aus, welche geplanten Mahlzeiten in die Einkaufsliste übernommen
            werden.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="meals-start">Startdatum</Label>
              <Input
                id="meals-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="meals-length">Länge (Tage)</Label>
              <Input
                id="meals-length"
                type="number"
                min={1}
                max={60}
                value={length}
                onChange={(e) =>
                  setLength(Math.max(1, Math.min(60, Number(e.target.value) || 1)))
                }
                className="w-24"
              />
            </div>
            <div className="flex flex-1 items-end justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAll(true)}
                disabled={!meals || meals.length === 0}
              >
                Alle auswählen
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAll(false)}
                disabled={!meals || meals.length === 0}
              >
                Keine auswählen
              </Button>
            </div>
          </div>

          <div className="max-h-[50vh] overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)]">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--color-muted-fg)]">
                Lädt…
              </div>
            ) : error ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--color-danger)]">
                {error}
              </div>
            ) : meals && meals.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--color-muted-fg)]">
                Keine Mahlzeiten in diesem Zeitraum.
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {meals?.map((m) => (
                  <MealRow
                    key={m.mealPlanId}
                    meal={m}
                    selected={selection.get(m.mealPlanId) ?? new Set()}
                    onToggleMeal={() => toggleMeal(m)}
                    onToggleIngredient={(riId) => toggleIngredient(m.mealPlanId, riId)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-sm text-[var(--color-muted-fg)]">
              {totalSelected} Zutaten ausgewählt
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={submitting}>
                Abbrechen
              </Button>
              <Button
                onClick={onSubmit}
                disabled={submitting || totalSelected === 0}
              >
                {submitting ? "Übernimmt…" : "Übernehmen"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MealRow({
  meal,
  selected,
  onToggleMeal,
  onToggleIngredient,
}: {
  meal: PreviewMeal;
  selected: Set<number>;
  onToggleMeal: () => void;
  onToggleIngredient: (riId: number) => void;
}) {
  const all = meal.ingredients.length;
  const checked = selected.size;
  const state = checked === 0 ? "none" : checked === all ? "all" : "some";

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={state === "all"}
          ref={(el) => {
            if (el) el.indeterminate = state === "some";
          }}
          onChange={onToggleMeal}
          className="size-4"
        />
        <span className="flex flex-1 flex-wrap items-baseline gap-2">
          <span className="font-medium">{meal.recipeTitle}</span>
          <span className="text-xs text-[var(--color-muted-fg)]">
            {formatDate(meal.date)} · {meal.servings} Portionen
          </span>
          {meal.alreadyOnList ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--color-accent),transparent_85%)] px-2 py-0.5 text-xs text-[var(--color-accent)]">
              Bereits auf der Liste
            </span>
          ) : null}
        </span>
      </label>
      <ul className="ml-6 flex flex-col gap-1">
        {meal.ingredients.map((ing) => (
          <IngredientCheckbox
            key={ing.recipeIngredientId}
            ing={ing}
            checked={selected.has(ing.recipeIngredientId)}
            onToggle={() => onToggleIngredient(ing.recipeIngredientId)}
          />
        ))}
      </ul>
    </li>
  );
}

function IngredientCheckbox({
  ing,
  checked,
  onToggle,
}: {
  ing: PreviewIngredient;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label
        className={`flex cursor-pointer items-baseline gap-2 text-sm ${
          ing.isOptional ? "text-[var(--color-muted-fg)] italic" : ""
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="size-3.5"
        />
        <span>
          <span>{ing.ingredientName}</span>
          {ing.qty != null || ing.unitName ? (
            <span className="ml-2 text-xs text-[var(--color-muted-fg)]">
              {ing.qty != null ? formatQty(ing.qty) : ""}
              {ing.unitName ? ` ${ing.unitName}` : ""}
            </span>
          ) : null}
          {ing.notes ? (
            <span className="ml-2 text-xs text-[var(--color-muted-fg)]">
              · {ing.notes}
            </span>
          ) : null}
          {ing.isOptional ? (
            <span className="ml-2 rounded-full bg-[var(--color-muted)] px-1.5 py-0.5 text-[10px] font-medium uppercase not-italic tracking-wider text-[var(--color-muted-fg)]">
              optional
            </span>
          ) : null}
        </span>
      </label>
    </li>
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
