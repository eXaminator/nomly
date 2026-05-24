"use client";

import * as React from "react";
import { Loader2, Plus, X } from "lucide-react";

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
import {
  SelectSearch,
  type SelectSearchItem,
} from "@/components/ui/select-search";

type Mode = "add" | "remove";

type Side = {
  /** Plural noun of the entity the user is *picking*, e.g. "Supermärkten" when
   *  the source list is categories. */
  pickedNoun: string;
  /** Singular of `pickedNoun` — used in the picker placeholder. */
  pickedNounSingular: string;
  /** Endpoint that returns `{ items: [{id,name}] }` for the picker. */
  searchEndpoint: string;
};

type Props = {
  open: boolean;
  side: Side;
  /** Localised label for the selected entities ("3 Kategorien" / "2 Supermärkte"). */
  selectionLabel: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (mode: Mode, pickedIds: number[]) => void;
};

/**
 * Generic dialog for bulk-managing the category↔supermarket join table.
 * Used from both sides — "add the selected categories to these supermarkets"
 * and "add these categories to the selected supermarkets" — by swapping which
 * endpoint feeds the picker.
 */
export function BulkSupermarketCategoryDialog({
  open,
  side,
  selectionLabel,
  saving,
  error,
  onClose,
  onApply,
}: Props) {
  const [mode, setMode] = React.useState<Mode>("add");
  const [picked, setPicked] = React.useState<SelectSearchItem[]>([]);

  React.useEffect(() => {
    if (!open) return;
    // setState-in-effect: clear the staged list every time the dialog is
    // reopened.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode("add");
    setPicked([]);
  }, [open]);

  const search = React.useCallback(
    async (q: string): Promise<SelectSearchItem[]> => {
      const res = await fetch(
        `${side.searchEndpoint}?q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items: Array<{ id: number; name: string }>;
      };
      const taken = new Set(picked.map((p) => p.id));
      return body.items.filter((i) => !taken.has(i.id));
    },
    [picked, side.searchEndpoint],
  );

  function handlePick(item: SelectSearchItem | null) {
    if (!item) return;
    setPicked((prev) =>
      prev.some((p) => p.id === item.id) ? prev : [...prev, item],
    );
  }

  function remove(id: number) {
    setPicked((prev) => prev.filter((p) => p.id !== id));
  }

  function apply() {
    if (picked.length === 0) return;
    onApply(
      mode,
      picked.map((p) => p.id),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Zuordnung bearbeiten</DialogTitle>
          <DialogDescription>
            {selectionLabel}. Wähle die {side.pickedNoun}, die ergänzt oder
            entfernt werden sollen.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex gap-2">
            <ModeChip
              active={mode === "add"}
              onClick={() => setMode("add")}
              label="Hinzufügen"
            />
            <ModeChip
              active={mode === "remove"}
              onClick={() => setMode("remove")}
              label="Entfernen"
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-[var(--color-muted-fg)]">
              {side.pickedNoun}
            </span>
            {picked.length === 0 ? (
              <p className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-3 py-3 text-sm text-[var(--color-muted-fg)]">
                Noch keine {side.pickedNoun} gewählt.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {picked.map((p) => (
                  <li
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--color-muted)] px-2.5 py-1 text-xs"
                  >
                    <span>{p.name}</span>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      className="text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
                      aria-label={`${p.name} entfernen`}
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <SelectSearch
              value={null}
              onChange={handlePick}
              search={search}
              placeholder={`${side.pickedNounSingular} wählen…`}
            />
          </div>
          {error ? (
            <p className="text-sm text-[var(--color-danger)]">{error}</p>
          ) : null}
        </DialogBody>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={apply} disabled={saving || picked.length === 0}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {mode === "add" ? "Hinzufügen" : "Entfernen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeChip({
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
        "rounded-full border px-3 py-1 text-xs transition-colors " +
        (active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
          : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
      }
    >
      {label}
    </button>
  );
}
