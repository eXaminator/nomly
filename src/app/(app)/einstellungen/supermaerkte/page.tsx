import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { SupermarketPageClient } from "@/components/settings/stammdaten/pages/supermarket-page-client";
import { listSupermarkets } from "@/lib/stammdaten/supermarket/service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Supermärkte" };

export default function SupermarketStammdatenPage() {
  const initial = listSupermarkets();
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
        <SupermarketPageClient initialItems={initial} />
      </div>
    </>
  );
}
