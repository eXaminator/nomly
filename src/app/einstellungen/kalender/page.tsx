import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { CalendarFeedsPageClient } from "@/components/settings/calendar/calendar-feeds-page-client";
import { listFeeds } from "@/lib/ical/feeds";

export const dynamic = "force-dynamic";

export default function CalendarFeedsPage() {
  const initial = listFeeds();
  return (
    <AppShell>
      <div className="flex flex-col gap-2">
        <Link
          href="/einstellungen"
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
        >
          <ChevronLeft className="size-4" />
          Einstellungen
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Kalender</h1>
        <p className="text-[var(--color-muted-fg)]">
          iCal/ICS-Feeds abonnieren und im Planer neben den Mahlzeiten anzeigen.
        </p>
      </div>
      <div className="mt-6">
        <CalendarFeedsPageClient initial={initial} />
      </div>
    </AppShell>
  );
}
