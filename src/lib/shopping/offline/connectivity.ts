export type ConnectivityState =
  | "online"
  | "offline"
  | "syncing"
  | "sessionExpired";

type Listener = (state: ConnectivityState) => void;

let state: ConnectivityState = "online";
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

const HEARTBEAT_MS = 30_000;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;

async function pingHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function startConnectivityWatcher(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onOnline = () => setConnectivity("online");
  const onOffline = () => setConnectivity("offline");
  const onVisibility = async () => {
    if (document.visibilityState !== "visible") return;
    const ok = await pingHealth();
    setConnectivity(ok ? "online" : "offline");
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);

  // Seed the initial state.
  if (navigator.onLine === false) setConnectivity("offline");

  heartbeatHandle = setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    const ok = await pingHealth();
    if (state === "sessionExpired") return; // sticky until user re-auths
    setConnectivity(ok ? "online" : "offline");
  }, HEARTBEAT_MS);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibility);
    if (heartbeatHandle) clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  };
}
