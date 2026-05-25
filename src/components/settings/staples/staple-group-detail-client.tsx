"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SelectSearch,
  type SelectSearchItem,
} from "@/components/ui/select-search";
import {
  CreateArticleDialog,
  type CreatedArticle,
} from "@/components/ingredients/create-article-dialog";
import type {
  StapleGroupDetail,
  StapleGroupItemDetail,
} from "@/lib/staples/groups";

type UnitOption = {
  id: number;
  name: string;
  dimension: "mass" | "volume" | "count";
};

type RowState = {
  /** Server id once the row has been saved. null for the bottom "new" row. */
  id: number | null;
  ingredientId: number | null;
  ingredientName: string;
  quantity: string;
  unitId: number | "";
  note: string;
};

type Props = {
  initial: StapleGroupDetail;
  units: UnitOption[];
};

async function searchIngredients(q: string): Promise<SelectSearchItem[]> {
  const res = await fetch(
    `/api/v1/shopping/autocomplete?q=${encodeURIComponent(q)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    hits: Array<{ id: number; name: string; matchedAlias?: string | null }>;
  };
  return data.hits.map((h) => ({
    id: h.id,
    name: h.name,
    detail: h.matchedAlias && h.matchedAlias !== h.name ? `≈ ${h.matchedAlias}` : undefined,
  }));
}

function fromDetail(item: StapleGroupItemDetail): RowState {
  return {
    id: item.id,
    ingredientId: item.ingredientId,
    ingredientName: item.ingredientName,
    quantity: item.quantity != null ? String(item.quantity) : "",
    unitId: item.unitId ?? "",
    note: item.note ?? "",
  };
}

function emptyRow(): RowState {
  return {
    id: null,
    ingredientId: null,
    ingredientName: "",
    quantity: "",
    unitId: "",
    note: "",
  };
}

function parseQty(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function StapleGroupDetailClient({ initial, units }: Props) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [editingName, setEditingName] = React.useState(false);
  const [renameBusy, setRenameBusy] = React.useState(false);

  const [rows, setRows] = React.useState<RowState[]>(() =>
    initial.items.map(fromDetail),
  );
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setName(initial.name), [initial]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setRows(initial.items.map(fromDetail)), [initial]);

  const [error, setError] = React.useState<string | null>(null);
  // The bottom "add ingredient" row's create-article-dialog state. Stores
  // the prefilled name and a resolver so SelectSearch's onCreate promise
  // settles once the modal closes.
  const [createPrompt, setCreatePrompt] = React.useState<{
    name: string;
    resolve: (item: SelectSearchItem | null) => void;
  } | null>(null);

  function setRow(idx: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function deleteRow(idx: number) {
    const row = rows[idx];
    setError(null);
    setRows((prev) => prev.filter((_, i) => i !== idx));
    if (row.id == null) return;
    try {
      const res = await fetch(
        `/api/v1/staple-groups/${initial.id}/items/${row.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
      router.refresh();
    }
  }

  function addEmptyRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  async function pickIngredientForRow(
    idx: number,
    item: SelectSearchItem | null,
  ) {
    if (!item) {
      setRow(idx, { ingredientId: null, ingredientName: "" });
      return;
    }
    setRow(idx, { ingredientId: item.id, ingredientName: item.name });
    // Persist immediately with the freshly-picked id so we don't race with React's setState.
    const next = { ...rows[idx], ingredientId: item.id, ingredientName: item.name };
    await commit(idx, next);
  }

  async function commit(idx: number, row: RowState) {
    if (row.ingredientId == null) return;
    const quantity = parseQty(row.quantity);
    const unitId = row.unitId === "" ? null : row.unitId;
    if ((quantity == null) !== (unitId == null)) {
      setError("Menge und Einheit müssen beide gesetzt oder beide leer sein.");
      return;
    }
    const note = row.note.trim() === "" ? null : row.note.trim();
    setError(null);
    try {
      if (row.id == null) {
        const res = await fetch(
          `/api/v1/staple-groups/${initial.id}/items`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ingredientId: row.ingredientId,
              quantity,
              unitId,
              note,
            }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (body.error === "duplicate_ingredient") {
            setError("Diese Zutat ist bereits in der Gruppe.");
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const created = (await res.json()) as { id: number };
        setRows((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, id: created.id } : r)),
        );
        router.refresh();
      } else {
        const res = await fetch(
          `/api/v1/staple-groups/${initial.id}/items/${row.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ quantity, unitId, note }),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    }
  }

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

  // SelectSearch.onCreate hook: open the dialog for the typed name and wait
  // for the modal to either return a newly-created ingredient or be cancelled.
  function promptCreate(typedName: string): Promise<SelectSearchItem> {
    return new Promise<SelectSearchItem>((resolve, reject) => {
      setCreatePrompt({
        name: typedName,
        resolve: (item) => {
          if (item) resolve(item);
          else reject(new Error("cancelled"));
        },
      });
    });
  }

  function handleCreated(article: CreatedArticle) {
    const item: SelectSearchItem = { id: article.id, name: article.name };
    createPrompt?.resolve(item);
    setCreatePrompt(null);
  }

  function handleCreateCancel() {
    createPrompt?.resolve(null);
    setCreatePrompt(null);
  }

  const existingIngredientIds = React.useMemo(
    () =>
      rows
        .map((r) => r.ingredientId)
        .filter((id): id is number => id != null),
    [rows],
  );

  const filterSearch = React.useCallback(
    async (q: string) => {
      const all = await searchIngredients(q);
      return all.filter((h) => !existingIngredientIds.includes(h.id));
    },
    [existingIngredientIds],
  );

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
            <Button variant="ghost" size="sm" onClick={saveName} disabled={renameBusy}>
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
        {rows.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-muted-fg)]">
            Noch keine Artikel. Füge unten eine Zutat hinzu.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row, idx) => (
              <li
                key={row.id ?? `new-${idx}`}
                className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-3"
              >
                <Row
                  row={row}
                  units={units}
                  onPatch={(patch) => setRow(idx, patch)}
                  onBlur={() => commit(idx, rows[idx])}
                  onPickIngredient={(item) => pickIngredientForRow(idx, item)}
                  onDelete={() => deleteRow(idx)}
                  ingredientSearch={filterSearch}
                  onCreateIngredient={promptCreate}
                />
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          onClick={addEmptyRow}
          className="self-start"
        >
          <Plus className="size-4" />
          Zutat hinzufügen
        </Button>
      </section>

      <CreateArticleDialog
        open={createPrompt != null}
        initialName={createPrompt?.name ?? ""}
        onClose={handleCreateCancel}
        onCreated={handleCreated}
      />
    </div>
  );
}

function Row({
  row,
  units,
  onPatch,
  onBlur,
  onPickIngredient,
  onDelete,
  ingredientSearch,
  onCreateIngredient,
}: {
  row: RowState;
  units: UnitOption[];
  onPatch: (patch: Partial<RowState>) => void;
  onBlur: () => void;
  onPickIngredient: (item: SelectSearchItem | null) => void;
  onDelete: () => void;
  ingredientSearch: (q: string) => Promise<SelectSearchItem[]>;
  onCreateIngredient: (name: string) => Promise<SelectSearchItem>;
}) {
  const ingredientValue: SelectSearchItem | null =
    row.ingredientId != null
      ? { id: row.ingredientId, name: row.ingredientName }
      : null;
  const ingredientLocked = row.id != null; // existing rows: lock ingredient

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex w-[260px] flex-col gap-1">
        <Label className="text-xs uppercase tracking-wider text-[var(--color-muted-fg)]">
          Zutat
        </Label>
        {ingredientLocked ? (
          <div className="flex h-9 items-center text-sm font-medium">
            {row.ingredientName}
          </div>
        ) : (
          <SelectSearch
            value={ingredientValue}
            onChange={onPickIngredient}
            search={ingredientSearch}
            placeholder="Zutat suchen oder anlegen…"
            onCreate={onCreateIngredient}
            createLabelPrefix="Neuen Artikel anlegen:"
          />
        )}
      </div>
      <div className="flex w-24 flex-col gap-1">
        <Label className="text-xs uppercase tracking-wider text-[var(--color-muted-fg)]">
          Menge
        </Label>
        <Input
          inputMode="decimal"
          value={row.quantity}
          onChange={(e) => onPatch({ quantity: e.target.value })}
          onBlur={onBlur}
          placeholder="—"
          disabled={row.ingredientId == null}
        />
      </div>
      <div className="flex w-28 flex-col gap-1">
        <Label className="text-xs uppercase tracking-wider text-[var(--color-muted-fg)]">
          Einheit
        </Label>
        <select
          value={row.unitId}
          onChange={(e) =>
            onPatch({
              unitId: e.target.value === "" ? "" : Number(e.target.value),
            })
          }
          onBlur={onBlur}
          disabled={row.ingredientId == null}
          className="h-9 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm disabled:opacity-50"
        >
          <option value="">—</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-[160px] flex-1 flex-col gap-1">
        <Label className="text-xs uppercase tracking-wider text-[var(--color-muted-fg)]">
          Notiz
        </Label>
        <Input
          value={row.note}
          onChange={(e) => onPatch({ note: e.target.value })}
          onBlur={onBlur}
          placeholder="—"
          disabled={row.ingredientId == null}
        />
      </div>
      <div className="flex items-end">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Löschen"
          onClick={onDelete}
          className="text-[var(--color-danger)]"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
