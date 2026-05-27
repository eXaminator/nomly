"use client";

import * as React from "react";

import { cn } from "@/lib/cn";
import { startConnectivityWatcher } from "@/lib/shopping/offline/connectivity";
import {
  chipPresentation,
  useConnectivity,
} from "@/components/shopping/offline-indicator";

/**
 * Always-on connection status in the app header. Owns the single
 * app-wide connectivity watcher (online/offline events + health heartbeat) so
 * the status is accurate on every page, not just the shopping list. Status
 * only — the pending-count + sync-drawer affordance stays on the shopping
 * shelf. Compact on phones (dot + icon); the label appears from `sm` up.
 */
export function ConnectivityStatus() {
  React.useEffect(() => startConnectivityWatcher(), []);
  const state = useConnectivity();
  const { dot, icon: Icon, label } = chipPresentation(state, 0);

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-xs font-medium text-[var(--color-fg)] sm:px-2.5"
      aria-label={`Verbindung: ${label}`}
      title={label}
    >
      <span className={cn("inline-block h-2 w-2 rounded-full", dot)} />
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
