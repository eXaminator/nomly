import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { ApiTokensPageClient } from "@/components/settings/api-tokens/api-tokens-page-client";
import { listApiTokens } from "@/lib/bearer";

export const dynamic = "force-dynamic";

export default function ApiTokensPage() {
  const initial = listApiTokens();
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
        <h1 className="text-2xl font-semibold tracking-tight">API-Tokens</h1>
        <p className="text-[var(--color-muted-fg)]">
          Bearer-Tokens für Maschinen-Zugriff auf die nomly-API — z. B. Home
          Assistant oder der Familywall-Import. Jeder Aufruf sendet den Token als{" "}
          <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 text-xs">
            Authorization: Bearer …
          </code>
          .
        </p>
      </div>
      <div className="mt-6">
        <ApiTokensPageClient initial={initial} />
      </div>
    </>
  );
}
