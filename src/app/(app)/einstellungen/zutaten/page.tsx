import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { IngredientPageClient } from "@/components/settings/stammdaten/pages/ingredient-page-client";
import { listIngredients } from "@/lib/stammdaten/ingredient/service";

export const dynamic = "force-dynamic";

export default function IngredientStammdatenPage() {
  const initial = listIngredients();
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
        <IngredientPageClient initialItems={initial} />
      </div>
    </>
  );
}
