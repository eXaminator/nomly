import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

/**
 * The guard's contract is narrow and load-bearing: a router fetch must never
 * hand the Next router a response it would answer with an MPA navigation,
 * because that navigation is the endless reload. Everything else must pass
 * through untouched.
 */

const RSC = { rsc: "1" };

function res(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : "body", { status, headers });
}

let guard: typeof import("@/components/auth/request-guard");
let connectivity: typeof import("@/lib/shopping/offline/connectivity");
let original: ReturnType<typeof vi.fn>;
let assigned: string[];

beforeEach(async () => {
  vi.resetModules();
  assigned = [];
  original = vi.fn();

  // A minimal browser for the guard to install into.
  vi.stubGlobal("window", {
    fetch: original,
    location: {
      origin: "https://nomly.test",
      pathname: "/einkauf",
      search: "",
      assign: (url: string) => assigned.push(url),
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  });
  vi.stubGlobal("navigator", { onLine: true });

  connectivity = await import("@/lib/shopping/offline/connectivity");
  guard = await import("@/components/auth/request-guard");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The wrapper the guard installed over window.fetch. */
function wrapped(): typeof fetch {
  return (globalThis as unknown as { window: { fetch: typeof fetch } }).window
    .fetch;
}

describe("isRouterRequest", () => {
  it("recognises every shape Next uses for router traffic", () => {
    const origin = "https://nomly.test";
    expect(guard.isRouterRequest("/einkauf", { headers: RSC }, origin)).toBe(true);
    expect(
      guard.isRouterRequest("/einkauf", { headers: { "next-router-prefetch": "1" } }, origin),
    ).toBe(true);
    expect(
      guard.isRouterRequest("/x", { headers: { "next-router-state-tree": "[]" } }, origin),
    ).toBe(true);
    expect(
      guard.isRouterRequest("/x", { headers: { "next-action": "abc" } }, origin),
    ).toBe(true);
    // Prefetches carry the marker in the URL instead.
    expect(guard.isRouterRequest("/rezepte?_rsc=1a2b", undefined, origin)).toBe(true);
  });

  it("leaves ordinary app fetches alone", () => {
    const origin = "https://nomly.test";
    expect(guard.isRouterRequest("/api/v1/shopping", undefined, origin)).toBe(false);
    expect(
      guard.isRouterRequest("/api/v1/shopping", { headers: { "content-type": "application/json" } }, origin),
    ).toBe(false);
  });
});

describe("isServerFailure", () => {
  it("flags a broken server and a proxy error page", () => {
    expect(guard.isServerFailure(res(503))).toBe(true);
    expect(guard.isServerFailure(res(500))).toBe(true);
    expect(guard.isServerFailure(res(502, { "content-type": "text/html" }))).toBe(true);
    // Non-OK without an RSC payload: whatever answered, it was not the app.
    expect(guard.isServerFailure(res(403, { "content-type": "text/html" }))).toBe(true);
  });

  it("leaves a real RSC payload alone, including Next's own not-found", () => {
    expect(
      guard.isServerFailure(res(200, { "content-type": "text/x-component" })),
    ).toBe(false);
    // A 404 that still carries a flight payload is Next rendering not-found.
    // Swallowing it would break not-found pages, and it cannot loop anyway.
    expect(
      guard.isServerFailure(res(404, { "content-type": "text/x-component" })),
    ).toBe(false);
  });
});

describe("the installed fetch guard", () => {
  it("rejects a router fetch the router would turn into a reload", async () => {
    original.mockResolvedValue(res(503));

    await expect(
      wrapped()("/einkauf", { headers: RSC }),
    ).rejects.toThrow(/server answered 503/);
    // ...and says so, so the banner can explain it.
    expect(connectivity.getConnectivity()).toBe("serverError");
  });

  it("passes a healthy RSC response straight through", async () => {
    const ok = res(200, { "content-type": "text/x-component" });
    original.mockResolvedValue(ok);

    await expect(wrapped()("/einkauf", { headers: RSC })).resolves.toBe(ok);
  });

  it("hands a failing *app* fetch back untouched, queue and callers intact", async () => {
    const bad = res(503);
    original.mockResolvedValue(bad);

    // No RSC marker: this is a component's own fetch. Its error handling and
    // the offline mutation queue are built on seeing the real response.
    await expect(wrapped()("/api/v1/shopping")).resolves.toBe(bad);
  });

  it("re-throws a network failure and marks us offline", async () => {
    const boom = new TypeError("Failed to fetch");
    original.mockRejectedValue(boom);

    await expect(wrapped()("/einkauf", { headers: RSC })).rejects.toBe(boom);
    expect(connectivity.getConnectivity()).toBe("offline");
  });

  it("sends a dead session to the IdP once, and never resolves that fetch", async () => {
    original.mockResolvedValue(res(401, { "x-nomly-reauth": "1" }));

    let settled = false;
    void wrapped()("/einkauf", { headers: RSC }).then(
      () => (settled = true),
      () => (settled = true),
    );
    // Two more offending requests must not queue up more navigations.
    void wrapped()("/plan", { headers: RSC }).then(undefined, () => undefined);
    await new Promise((r) => setTimeout(r, 0));

    expect(assigned).toEqual([
      "/api/auth/login?next=%2Feinkauf",
    ]);
    // Resolving it would let the router hard-assign the *current* URL and
    // cancel the login navigation — the race that made the loop.
    expect(settled).toBe(false);
    expect(connectivity.getConnectivity()).toBe("sessionExpired");
  });
});
