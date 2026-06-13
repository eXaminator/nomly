"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewIngredientsDialog } from "@/components/recipes/new-ingredients-dialog";
import { IngredientRow } from "@/components/recipes/ingredient-row";
import type { DraftIngredient } from "@/components/recipes/types";
import type { NewIngredientDefaults } from "@/lib/recipes/types";
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
  /** Stable key local to this editor session. */
  key: number;
  /** Server id; null for new rows that haven't been saved yet. */
  id: number | null;
  /** Resolved ingredient id from the matcher pills; null = "new ingredient",
   *  handled via the new-ingredients dialog at save time. */
  pickedIngredientId: number | null;
  /** Canonical name of the picked ingredient (for the pinned pill / resolve). */
  pickedIngredientName: string;
  name: string;
  quantity: string;
  unitId: number | "";
  note: string;
};

type AutocompleteHit = { id: number; name: string };

type Props = {
  initial: StapleGroupDetail;
  units: UnitOption[];
};

async function autocomplete(query: string): Promise<AutocompleteHit[]> {
  if (query.trim().length === 0) return [];
  const res = await fetch(
    `/api/v1/shopping/autocomplete?q=${encodeURIComponent(query)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { hits: AutocompleteHit[] };
  return data.hits;
}

function fromDetail(item: StapleGroupItemDetail): RowState {
  return {
    key: item.id,
    id: item.id,
    pickedIngredientId: item.ingredientId,
    pickedIngredientName: item.ingredientName,
    name: item.ingredientName,
    quantity: item.quantity != null ? String(item.quantity) : "",
    unitId: item.unitId ?? "",
    note: item.note ?? "",
  };
}

function parseQty(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function rowFingerprint(r: RowState): string {
  return JSON.stringify({
    id: r.id,
    name: r.name.trim().toLowerCase(),
    pickedIngredientId: r.pickedIngredientId,
    quantity: r.quantity.trim(),
    unitId: r.unitId,
    note: r.note.trim(),
  });
}

export function StapleGroupDetailClient({ initial, units }: Props) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [editingName, setEditingName] = React.useState(false);
  const [renameBusy, setRenameBusy] = React.useState(false);

  const initialRows = React.useMemo(
    () => initial.items.map(fromDetail),
    [initial],
  );
  const [rows, setRows] = React.useState<RowState[]>(initialRows);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setName(initial.name), [initial]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setRows(initialRows), [initialRows]);

  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [pendingNewNames, setPendingNewNames] = React.useState<string[] | null>(
    null,
  );
  const nextKeyRef = React.useRef(-1);

  function setRow(key: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function deleteRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function addEmptyRow() {
    const key = nextKeyRef.current--;
    setRows((prev) => [
      ...prev,
      {
        key,
        id: null,
        pickedIngredientId: null,
        pickedIngredientName: "",
        name: "",
        quantity: "",
        unitId: "",
        note: "",
      },
    ]);
  }

  const isDirty = React.useMemo(() => {
    if (rows.length !== initialRows.length) return true;
    const initFp = new Map(initialRows.map((r) => [r.key, rowFingerprint(r)]));
    const curFp = new Map(rows.map((r) => [r.key, rowFingerprint(r)]));
    if (initFp.size !== curFp.size) return true;
    for (const [k, v] of curFp) {
      if (initFp.get(k) !== v) return true;
    }
    return false;
  }, [rows, initialRows]);

  /**
   * Resolve every row to an ingredient id. The matcher pills set
   * `pickedIngredientId` (existing article); rows still without one are new
   * and go to the new-ingredients dialog.
   */
  function resolveRowNames(activeRows: RowState[]): {
    resolved: Map<number, number>;
    unresolved: string[];
  } {
    const resolved = new Map<number, number>();
    const unresolvedSet = new Set<string>();
    for (const r of activeRows) {
      const trimmed = r.name.trim();
      if (trimmed === "") continue;
      if (r.pickedIngredientId != null) {
        resolved.set(r.key, r.pickedIngredientId);
      } else {
        unresolvedSet.add(trimmed);
      }
    }
    return { resolved, unresolved: [...unresolvedSet] };
  }

  // Run the diff against initialRows and fire DELETE / PATCH / POST.
  async function commitSave(resolvedByKey: Map<number, number>): Promise<void> {
    setError(null);
    // Validate: amount must be both-or-neither (a sub-unit counts as a unit).
    for (const r of rows) {
      if (!resolvedByKey.has(r.key)) continue;
      const q = parseQty(r.quantity);
      const hasUnit = r.unitId !== "" && r.unitId != null;
      if ((q == null) === hasUnit) {
        throw new Error(
          "Menge und Einheit müssen beide gesetzt oder beide leer sein.",
        );
      }
    }

    const initialIds = new Set(
      initialRows.map((r) => r.id).filter((id): id is number => id != null),
    );
    const currentIds = new Set(
      rows.map((r) => r.id).filter((id): id is number => id != null),
    );
    const removed = [...initialIds].filter((id) => !currentIds.has(id));

    for (const id of removed) {
      const res = await fetch(`/api/v1/staple-groups/${initial.id}/items/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`DELETE ${id}: HTTP ${res.status}`);
    }

    for (const r of rows) {
      const newIngredientId = resolvedByKey.get(r.key);
      if (newIngredientId == null) continue; // row has no article — skip silently
      const body = {
        ingredientId: newIngredientId,
        quantity: parseQty(r.quantity),
        unitId: r.unitId === "" ? null : r.unitId,
        note: r.note.trim() === "" ? null : r.note.trim(),
      };
      if (r.id == null) {
        const res = await fetch(`/api/v1/staple-groups/${initial.id}/items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (data.error === "duplicate_ingredient") {
            throw new Error(`${r.name.trim()} ist bereits in dieser Gruppe.`);
          }
          throw new Error(`POST: HTTP ${res.status}`);
        }
      } else {
        const orig = initialRows.find((x) => x.id === r.id);
        if (
          orig != null &&
          rowFingerprint(orig) === rowFingerprint(r) &&
          orig.pickedIngredientId === newIngredientId
        ) {
          continue;
        }
        const res = await fetch(
          `/api/v1/staple-groups/${initial.id}/items/${r.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (data.error === "duplicate_ingredient") {
            throw new Error(`${r.name.trim()} ist bereits in dieser Gruppe.`);
          }
          if (data.error === "incomplete_amount") {
            throw new Error(
              "Menge und Einheit müssen beide gesetzt oder beide leer sein.",
            );
          }
          throw new Error(`PATCH ${r.id}: HTTP ${res.status}`);
        }
      }
    }
  }

  async function save() {
    if (!isDirty) return;
    setSaving(true);
    setError(null);
    try {
      const { resolved, unresolved } = resolveRowNames(rows);
      if (unresolved.length > 0) {
        // Hand off to the dialog; its onConfirm finishes the save.
        setPendingNewNames(unresolved);
        return;
      }
      await commitSave(resolved);
      router.push("/einstellungen/standards");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleNewIngredientsConfirm(defaults: NewIngredientDefaults[]) {
    if (pendingNewNames == null) return;
    setSaving(true);
    setError(null);
    try {
      // Create each unresolved ingredient via the manage endpoint → name→id.
      const nameToId = new Map<string, number>();
      for (const d of defaults) {
        const payload = {
          name: d.name,
          defaultCategoryId: d.defaultCategoryId,
          excludeFromShoppingList: d.excludeFromShoppingList,
          isEquipment: d.isEquipment,
          dietaryClass: d.dietaryClass,
          // Forward the advanced "enrich the article" fields the dialog now
          // collects (default unit, conversions, aliases, excluded markets).
          aliases: d.aliases ?? [],
          aliasUnitDefaults: d.aliasUnitDefaults ?? [],
          aliasDisplayNames: d.aliasDisplayNames ?? {},
          conversions: d.conversions ?? [],
          defaultUnitId: d.defaultUnitId ?? null,
          defaultUnitDisplay: d.defaultUnitDisplay ?? null,
          excludedSupermarketIds: d.excludedSupermarketIds ?? [],
        };
        const res = await fetch("/api/v1/ingredients/manage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          if (res.status === 409) {
            const hits = await autocomplete(d.name);
            const exact = hits.find(
              (h) => h.name.toLowerCase() === d.name.toLowerCase(),
            );
            if (!exact) throw new Error(`Konnte ${d.name} nicht anlegen.`);
            nameToId.set(d.name.toLowerCase(), exact.id);
            continue;
          }
          throw new Error(`Anlegen von ${d.name}: HTTP ${res.status}`);
        }
        const created = (await res.json()) as { id: number; name: string };
        nameToId.set(d.name.toLowerCase(), created.id);
      }

      const resolvedByKey = new Map<number, number>();
      for (const r of rows) {
        const trimmed = r.name.trim();
        if (trimmed === "") continue;
        if (r.pickedIngredientId != null) {
          resolvedByKey.set(r.key, r.pickedIngredientId);
          continue;
        }
        const lookup = nameToId.get(trimmed.toLowerCase());
        if (lookup != null) resolvedByKey.set(r.key, lookup);
      }
      await commitSave(resolvedByKey);
      setPendingNewNames(null);
      router.push("/einstellungen/standards");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
      setPendingNewNames(null);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setRows(initialRows);
    setError(null);
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
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "duplicate_name") {
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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
          Artikel
        </h2>
        {rows.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-muted-fg)]">
            Noch keine Artikel. Füge unten einen hinzu.
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {rows.map((row) => (
              <li key={row.key} className="py-1">
                <StapleIngredientRow
                  row={row}
                  units={units}
                  onPatch={(patch) => setRow(row.key, patch)}
                  onRemove={() => deleteRow(row.key)}
                />
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" onClick={addEmptyRow} className="self-start">
          <Plus className="size-4" />
          Artikel hinzufügen
        </Button>
      </section>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        {isDirty ? (
          <span className="mr-auto text-sm text-[var(--color-muted-fg)]">
            Ungespeicherte Änderungen
          </span>
        ) : null}
        {isDirty ? (
          <Button variant="ghost" onClick={reset} disabled={saving}>
            Verwerfen
          </Button>
        ) : null}
        <Button onClick={save} disabled={saving || !isDirty}>
          {saving ? "Speichert…" : "Speichern"}
        </Button>
      </div>

      <NewIngredientsDialog
        open={pendingNewNames != null}
        newNames={pendingNewNames ?? []}
        saving={saving}
        onCancel={() => {
          setPendingNewNames(null);
          setSaving(false);
        }}
        onConfirm={handleNewIngredientsConfirm}
      />
    </div>
  );
}

/**
 * Bridges a staple {@link RowState} to the recipe {@link IngredientRow} (the
 * shared ingredient-matching editor). Builds a controlled `DraftIngredient`
 * from the row and maps every change back, so standards get the exact same
 * matcher / candidate-pills / force-match / edit-article / new-ingredient flow
 * as recipes — minus the recipe-only chrome (`variant="staple"`).
 */
function StapleIngredientRow({
  row,
  units,
  onPatch,
  onRemove,
}: {
  row: RowState;
  units: UnitOption[];
  onPatch: (patch: Partial<RowState>) => void;
  onRemove: () => void;
}) {
  const draft: DraftIngredient = React.useMemo(() => {
    const unitName =
      row.unitId !== "" && row.unitId != null
        ? units.find((u) => u.id === row.unitId)?.name ?? ""
        : "";
    return {
      uid: `staple-${row.key}`,
      name: row.name,
      canonicalName:
        row.pickedIngredientId != null &&
        row.pickedIngredientName.toLowerCase() !== row.name.toLowerCase()
          ? row.pickedIngredientName
          : null,
      selectedIngredientId: row.pickedIngredientId,
      candidates: [],
      addAsAlias: false,
      // Staples must resolve to a buyable article — the "Nicht zugeordnet"
      // pill is hidden in this variant (allowUnassigned={false}).
      unassigned: false,
      quantity: row.quantity,
      // Staples have no range support (recipe-only feature).
      quantityLow: "",
      isRange: false,
      unit:
        row.unitId !== "" && row.unitId != null
          ? { id: row.unitId, name: unitName }
          : null,
      notes: row.note,
      isOptional: false,
      fixedAmount: false,
      isAlternative: false,
    };
  }, [row, units]);

  return (
    <IngredientRow
      variant="staple"
      value={draft}
      onChange={(next) =>
        onPatch({
          name: next.name,
          pickedIngredientId: next.selectedIngredientId,
          pickedIngredientName: next.canonicalName ?? next.name,
          quantity: next.quantity,
          unitId: next.unit?.id ?? "",
          note: next.notes,
        })
      }
      onRemove={onRemove}
    />
  );
}
