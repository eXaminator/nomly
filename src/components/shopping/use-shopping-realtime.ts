"use client";

import * as React from "react";

import { useConnectivity } from "./offline-indicator";

/**
 * Realtime shopping-list sync. While online, holds a WebSocket to `/ws`,
 * subscribes to the "shopping" topic, and invokes `onChanged` (debounced)
 * whenever the server broadcasts a change — the caller refetches the list.
 *
 * - Connects only when online (the offline queue covers the disconnected
 *   case; on reconnect we refetch to catch anything missed).
 * - Reconnects with capped exponential backoff while the socket drops but the
 *   device is still online.
 * - Cookies authenticate the handshake (same-origin), matching the server's
 *   session/bearer upgrade gate.
 */
export function useShoppingRealtime(onChanged: () => void): void {
  const state = useConnectivity();
  // Don't bother connecting when offline or when the session is dead (the
  // upgrade would just 401-loop).
  const shouldConnect = state !== "offline" && state !== "sessionExpired";

  const onChangedRef = React.useRef(onChanged);
  React.useEffect(() => {
    onChangedRef.current = onChanged;
  });

  React.useEffect(() => {
    if (typeof window === "undefined" || !shouldConnect) return;

    let socket: WebSocket | null = null;
    let disposed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const refetchSoon = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChangedRef.current(), 250);
    };

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      socket = ws;

      ws.onopen = () => {
        attempt = 0;
        ws.send(JSON.stringify({ op: "subscribe", topic: "shopping" }));
        // Reconcile whatever changed while we were disconnected.
        onChangedRef.current();
      };
      ws.onmessage = (ev) => {
        let msg: { op?: string; topic?: string };
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }
        if (msg.op === "event" && msg.topic === "shopping") refetchSoon();
      };
      ws.onclose = () => {
        if (disposed) return;
        const delay = Math.min(1000 * 2 ** attempt, 15_000);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      socket?.close();
    };
  }, [shouldConnect]);
}
