"use client";

import * as React from "react";
import { Download, Link as LinkIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ImportedRecipeResponse = {
  title: string;
  description: string | null;
  servings: number;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  sourceUrl: string;
  photoPath: string | null;
  tags: string[];
  sections: Array<{
    title: string | null;
    instructions: string;
    ingredients: Array<{
      quantity: number | null;
      unit: { id: number; name: string } | null;
      name: string;
      notes: string | null;
    }>;
  }>;
};

type Props = {
  onImported: (recipe: ImportedRecipeResponse) => void;
};

export function UrlImportDialog({ onImported }: Props) {
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function reset() {
    setUrl("");
    setError(null);
    setLoading(false);
  }

  async function handleImport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/recipes/import-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onImported(data as ImportedRecipeResponse);
      reset();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="size-4" />
          Aus URL importieren
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rezept aus einer Webseite importieren</DialogTitle>
          <DialogDescription>
            Funktioniert mit Seiten, die strukturierte Rezeptdaten (schema.org
            Recipe) liefern – z.&nbsp;B. Chefkoch, Lecker, BBC Good Food.
            Anschließend kannst du alles vor dem Speichern prüfen und anpassen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="import-url">Rezept-URL</Label>
          <div className="relative">
            <LinkIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-fg)]" />
            <Input
              id="import-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!loading && url.trim()) void handleImport();
                }
              }}
              placeholder="https://…"
              autoFocus
              disabled={loading}
              className="pl-9"
            />
          </div>
          {error ? (
            <p className="rounded-[var(--radius)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger),var(--color-bg)_85%)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={loading}>
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            onClick={handleImport}
            disabled={loading || url.trim().length === 0}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Importieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
