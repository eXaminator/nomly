"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Props = {
  /** Controlled value. When both `value` and `onChange` are passed, the
   *  component skips URL writes and reports debounced changes via the
   *  callback instead — useful for hosts that don't want filter retention. */
  value?: string;
  onChange?: (next: string) => void;
};

export function RecipeSearch({ value: controlledValue, onChange: controlledOnChange }: Props = {}) {
  const isControlled = controlledValue != null && controlledOnChange != null;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = isControlled ? controlledValue : (params.get("q") ?? "");
  const [value, setValue] = React.useState(initial);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      const q = value.trim();
      if (isControlled) {
        controlledOnChange(q);
        return;
      }
      // Preserve other filters (must/not) on the URL — only mutate `q`.
      const url = new URLSearchParams(params.toString());
      if (q) url.set("q", q);
      else url.delete("q");
      const qs = url.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
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
