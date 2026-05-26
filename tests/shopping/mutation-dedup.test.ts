import { describe, expect, it, beforeEach } from "vitest";
import {
  recordMutation,
  recallMutation,
  __resetMutationCacheForTests,
} from "@/lib/shopping/offline/mutation-dedup";

describe("mutation dedup cache", () => {
  beforeEach(() => __resetMutationCacheForTests());

  it("returns null when a mutation has not been seen", () => {
    expect(recallMutation("abc")).toBeNull();
  });

  it("returns the previously recorded value", () => {
    recordMutation("abc", { ok: true });
    expect(recallMutation("abc")).toEqual({ ok: true });
  });

  it("evicts the oldest entry when capacity is exceeded", () => {
    // Capacity is 256. Insert 257 entries; the first one falls off.
    for (let i = 0; i < 257; i++) {
      recordMutation(`m${i}`, { i });
    }
    expect(recallMutation("m0")).toBeNull();
    expect(recallMutation("m1")).toEqual({ i: 1 });
    expect(recallMutation("m256")).toEqual({ i: 256 });
  });

  it("treats entries older than the TTL as missing", () => {
    recordMutation("stale", { ok: true }, Date.now() - 11 * 60 * 1000);
    expect(recallMutation("stale")).toBeNull();
  });
});
