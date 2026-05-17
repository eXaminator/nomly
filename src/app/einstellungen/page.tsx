import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StandarddatenCard } from "@/components/settings/standarddaten-card";
import { readStandarddatenCounts } from "@/lib/seed-counts";

const PLACEHOLDERS = [
  {
    title: "Supermärkte",
    description:
      "Reihenfolge der Kategorien pro Supermarkt – kommt in Epic 6.",
  },
  {
    title: "Zutaten / Produkte / Einheiten / Kategorien",
    description:
      "Verwaltung, Aliase, Zusammenführen – kommt in Epic 7.",
  },
  {
    title: "Kalender (iCal)",
    description: "Externe Feeds in den Planer einbinden – kommt in Epic 13.",
  },
  {
    title: "API-Tokens",
    description: "Bearer-Tokens für Home Assistant – kommt in Epic 12.",
  },
];

export default async function EinstellungenPage() {
  const counts = readStandarddatenCounts();
  return (
    <AppShell>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>
        <p className="text-[var(--color-muted-fg)]">
          Konfiguration und Stammdaten.
        </p>
      </div>
      <div className="mt-8 grid gap-6">
        <StandarddatenCard initial={counts} />
        <div className="grid gap-4 sm:grid-cols-2">
          {PLACEHOLDERS.map((p) => (
            <Card key={p.title} className="opacity-70">
              <CardHeader>
                <CardTitle>{p.title}</CardTitle>
                <CardDescription>{p.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
