"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewIngredientsDialog } from "@/components/recipes/new-ingredients-dialog";
import type {
  StapleGroupDetail,
  StapleGroupItemDetail,
} from "@/lib/staples/groups";
import type { NewIngredientDefaults } from "@/lib/recipes/types";

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
  /** Server-known ingredient id; cleared when the user types a name that no
   *  longer matches the picked ingredient. Resolved at save time by exact
   *  name match against the autocomplete; unresolved rows go through the
   *  new-ingredients dialog. */
  pickedIngredientId: number | null;
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

  // Step 1 of save: resolve every row's name against the catalog. If user
  // already picked the matching ingredient (pickedIngredientName === current
  // name, case-insensitive) we use that id. Otherwise we hit autocomplete
  // and look for an exact name match. Names that don't resolve land in the
  // new-ingredients dialog.
  async function resolveRowNames(
    activeRows: RowState[],
  ): Promise<{ resolved: Map<number, number>; unresolved: string[] }> {
    const resolved = new Map<number, number>(); // rowKey -> ingredientId
    const unresolvedSet = new Set<string>();
    for (const r of activeRows) {
      const trimmed = r.name.trim();
      if (trimmed === "") continue;
      if (
        r.pickedIngredientId != null &&
        r.pickedIngredientName.toLowerCase() === trimmed.toLowerCase()
      ) {
        resolved.set(r.key, r.pickedIngredientId);
        continue;
      }
      const hits = await autocomplete(trimmed);
      const exact = hits.find(
        (h) => h.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (exact) {
        resolved.set(r.key, exact.id);
      } else {
        unresolvedSet.add(trimmed);
      }
    }
    return { resolved, unresolved: [...unresolvedSet] };
  }

  // Step 2 of save: actually run the diff against initialRows and fire the
  // DELETE / PATCH / POST sequence. `resolvedByKey` must already cover every
  // active row whose name was unmatched-at-resolve-time but has since been
  // created via the new-ingredients dialog.
  async function commitSave(resolvedByKey: Map<number, number>): Promise<void> {
    setError(null);
    // Validate: amount must be both-or-neither.
    for (const r of rows) {
      if (!resolvedByKey.has(r.key)) continue;
      const q = parseQty(r.quantity);
      const u = r.unitId === "" ? null : r.unitId;
      if ((q == null) !== (u == null)) {
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
      const res = await fetch(
        `/api/v1/staple-groups/${initial.id}/items/${id}`,
        { method: "DELETE" },
      );
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
        // For existing rows, only PATCH when anything changed. (The diff is
        // already done by isDirty, but we re-check here to avoid empty PATCHes.)
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
      const { resolved, unresolved } = await resolveRowNames(rows);
      if (unresolved.length > 0) {
        // Hand off to the dialog; the dialog's onConfirm will finish the save.
        setPendingNewNames(unresolved);
        return;
      }
      await commitSave(resolved);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleNewIngredientsConfirm(
    defaults: NewIngredientDefaults[],
  ) {
    if (pendingNewNames == null) return;
    setSaving(true);
    setError(null);
    try {
      // Create each unresolved ingredient via the manage endpoint and build
      // a name→id map.
      const nameToId = new Map<string, number>();
      for (const d of defaults) {
        const payload = {
          name: d.name,
          aliases: [],
          aliasUnitDefaults: [],
          subUnits: [],
          defaultCategoryId: d.defaultCategoryId,
          purchaseUnitId: null,
          excludeFromShoppingList: d.excludeFromShoppingList,
          isEquipment: d.isEquipment,
          dietaryClass: d.dietaryClass,
        };
        const res = await fetch("/api/v1/ingredients/manage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (data.error === "duplicate" || data.error === "duplicate_name") {
            // Someone else created it in the meantime — look it up via auto-
            // complete instead of failing the whole save.
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

      // Re-resolve names for current rows, now that the new ingredients
      // exist. (We can't call resolveRowNames again because autocomplete
      // probably doesn't reflect the just-created ingredients yet; use the
      // local map for the rows whose names were unresolved.)
      const resolvedByKey = new Map<number, number>();
      for (const r of rows) {
        const trimmed = r.name.trim();
        if (trimmed === "") continue;
        if (
          r.pickedIngredientId != null &&
          r.pickedIngredientName.toLowerCase() === trimmed.toLowerCase()
        ) {
          resolvedByKey.set(r.key, r.pickedIngredientId);
          continue;
        }
        const lookup = nameToId.get(trimmed.toLowerCase());
        if (lookup != null) {
          resolvedByKey.set(r.key, lookup);
          continue;
        }
        // Wasn't in the unresolved set — must have matched a real ingredient
        // earlier. Re-look-up.
        const hits = await autocomplete(trimmed);
        const exact = hits.find(
          (h) => h.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (exact) {
          resolvedByKey.set(r.key, exact.id);
        }
      }
      await commitSave(resolvedByKey);
      setPendingNewNames(null);
      router.refresh();
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
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.key}>
                <ItemRow
                  row={row}
                  units={units}
                  onPatch={(patch) => setRow(row.key, patch)}
                  onDelete={() => deleteRow(row.key)}
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

function ItemRow({
  row,
  units,
  onPatch,
  onDelete,
}: {
  row: RowState;
  units: UnitOption[];
  onPatch: (patch: Partial<RowState>) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="grid items-center gap-2"
      style={{ gridTemplateColumns: "5rem 8rem 1fr 1fr auto" }}
    >
      <Input
        inputMode="decimal"
        placeholder="Menge"
        value={row.quantity}
        onChange={(e) => onPatch({ quantity: e.target.value })}
        aria-label="Menge"
      />
      <select
        value={row.unitId}
        onChange={(e) =>
          onPatch({
            unitId: e.target.value === "" ? "" : Number(e.target.value),
          })
        }
        aria-label="Einheit"
        className="flex h-11 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        <option value="">Einheit</option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <ArticleNameInput
        value={row.name}
        pickedName={row.pickedIngredientName}
        onTextChange={(next) => {
          // Typing breaks the picked-id association unless the new text
          // still matches the picked name exactly (case-insensitive).
          const stillPicked =
            row.pickedIngredientName.length > 0 &&
            next.toLowerCase() === row.pickedIngredientName.toLowerCase();
          if (stillPicked) {
            onPatch({ name: next });
          } else {
            onPatch({
              name: next,
              pickedIngredientId: null,
              pickedIngredientName: "",
            });
          }
        }}
        onPick={(hit) =>
          onPatch({
            name: hit.name,
            pickedIngredientId: hit.id,
            pickedIngredientName: hit.name,
          })
        }
      />
      <Input
        placeholder="Notiz"
        value={row.note}
        onChange={(e) => onPatch({ note: e.target.value })}
        aria-label="Notiz"
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Artikel entfernen"
        onClick={onDelete}
        className="text-[var(--color-danger)]"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function ArticleNameInput({
  value,
  pickedName,
  onTextChange,
  onPick,
}: {
  value: string;
  pickedName: string;
  onTextChange: (text: string) => void;
  onPick: (hit: AutocompleteHit) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [hits, setHits] = React.useState<AutocompleteHit[]>([]);
  const reqId = React.useRef(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits([]);
      return;
    }
    // Suppress the popover when the typed value matches the currently picked
    // ingredient — no point asking the user to re-pick what's already set.
    if (trimmed.toLowerCase() === pickedName.toLowerCase()) {
      setHits([]);
      return;
    }
    const id = ++reqId.current;
    const handle = setTimeout(async () => {
      const result = await autocomplete(trimmed);
      if (reqId.current === id) setHits(result);
    }, 150);
    return () => clearTimeout(handle);
  }, [value, pickedName]);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const showPopover = open && hits.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => onTextChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay close so a click on a suggestion still registers.
          setTimeout(() => setOpen(false), 120);
        }}
        placeholder="Artikel"
        aria-label="Artikel"
      />
      {showPopover ? (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(h);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-muted)] focus-visible:bg-[var(--color-muted)]"
              >
                {h.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
