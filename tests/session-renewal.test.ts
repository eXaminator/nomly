import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IronSession } from "iron-session";
import type { SessionData } from "@/lib/session";

const refreshTokenGrant = vi.fn();

vi.mock("openid-client", () => ({
  refreshTokenGrant: (...args: unknown[]) => refreshTokenGrant(...args),
}));
vi.mock("@/lib/oidc", () => ({
  getOidcConfig: () => Promise.resolve({ marker: "config" }),
}));

const { renewSessionIfStale } = await import("@/lib/session-renewal");
const { REFRESH_AT_SEC } = await import("@/lib/session");

const NOW = 1_800_000_000;
/** Mirrors `RETRY_AFTER_SEC` in the module under test. */
const RETRY_AFTER_SEC = 5 * 60;

/** A session object shaped like iron-session's, minus the persistence. */
function session(
  over: Partial<SessionData> = {},
): IronSession<Partial<SessionData>> {
  return {
    sub: "user-1",
    name: "Test",
    exp: NOW + 3600,
    issuedAt: NOW - REFRESH_AT_SEC - 1,
    refreshToken: "rt-old",
    ...over,
  } as IronSession<Partial<SessionData>>;
}

function grantOk(over: Record<string, unknown> = {}) {
  return {
    access_token: "at-new",
    refresh_token: "rt-new",
    claims: () => ({ sub: "user-1", exp: NOW + 3600 }),
    ...over,
  };
}

beforeEach(() => {
  refreshTokenGrant.mockReset();
});

describe("renewSessionIfStale", () => {
  it("renews a stale session and reports that it must be re-saved", async () => {
    refreshTokenGrant.mockResolvedValue(grantOk());
    const s = session();

    expect(await renewSessionIfStale(s, NOW)).toBe(true);
    expect(refreshTokenGrant).toHaveBeenCalledTimes(1);
    expect(refreshTokenGrant.mock.calls[0][1]).toBe("rt-old");
    // issuedAt sliding forward is what turns the 30-day cap into a real
    // inactivity timeout.
    expect(s.issuedAt).toBe(NOW);
    expect(s.accessToken).toBe("at-new");
    expect(s.refreshToken).toBe("rt-new");
  });

  it("keeps the old refresh token when the IdP does not rotate it", async () => {
    refreshTokenGrant.mockResolvedValue(grantOk({ refresh_token: undefined }));
    const s = session();

    expect(await renewSessionIfStale(s, NOW)).toBe(true);
    expect(s.refreshToken).toBe("rt-old");
  });

  it("does nothing while the session is still fresh", async () => {
    const s = session({ issuedAt: NOW - REFRESH_AT_SEC + 60 });

    expect(await renewSessionIfStale(s, NOW)).toBe(false);
    expect(refreshTokenGrant).not.toHaveBeenCalled();
  });

  it("does nothing without a stored refresh token", async () => {
    const s = session({ refreshToken: undefined });

    expect(await renewSessionIfStale(s, NOW)).toBe(false);
    expect(refreshTokenGrant).not.toHaveBeenCalled();
  });

  it("keeps the user signed in when the IdP call fails", async () => {
    refreshTokenGrant.mockRejectedValue(new Error("idp down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Its own token: a failure puts that token on cooldown, and reusing
    // "rt-old" here would suppress the renewal the other cases expect.
    const s = session({ refreshToken: "rt-idp-down" });
    const before = s.issuedAt;

    expect(await renewSessionIfStale(s, NOW)).toBe(false);
    expect(s.issuedAt).toBe(before);
    expect(s.refreshToken).toBe("rt-idp-down");
    warn.mockRestore();
  });

  it("stops re-spending a refresh token the IdP has rejected", async () => {
    // `invalid_grant` is terminal: the session stays live for the whole
    // inactivity window and `issuedAt` never moves, so without a cooldown every
    // single request would await the same doomed token round trip.
    refreshTokenGrant.mockRejectedValue(new Error("invalid_grant"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      await renewSessionIfStale(session({ refreshToken: "rt-dead" }), NOW),
    ).toBe(false);
    expect(
      await renewSessionIfStale(session({ refreshToken: "rt-dead" }), NOW + 1),
    ).toBe(false);
    expect(refreshTokenGrant).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    // ...but it is a cooldown, not a blocklist: an IdP that recovers is picked
    // back up without the user having to sign in again.
    refreshTokenGrant.mockResolvedValue(grantOk());
    const back = session({ refreshToken: "rt-dead" });
    expect(await renewSessionIfStale(back, NOW + RETRY_AFTER_SEC)).toBe(true);
    expect(back.refreshToken).toBe("rt-new");
    warn.mockRestore();
  });

  it("coalesces the burst of requests a single page load fires", async () => {
    // A page load hits the proxy with the document request plus several RSC and
    // API requests at once. Each spending the same refresh token would break on
    // an IdP that rotates them.
    let release!: (v: unknown) => void;
    refreshTokenGrant.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    const sessions = [session(), session(), session()];
    const pending = Promise.all(
      sessions.map((s) => renewSessionIfStale(s, NOW)),
    );

    release(grantOk());
    expect(await pending).toEqual([true, true, true]);
    expect(refreshTokenGrant).toHaveBeenCalledTimes(1);
    for (const s of sessions) expect(s.issuedAt).toBe(NOW);
  });
});
