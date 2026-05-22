"use client";

import * as React from "react";
import { Ban, BookOpen, Check, MoreVertical, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type {
  ShoppingItemAmount,
  ShoppingItemSourceView,
  ShoppingItemView,
} from "@/lib/shopping/items";
import { formatQty } from "@/lib/shopping/format";
import { cn } from "@/lib/cn";

type Props = {
  item: ShoppingItemView;
  /** When set, "Hier nicht verfügbar" toggles for this supermarket. */
  activeSupermarketId: number | null;
  /** Opens the recipe preview dialog. Triggered from the context menu only. */
  onPreviewRecipe: (recipeId: number) => void;
  onToggle: (item: ShoppingItemView) => void;
  /** Sets a manual override quantity for one dimension of the item. */
  onSetAmount: (
    id: number,
    amount: { quantity: number | null; unitId: number | null },
  ) => Promise<void>;
  onPatchNote: (id: number, note: string | null) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onToggleUnavailable: (item: ShoppingItemView, supermarketId: number) => Promise<void>;
};

export function ShoppingItemRow({
  item,
  activeSupermarketId,
  onPreviewRecipe,
  onToggle,
  onSetAmount,
  onPatchNote,
  onDelete,
  onToggleUnavailable,
}: Props) {
  const [editing, setEditing] = React.useState(false);
  const [amountInputs, setAmountInputs] = React.useState<string[]>(() =>
    item.amounts.map((a) => (a.quantity != null ? String(a.quantity) : "")),
  );
  const [note, setNote] = React.useState(item.note ?? "");
  const [saving, setSaving] = React.useState(false);
  const [newAmountQty, setNewAmountQty] = React.useState("");
  const [newAmountUnit, setNewAmountUnit] = React.useState<ComboboxItem | null>(null);
  const [addingNew, setAddingNew] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAmountInputs(
      item.amounts.map((a) => (a.quantity != null ? String(a.quantity) : "")),
    );
    setNote(item.note ?? "");
    setNewAmountQty("");
    setNewAmountUnit(null);
    setAddingNew(false);
  }, [item.id, item.amounts, item.note]);

  async function addNewAmount() {
    const raw = newAmountQty.trim().replace(",", ".");
    if (raw.length === 0 || !newAmountUnit) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setSaving(true);
    try {
      await onSetAmount(item.id, { quantity: n, unitId: newAmountUnit.id });
      // Reset the inline form; the surrounding list will refresh via the
      // parent's optimistic update.
      setNewAmountQty("");
      setNewAmountUnit(null);
      setAddingNew(false);
    } finally {
      setSaving(false);
    }
  }

  async function searchUnits(query: string): Promise<ComboboxItem[]> {
    const res = await fetch(
      `/api/v1/units?q=${encodeURIComponent(query)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items: Array<{ id: number; name: string }> };
    return data.items.map((u) => ({ id: u.id, name: u.name }));
  }

  async function commit() {
    setSaving(true);
    try {
      // Persist amount edits first — each dimension is independent. Send only
      // the ones whose input differs from the displayed value.
      const tasks: Array<Promise<unknown>> = [];
      for (let i = 0; i < item.amounts.length; i += 1) {
        const original = item.amounts[i];
        const raw = (amountInputs[i] ?? "").trim().replace(",", ".");
        const next = raw.length === 0 ? null : Number(raw);
        const parsed =
          next != null && Number.isFinite(next) ? next : null;
        if (parsed === original.quantity) continue;
        tasks.push(
          onSetAmount(item.id, {
            quantity: parsed,
            unitId: original.unitId,
          }),
        );
      }
      const trimmedNote = note.trim();
      const nextNote = trimmedNote.length > 0 ? trimmedNote : null;
      if (nextNote !== (item.note ?? null)) {
        tasks.push(onPatchNote(item.id, nextNote));
      }
      await Promise.all(tasks);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const isUnavailableHere =
    activeSupermarketId != null &&
    item.unavailableSupermarketIds.includes(activeSupermarketId);

  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-2 py-2 sm:px-3 transition-colors",
        item.checked ? "opacity-60" : "hover:bg-[var(--color-muted)]/40",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(item)}
        aria-label={item.checked ? "Rückgängig" : "Abhaken"}
        title={item.checked ? "Rückgängig" : "Abhaken"}
        className="flex w-7 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            "inline-flex size-5 items-center justify-center rounded-md border-2 transition-colors",
            item.checked
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
              : "border-[var(--color-border)] bg-[var(--color-bg)]",
          )}
        >
          {item.checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
        </span>
      </button>

      <button
        type="button"
        onClick={(e) => {
          if (editing) return;
          e.preventDefault();
          onToggle(item);
        }}
        className="min-w-0 flex-1 text-left"
      >
        {editing ? (
          <div
            className="flex flex-col gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{item.name}</span>
              <span className="text-xs text-[var(--color-muted-fg)]">
                {item.refType === "product" ? "Produkt" : "Zutat"}
              </span>
            </div>
            {item.amounts.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {item.amounts.map((a, i) => (
                  <li
                    key={`${a.dimension}-${a.unitId ?? "none"}`}
                    className="flex items-center gap-2"
                  >
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={amountInputs[i] ?? ""}
                      onChange={(e) => {
                        const next = [...amountInputs];
                        next[i] = e.target.value;
                        setAmountInputs(next);
                      }}
                      placeholder="Menge"
                      className="w-24"
                    />
                    <span className="text-sm text-[var(--color-muted-fg)]">
                      {a.unitName ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--color-muted-fg)]">
                Keine Mengen erfasst.
              </p>
            )}
            {addingNew ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={newAmountQty}
                  onChange={(e) => setNewAmountQty(e.target.value)}
                  placeholder="Menge"
                  className="w-24"
                  autoFocus
                />
                <Combobox
                  value={newAmountUnit}
                  onChange={setNewAmountUnit}
                  search={searchUnits}
                  placeholder="Einheit"
                  className="min-w-[8rem] flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Hinzufügen"
                  onClick={addNewAmount}
                  disabled={
                    saving ||
                    newAmountQty.trim().length === 0 ||
                    newAmountUnit == null
                  }
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Abbrechen"
                  onClick={() => {
                    setAddingNew(false);
                    setNewAmountQty("");
                    setNewAmountUnit(null);
                  }}
                  disabled={saving}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddingNew(true)}
                className="self-start"
              >
                <Plus className="size-4" />
                Weitere Menge
              </Button>
            )}
            <Input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Notiz"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div
              className={cn(
                "flex flex-wrap items-baseline gap-x-2 gap-y-0.5",
                item.checked && "line-through",
              )}
            >
              <span className="font-medium">{item.name}</span>
              <AmountList amounts={item.amounts} />
              {item.note ? (
                <span className="text-xs text-[var(--color-muted-fg)]">
                  · {item.note}
                </span>
              ) : null}
              {isUnavailableHere ? (
                <span className="rounded-full bg-[color-mix(in_srgb,var(--color-danger),transparent_90%)] px-2 py-0.5 text-xs text-[var(--color-danger)]">
                  Hier nicht verfügbar
                </span>
              ) : null}
            </div>
            {item.sources.length > 0 ? (
              <ul className="flex flex-col gap-0.5 text-xs text-[var(--color-muted-fg)]">
                {item.sources.map((s) => (
                  <SourceLine key={s.sourceId} source={s} />
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Speichern"
              onClick={commit}
              disabled={saving}
            >
              <Check className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Abbrechen"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              <RotateCcw className="size-4" />
            </Button>
          </>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Aktionen"
                title="Aktionen"
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil className="mr-2 size-4" />
                Bearbeiten
              </DropdownMenuItem>
              <RecipeMenuEntry
                sources={item.sources}
                onPreview={onPreviewRecipe}
              />
              <DropdownMenuItem
                onClick={() =>
                  activeSupermarketId != null
                    ? void onToggleUnavailable(item, activeSupermarketId)
                    : undefined
                }
                disabled={activeSupermarketId == null}
                className="text-[var(--color-fg)]"
              >
                <Ban className="mr-2 size-4" />
                {isUnavailableHere
                  ? "Hier verfügbar markieren"
                  : "Hier nicht verfügbar"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void onDelete(item.id)}
                className="text-[var(--color-danger)]"
              >
                <Trash2 className="mr-2 size-4" />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function AmountList({ amounts }: { amounts: ShoppingItemAmount[] }) {
  const visible = amounts.filter(
    (a) => a.quantity != null || a.unitName != null,
  );
  if (visible.length === 0) return null;
  return (
    <span className="text-sm text-[var(--color-muted-fg)]">
      {visible.map((a, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="mx-1">+</span> : null}
          <span>
            {a.quantity != null ? formatQty(a.quantity) : ""}
            {a.unitName ? `${a.quantity != null ? " " : ""}${a.unitName}` : ""}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

function SourceLine({ source }: { source: ShoppingItemSourceView }) {
  return (
    <li className="inline-flex flex-wrap items-baseline gap-x-1.5 px-1">
      <span className="font-medium text-[var(--color-fg)]/80">{source.recipeTitle}</span>
      <span>({formatDate(source.mealDate)})</span>
      {source.contributedQuantity != null || source.contributedUnit ? (
        <span>
          {source.contributedQuantity != null
            ? formatQty(source.contributedQuantity)
            : ""}
          {source.contributedUnit ? ` ${source.contributedUnit}` : ""}
        </span>
      ) : null}
      {source.recipeNotes ? <span>· {source.recipeNotes}</span> : null}
    </li>
  );
}

function RecipeMenuEntry({
  sources,
  onPreview,
}: {
  sources: ShoppingItemSourceView[];
  onPreview: (recipeId: number) => void;
}) {
  if (sources.length === 0) return null;
  const uniqueByRecipe = new Map<number, ShoppingItemSourceView>();
  for (const s of sources) {
    if (!uniqueByRecipe.has(s.recipeId)) uniqueByRecipe.set(s.recipeId, s);
  }
  const unique = Array.from(uniqueByRecipe.values());
  if (unique.length === 1) {
    const only = unique[0];
    return (
      <DropdownMenuItem onClick={() => onPreview(only.recipeId)}>
        <BookOpen className="mr-2 size-4" />
        Rezept öffnen
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <BookOpen className="mr-2 size-4" />
        Rezept öffnen
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {unique.map((s) => (
          <DropdownMenuItem
            key={s.recipeId}
            onClick={() => onPreview(s.recipeId)}
          >
            {s.recipeTitle}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
