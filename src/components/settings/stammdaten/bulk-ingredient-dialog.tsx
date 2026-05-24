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
import {
  SelectSearch,
  type SelectSearchItem,
} from "@/components/ui/select-search";
import { Switch } from "@/components/ui/switch";

type DietaryClass = "vegan" | "vegetarian" | "meat" | null;

const DIET_OPTIONS: Array<{ value: Exclude<DietaryClass, null>; label: string }> =
  [
    { value: "vegan", label: "Vegan" },
    { value: "vegetarian", label: "Vegetarisch" },
    { value: "meat", label: "Tierisch" },
  ];

/** Each field is tri-state: "keep" (leave alone), "clear" (set null/false),
 *  or a concrete value. Mirrors the server-side patch shape. */
type FieldMode = "keep" | "set" | "clear";

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
  selectedCount: number;
  selectedIds: number[];
  onClose: () => void;
  onApplied: () => void;
};

export function BulkIngredientDialog({
  open,
  selectedCount,
  selectedIds,
  onClose,
  onApplied,
}: Props) {
  const [categoryMode, setCategoryMode] = React.useState<FieldMode>("keep");
  const [category, setCategory] = React.useState<SelectSearchItem | null>(null);
  const [dietMode, setDietMode] = React.useState<FieldMode>("keep");
  const [diet, setDiet] = React.useState<Exclude<DietaryClass, null>>("vegan");
  const [excludeMode, setExcludeMode] = React.useState<FieldMode>("keep");
  const [excludeValue, setExcludeValue] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    // setState-in-effect: reset the staged patch every time the dialog is
    // reopened so a previous bulk action never silently re-applies.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategoryMode("keep");
    setCategory(null);
    setDietMode("keep");
    setDiet("vegan");
    setExcludeMode("keep");
    setExcludeValue(false);
    setError(null);
  }, [open]);

  const patchHasAnyField =
    categoryMode !== "keep" || dietMode !== "keep" || excludeMode !== "keep";

  async function apply() {
    if (!patchHasAnyField) return;
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      if (categoryMode === "set") {
        if (!category) {
          throw new Error("Bitte eine Kategorie auswählen.");
        }
        patch.defaultCategoryId = category.id;
      } else if (categoryMode === "clear") {
        patch.defaultCategoryId = null;
      }
      if (dietMode === "set") patch.dietaryClass = diet;
      else if (dietMode === "clear") patch.dietaryClass = null;
      if (excludeMode === "set") patch.excludeFromShoppingList = excludeValue;
      else if (excludeMode === "clear") patch.excludeFromShoppingList = false;
      const res = await fetch("/api/v1/ingredients/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, patch }),
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
          <DialogTitle>{selectedCount} Zutaten bearbeiten</DialogTitle>
          <DialogDescription>
            Felder werden nur geändert, wenn sie hier ausdrücklich gesetzt
            werden. Andere Felder bleiben pro Zutat unverändert.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FieldRow
            label="Standard-Kategorie"
            mode={categoryMode}
            onModeChange={setCategoryMode}
          >
            <SelectSearch
              value={category}
              onChange={setCategory}
              search={searchCategories}
              placeholder="Kategorie wählen…"
              disabled={categoryMode !== "set"}
            />
          </FieldRow>
          <FieldRow
            label="Diät-Klasse"
            mode={dietMode}
            onModeChange={setDietMode}
          >
            <div className="grid grid-cols-3 gap-1">
              {DIET_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={dietMode !== "set"}
                  onClick={() => setDiet(opt.value)}
                  className={
                    "rounded-[var(--radius)] border px-2 py-1.5 text-xs transition-colors disabled:opacity-50 " +
                    (diet === opt.value
                      ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] text-[var(--color-fg)]"
                      : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </FieldRow>
          <FieldRow
            label="Von Einkaufsliste ausschließen"
            mode={excludeMode}
            onModeChange={setExcludeMode}
            allowClear={false}
          >
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={excludeValue}
                onCheckedChange={(v) => setExcludeValue(Boolean(v))}
                disabled={excludeMode !== "set"}
              />
              <span>{excludeValue ? "Ja" : "Nein"}</span>
            </label>
          </FieldRow>
          {error ? (
            <p className="text-sm text-[var(--color-danger)]">{error}</p>
          ) : null}
        </DialogBody>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={apply} disabled={saving || !patchHasAnyField}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Auf {selectedCount} anwenden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({
  label,
  mode,
  onModeChange,
  allowClear = true,
  children,
}: {
  label: string;
  mode: FieldMode;
  onModeChange: (next: FieldMode) => void;
  allowClear?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex gap-1">
          <ModeChip
            active={mode === "keep"}
            onClick={() => onModeChange("keep")}
            label="Unverändert"
          />
          <ModeChip
            active={mode === "set"}
            onClick={() => onModeChange("set")}
            label="Setzen"
          />
          {allowClear ? (
            <ModeChip
              active={mode === "clear"}
              onClick={() => onModeChange("clear")}
              label="Leeren"
            />
          ) : null}
        </div>
      </div>
      <div className={mode === "set" ? "" : "opacity-50"}>{children}</div>
    </div>
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
