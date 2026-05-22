import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { ProductPageClient } from "@/components/settings/stammdaten/pages/product-page-client";
import { listProducts } from "@/lib/stammdaten/product/service";

export const dynamic = "force-dynamic";

export default function ProductStammdatenPage() {
  const initial = listProducts();
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
      </div>
      <div className="mt-4">
        <ProductPageClient initialItems={initial} />
      </div>
    </AppShell>
  );
}
