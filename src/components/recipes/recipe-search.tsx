"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { HelpCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Props = {
  /** Controlled value. When both `value` and `onChange` are passed, the
   *  component skips URL writes and reports debounced changes via the
   *  callback instead — useful for hosts that don't want filter retention. */
  value?: string;
  onChange?: (next: string) => void;
};

export function RecipeSearch({
  value: controlledValue,
  onChange: controlledOnChange,
}: Props = {}) {
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
        placeholder='Suche: tomate "rote linsen" zutat:basilikum -nudeln'
        className="pl-9 pr-10"
        aria-label="Rezepte durchsuchen"
      />
      <Popover.Root>
        <Popover.Trigger
          className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
          aria-label="Suchsyntax-Hilfe"
        >
          <HelpCircle className="size-4" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={6}
            align="end"
            className="z-50 max-w-sm rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-sm shadow-lg"
          >
            <p className="font-medium text-[var(--color-fg)]">Suche</p>
            <ul className="mt-2 space-y-1.5 text-[var(--color-muted-fg)]">
              <li>
                <code className="text-[var(--color-fg)]">tomate basilikum</code> —
                alle Begriffe müssen im Titel vorkommen.
              </li>
              <li>
                <code className="text-[var(--color-fg)]">
                  &quot;rote linsen&quot;
                </code>{" "}
                — Anführungszeichen für zusammenhängende Phrasen.
              </li>
              <li>
                <code className="text-[var(--color-fg)]">-nudeln</code> —
                Bindestrich schließt Treffer aus.
              </li>
              <li>
                <code className="text-[var(--color-fg)]">tomate OR pasta</code>{" "}
                — &quot;or&quot; (auch klein geschrieben) akzeptiert eines der
                beiden.
              </li>
              <li>
                <code className="text-[var(--color-fg)]">zutat:basilikum</code> —
                sucht in Zutaten (inkl. Aliase) statt im Titel.
              </li>
              <li>Tippfehler werden bis zu einer kleinen Distanz toleriert.</li>
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
