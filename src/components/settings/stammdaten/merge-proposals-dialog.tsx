"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ENTITY_LABELS, type EntityKind } from "./types";

type ClusterItem = {
  id: number;
  name: string;
  aliases: string[];
  refCount: number;
};

type Cluster = {
  id: string;
  items: ClusterItem[];
  defaultWinnerId: number;
};

/**
 * Per-cluster local state. The user can:
 *   - check/uncheck the whole cluster (skip a group entirely)
 *   - check/uncheck individual rows inside it (some items might be a false-positive
 *     similarity hit and shouldn't merge)
 *   - pick the winner via a radio (defaults to the algorithm's pick)
 */
type ClusterDecision = {
  enabled: boolean;
  winnerId: number;
  /** ids that should participate; subset of cluster.items. */
  participantIds: Set<number>;
  /** Per-loser mode. Missing key = default "merge". Winner is never in the
   * map. "replace" rewires FK refs but discards the name (no alias). */
  modes: Map<number, "merge" | "replace">;
};

export type MergeProposalsDialogProps = {
  open: boolean;
  onClose: () => void;
  entityKind: EntityKind;
  /** Called after a successful save so the parent list refreshes. */
  onMerged: () => void;
};

export function MergeProposalsDialog({
  open,
  onClose,
  entityKind,
  onMerged,
}: MergeProposalsDialogProps) {
  const labels = ENTITY_LABELS[entityKind];
  const plural = pluralFor(entityKind);

  const [clusters, setClusters] = React.useState<Cluster[]>([]);
  const [decisions, setDecisions] = React.useState<Map<string, ClusterDecision>>(
    new Map(),
  );
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setProgress(null);
    fetch(`/api/v1/${plural}/merge-proposals`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { clusters: Cluster[] };
      })
      .then((body) => {
        if (cancelled) return;
        setClusters(body.clusters);
        const init = new Map<string, ClusterDecision>();
        for (const c of body.clusters) {
          init.set(c.id, {
            enabled: true,
            winnerId: c.defaultWinnerId,
            participantIds: new Set(c.items.map((i) => i.id)),
            modes: new Map(),
          });
        }
        setDecisions(init);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof Error
            ? e.message
            : "Vorschläge konnten nicht geladen werden.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, plural]);

  function updateDecision(
    clusterId: string,
    patch: Partial<ClusterDecision>,
  ): void {
    setDecisions((prev) => {
      const next = new Map(prev);
      const current = next.get(clusterId);
      if (!current) return prev;
      next.set(clusterId, { ...current, ...patch });
      return next;
    });
  }

  function toggleParticipant(clusterId: string, itemId: number): void {
    setDecisions((prev) => {
      const next = new Map(prev);
      const current = next.get(clusterId);
      if (!current) return prev;
      const participantIds = new Set(current.participantIds);
      if (participantIds.has(itemId)) {
        participantIds.delete(itemId);
      } else {
        participantIds.add(itemId);
      }
      // If the winner just got deselected, fall back to the first remaining.
      let winnerId = current.winnerId;
      if (!participantIds.has(winnerId)) {
        const first = participantIds.values().next().value;
        if (typeof first === "number") winnerId = first;
      }
      next.set(clusterId, { ...current, participantIds, winnerId });
      return next;
    });
  }

  const selectedClusters = clusters.filter((c) => {
    const d = decisions.get(c.id);
    return d?.enabled && d.participantIds.size >= 2;
  });

  async function save() {
    if (selectedClusters.length === 0) return;
    setSaving(true);
    setError(null);
    setProgress({ done: 0, total: selectedClusters.length });

    let success = 0;
    const errors: string[] = [];

    for (const cluster of selectedClusters) {
      const decision = decisions.get(cluster.id);
      if (!decision) continue;
      const loserIds = Array.from(decision.participantIds).filter(
        (id) => id !== decision.winnerId,
      );
      if (loserIds.length === 0) continue;
      const replaceIds = loserIds.filter(
        (id) => decision.modes.get(id) === "replace",
      );
      try {
        const res = await fetch(`/api/v1/${plural}/merge`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            winnerId: decision.winnerId,
            loserIds,
            replaceIds,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        success += 1;
      } catch (e) {
        const winnerName =
          cluster.items.find((i) => i.id === decision.winnerId)?.name ??
          `#${decision.winnerId}`;
        errors.push(
          `${winnerName}: ${e instanceof Error ? e.message : "Fehler"}`,
        );
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }

    setSaving(false);
    setProgress(null);
    if (errors.length > 0) {
      setError(
        `${success} Gruppen zusammengeführt. ${errors.length} fehlgeschlagen: ${errors.join("; ")}`,
      );
      onMerged();
      return;
    }
    onMerged();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Ähnliche {labels.plural} zusammenführen
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">

        <p className="text-sm text-[var(--color-muted-fg)]">
          Vorschläge basieren auf Namensähnlichkeit (Plurale, Schreibvarianten,
          ASCII-Umschriften). Wähle pro Gruppe die {labels.singular}, in die die
          anderen zusammengeführt werden.
        </p>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-[var(--color-muted-fg)]">
            <Loader2 className="size-4 animate-spin" /> lädt Vorschläge…
          </div>
        )}

        {!loading && clusters.length === 0 && !error && (
          <p className="py-6 text-center text-[var(--color-muted-fg)]">
            Keine ähnlichen {labels.plural} gefunden. 👍
          </p>
        )}

        {!loading && clusters.length > 0 && (
          <div className="max-h-[60vh] overflow-y-auto flex flex-col gap-3 pr-1">
            {clusters.map((cluster) => {
              const decision = decisions.get(cluster.id);
              if (!decision) return null;
              return (
                <div
                  key={cluster.id}
                  className={
                    "rounded-[var(--radius)] border border-[var(--color-border)] p-3 " +
                    (decision.enabled ? "" : "opacity-50")
                  }
                >
                  <div className="flex items-center justify-between gap-2 pb-2">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <Checkbox
                        checked={decision.enabled}
                        onCheckedChange={() =>
                          updateDecision(cluster.id, {
                            enabled: !decision.enabled,
                          })
                        }
                      />
                      Diese Gruppe zusammenführen
                    </label>
                    <span className="text-xs text-[var(--color-muted-fg)]">
                      {decision.participantIds.size} ausgewählt
                    </span>
                  </div>

                  <div className="flex flex-col divide-y divide-[var(--color-border)]">
                    {cluster.items.map((item) => {
                      const checked = decision.participantIds.has(item.id);
                      const isWinner = decision.winnerId === item.id;
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 py-2"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() =>
                              toggleParticipant(cluster.id, item.id)
                            }
                            disabled={!decision.enabled}
                            aria-label={`${item.name} einbeziehen`}
                          />
                          <input
                            type="radio"
                            name={`winner-${cluster.id}`}
                            checked={isWinner}
                            onChange={() =>
                              updateDecision(cluster.id, {
                                winnerId: item.id,
                              })
                            }
                            disabled={!decision.enabled || !checked}
                            className="ml-1"
                            aria-label={`${item.name} als Gewinner`}
                          />
                          <div className="flex-1 min-w-0">
                            <div
                              className={
                                "truncate " +
                                (isWinner
                                  ? "font-medium text-[var(--color-fg)]"
                                  : "text-[var(--color-fg)]")
                              }
                            >
                              {item.name}
                              {isWinner && (
                                <span className="ml-2 text-xs text-[var(--color-accent)]">
                                  ← Gewinner
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--color-muted-fg)] truncate">
                              {item.aliases.length} Aliase ·{" "}
                              {item.refCount} Referenzen
                              {item.aliases.length > 0 &&
                                ` · ${item.aliases.slice(0, 3).join(", ")}${item.aliases.length > 3 ? "…" : ""}`}
                            </div>
                          </div>
                          {!isWinner && (
                            <select
                              value={decision.modes.get(item.id) ?? "merge"}
                              onChange={(e) => {
                                const mode = e.target.value as
                                  | "merge"
                                  | "replace";
                                const nextModes = new Map(decision.modes);
                                if (mode === "merge") nextModes.delete(item.id);
                                else nextModes.set(item.id, mode);
                                updateDecision(cluster.id, {
                                  modes: nextModes,
                                });
                              }}
                              disabled={!decision.enabled || !checked}
                              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
                              aria-label="Modus für diese Zeile"
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
              );
            })}
          </div>
        )}

        {error && (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        )}

        {progress && (
          <p className="text-sm text-[var(--color-muted-fg)]">
            Wird zusammengeführt… ({progress.done} / {progress.total})
          </p>
        )}
        </DialogBody>

        <DialogFooter className="sm:items-center sm:justify-between">
          <span className="text-xs text-[var(--color-muted-fg)] sm:mr-auto">
            {selectedClusters.length} von {clusters.length} Gruppen zur
            Zusammenführung ausgewählt
          </span>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            onClick={save}
            disabled={saving || selectedClusters.length === 0}
          >
            {saving ? (
              <>
                <Loader2 className="animate-spin" /> Speichert…
              </>
            ) : (
              `${selectedClusters.length} Gruppen zusammenführen`
            )}
          </Button>
        </DialogFooter>
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
