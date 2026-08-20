export type ConnectivityState =
  | "checking"
  | "online"
  | "offline"
  | "syncing"
  | "serverError"
  | "sessionExpired";

type Listener = (state: ConnectivityState) => void;

let state: ConnectivityState = "checking";
const listeners = new Set<Listener>();

export function getConnectivity(): ConnectivityState {
  return state;
}

export function setConnectivity(next: ConnectivityState): void {
  if (next === state) return;
  state = next;
  for (const l of listeners) l(state);
}

export function subscribeConnectivity(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * Fired by the request guard when a router fetch came back broken. Kept as a
 * DOM event so the guard — which is installed at module-eval time, before any
 * watcher exists — does not have to reach into the watcher's lifecycle.
 */
export const SERVER_ERROR_EVENT = "nomly:server-error";

/** Report a server that answered, but badly. Safe to call before mount. */
export function reportServerError(): void {
  setConnectivity("serverError");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SERVER_ERROR_EVENT));
  }
}

/** Probe cadence while everything is fine — just enough to stay honest. */
const HEARTBEAT_MS = 30_000;
/**
 * Probe cadence while we are showing a failure. The banner promises we keep
 * trying in the background, so it has to clear itself quickly once the server
 * is back — waiting out a 30s heartbeat to drop a red banner reads as broken.
 */
const RECOVERY_HEARTBEAT_MS = 5_000;
let heartbeatHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Reachability of the server, split three ways — the distinction is the whole
 * point. A thrown fetch means we cannot reach it at all ("offline"); a reply we
 * do not like means it is up but broken ("serverError"), which is a different
 * message for the user and a different expectation (their queued work is fine,
 * the box needs looking at). Collapsing both into "offline" is what made a
 * crash-looping server look like a network problem.
 */
type Reachability = "online" | "offline" | "serverError";

async function probeHealth(): Promise<Reachability> {
  try {
    const res = await fetch("/api/health", {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? "online" : "serverError";
  } catch {
    return "offline";
  }
}

export function startConnectivityWatcher(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onOnline = () => {
    void runProbe();
  };
  const onOffline = () => setConnectivity("offline");
  const onVisibility = async () => {
    if (document.visibilityState !== "visible") return;
    if (state === "sessionExpired") return;
    await runProbe();
  };

  async function runProbe() {
    if (navigator.onLine === false) {
      setConnectivity("offline");
      return;
    }
    const reach = await probeHealth();
    if (state === "sessionExpired") return; // sticky until user re-auths
    setConnectivity(reach);
  }

  // The request guard flags a broken server the moment a router fetch sees one,
  // without waiting for the next heartbeat. Re-probe promptly so the banner
  // clears itself as soon as the server is back, rather than sitting on a stale
  // "serverError" for up to a full heartbeat.
  const onGuardReport = () => {
    void runProbe();
  };
  window.addEventListener(SERVER_ERROR_EVENT, onGuardReport);

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);

  // Pessimistic-by-default: probe immediately on mount so the chip is
  // honest within ~5s of every fresh page load. `navigator.onLine === false`
  // short-circuits to "offline" with no network call.
  void runProbe();

  // Self-rescheduling rather than a fixed interval, so the cadence can follow
  // the state: slow while healthy, brisk while we owe the user a recovery.
  // Always clears first, so arming it from the timer chain and from a state
  // change cannot leave two timers running.
  const scheduleHeartbeat = () => {
    if (heartbeatHandle) clearTimeout(heartbeatHandle);
    const due =
      state === "offline" || state === "serverError"
        ? RECOVERY_HEARTBEAT_MS
        : HEARTBEAT_MS;
    heartbeatHandle = setTimeout(async () => {
      if (document.visibilityState === "visible" && state !== "sessionExpired") {
        await runProbe();
      }
      scheduleHeartbeat();
    }, due);
  };

  // Re-arm on every state change, not just when the timer next fires. Without
  // this the cadence is whatever was picked at the *previous* arming: a failure
  // that starts one second into a 30s wait would go unchecked for the other 29,
  // and the banner would sit there long after the server came back.
  const unsubscribe = subscribeConnectivity(scheduleHeartbeat);
  scheduleHeartbeat();

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener(SERVER_ERROR_EVENT, onGuardReport);
    document.removeEventListener("visibilitychange", onVisibility);
    unsubscribe();
    if (heartbeatHandle) clearTimeout(heartbeatHandle);
    heartbeatHandle = null;
  };
}
