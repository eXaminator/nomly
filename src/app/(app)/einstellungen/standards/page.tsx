import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { StapleGroupsPageClient } from "@/components/settings/staples/staple-groups-page-client";
import { listGroups } from "@/lib/staples/groups";

export const dynamic = "force-dynamic";

export default function StandardsListPage() {
  const initial = listGroups();
  return (
    <>
      <div className="flex flex-col gap-2">
        <Link
          href="/einstellungen"
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
        >
          <ChevronLeft className="size-4" />
          Einstellungen
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Standards</h1>
        <p className="text-[var(--color-muted-fg)]">
          Wiederkehrende Einkäufe als Gruppen — auf der Einkaufsliste mit
          einem Tap hinzufügen.
        </p>
      </div>
      <div className="mt-6">
        <StapleGroupsPageClient initial={initial} />
      </div>
    </>
  );
}
