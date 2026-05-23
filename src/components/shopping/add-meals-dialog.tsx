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
import { DateInputWithWeekday } from "@/components/ui/date-input-with-weekday";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays } from "@/lib/meal-plans/dates";
import type { PreviewMeal, PreviewIngredient } from "@/lib/shopping/preview";
import { previewMeals as apiPreview, addMealsToList } from "./api";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Inclusive day count between two ISO dates. 0/negative-result inputs
 * collapse to 1 so the form never produces an invalid length.
 */
function daysBetween(start: string, end: string): number {
  if (!ISO_DATE_RE.test(start) || !ISO_DATE_RE.test(end)) return 1;
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  const diff = Math.round((b - a) / 86_400_000) + 1;
  if (!Number.isFinite(diff) || diff < 1) return 1;
  return diff;
}

type Props = {
  open: boolean;
  defaultLengthDays: number;
  /** ISO date the range should start on when the dialog opens. Caller picks
   *  this — usually the planner's currently-visible start. */
  defaultStart: string;
  onClose: () => void;
  onAdded: () => void;
};

type SelectionState = Map<number, Set<number>>;
// Per-recipe-ingredient quantity input string (raw user input). Keyed by
// `${mealPlanId}:${recipeIngredientId}` so a recipe appearing twice keeps
// independent quantities.
type QuantityState = Map<string, string>;

function qtyKey(mealPlanId: number, recipeIngredientId: number): string {
  return `${mealPlanId}:${recipeIngredientId}`;
}

function formatScaledQty(q: number | null): string {
  if (q == null) return "";
  const rounded = Math.round(q * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function AddMealsDialog({
  open,
  defaultLengthDays,
  defaultStart,
  onClose,
  onAdded,
}: Props) {
  const [start, setStart] = React.useState(defaultStart);
  const [length, setLength] = React.useState(defaultLengthDays);
  const [meals, setMeals] = React.useState<PreviewMeal[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // selection: per-meal set of recipeIngredientIds that are checked.
  const [selection, setSelection] = React.useState<SelectionState>(new Map());
  const [quantities, setQuantities] = React.useState<QuantityState>(new Map());

  React.useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMeals(null);
      setError(null);
      setSelection(new Map());
      return;
    }
    // Reset to defaults each time the dialog opens.
    setStart(defaultStart);
    setLength(defaultLengthDays);
  }, [open, defaultStart, defaultLengthDays]);

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
        // Start fully unchecked — the user opts in to whichever meals
        // and ingredients they want on the list, instead of de-selecting
        // a default that may or may not match their intent.
        const sel = new Map<number, Set<number>>();
        const qs = new Map<string, string>();
        for (const m of rows) {
          sel.set(m.mealPlanId, new Set());
          for (const i of m.ingredients) {
            qs.set(
              qtyKey(m.mealPlanId, i.recipeIngredientId),
              formatScaledQty(i.qty),
            );
          }
        }
        setSelection(sel);
        setQuantities(qs);
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

  function parseQty(raw: string | undefined): number | null {
    if (raw == null) return null;
    const trimmed = raw.trim().replace(",", ".");
    if (trimmed.length === 0) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  async function onSubmit() {
    if (!meals || totalSelected === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const sel = Array.from(selection.entries())
        .filter(([, set]) => set.size > 0)
        .map(([mealPlanId, set]) => ({
          mealPlanId,
          ingredients: Array.from(set).map((recipeIngredientId) => ({
            recipeIngredientId,
            quantity: parseQty(quantities.get(qtyKey(mealPlanId, recipeIngredientId))),
          })),
        }));
      await addMealsToList(sel);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  function setQty(mealPlanId: number, recipeIngredientId: number, value: string) {
    setQuantities((prev) => {
      const next = new Map(prev);
      next.set(qtyKey(mealPlanId, recipeIngredientId), value);
      return next;
    });
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
        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="meals-start">Startdatum</Label>
              <DateInputWithWeekday
                id="meals-start"
                value={start}
                onChange={setStart}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="meals-end">Enddatum</Label>
              <DateInputWithWeekday
                id="meals-end"
                value={addDays(start, Math.max(0, length - 1))}
                min={start}
                onChange={(next) => {
                  if (!ISO_DATE_RE.test(next)) return;
                  setLength(Math.min(60, daysBetween(start, next)));
                }}
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
                    quantities={quantities}
                    onToggleMeal={() => toggleMeal(m)}
                    onToggleIngredient={(riId) => toggleIngredient(m.mealPlanId, riId)}
                    onChangeQuantity={(riId, value) => setQty(m.mealPlanId, riId, value)}
                  />
                ))}
              </ul>
            )}
          </div>

        </DialogBody>
        <DialogFooter className="sm:items-center sm:justify-between">
          <span className="text-sm text-[var(--color-muted-fg)] sm:mr-auto">
            {totalSelected} Zutaten ausgewählt
          </span>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button
            onClick={onSubmit}
            disabled={submitting || totalSelected === 0}
          >
            {submitting ? "Übernimmt…" : "Übernehmen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MealRow({
  meal,
  selected,
  quantities,
  onToggleMeal,
  onToggleIngredient,
  onChangeQuantity,
}: {
  meal: PreviewMeal;
  selected: Set<number>;
  quantities: QuantityState;
  onToggleMeal: () => void;
  onToggleIngredient: (riId: number) => void;
  onChangeQuantity: (riId: number, value: string) => void;
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
            quantityValue={
              quantities.get(qtyKey(meal.mealPlanId, ing.recipeIngredientId)) ?? ""
            }
            onToggle={() => onToggleIngredient(ing.recipeIngredientId)}
            onChangeQuantity={(v) => onChangeQuantity(ing.recipeIngredientId, v)}
          />
        ))}
      </ul>
    </li>
  );
}

function IngredientCheckbox({
  ing,
  checked,
  quantityValue,
  onToggle,
  onChangeQuantity,
}: {
  ing: PreviewIngredient;
  checked: boolean;
  quantityValue: string;
  onToggle: () => void;
  onChangeQuantity: (value: string) => void;
}) {
  return (
    <li>
      <label
        className={`flex cursor-pointer items-center gap-2 text-sm ${
          ing.isOptional ? "text-[var(--color-muted-fg)] italic" : ""
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="size-3.5"
        />
        <span className="flex flex-1 flex-wrap items-center gap-2">
          <span>{ing.ingredientName}</span>
          {ing.isOptional ? (
            <span className="rounded-full bg-[var(--color-muted)] px-1.5 py-0.5 text-[10px] font-medium uppercase not-italic tracking-wider text-[var(--color-muted-fg)]">
              optional
            </span>
          ) : null}
          {ing.notes ? (
            <span className="text-xs text-[var(--color-muted-fg)]">
              · {ing.notes}
            </span>
          ) : null}
        </span>
        <span
          className="flex shrink-0 items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            inputMode="decimal"
            value={quantityValue}
            onChange={(e) => onChangeQuantity(e.target.value)}
            className="h-7 w-16 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-right text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          />
          {/* Fixed-width slot so the inputs above all line up regardless of
              the unit's character count (or absence). */}
          <span className="w-10 text-xs text-[var(--color-muted-fg)]">
            {ing.unitName ?? ""}
          </span>
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
