"use client";

import * as React from "react";
import Link from "next/link";
import { useConnectivity } from "@/components/shopping/offline-indicator";
import { cn } from "@/lib/cn";

/**
 * A Link that degrades to inert, dimmed text while offline. Used for
 * dashboard links into areas that aren't available offline (recipes, plan).
 * Shopping links stay plain <Link>s — /einkauf works offline.
 *
 * "checking" keeps links enabled: the probe resolves within seconds and
 * briefly-disabled links on every load would just flicker.
 */
export function OfflineAwareLink({
  href,
  className,
  children,
  ...rest
}: React.ComponentProps<typeof Link>) {
  const connectivity = useConnectivity();
  if (connectivity === "offline" || connectivity === "sessionExpired") {
    return (
      <span aria-disabled="true" className={cn(className, "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}
