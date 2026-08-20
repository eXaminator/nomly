"use client";

import * as React from "react";
import { CloudOff, RefreshCw, Wifi, AlertTriangle } from "lucide-react";
import {
  getConnectivity,
  subscribeConnectivity,
  type ConnectivityState,
} from "@/lib/shopping/offline/connectivity";

/**
 * Read the app-wide connectivity state.
 *
 * `useSyncExternalStore` rather than useState + useEffect(subscribe), because
 * the store is written *before* subscription in the case that matters most: on
 * a reload while offline, `startConnectivityWatcher` (an earlier effect in
 * ConnectivityStatus) synchronously flips the state to "offline" via the
 * `navigator.onLine === false` short-circuit. A subscribe-in-effect hook misses
 * that write, and since `setConnectivity` ignores no-op writes, no later probe
 * ever notifies it — the UI would sit on "Prüfe Verbindung…" forever and never
 * tell the user they are offline. useSyncExternalStore re-reads the snapshot
 * after subscribing, so the window does not exist.
 */
export function useConnectivity(): ConnectivityState {
  return React.useSyncExternalStore(
    subscribeConnectivity,
    getConnectivity,
    // Server snapshot: the store is browser-only, and this matches the value a
    // fresh client starts from, so hydration stays consistent.
    () => "checking" as ConnectivityState,
  );
}

export function chipPresentation(state: ConnectivityState, pending: number) {
  if (state === "sessionExpired") {
    return { dot: "bg-[var(--color-danger)]", icon: AlertTriangle, label: "Anmeldung abgelaufen" };
  }
  if (state === "serverError") {
    return {
      dot: "bg-[var(--color-danger)]",
      icon: AlertTriangle,
      label: "Server nicht erreichbar",
    };
  }
  if (state === "offline") {
    const label = pending > 0 ? `Offline – ${pending} ausstehend` : "Offline";
    return { dot: "bg-[var(--color-muted-fg)]", icon: CloudOff, label };
  }
  if (state === "checking") {
    return {
      dot: "bg-[var(--color-muted-fg)]",
      icon: RefreshCw,
      label: "Prüfe Verbindung…",
    };
  }
  if (state === "syncing" || pending > 0) {
    return {
      dot: "bg-[var(--color-warning)]",
      icon: RefreshCw,
      label: `Synchronisiere${pending > 0 ? ` ${pending}` : ""}…`,
    };
  }
  return { dot: "bg-[var(--color-success)]", icon: Wifi, label: "Online" };
}
