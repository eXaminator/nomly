import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("connectivity module", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initial state is 'checking', not 'online'", async () => {
    const mod = await import("@/lib/shopping/offline/connectivity");
    expect(mod.getConnectivity()).toBe("checking");
  });

  it("startConnectivityWatcher fires an immediate probe and flips to 'online' on success", async () => {
    const mod = await import("@/lib/shopping/offline/connectivity");
    // jsdom-less environment: stub window + document just enough.
    const listeners: Record<string, Array<() => void>> = {};
    vi.stubGlobal("window", {
      addEventListener: (k: string, fn: () => void) => {
        (listeners[k] ??= []).push(fn);
      },
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("navigator", { onLine: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const stop = mod.startConnectivityWatcher();
    // Yield to microtasks so the immediate probe resolves.
    await new Promise((r) => setTimeout(r, 0));
    expect(mod.getConnectivity()).toBe("online");
    stop();
  });

  it("flips to 'offline' immediately when navigator.onLine is false", async () => {
    const mod = await import("@/lib/shopping/offline/connectivity");
    vi.stubGlobal("window", {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("navigator", { onLine: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const stop = mod.startConnectivityWatcher();
    await new Promise((r) => setTimeout(r, 0));
    expect(mod.getConnectivity()).toBe("offline");
    expect(fetchSpy).not.toHaveBeenCalled(); // no probe when navigator says offline
    stop();
  });

  it("flips to 'offline' when the immediate probe rejects", async () => {
    const mod = await import("@/lib/shopping/offline/connectivity");
    vi.stubGlobal("window", {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("navigator", { onLine: true });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("net"));

    const stop = mod.startConnectivityWatcher();
    await new Promise((r) => setTimeout(r, 0));
    expect(mod.getConnectivity()).toBe("offline");
    stop();
  });
});
