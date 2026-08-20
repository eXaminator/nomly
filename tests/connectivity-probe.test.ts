import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The banner's wording depends entirely on this split: a thrown fetch means we
 * cannot reach the server (the user's problem is their network), a bad reply
 * means the server is up and broken (the user's problem is the server). Before
 * this, both collapsed into "Offline", which is how a crash-looping container
 * looked like a network outage.
 */
type Watcher = typeof import("@/lib/shopping/offline/connectivity");

let mod: Watcher;
let fetchMock: ReturnType<typeof vi.fn>;
let stop: (() => void) | null = null;

beforeEach(async () => {
  vi.resetModules();
  fetchMock = vi.fn();
  const listeners = new Map<string, Set<() => void>>();
  const on = (t: string, l: () => void) => {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t)!.add(l);
  };
  vi.stubGlobal("window", {
    addEventListener: on,
    removeEventListener: (t: string, l: () => void) => listeners.get(t)?.delete(l),
    dispatchEvent: (e: Event) => {
      listeners.get(e.type)?.forEach((l) => l());
      return true;
    },
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", fetchMock);
  mod = await import("@/lib/shopping/offline/connectivity");
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.unstubAllGlobals();
});

/** Start the watcher and let its immediate probe settle. */
async function probe(): Promise<string> {
  stop = mod.startConnectivityWatcher();
  await vi.waitFor(() => {
    if (mod.getConnectivity() === "checking") throw new Error("still checking");
  });
  return mod.getConnectivity();
}

describe("connectivity probe", () => {
  it("calls a reachable, healthy server online", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    expect(await probe()).toBe("online");
  });

  it("calls a thrown fetch offline", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await probe()).toBe("offline");
  });

  it("calls a server that answers badly a server error, not offline", async () => {
    fetchMock.mockResolvedValue(new Response("gateway", { status: 503 }));
    expect(await probe()).toBe("serverError");
  });

  it("short-circuits to offline without a request when the OS says so", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(await probe()).toBe("offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-probes when the guard reports a broken server, so it can recover", async () => {
    fetchMock.mockResolvedValue(new Response("gateway", { status: 503 }));
    expect(await probe()).toBe("serverError");

    // Server comes back; the guard's report triggers a fresh probe rather than
    // leaving the banner up until the next 30s heartbeat.
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    mod.reportServerError();
    await vi.waitFor(() => {
      if (mod.getConnectivity() !== "online") throw new Error("not back yet");
    });
    expect(mod.getConnectivity()).toBe("online");
  });

  it("keeps an expired session sticky — a probe must not clear it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    stop = mod.startConnectivityWatcher();
    mod.setConnectivity("sessionExpired");
    await new Promise((r) => setTimeout(r, 5));
    expect(mod.getConnectivity()).toBe("sessionExpired");
  });
});
