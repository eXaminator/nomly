"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SelectSearch } from "@/components/ui/select-search";

import {
  ENTITY_LABELS,
  type EntityKind,
  formatRefs,
  type ImpactRow,
  refsSum,
} from "./types";

export type DeleteDialogProps<TItem> = {
  open: boolean;
  onClose: () => void;
  entityKind: EntityKind;
  items: TItem[]; // 1+ rows to delete
  idOf: (item: TItem) => number;
  nameOf: (item: TItem) => string;
  /** Search function for replacement picker (excludes the rows being deleted). */
  searchReplacement: (
    q: string,
    excludeIds: number[],
  ) => Promise<Array<{ id: number; name: string; detail?: string }>>;
  /** True when "Trotzdem löschen" is allowed (no hard-blocker FKs). */
  hardDeleteAllowed: boolean;
  /** Reason to show when hardDeleteAllowed is false. */
  hardDeleteDisabledReason?: string;
  onSubmit: (
    replaceWith: number | null,
    ids: number[],
  ) => Promise<void>;
};

export function DeleteDialog<TItem>({
  open,
  onClose,
  entityKind,
  items,
  idOf,
  nameOf,
  searchReplacement,
  hardDeleteAllowed,
  hardDeleteDisabledReason,
  onSubmit,
}: DeleteDialogProps<TItem>) {
  const labels = ENTITY_LABELS[entityKind];
  const [mode, setMode] = React.useState<"replace" | "hard">(
    hardDeleteAllowed ? "hard" : "replace",
  );
  const [replacement, setReplacement] = React.useState<
    { id: number; name: string; detail?: string } | null
  >(null);
  const [impact, setImpact] = React.useState<Map<number, ImpactRow>>(new Map());
  const [loadingImpact, setLoadingImpact] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || items.length === 0) return;
    // setState-in-effect: synchronizes external (server-fetched) impact data
    // into local state when the dialog opens. These resets just stage that
    // loading sequence; the rule's preferred patterns don't fit a fetch-on-
    // open trigger.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(hardDeleteAllowed ? "hard" : "replace");
     
    setReplacement(null);
     
    setError(null);
     
    setLoadingImpact(true);
    const ids = items.map(idOf);
    fetch(`/api/v1/${pluralFor(entityKind)}/impact?ids=${ids.join(",")}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((body: { items: ImpactRow[] }) => {
        const map = new Map<number, ImpactRow>();
        for (const it of body.items) map.set(it.id, it);
        setImpact(map);
        // If nothing references these rows AND hard delete allowed, default to hard.
        const anyRefs = body.items.some((it) => refsSum(it.refs) > 0);
        setMode(anyRefs && !hardDeleteAllowed ? "replace" : hardDeleteAllowed ? "hard" : "replace");
      })
      .catch(() => setError("Konnte Verwendungs-Daten nicht laden."))
      .finally(() => setLoadingImpact(false));
  }, [open, items, entityKind, idOf, hardDeleteAllowed]);

  const ids = items.map(idOf);
  const totalRefs = items.reduce(
    (acc, it) => acc + refsSum(impact.get(idOf(it))?.refs ?? {}),
    0,
  );

  const canSubmit =
    !submitting &&
    (mode === "hard" || (mode === "replace" && replacement != null));

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(mode === "replace" ? replacement!.id : null, ids);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  const title =
    items.length === 1
      ? `${labels.singular} "${nameOf(items[0])}" löschen`
      : `${items.length} ${labels.plural} löschen`;

  const labelHard =
    mode === "replace" ? "Ersetzen und löschen" : "Löschen";

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">

        <div className="text-sm">
          {loadingImpact ? (
            <p className="text-[var(--color-muted-fg)]">lädt…</p>
          ) : totalRefs === 0 ? (
            <p className="text-[var(--color-muted-fg)]">
              Wird nirgendwo verwendet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((it) => {
                const im = impact.get(idOf(it));
                if (!im) return null;
                const sum = refsSum(im.refs);
                return (
                  <li key={idOf(it)} className="text-[var(--color-muted-fg)]">
                    <strong className="text-[var(--color-fg)]">{nameOf(it)}</strong>{" "}
                    — {sum === 0 ? "wird nirgendwo verwendet" : formatRefs(im.refs)}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {totalRefs > 0 && (
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="delete-mode"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">
                  Durch {labels.singular === "Tag" ? "anderen Tag" : `andere ${labels.singular}`} ersetzen
                </div>
                <div className="mt-2">
                  <SelectSearch
                    value={replacement}
                    onChange={setReplacement}
                    search={(q) => searchReplacement(q, ids)}
                    placeholder={`${labels.singular} auswählen…`}
                    disabled={mode !== "replace"}
                  />
                </div>
              </div>
            </label>

            <label
              className={
                "flex items-start gap-3 " +
                (hardDeleteAllowed ? "cursor-pointer" : "cursor-not-allowed opacity-60")
              }
            >
              <input
                type="radio"
                name="delete-mode"
                checked={mode === "hard"}
                onChange={() => setMode("hard")}
                disabled={!hardDeleteAllowed}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Trotzdem löschen</div>
                {!hardDeleteAllowed && hardDeleteDisabledReason && (
                  <p className="text-xs text-[var(--color-muted-fg)] mt-1">
                    {hardDeleteDisabledReason}
                  </p>
                )}
              </div>
            </label>
          </div>
        )}

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button variant="danger" onClick={submit} disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 className="animate-spin" /> wird gelöscht…
              </>
            ) : (
              labelHard
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
