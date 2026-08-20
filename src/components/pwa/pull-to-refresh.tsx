"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";

import { cn } from "@/lib/cn";
import { getConnectivity } from "@/lib/shopping/offline/connectivity";

const THRESHOLD = 70; // px (after damping) needed to trigger a refresh
const MAX_PULL = 110; // visual cap on how far the indicator travels
const DAMP = 0.5; // resistance so the pull feels rubber-banded

/**
 * Custom pull-to-refresh for the standalone PWA, where there's no browser
 * chrome (and thus no native pull-to-refresh) and `overscroll-behavior: none`
 * disables the gesture anyway. Arms only at the top of the page on a single
 * downward touch; on release past the threshold it checks for a service-worker
 * update and reloads — which, with the network-first shell, pulls in the
 * latest deployed version. Doesn't preventDefault, so normal scrolling is
 * untouched.
 *
 * The reload is skipped while we know the server is unreachable: it would be
 * answered from the service-worker cache and re-run the same failing request,
 * i.e. hand-crank the very loop the request guard exists to prevent. The
 * connection banner is already explaining the situation, so the gesture just
 * springs back.
 */
export function PullToRefresh() {
  const [pull, setPull] = React.useState(0);
  const [active, setActive] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  const startY = React.useRef<number | null>(null);
  const pullRef = React.useRef(0);
  const refreshingRef = React.useRef(false);

  const applyPull = React.useCallback((v: number) => {
    pullRef.current = v;
    setPull(v);
  }, []);

  // Don't arm the gesture while the user is interacting with something: a
  // modal/drawer is open (Radix sets `data-scroll-locked` on <body>) or an
  // editable field is focused. Otherwise scrolling a dialog's list to its end
  // and dragging further bubbles to the page and reloads — wiping the input.
  const interactionActive = () => {
    if (document.body.hasAttribute("data-scroll-locked")) return true;
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable
    );
  };

  React.useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (e.touches.length !== 1 || window.scrollY > 0 || interactionActive()) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (refreshingRef.current || startY.current == null) return;
      if (window.scrollY > 0) {
        startY.current = null;
        setActive(false);
        applyPull(0);
        return;
      }
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        if (pullRef.current !== 0) applyPull(0);
        return;
      }
      setActive(true);
      applyPull(Math.min(delta * DAMP, MAX_PULL));
    };

    const onEnd = () => {
      if (refreshingRef.current) return;
      const triggered = startY.current != null && pullRef.current >= THRESHOLD;
      startY.current = null;
      setActive(false);
      if (!triggered) {
        applyPull(0);
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      applyPull(THRESHOLD);
      void (async () => {
        try {
          const reg = await navigator.serviceWorker?.getRegistration?.();
          await reg?.update?.();
        } catch {
          // best-effort update nudge; reload regardless
        }
        const state = getConnectivity();
        if (state === "offline" || state === "serverError") {
          refreshingRef.current = false;
          setRefreshing(false);
          applyPull(0);
          return;
        }
        window.location.reload();
      })();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [applyPull]);

  const visible = pull > 0 || refreshing;
  const progress = Math.min(pull / THRESHOLD, 1);
  const travel = refreshing ? THRESHOLD : pull;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
      style={{
        transform: `translateY(${travel}px)`,
        opacity: visible ? 1 : 0,
        transition: active ? "none" : "transform 200ms ease, opacity 200ms ease",
      }}
    >
      <div className="mt-1 flex size-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] shadow-md">
        <RefreshCw
          className={cn("size-5 text-[var(--color-accent)]", refreshing && "animate-spin")}
          style={{
            transform: refreshing ? undefined : `rotate(${progress * 270}deg)`,
            opacity: 0.4 + progress * 0.6,
          }}
        />
      </div>
    </div>
  );
}
