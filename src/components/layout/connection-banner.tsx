"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CloudOff, RefreshCw, ServerCrash, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConnectivity } from "@/components/shopping/offline-indicator";

/**
 * The app's one place for "we could not reach the server".
 *
 * The request guard stops a failing server from reloading the page, which means
 * the frame, the navigation and the IndexedDB-backed shopping list keep working
 * — but it also means nothing on screen would otherwise say *why* the content
 * stopped changing. This is that message.
 *
 * Deliberately a strip, not an overlay: whatever offline functionality survives
 * has to stay reachable underneath it. Requests are parked and retried by the
 * framework, so the retry button is a convenience for the impatient, not the
 * only way out.
 */
type Presentation = {
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  detail: string;
  retry: boolean;
};

export function bannerPresentation(
  state: ReturnType<typeof useConnectivity>,
): Presentation | null {
  switch (state) {
    case "offline":
      return {
        icon: CloudOff,
        tone: "border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-fg)]",
        title: "Du bist offline.",
        detail:
          "Einkaufsliste und Navigation funktionieren weiter. Änderungen werden gespeichert und übertragen, sobald du wieder Verbindung hast.",
        retry: false,
      };
    case "serverError":
      return {
        icon: ServerCrash,
        tone: "border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger),var(--color-bg)_88%)] text-[var(--color-fg)]",
        title: "Der Server antwortet nicht.",
        detail:
          "Die angezeigten Inhalte können veraltet sein. Die Seite lädt sich nicht selbst neu — sie versucht es im Hintergrund weiter.",
        retry: true,
      };
    case "sessionExpired":
      return {
        icon: AlertTriangle,
        tone: "border-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning),var(--color-bg)_88%)] text-[var(--color-fg)]",
        title: "Deine Anmeldung ist abgelaufen.",
        detail: "Du wirst zur Anmeldung weitergeleitet.",
        retry: false,
      };
    default:
      // "online", "checking" and "syncing" are the header chip's business — a
      // banner for them would be noise on every page load.
      return null;
  }
}

export function ConnectionBanner() {
  const state = useConnectivity();
  const router = useRouter();
  // Which state the user last hit retry from. Deriving the spinner from it
  // means a change of state clears it on its own — no effect syncing state to
  // state, and nothing that can get stuck spinning after recovery.
  const [retriedFrom, setRetriedFrom] = React.useState<string | null>(null);
  const retrying = retriedFrom === state;
  const present = bannerPresentation(state);

  if (!present) return null;
  const { icon: Icon, tone, title, detail, retry } = present;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border-b px-4 py-2.5 text-sm md:px-6 ${tone}`}
    >
      <div className="mx-auto flex max-w-screen-2xl items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="flex-1">
          <span className="font-medium">{title}</span>{" "}
          <span className="text-[var(--color-muted-fg)]">{detail}</span>
        </p>
        {retry ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setRetriedFrom(state);
              // A router refresh, never location.reload(): a reload is served
              // from the service worker cache and re-runs the same failing
              // request, which is the loop this whole change removes. Left
              // enabled on purpose — while the server stays down the framework
              // is retrying anyway, and another click costs nothing.
              router.refresh();
            }}
          >
            <RefreshCw
              className={retrying ? "animate-spin" : undefined}
              aria-hidden
            />
            Erneut versuchen
          </Button>
        ) : null}
      </div>
    </div>
  );
}
