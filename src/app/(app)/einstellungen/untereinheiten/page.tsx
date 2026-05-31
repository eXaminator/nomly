import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { SubUnitPageClient } from "@/components/settings/stammdaten/pages/subunit-page-client";
import { listSubUnitsManaged } from "@/lib/stammdaten/sub-unit/service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Untereinheiten" };

export default function SubUnitStammdatenPage() {
  const initial = listSubUnitsManaged();
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
        <SubUnitPageClient initialItems={initial} />
      </div>
    </>
  );
}
