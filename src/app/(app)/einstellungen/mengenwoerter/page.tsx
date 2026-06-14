import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { QuantifierPageClient } from "@/components/settings/stammdaten/pages/quantifier-page-client";
import { listQuantifiersManaged } from "@/lib/stammdaten/quantifier/service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mengenwörter" };

export default function QuantifierStammdatenPage() {
  const initial = listQuantifiersManaged();
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
        <QuantifierPageClient initialItems={initial} />
      </div>
    </>
  );
}
