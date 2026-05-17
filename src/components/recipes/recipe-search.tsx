"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function RecipeSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [value, setValue] = React.useState(initial);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      const q = value.trim();
      const next = q ? `/rezepte?q=${encodeURIComponent(q)}` : "/rezepte";
      router.replace(next, { scroll: false });
    }, 200);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-fg)]" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Nach Titel oder Tag suchen…"
        className="pl-9"
        aria-label="Rezepte durchsuchen"
      />
    </div>
  );
}
