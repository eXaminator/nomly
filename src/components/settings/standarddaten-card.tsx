"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StandarddatenCounts } from "@/lib/seed-counts";

type SeedResult = {
  units: { added: number; skipped: number; aliasesAdded: number };
  categories: { added: number; skipped: number };
  ingredients: { added: number; skipped: number; aliasesAdded: number };
  supermarkets: { added: number; skipped: number };
};

const FORMAT = (n: number) => n.toLocaleString("de-DE");

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-sm text-[var(--color-muted-fg)]">{label}</span>
      <span className="font-mono text-base font-medium text-[var(--color-fg)]">
        {FORMAT(value)}
      </span>
    </div>
  );
}

export function StandarddatenCard({
  initial,
}: {
  initial: StandarddatenCounts;
}) {
  const [counts, setCounts] = React.useState(initial);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SeedResult | null>(null);

  async function refresh() {
    const res = await fetch("/api/v1/seed", { method: "GET" });
    if (res.ok) setCounts((await res.json()) as StandarddatenCounts);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/seed", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SeedResult;
      setResult(data);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Standarddaten</CardTitle>
        <CardDescription>
          Vordefinierte Zutaten, Einheiten, Kategorien und Supermärkte aus der
          <a
            href="https://github.com/TandoorRecipes/open-tandoor-data"
            target="_blank"
            rel="noreferrer"
            className="ml-1 underline underline-offset-2"
          >
            Tandoor-Datensammlung
          </a>
          . Wiederholtes Laden ist idempotent.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1 sm:grid-cols-2">
        <CountRow label="Zutaten" value={counts.ingredients} />
        <CountRow label="Einheiten" value={counts.units} />
        <CountRow label="Kategorien" value={counts.categories} />
        <CountRow label="Supermärkte" value={counts.supermarkets} />
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-[var(--color-muted-fg)]">
          {result ? (
            <ResultLine result={result} />
          ) : error ? (
            <span className="text-[var(--color-danger)]">{error}</span>
          ) : (
            <span>Bestehende Einträge werden übersprungen.</span>
          )}
        </div>
        <Button onClick={() => setConfirmOpen(true)} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          Standarddaten laden
        </Button>
      </CardFooter>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Standarddaten laden?</DialogTitle>
            <DialogDescription>
              Der Snapshot enthält Zutaten, Einheiten, Kategorien und Supermärkte
              aus der Tandoor-Datensammlung. Vorhandene Einträge werden anhand
              ihres Namens erkannt und übersprungen; neue Aliase werden ergänzt.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" disabled={loading}>
                Abbrechen
              </Button>
            </DialogClose>
            <Button
              onClick={async () => {
                await load();
                setConfirmOpen(false);
              }}
              disabled={loading}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              Jetzt laden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ResultLine({ result }: { result: SeedResult }) {
  const parts = [
    `${FORMAT(result.ingredients.added)} Zutaten hinzugefügt`,
    `${FORMAT(result.units.added)} Einheiten`,
    `${FORMAT(result.categories.added)} Kategorien`,
    `${FORMAT(result.supermarkets.added)} Supermärkte`,
  ];
  const skipped =
    result.ingredients.skipped +
    result.units.skipped +
    result.categories.skipped +
    result.supermarkets.skipped;
  return (
    <span>
      {parts.join(", ")} – {FORMAT(skipped)} übersprungen.
    </span>
  );
}
