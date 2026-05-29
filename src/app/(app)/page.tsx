import Link from "next/link";

export const dynamic = "force-dynamic";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NAV_ITEMS } from "@/components/layout/nav-items";

const DESCRIPTIONS: Record<string, string> = {
  "/rezepte": "Rezepte erfassen, durchsuchen und verwalten.",
  "/plan": "Mahlzeiten auf den Kalender setzen.",
  "/einkauf": "Eine laufende Einkaufsliste, immer dabei.",
  "/einstellungen": "Standarddaten, Supermärkte, Tokens und mehr.",
};

export default function Home() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Willkommen
        </h1>
        <p className="text-[var(--color-muted-fg)]">
          Wähle einen Bereich, um loszulegen.
        </p>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className="block">
            <Card className="h-full transition-colors hover:border-[var(--color-accent)]">
              <CardHeader>
                <item.icon className="size-6 text-[var(--color-accent)]" />
                <CardTitle>{item.label}</CardTitle>
                <CardDescription>{DESCRIPTIONS[item.href]}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
