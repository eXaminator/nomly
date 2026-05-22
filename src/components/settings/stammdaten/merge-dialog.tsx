"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import {
  ENTITY_LABELS,
  type EntityKind,
  formatRefs,
  type ImpactRow,
} from "./types";

export type MergeDialogProps<TItem> = {
  open: boolean;
  onClose: () => void;
  entityKind: EntityKind;
  /** Pre-loaded rows for the selection. */
  items: TItem[];
  idOf: (item: TItem) => number;
  nameOf: (item: TItem) => string;
  /** Optional inline warning banner shown above the radio list. */
  warning?: React.ReactNode;
  /** Submit handler — receives winner id + loser ids + ids that should be
   *  REPLACED (FKs rewired but name/aliases NOT absorbed). */
  onSubmit: (
    winnerId: number,
    loserIds: number[],
    replaceIds: number[],
  ) => Promise<void>;
};

export function MergeDialog<TItem>({
  open,
  onClose,
  entityKind,
  items,
  idOf,
  nameOf,
  warning,
  onSubmit,
}: MergeDialogProps<TItem>) {
  const labels = ENTITY_LABELS[entityKind];
  const [winnerId, setWinnerId] = React.useState<number | null>(null);
  const [impact, setImpact] = React.useState<Map<number, ImpactRow>>(new Map());
  const [loadingImpact, setLoadingImpact] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Per-loser mode: "merge" absorbs the loser's name+aliases as new aliases
  // of the winner; "replace" rewires refs but discards the name. Default
  // merge for every row; can't be set on the winner.
  const [modes, setModes] = React.useState<Map<number, "merge" | "replace">>(
    new Map(),
  );

  React.useEffect(() => {
    if (!open || items.length === 0) return;
    // setState-in-effect: this effect synchronizes external (server-fetched)
    // impact data into local state when the dialog opens for a new selection.
    // The set calls below initialize that loading state — they aren't a
    // cascading render trigger.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWinnerId(idOf(items[0]));
     
    setError(null);
     
    setLoadingImpact(true);
    const ids = items.map(idOf);
    fetch(`/api/v1/${pluralFor(entityKind)}/impact?ids=${ids.join(",")}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((body: { items: ImpactRow[] }) => {
        const map = new Map<number, ImpactRow>();
        for (const item of body.items) map.set(item.id, item);
        setImpact(map);
      })
      .catch(() => setError("Konnte Verwendungs-Daten nicht laden."))
      .finally(() => setLoadingImpact(false));
  }, [open, items, entityKind, idOf]);

  if (items.length < 2) return null;

  const winner = items.find((i) => idOf(i) === winnerId) ?? items[0];
  const losers = items.filter((i) => idOf(i) !== idOf(winner));
  const totalRefs = losers.reduce((acc, l) => {
    const im = impact.get(idOf(l));
    return im ? acc + Object.values(im.refs).reduce((a, b) => a + b, 0) : acc;
  }, 0);
  const totalAliases = losers.reduce(
    (acc, l) => acc + (impact.get(idOf(l))?.aliasCount ?? 0),
    0,
  );

  async function submit() {
    if (!winner) return;
    setSubmitting(true);
    setError(null);
    try {
      const replaceIds = losers
        .map(idOf)
        .filter((id) => modes.get(id) === "replace");
      await onSubmit(idOf(winner), losers.map(idOf), replaceIds);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  function setMode(id: number, mode: "merge" | "replace"): void {
    setModes((prev) => {
      const next = new Map(prev);
      next.set(id, mode);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {items.length} {labels.plural} zusammenführen
          </DialogTitle>
        </DialogHeader>

        {warning && (
          <div className="rounded-[var(--radius)] border border-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning),transparent_88%)] px-3 py-2 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
              <div>{warning}</div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--color-muted-fg)]">
            Welche Zeile soll erhalten bleiben? Die anderen werden in diese
            aufgenommen.
          </p>
          <div className="rounded-[var(--radius)] border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            {items.map((item) => {
              const id = idOf(item);
              const im = impact.get(id);
              const refSummary = im ? formatRefs(im.refs) : "";
              const isWinner = winnerId === id;
              const mode = modes.get(id) ?? "merge";
              return (
                <div
                  key={id}
                  className="flex items-start gap-3 px-3 py-2 hover:bg-[var(--color-muted)]"
                >
                  <input
                    type="radio"
                    name="winner"
                    checked={isWinner}
                    onChange={() => setWinnerId(id)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{nameOf(item)}</div>
                    <div className="text-xs text-[var(--color-muted-fg)] truncate">
                      {loadingImpact && "lädt…"}
                      {!loadingImpact && im && refSummary}
                      {!loadingImpact && im && im.aliasCount > 0 &&
                        ` · ${im.aliasCount} Aliase`}
                    </div>
                  </div>
                  {!isWinner && (
                    <select
                      value={mode}
                      onChange={(e) =>
                        setMode(id, e.target.value as "merge" | "replace")
                      }
                      className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
                      aria-label="Modus für diese Zeile"
                      title={
                        hasAliasTable(entityKind)
                          ? "Zusammenführen: Name + Aliase werden zu Aliasen des Gewinners. Ersetzen: Referenzen umhängen, Name verwerfen."
                          : "Referenzen werden umgehängt; der Name geht in beiden Modi verloren."
                      }
                    >
                      <option value="merge">Zusammenführen</option>
                      <option value="replace">Ersetzen</option>
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm">
          <p>
            <strong>{nameOf(winner)}</strong> bleibt erhalten.{" "}
            {losers.length > 0 && (
              <>
                Die Namen der {losers.length} anderen{" "}
                {losers.length === 1 ? "Zeile" : "Zeilen"}
                {totalAliases > 0 && ` und ihre ${totalAliases} Aliase`} werden{" "}
                {hasAliasTable(entityKind) ? (
                  <>zu Aliasen von <strong>{nameOf(winner)}</strong>.</>
                ) : (
                  <>verworfen ({labels.plural} haben keine Aliase).</>
                )}
              </>
            )}
          </p>
          {totalRefs > 0 && (
            <p className="mt-1 text-[var(--color-muted-fg)]">
              {totalRefs} Referenzen werden auf <strong>{nameOf(winner)}</strong>{" "}
              umgehängt.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="animate-spin" /> Wird zusammengeführt…
              </>
            ) : (
              "Zusammenführen"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function pluralFor(kind: EntityKind): string {
  switch (kind) {
    case "ingredient":
      return "ingredients";
    case "product":
      return "products";
    case "unit":
      return "units";
    case "category":
      return "categories";
    case "tag":
      return "tags";
    case "supermarket":
      return "supermarkets";
  }
}

function hasAliasTable(kind: EntityKind): boolean {
  return kind === "ingredient" || kind === "product" || kind === "unit" || kind === "category";
}
