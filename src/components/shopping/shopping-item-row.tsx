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
  /** Inserts a fresh manual amount on top of whatever already contributes.
   *  Used by the "Weitere Menge" form so amounts can be additive. */
  onAddAmount: (
    id: number,
    amount: { quantity: number | null; unitId: number | null },
  ) => Promise<void>;
  /** Updates a single recipe-derived source row's contributed quantity. */
  onSetSourceQuantity: (
    id: number,
    sourceId: number,
    quantity: number | null,
  ) => Promise<void>;
  /** Updates a single manual-amount row's quantity. */
  onSetManualAmountQuantity: (
    id: number,
    amountId: number,
    quantity: number | null,
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
  onAddAmount,
  onSetSourceQuantity,
  onSetManualAmountQuantity,
  onPatchNote,
  onDelete,
  onToggleUnavailable,
}: Props) {
  const [editing, setEditing] = React.useState(false);
  // Per-source and per-manual inputs are keyed by their row id so we can
  // diff against the original to know which ones changed on save.
  const [sourceInputs, setSourceInputs] = React.useState<Record<number, string>>(() =>
    Object.fromEntries(
      item.sources.map((s) => [
        s.sourceId,
        s.contributedQuantity != null ? String(s.contributedQuantity) : "",
      ]),
    ),
  );
  const [manualInputs, setManualInputs] = React.useState<Record<number, string>>(() =>
    Object.fromEntries(
      item.manualAmounts.map((m) => [
        m.id,
        m.quantity != null ? String(m.quantity) : "",
      ]),
    ),
  );
  const [note, setNote] = React.useState(item.note ?? "");
  const [saving, setSaving] = React.useState(false);
  const [newAmountQty, setNewAmountQty] = React.useState("");
  const [newAmountUnit, setNewAmountUnit] = React.useState<ComboboxItem | null>(null);
  const [addingNew, setAddingNew] = React.useState(false);

  // Default the new-amount unit to "Stück" the first time the form opens
  // for this item — it's the most common ad-hoc unit by a wide margin.
  // Fetched lazily so we don't pay for it unless the user opens the form.
  React.useEffect(() => {
    if (!addingNew || newAmountUnit != null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/v1/units?q=${encodeURIComponent("Stück")}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          items: Array<{ id: number; name: string }>;
        };
        const hit = data.items.find((u) => u.name === "Stück") ?? data.items[0];
        if (!cancelled && hit) {
          setNewAmountUnit({ id: hit.id, name: hit.name });
        }
      } catch {
        // Best-effort default; leave the picker empty if the lookup fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addingNew, newAmountUnit]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSourceInputs(
      Object.fromEntries(
        item.sources.map((s) => [
          s.sourceId,
          s.contributedQuantity != null ? String(s.contributedQuantity) : "",
        ]),
      ),
    );
    setManualInputs(
      Object.fromEntries(
        item.manualAmounts.map((m) => [
          m.id,
          m.quantity != null ? String(m.quantity) : "",
        ]),
      ),
    );
    setNote(item.note ?? "");
    setNewAmountQty("");
    setNewAmountUnit(null);
    setAddingNew(false);
  }, [item.id, item.sources, item.manualAmounts, item.note]);

  async function addNewAmount() {
    const raw = newAmountQty.trim().replace(",", ".");
    if (raw.length === 0 || !newAmountUnit) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setSaving(true);
    try {
      await onAddAmount(item.id, { quantity: n, unitId: newAmountUnit.id });
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

  function parseInput(raw: string | undefined): number | null {
    if (raw == null) return null;
    const trimmed = raw.trim().replace(",", ".");
    if (trimmed.length === 0) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  async function commit() {
    setSaving(true);
    try {
      // Sequential not parallel: writes against the same item's version
      // would race in flight and stomp on each other. Each call returns
      // the updated item from the server.
      for (const s of item.sources) {
        const next = parseInput(sourceInputs[s.sourceId]);
        if (next === s.contributedQuantity) continue;
        await onSetSourceQuantity(item.id, s.sourceId, next);
      }
      for (const m of item.manualAmounts) {
        const next = parseInput(manualInputs[m.id]);
        if (next === m.quantity) continue;
        await onSetManualAmountQuantity(item.id, m.id, next);
      }
      const trimmedNote = note.trim();
      const nextNote = trimmedNote.length > 0 ? trimmedNote : null;
      if (nextNote !== (item.note ?? null)) {
        await onPatchNote(item.id, nextNote);
      }
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
            {item.sources.length === 0 && item.manualAmounts.length === 0 ? (
              <p className="text-xs text-[var(--color-muted-fg)]">
                Keine Mengen erfasst.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {item.sources.map((s) => (
                  <li
                    key={`src-${s.sourceId}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-muted-fg)]">
                      <span className="font-medium text-[var(--color-fg)]/80">
                        {s.recipeTitle}
                      </span>
                      <span className="ml-1">({formatDate(s.mealDate)})</span>
                    </span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={sourceInputs[s.sourceId] ?? ""}
                      onChange={(e) =>
                        setSourceInputs((prev) => ({
                          ...prev,
                          [s.sourceId]: e.target.value,
                        }))
                      }
                      placeholder="Menge"
                      className="w-24"
                    />
                    <span className="w-10 text-xs text-[var(--color-muted-fg)]">
                      {s.contributedUnit ?? ""}
                    </span>
                  </li>
                ))}
                {item.manualAmounts.map((m) => (
                  <li
                    key={`man-${m.id}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="min-w-0 flex-1 text-xs italic text-[var(--color-muted-fg)]">
                      Manuell
                    </span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={manualInputs[m.id] ?? ""}
                      onChange={(e) =>
                        setManualInputs((prev) => ({
                          ...prev,
                          [m.id]: e.target.value,
                        }))
                      }
                      placeholder="Menge"
                      className="w-24"
                    />
                    <span className="w-10 text-xs text-[var(--color-muted-fg)]">
                      {m.unitName ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
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
