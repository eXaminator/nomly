"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  SelectSearch,
  type SelectSearchItem,
} from "@/components/ui/select-search";
import type { NewIngredientDefaults } from "@/lib/recipes/types";

type DietaryClass = "vegan" | "vegetarian" | "meat" | null;

const DIET_OPTIONS: Array<{ value: Exclude<DietaryClass, null>; label: string }> =
  [
    { value: "vegan", label: "Vegan" },
    { value: "vegetarian", label: "Vegetarisch" },
    { value: "meat", label: "Tierisch" },
  ];

type RowState = {
  name: string;
  category: SelectSearchItem | null;
  dietaryClass: DietaryClass;
  excludeFromShoppingList: boolean;
};

async function searchCategories(q: string): Promise<SelectSearchItem[]> {
  const res = await fetch(`/api/v1/categories?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as {
    items: Array<{ id: number; name: string }>;
  };
  return body.items;
}

type Props = {
  open: boolean;
  newNames: string[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (defaults: NewIngredientDefaults[]) => void;
};

/**
 * Dialog surfaced right before the final recipe POST when the form contains
 * ingredient names that don't match an existing canonical or alias row. Lets
 * the user attach category, dietary class, and the exclude-from-shopping flag
 * to each new ingredient in one step — saves the round-trip through the
 * Stammdaten settings page after the recipe lands.
 *
 * Skipping fields is fine: every input defaults to the "unset" state and the
 * recipe service treats those the same as today's auto-create path.
 */
export function NewIngredientsDialog({
  open,
  newNames,
  saving,
  onCancel,
  onConfirm,
}: Props) {
  const [rows, setRows] = React.useState<RowState[]>([]);

  React.useEffect(() => {
    if (!open) return;
    // setState-in-effect: hydrates row state when the dialog opens with a
    // freshly-detected set of new ingredient names.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(
      newNames.map((name) => ({
        name,
        category: null,
        dietaryClass: null,
        excludeFromShoppingList: false,
      })),
    );
  }, [open, newNames]);

  function patch(index: number, partial: Partial<RowState>) {
    setRows((prev) => {
      const next = prev.slice();
      next[index] = { ...next[index], ...partial };
      return next;
    });
  }

  function submit() {
    onConfirm(
      rows.map((r) => ({
        name: r.name,
        defaultCategoryId: r.category?.id ?? null,
        dietaryClass: r.dietaryClass,
        excludeFromShoppingList: r.excludeFromShoppingList,
      })),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Neue Zutaten definieren</DialogTitle>
          <DialogDescription>
            {newNames.length === 1
              ? "Diese Zutat existiert noch nicht. "
              : `${newNames.length} Zutaten existieren noch nicht. `}
            Du kannst hier direkt Kategorie und Diät-Klasse setzen — alle
            Felder sind optional und lassen sich später in den Stammdaten
            anpassen.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[60vh] overflow-y-auto">
          <ul className="flex flex-col gap-4">
            {rows.map((row, idx) => (
              <li
                key={row.name + idx}
                className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-3"
              >
                <div className="font-medium">{row.name}</div>
                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[var(--color-muted-fg)]">
                      Kategorie
                    </span>
                    <SelectSearch
                      value={row.category}
                      onChange={(c) => patch(idx, { category: c })}
                      search={searchCategories}
                      placeholder="Kategorie wählen…"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[var(--color-muted-fg)]">
                      Diät-Klasse
                    </span>
                    <div className="grid grid-cols-4 gap-1">
                      <button
                        type="button"
                        onClick={() => patch(idx, { dietaryClass: null })}
                        className={
                          "rounded-[var(--radius)] border px-2 py-1.5 text-xs transition-colors " +
                          (row.dietaryClass === null
                            ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] text-[var(--color-fg)]"
                            : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
                        }
                      >
                        ?
                      </button>
                      {DIET_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => patch(idx, { dietaryClass: opt.value })}
                          className={
                            "rounded-[var(--radius)] border px-2 py-1.5 text-xs transition-colors " +
                            (row.dietaryClass === opt.value
                              ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] text-[var(--color-fg)]"
                              : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
                          }
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <label className="mt-3 flex items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">Von Einkaufsliste ausschließen</span>
                    <span className="block text-xs text-[var(--color-muted-fg)]">
                      Z.&nbsp;B. Wasser, Salz — wird nie automatisch ergänzt.
                    </span>
                  </span>
                  <Switch
                    checked={row.excludeFromShoppingList}
                    onCheckedChange={(v) =>
                      patch(idx, { excludeFromShoppingList: Boolean(v) })
                    }
                  />
                </label>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
