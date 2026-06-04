"use client";

import * as React from "react";
import {
  ShoppingSummaryCard,
  type ShoppingStoreSummary,
} from "./shopping-summary-card";
import { useConnectivity } from "@/components/shopping/offline-indicator";
import { readOfflineShoppingSummary } from "@/lib/shopping/offline/dashboard-summary";
import type { ShoppingSummary } from "@/lib/shopping/shopping-summary";

/**
 * Shopping card with an offline overlay. Online, the server-rendered values
 * are authoritative (they're refreshed by DashboardRefresher and include
 * changes from other devices). While not online, IndexedDB is — it carries
 * the user's offline check-offs. No overlay data (IDB never seeded or
 * broken) → the server snapshot stays.
 */
export function ShoppingSummaryLive({
  openCount,
  stores,
  className,
}: {
  openCount: number;
  stores: ShoppingStoreSummary[];
  className?: string;
}) {
  const connectivity = useConnectivity();
  const [offline, setOffline] = React.useState<ShoppingSummary | null>(null);

  React.useEffect(() => {
    if (connectivity === "online") return;
    let cancelled = false;
    void readOfflineShoppingSummary().then((summary) => {
      if (!cancelled && summary) setOffline(summary);
    });
    return () => {
      cancelled = true;
    };
  }, [connectivity]);

  const show =
    connectivity !== "online" && offline ? offline : { openCount, stores };
  return (
    <ShoppingSummaryCard
      openCount={show.openCount}
      stores={show.stores}
      className={className}
    />
  );
}
