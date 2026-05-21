import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

const STAMMDATEN_LINKS: Array<{
  href: string;
  title: string;
  description: string;
}> = [
  {
    href: "/einstellungen/zutaten",
    title: "Zutaten",
    description:
      "Namen, Aliase, Default-Kategorie, Diät-Klassifikation, Liste-Ausschluss.",
  },
  {
    href: "/einstellungen/produkte",
    title: "Produkte",
    description:
      "Manuell hinzufügbare Einkaufs-Artikel mit Namen, Aliasen und Kategorien.",
  },
  {
    href: "/einstellungen/einheiten",
    title: "Einheiten",
    description:
      "Maßeinheiten mit Aliasen, Dimension und Faktor zu ihrer Basis-Einheit.",
  },
  {
    href: "/einstellungen/kategorien",
    title: "Kategorien",
    description:
      "Zuordnung von Zutaten und Produkten zu Sortier-Kategorien.",
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
];

const PLACEHOLDERS = [
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
  return (
    <AppShell>
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
            Kommt noch
          </h2>
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
      </div>
    </AppShell>
  );
}
