import { describe, it, expect, beforeAll } from "vitest";

// sealData/unsealData need a >=32 char secret (env.SESSION_SECRET enforces it).
process.env.SESSION_SECRET = "test-session-secret-please-32-chars-long";

let sealEmbedSession: typeof import("@/lib/embed-session").sealEmbedSession;
let readEmbedSession: typeof import("@/lib/embed-session").readEmbedSession;
let isEmbedAllowedPath: typeof import("@/lib/embed-session").isEmbedAllowedPath;

beforeAll(async () => {
  const mod = await import("@/lib/embed-session");
  sealEmbedSession = mod.sealEmbedSession;
  readEmbedSession = mod.readEmbedSession;
  isEmbedAllowedPath = mod.isEmbedAllowedPath;
});

describe("embed session seal/unseal", () => {
  it("round-trips a sealed payload", async () => {
    const sealed = await sealEmbedSession({ tokenId: 7, scope: "embed" });
    expect(typeof sealed).toBe("string");
    const data = await readEmbedSession(sealed);
    expect(data).not.toBeNull();
    expect(data!.tokenId).toBe(7);
    expect(data!.scope).toBe("embed");
    expect(typeof data!.issuedAt).toBe("number");
  });

  it("returns null for missing/empty cookie", async () => {
    expect(await readEmbedSession(undefined)).toBeNull();
    expect(await readEmbedSession(null)).toBeNull();
    expect(await readEmbedSession("")).toBeNull();
  });

  it("returns null for a tampered/garbage value", async () => {
    expect(await readEmbedSession("not-a-real-sealed-cookie")).toBeNull();
    const sealed = await sealEmbedSession({ tokenId: 1, scope: "embed" });
    // Flip a character in the middle so the HMAC no longer matches.
    const mid = Math.floor(sealed.length / 2);
    const flipped =
      sealed.slice(0, mid) +
      (sealed[mid] === "a" ? "b" : "a") +
      sealed.slice(mid + 1);
    expect(await readEmbedSession(flipped)).toBeNull();
  });
});

describe("embed allow-list", () => {
  it("permits embed pages on any method", () => {
    expect(isEmbedAllowedPath("/embed/rezepte/12", "GET")).toBe(true);
    expect(isEmbedAllowedPath("/embed", "GET")).toBe(true);
  });

  it("permits GET on recipe photos only", () => {
    expect(isEmbedAllowedPath("/api/v1/photos/abc.webp", "GET")).toBe(true);
    expect(isEmbedAllowedPath("/api/v1/photos/abc.webp", "POST")).toBe(false);
  });

  it("permits GET on a meal's upcoming-ingredient-uses (for ?meal=)", () => {
    expect(
      isEmbedAllowedPath("/api/v1/meal-plans/42/upcoming-ingredient-uses", "GET"),
    ).toBe(true);
    expect(
      isEmbedAllowedPath("/api/v1/meal-plans/42/upcoming-ingredient-uses", "POST"),
    ).toBe(false);
    // not the bare meal-plan endpoints
    expect(isEmbedAllowedPath("/api/v1/meal-plans/42", "GET")).toBe(false);
    expect(isEmbedAllowedPath("/api/v1/meal-plans", "GET")).toBe(false);
  });

  it("denies everything else", () => {
    expect(isEmbedAllowedPath("/api/v1/recipes", "GET")).toBe(false);
    expect(isEmbedAllowedPath("/rezepte/12", "GET")).toBe(false);
    expect(isEmbedAllowedPath("/api/v1/shopping/items", "POST")).toBe(false);
    expect(isEmbedAllowedPath("/embedding-evil", "GET")).toBe(false);
  });
});
