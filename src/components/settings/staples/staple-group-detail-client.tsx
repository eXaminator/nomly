"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  StapleGroupDetail,
  StapleGroupItemDetail,
} from "@/lib/staples/groups";
import type { AutocompleteHit } from "@/lib/shopping/items";
import { autocomplete } from "@/components/shopping/api";

type UnitOption = {
  id: number;
  name: string;
  dimension: "mass" | "volume" | "count";
};

type Props = {
  initial: StapleGroupDetail;
  units: UnitOption[];
};

export function StapleGroupDetailClient({ initial, units }: Props) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [editingName, setEditingName] = React.useState(false);
  const [renameBusy, setRenameBusy] = React.useState(false);
  const [items, setItems] = React.useState(initial.items);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setName(initial.name), [initial]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setItems(initial.items), [initial]);
  const [error, setError] = React.useState<string | null>(null);

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed === initial.name || trimmed.length === 0) {
      setEditingName(false);
      setName(initial.name);
      return;
    }
    setRenameBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/staple-groups/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "duplicate_name") {
          setError("Es gibt schon eine Gruppe mit diesem Namen.");
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      setEditingName(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setRenameBusy(false);
    }
  }

  async function deleteItem(itemId: number) {
    setError(null);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    try {
      const res = await fetch(
        `/api/v1/staple-groups/${initial.id}/items/${itemId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
      router.refresh();
    }
  }

  async function patchItem(
    itemId: number,
    patch: { quantity: number | null; unitId: number | null; note: string | null },
  ) {
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/staple-groups/${initial.id}/items/${itemId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "incomplete_amount") {
          setError("Menge und Einheit müssen beide gesetzt oder beide leer sein.");
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    }
  }

  async function addItem(input: {
    ingredientId: number;
    quantity: number | null;
    unitId: number | null;
    note: string | null;
  }): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/staple-groups/${initial.id}/items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "duplicate_ingredient") {
          setError("Diese Zutat ist bereits in der Gruppe.");
          return false;
        }
        if (body.error === "incomplete_amount") {
          setError("Menge und Einheit müssen beide gesetzt oder beide leer sein.");
          return false;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
      return false;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        {editingName ? (
          <>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveName();
                }
                if (e.key === "Escape") {
                  setEditingName(false);
                  setName(initial.name);
                }
              }}
              className="text-2xl font-semibold"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={saveName}
              disabled={renameBusy}
            >
              <Check className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingName(false);
                setName(initial.name);
              }}
              disabled={renameBusy}
            >
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Umbenennen"
              onClick={() => setEditingName(true)}
            >
              <Pencil className="size-4" />
            </Button>
          </>
        )}
      </div>

      {error ? (
        <p className="text-sm text-[var(--color-danger)]">{error}</p>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
          Artikel
        </h2>
        {items.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-muted-fg)]">
            Noch keine Artikel. Füge unten eine Zutat hinzu — optional mit
            Standardmenge.
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                units={units}
                onDelete={() => deleteItem(item.id)}
                onPatch={(patch) => patchItem(item.id, patch)}
              />
            ))}
          </ul>
        )}
      </section>

      <AddItemForm units={units} existingIngredientIds={items.map((i) => i.ingredientId)} onAdd={addItem} />
    </div>
  );
}

function ItemRow({
  item,
  units,
  onDelete,
  onPatch,
}: {
  item: StapleGroupItemDetail;
  units: UnitOption[];
  onDelete: () => void;
  onPatch: (patch: {
    quantity: number | null;
    unitId: number | null;
    note: string | null;
  }) => Promise<void> | void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [quantity, setQuantity] = React.useState(
    item.quantity != null ? String(item.quantity) : "",
  );
  const [unitId, setUnitId] = React.useState<number | "">(item.unitId ?? "");
  const [note, setNote] = React.useState(item.note ?? "");

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setQuantity(item.quantity != null ? String(item.quantity) : ""), [item]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setUnitId(item.unitId ?? ""), [item]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setNote(item.note ?? ""), [item]);

  function parsedQuantity(): number | null {
    const t = quantity.trim().replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async function save() {
    const q = parsedQuantity();
    const u = unitId === "" ? null : unitId;
    await onPatch({
      quantity: q,
      unitId: u,
      note: note.trim() === "" ? null : note.trim(),
    });
    setEditing(false);
  }

  if (!editing) {
    return (
      <li className="flex items-center gap-3 p-3">
        <div className="flex flex-1 flex-col">
          <span className="font-medium">{item.ingredientName}</span>
          <span className="text-xs text-[var(--color-muted-fg)]">
            {item.quantity != null && item.unitName != null
              ? `${formatQuantity(item.quantity)} ${item.unitName}`
              : "ohne Standardmenge"}
            {item.note != null && item.note !== "" ? ` · ${item.note}` : ""}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Bearbeiten"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Löschen"
          onClick={onDelete}
          className="text-[var(--color-danger)]"
        >
          <Trash2 className="size-4" />
        </Button>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="font-medium">{item.ingredientName}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_2fr]">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Menge</Label>
          <Input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="optional"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Einheit</Label>
          <select
            value={unitId}
            onChange={(e) =>
              setUnitId(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
          >
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
          <Label className="text-xs">Notiz</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Vollkorn"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(false)}
        >
          Abbrechen
        </Button>
        <Button size="sm" onClick={save}>
          Speichern
        </Button>
      </div>
    </li>
  );
}

function AddItemForm({
  units,
  existingIngredientIds,
  onAdd,
}: {
  units: UnitOption[];
  existingIngredientIds: number[];
  onAdd: (input: {
    ingredientId: number;
    quantity: number | null;
    unitId: number | null;
    note: string | null;
  }) => Promise<boolean>;
}) {
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<AutocompleteHit[]>([]);
  const [picked, setPicked] = React.useState<AutocompleteHit | null>(null);
  const [quantity, setQuantity] = React.useState("");
  const [unitId, setUnitId] = React.useState<number | "">("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const reqCounter = React.useRef(0);

  React.useEffect(() => {
    if (picked != null) return;
    if (query.trim().length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits([]);
      return;
    }
    const reqId = ++reqCounter.current;
    const handle = setTimeout(async () => {
      try {
        const res = await autocomplete(query.trim());
        if (reqCounter.current !== reqId) return;
        const filtered = res.filter(
          (h) => !existingIngredientIds.includes(h.id),
        );
        setHits(filtered);
      } catch {
        // ignore
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [query, existingIngredientIds, picked]);

  function reset() {
    setQuery("");
    setPicked(null);
    setHits([]);
    setQuantity("");
    setUnitId("");
    setNote("");
  }

  function parsedQuantity(): number | null {
    const t = quantity.trim().replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async function submit() {
    if (!picked) return;
    setBusy(true);
    const ok = await onAdd({
      ingredientId: picked.id,
      quantity: parsedQuantity(),
      unitId: unitId === "" ? null : unitId,
      note: note.trim() === "" ? null : note.trim(),
    });
    setBusy(false);
    if (ok) reset();
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-dashed border-[var(--color-border)] p-4">
      <h3 className="text-sm font-medium">Zutat hinzufügen</h3>
      {picked == null ? (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="z. B. Brot — bestehende Zutaten erscheinen unten"
          />
          {hits.length > 0 ? (
            <ul className="flex max-h-60 flex-col divide-y divide-[var(--color-border)] overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)]">
              {hits.map((h) => (
                <li key={`${h.kind}:${h.id}`}>
                  <button
                    type="button"
                    onClick={() => setPicked(h)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-muted)] focus-visible:outline-none focus-visible:bg-[var(--color-muted)]"
                  >
                    <span className="flex flex-1 flex-col">
                      <span className="font-medium">{h.name}</span>
                      {h.matchedAlias ? (
                        <span className="text-xs text-[var(--color-muted-fg)]">
                          Alias: {h.matchedAlias}
                        </span>
                      ) : null}
                    </span>
                    <Plus className="size-4 text-[var(--color-muted-fg)]" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">{picked.name}</span>
            <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
              <X className="size-4" />
              Andere Zutat wählen
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_2fr]">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Menge (optional)</Label>
              <Input
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Einheit</Label>
              <select
                value={unitId}
                onChange={(e) =>
                  setUnitId(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
              >
                <option value="">—</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
              <Label className="text-xs">Notiz</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="z. B. Vollkorn"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Abbrechen
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Speichert…" : "Hinzufügen"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function formatQuantity(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}
