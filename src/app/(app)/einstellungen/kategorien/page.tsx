import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { CategoryPageClient } from "@/components/settings/stammdaten/pages/category-page-client";
import { listCategories } from "@/lib/stammdaten/category/service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Kategorien" };

export default function CategoryStammdatenPage() {
  const initial = listCategories();
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
        <CategoryPageClient initialItems={initial} />
      </div>
    </>
  );
}
