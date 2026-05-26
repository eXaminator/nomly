"use client";

import * as React from "react";
import { CloudOff, RefreshCw, Wifi, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  getConnectivity,
  subscribeConnectivity,
  type ConnectivityState,
} from "@/lib/shopping/offline/connectivity";

type Props = {
  pendingCount: number;
  onOpenDrawer?: () => void;
  className?: string;
};

function useConnectivity(): ConnectivityState {
  const [state, setState] = React.useState<ConnectivityState>(() => getConnectivity());
  React.useEffect(() => subscribeConnectivity(setState), []);
  return state;
}

export function OfflineIndicator({ pendingCount, onOpenDrawer, className }: Props) {
  const state = useConnectivity();
  const { dot, icon: Icon, label } = chipPresentation(state, pendingCount);
  const isClickable = onOpenDrawer != null && (state !== "online" || pendingCount > 0);
  const Tag = isClickable ? "button" : "span";

  return (
    <Tag
      type={isClickable ? "button" : undefined}
      onClick={isClickable ? onOpenDrawer : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-fg)]",
        isClickable && "hover:bg-[var(--color-muted)]",
        className,
      )}
      aria-label={`Verbindung: ${label}`}
    >
      <span className={cn("inline-block h-2 w-2 rounded-full", dot)} />
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>{label}</span>
    </Tag>
  );
}

function chipPresentation(state: ConnectivityState, pending: number) {
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
