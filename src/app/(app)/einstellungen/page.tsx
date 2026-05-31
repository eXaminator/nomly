import Link from "next/link";
import { ChevronRight } from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BulkReparseButton } from "@/components/recipes/bulk-reparse-button";

export const dynamic = "force-dynamic";

const STAMMDATEN_LINKS: Array<{
  href: string;
  title: string;
  description: string;
}> = [
  {
    href: "/einstellungen/zutaten",
    title: "Artikel",
    description:
      "Lebensmittel, Haushaltsartikel und Ausrüstung — Name, Aliase, Kategorie, Diät-Klassifikation, Equipment-Flag.",
  },
  {
    href: "/einstellungen/einheiten",
    title: "Einheiten",
    description:
      "Maßeinheiten mit Aliasen, Plural, Dimension und Faktor zu ihrer Basis-Einheit.",
  },
  {
    href: "/einstellungen/kategorien",
    title: "Kategorien",
    description:
      "Zuordnung von Artikeln zu Sortier-Kategorien.",
  },
  {
    href: "/einstellungen/tags",
    title: "Tags",
    description: "Rezept-Tags wie 'schnell', 'vegetarisch', 'feierlich'.",
  },
  {
    href: "/einstellungen/supermaerkte",
    title: "Supermärkte",
    description:
      "Supermärkte und die Reihenfolge der Kategorien für die Einkaufsliste.",
  },
  {
    href: "/einstellungen/standards",
    title: "Standards",
    description:
      "Wiederkehrende Einkäufe gruppieren — Brot, Milch, Backzutaten. Mit einem Tap auf die Einkaufsliste.",
  },
  {
    href: "/einstellungen/planer",
    title: "Planer",
    description:
      "Sichtbare Tage und Beginn der Woche für den Mahlzeitenplaner.",
  },
  {
    href: "/einstellungen/kalender",
    title: "Kalender (iCal)",
    description:
      "Externe iCal-Feeds abonnieren und Termine im Planer anzeigen.",
  },
  {
    href: "/einstellungen/api-tokens",
    title: "API-Tokens",
    description:
      "Bearer-Tokens für Maschinen-Zugriff auf die API — Home Assistant, Familywall-Import.",
  },
];

export const metadata = { title: "Einstellungen" };

export default async function EinstellungenPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>
        <p className="text-[var(--color-muted-fg)]">
          Konfiguration und Stammdaten.
        </p>
      </div>
      <div className="mt-8 grid gap-6">
        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
            Stammdaten
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {STAMMDATEN_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block rounded-[var(--radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <Card className="transition-colors hover:bg-[var(--color-muted)]">
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle>{link.title}</CardTitle>
                      <CardDescription>{link.description}</CardDescription>
                    </div>
                    <ChevronRight className="mt-1 size-5 shrink-0 text-[var(--color-muted-fg)]" />
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
            Wartung
          </h2>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Rezepte neu parsen</CardTitle>
                <CardDescription>
                  Den aktuellen Zutaten-Parser auf alle Rezepte anwenden und
                  Änderungen vor dem Übernehmen prüfen.
                </CardDescription>
              </div>
              <BulkReparseButton />
            </CardHeader>
          </Card>
        </div>
      </div>
    </>
  );
}
