"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DietBadge } from "@/components/recipes/diet-badge";
import type { PlannerRecipe } from "@/lib/recipes/types";
import { defaultMealPortions } from "@/lib/meal-plans/types";
import {
  formatDayMonthDe,
  formatWeekdayLongDe,
} from "@/lib/meal-plans/dates";
import { cn } from "@/lib/cn";
import {
  EMPTY_RECIPE_FILTER,
  RecipeFilterControls,
  useFilteredRecipes,
  type PlannerRecipeFilter,
} from "./recipe-filter";

type Props = {
  date: string | null;
  allTags: string[];
  onClose: () => void;
  onSelect: (input: {
    recipeId: number;
    date: string;
    servings: number;
    note: string;
  }) => Promise<void>;
};

// The modal isn't virtualised, so cap how many matches we render to keep the
// DOM small. Users narrow further with the filter; the panel (which is
// virtualised) shows the unbounded list.
const MAX_RESULTS = 50;

export function AddMealModal(props: Props) {
  // Key on the target date so form state resets between consecutive opens
  // (different days). The outer Dialog stays mounted to play close animations.
  return <AddMealModalInner key={props.date ?? "closed"} {...props} />;
}

function AddMealModalInner({
  date,
  allTags,
  onClose,
  onSelect,
}: Props) {
  const [filter, setFilter] =
    React.useState<PlannerRecipeFilter>(EMPTY_RECIPE_FILTER);
  const { recipes: matches } = useFilteredRecipes(filter);
  const [selected, setSelected] = React.useState<PlannerRecipe | null>(null);
  const [servings, setServings] = React.useState<number>(1);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const filtered = React.useMemo(
    () => matches.slice(0, MAX_RESULTS),
    [matches],
  );

  async function handleSave() {
    if (!selected || !date) return;
    setSaving(true);
    try {
      await onSelect({
        recipeId: selected.id,
        date,
        servings,
        note: note.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={date != null} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Mahlzeit hinzufügen</DialogTitle>
          {date ? (
            <DialogDescription>
              {formatWeekdayLongDe(date)}, {formatDayMonthDe(date)}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {selected == null ? (
          <div className="flex flex-col gap-3">
            <RecipeFilterControls
              allTags={allTags}
              value={filter}
              onChange={setFilter}
            />
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-fg)]">
                  Keine Treffer.
                </p>
              ) : (
                filtered.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelected(r);
                      setServings(defaultMealPortions(r.servings));
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-left text-sm transition-colors hover:border-[var(--color-accent)]",
                    )}
                  >
                    {r.photoPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/v1/${r.photoPath}`}
                        alt=""
                        className="size-10 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <div className="size-10 shrink-0 rounded bg-[var(--color-muted)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate font-medium">
                        <DietBadge
                          isVegan={r.isVegan}
                          isVegetarian={r.isVegetarian}
                          confidence={r.dietConfidence}
                          size="sm"
                        />
                        <span className="truncate">{r.title}</span>
                      </span>
                      <span className="block truncate text-xs text-[var(--color-muted-fg)]">
                        {r.servings} Portionen
                        {r.tags.length > 0 ? ` · ${r.tags.slice(0, 2).join(", ")}` : ""}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-2 text-sm">
              <span className="font-medium">{selected.title}</span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ml-2 text-xs text-[var(--color-muted-fg)] underline-offset-2 hover:underline"
              >
                ändern
              </button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-servings">Portionen</Label>
              <NumberInput
                id="add-servings"
                min={1}
                value={servings}
                onChange={(n) => setServings(n ?? 1)}
                className="w-32"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-note">Notiz</Label>
              <Input
                id="add-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                Abbrechen
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Speichert…" : "Hinzufügen"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
