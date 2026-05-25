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
import { RecipeSearch } from "@/components/recipes/recipe-search";
import {
  TagFilterBar,
  type TagFilterValue,
} from "@/components/recipes/tag-filter-bar";
import type { RecipeListItem } from "@/lib/recipes/types";
import { defaultMealPortions } from "@/lib/meal-plans/types";
import {
  formatDayMonthDe,
  formatWeekdayLongDe,
} from "@/lib/meal-plans/dates";
import { cn } from "@/lib/cn";

type Props = {
  date: string | null;
  recipes: RecipeListItem[];
  allTags: string[];
  onClose: () => void;
  onSelect: (input: {
    recipeId: number;
    date: string;
    servings: number;
    note: string;
  }) => Promise<void>;
};

const EMPTY_TAG_VALUE: TagFilterValue = { must: [], not: [] };

export function AddMealModal(props: Props) {
  // Key on the target date so form state resets between consecutive opens
  // (different days). The outer Dialog stays mounted to play close animations.
  return <AddMealModalInner key={props.date ?? "closed"} {...props} />;
}

function AddMealModalInner({
  date,
  recipes,
  allTags,
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = React.useState("");
  const [tagFilter, setTagFilter] = React.useState<TagFilterValue>(EMPTY_TAG_VALUE);
  const [selected, setSelected] = React.useState<RecipeListItem | null>(null);
  const [servings, setServings] = React.useState<number>(1);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const mustSet = new Set(tagFilter.must.map((t) => t.toLowerCase()));
    const notSet = new Set(tagFilter.not.map((t) => t.toLowerCase()));
    return recipes
      .filter((r) => {
        if (q.length > 0) {
          const hayTitle = r.title.toLowerCase();
          const hayTags = r.tags.join(" ").toLowerCase();
          if (!hayTitle.includes(q) && !hayTags.includes(q)) return false;
        }
        if (mustSet.size > 0 || notSet.size > 0) {
          const have = new Set(r.tags.map((t) => t.toLowerCase()));
          for (const m of mustSet) if (!have.has(m)) return false;
          for (const n of notSet) if (have.has(n)) return false;
        }
        return true;
      })
      .slice(0, 50);
  }, [recipes, query, tagFilter]);

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
            <RecipeSearch value={query} onChange={setQuery} />
            {allTags.length > 0 ? (
              <TagFilterBar
                allTags={allTags}
                value={tagFilter}
                onChange={setTagFilter}
              />
            ) : null}
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
