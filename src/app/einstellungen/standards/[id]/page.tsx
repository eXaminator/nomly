import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { asc } from "drizzle-orm";

import { AppShell } from "@/components/layout/app-shell";
import { StapleGroupDetailClient } from "@/components/settings/staples/staple-group-detail-client";
import { db } from "@/db";
import { unit } from "@/db/schema";
import { getGroup } from "@/lib/staples/groups";

export const dynamic = "force-dynamic";

export default async function StandardsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const group = getGroup(id);
  if (!group) notFound();
  const units = db
    .select({ id: unit.id, name: unit.name, dimension: unit.dimension })
    .from(unit)
    .orderBy(asc(unit.name))
    .all();
  return (
    <AppShell>
      <div className="flex flex-col gap-2">
        <Link
          href="/einstellungen/standards"
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
        >
          <ChevronLeft className="size-4" />
          Standards
        </Link>
      </div>
      <div className="mt-4">
        <StapleGroupDetailClient initial={group} units={units} />
      </div>
    </AppShell>
  );
}
