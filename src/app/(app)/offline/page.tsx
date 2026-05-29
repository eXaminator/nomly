import { CloudOff } from "lucide-react";

// Static fallback the SW serves for any non-`/einkauf` navigation that fails
// offline; renders inside the root `AppShell` so header + nav stay reachable.
export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <CloudOff className="size-12 text-[var(--color-muted-fg)]" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">Du bist offline</h1>
      <p className="text-sm text-[var(--color-muted-fg)]">
        Diese Seite ist offline nicht verfügbar. Die Einkaufsliste funktioniert
        weiter — sobald die Verbindung zurück ist, kannst du auch wieder andere
        Bereiche öffnen.
      </p>
    </div>
  );
}
