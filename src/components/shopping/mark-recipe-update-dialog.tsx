"use client";

import * as React from "react";
import { Wrench } from "lucide-react";
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
import type { ShoppingItemView } from "@/lib/shopping/items";
import { uniqueRecipes } from "./shopping-item-row";

/**
 * Picker shown when a shopping item is tied to more than one recipe and the
 * user wants to flag some/all of them for a later update. Marking is one-way
 * (sets needsUpdate=true); all recipes start checked.
 */
export function MarkRecipeUpdateDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: ShoppingItemView | null;
  onClose: () => void;
  onConfirm: (recipeIds: number[]) => void;
}) {
  const recipes = React.useMemo(
    () => (item ? uniqueRecipes(item.sources) : []),
    [item],
  );
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  // Reset the selection to "all checked" whenever a new item opens the dialog.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set(recipes.map((r) => r.recipeId)));
  }, [recipes]);

  const toggle = (recipeId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });

  return (
    <Dialog
      open={item != null}
      onOpenChange={(v) => (!v ? onClose() : undefined)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update vormerken</DialogTitle>
          <DialogDescription>
            {item?.name
              ? `„${item.name}" stammt aus mehreren Rezepten. Welche sollen für ein Update vorgemerkt werden?`
              : "Welche Rezepte sollen für ein Update vorgemerkt werden?"}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)]">
            {recipes.map((r) => (
              <li key={r.recipeId}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(r.recipeId)}
                    onChange={() => toggle(r.recipeId)}
                    className="size-4"
                  />
                  <span className="font-medium">{r.recipeTitle ?? "Rezept"}</span>
                </label>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter className="sm:items-center sm:justify-between">
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={selected.size === 0}
            onClick={() => {
              onConfirm(Array.from(selected));
              onClose();
            }}
          >
            <Wrench className="mr-2 size-4" />
            Vormerken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
