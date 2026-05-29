import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { UnitPageClient } from "@/components/settings/stammdaten/pages/unit-page-client";
import { listUnitsManaged } from "@/lib/stammdaten/unit/service";

export const dynamic = "force-dynamic";

export default function UnitStammdatenPage() {
  const initial = listUnitsManaged();
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
      </div>
      <div className="mt-4">
        <UnitPageClient initialItems={initial} />
      </div>
    </>
  );
}
