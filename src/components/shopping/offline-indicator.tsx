"use client";

import * as React from "react";
import { CloudOff, RefreshCw, Wifi, AlertTriangle } from "lucide-react";
import {
  getConnectivity,
  subscribeConnectivity,
  type ConnectivityState,
} from "@/lib/shopping/offline/connectivity";

export function useConnectivity(): ConnectivityState {
  const [state, setState] = React.useState<ConnectivityState>(() => getConnectivity());
  React.useEffect(() => subscribeConnectivity(setState), []);
  return state;
}

export function chipPresentation(state: ConnectivityState, pending: number) {
  if (state === "sessionExpired") {
    return { dot: "bg-[var(--color-danger)]", icon: AlertTriangle, label: "Anmeldung abgelaufen" };
  }
  if (state === "offline") {
    const label = pending > 0 ? `Offline – ${pending} ausstehend` : "Offline";
    return { dot: "bg-[var(--color-muted-fg)]", icon: CloudOff, label };
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
