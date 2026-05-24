"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInputWithWeekday } from "@/components/ui/date-input-with-weekday";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MealPlanView } from "@/lib/meal-plans/types";
import { cn } from "@/lib/cn";

type Props = {
  meal: MealPlanView | null;
  onClose: () => void;
  onSave: (
    id: number,
    patch: {
      servingsOverride: number | null;
      note: string | null;
      /** Optional. When set, moves the meal to this ISO date (and re-sorts
       *  it at the bottom of the day). Omit to keep the meal's date. */
      date?: string;
    },
  ) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
};

export function MealEditor(props: Props) {
  // Render only when there is a meal — and key the inner form by meal.id so
  // local form state resets cleanly each time a different meal is opened.
  // The wrapping Dialog stays mounted so its close animation can play out
  // when `meal` returns to null.
  return (
    <MealEditorDialog
      key={props.meal?.id ?? "closed"}
      {...props}
    />
  );
}

function MealEditorDialog({ meal, onClose, onSave, onDelete }: Props) {
  const [servings, setServings] = React.useState<number>(
    meal?.servings ?? 1,
  );
  const [date, setDate] = React.useState<string>(meal?.date ?? "");
  const [note, setNote] = React.useState<string>(meal?.note ?? "");
  const [saving, setSaving] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const open = meal != null;

  async function handleSave() {
    if (!meal) return;
    setSaving(true);
    try {
      const override = servings === meal.recipe.baseServings ? null : servings;
      const trimmed = note.trim();
      const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : meal.date;
      await onSave(meal.id, {
        servingsOverride: override,
        note: trimmed.length > 0 ? trimmed : null,
        // Only include the date when it actually changed so meals whose
        // date is untouched skip the extra `moveMealToDay` round-trip and
        // keep their sort order intact.
        ...(isoDate !== meal.date ? { date: isoDate } : {}),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!meal) return;
    setSaving(true);
    try {
      await onDelete(meal.id);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            // Side panel on every breakpoint: full viewport height, slides in
            // from the right edge. Mobile takes the whole width; ≥ sm caps at
            // a fixed sidebar width. Matches DrawerShell so every sidebar form
            // in the app has the same shape.
            "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-[var(--color-card)] shadow-2xl",
            "sm:max-w-md",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
            "duration-200",
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
            <div className="flex min-w-0 flex-col">
              <span className="text-xs uppercase tracking-wider text-[var(--color-muted-fg)]">
                Mahlzeit bearbeiten
              </span>
              <DialogPrimitive.Title className="truncate text-lg font-semibold leading-tight">
                {meal?.recipe.title ?? ""}
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Schließen">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="meal-date">Datum</Label>
              <DateInputWithWeekday
                id="meal-date"
                value={date}
                onChange={setDate}
                className="w-44"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="servings">Portionen</Label>
              <NumberInput
                id="servings"
                min={1}
                value={servings}
                onChange={(n) => setServings(n ?? 1)}
                className="w-32"
              />
              {meal && servings !== meal.recipe.baseServings ? (
                <button
                  type="button"
                  onClick={() => setServings(meal.recipe.baseServings)}
                  className="text-xs text-[var(--color-muted-fg)] underline-offset-2 hover:text-[var(--color-accent)] hover:underline"
                >
                  Auf Rezept-Standard ({meal.recipe.baseServings}) zurücksetzen
                </button>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">Notiz</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-3">
            {confirmingDelete ? (
              <div className="flex flex-1 items-center justify-between gap-2">
                <span className="text-sm text-[var(--color-fg)]">Mahlzeit löschen?</span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={saving}
                  >
                    Abbrechen
                  </Button>
                  <Button variant="danger" onClick={handleDelete} disabled={saving}>
                    Löschen
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Löschen"
                  className="text-[var(--color-danger)]"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={saving}
                >
                  <Trash2 />
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={onClose} disabled={saving}>
                    Abbrechen
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? "Speichert…" : "Speichern"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
