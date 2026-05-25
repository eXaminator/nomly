"use client";

import * as React from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CreateArticleDialog,
  type CreatedArticle,
} from "@/components/ingredients/create-article-dialog";
import type { AutocompleteHit } from "@/lib/shopping/items";
import { addItem, autocomplete } from "./api";

type Props = {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
};

export function AddItemDialog({ open, onClose, onAdded }: Props) {
  const [query, setQuery] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [hits, setHits] = React.useState<AutocompleteHit[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setQuantity("1");
      setHits([]);
      setError(null);
      setCreateOpen(false);
    }
  }, [open]);

  function parsedQuantity(): number | null {
    const trimmed = quantity.trim().replace(",", ".");
    if (trimmed.length === 0) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  React.useEffect(() => {
    if (!open) return;
    if (query.trim().length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits([]);
      return;
    }
    const reqId = ++reqCounter.current;
    const handle = setTimeout(async () => {
      try {
        const res = await autocomplete(query.trim());
        if (reqCounter.current === reqId) setHits(res);
      } catch {
        // ignore
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [query, open]);

  const reqCounter = React.useRef(0);

  async function pickExisting(hit: AutocompleteHit) {
    setBusy(true);
    setError(null);
    const qty = parsedQuantity();
    try {
      await addItem({ ingredientId: hit.id, quantity: qty });
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  function openCreateDialog() {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    setCreateOpen(true);
  }

  async function handleCreated(article: CreatedArticle) {
    setCreateOpen(false);
    setBusy(true);
    setError(null);
    try {
      await addItem({ ingredientId: article.id, quantity: parsedQuantity() });
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !busy ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Artikel hinzufügen</DialogTitle>
          <DialogDescription>
            Tipp den Namen — bestehende Artikel erscheinen unten. Findet sich
            nichts, legst du einen neuen Artikel an.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="z. B. Toilettenpapier"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (hits.length === 0) {
                      openCreateDialog();
                    } else {
                      void pickExisting(hits[0]);
                    }
                  }
                }}
              />
            </div>
            <div className="flex flex-col gap-2 sm:w-24">
              <Label htmlFor="add-quantity">Menge</Label>
              <Input
                id="add-quantity"
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
              />
            </div>
          </div>
          {hits.length > 0 ? (
            <ul className="flex max-h-60 flex-col divide-y divide-[var(--color-border)] overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)]">
              {hits.map((h) => (
                <li key={`${h.kind}:${h.id}`}>
                  <button
                    type="button"
                    onClick={() => pickExisting(h)}
                    disabled={busy}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--color-muted)] focus-visible:outline-none focus-visible:bg-[var(--color-muted)]"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">{h.name}</span>
                      {h.matchedAlias ? (
                        <span className="text-xs text-[var(--color-muted-fg)]">
                          Alias: {h.matchedAlias}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs uppercase tracking-wider text-[var(--color-muted-fg)]">
                      Artikel
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim().length > 0 ? (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted-fg)]">
              Kein Treffer — „{query.trim()}“ als neuen Artikel anlegen.
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-[var(--color-danger)]">{error}</p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            onClick={() => {
              if (hits.length > 0) {
                void pickExisting(hits[0]);
              } else {
                openCreateDialog();
              }
            }}
            disabled={busy || query.trim().length === 0}
          >
            {busy ? "Speichert…" : hits.length > 0 ? "Hinzufügen" : "Neu anlegen…"}
          </Button>
        </DialogFooter>
      </DialogContent>
      <CreateArticleDialog
        open={createOpen}
        initialName={query.trim()}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </Dialog>
  );
}
