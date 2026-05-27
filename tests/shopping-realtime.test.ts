import { describe, it, expect } from "vitest";
import {
  publishShoppingChanged,
  onShoppingChanged,
} from "@/lib/shopping/realtime";

describe("shopping realtime bus", () => {
  it("notifies a subscriber on publish", () => {
    let calls = 0;
    const off = onShoppingChanged(() => {
      calls += 1;
    });
    publishShoppingChanged();
    publishShoppingChanged();
    expect(calls).toBe(2);
    off();
  });

  it("stops notifying after unsubscribe", () => {
    let calls = 0;
    const off = onShoppingChanged(() => {
      calls += 1;
    });
    publishShoppingChanged();
    off();
    publishShoppingChanged();
    expect(calls).toBe(1);
  });

  it("fans out to multiple subscribers and isolates one throwing listener", () => {
    let a = 0;
    let b = 0;
    const offA = onShoppingChanged(() => {
      a += 1;
      throw new Error("boom"); // must not stop the other listener
    });
    const offB = onShoppingChanged(() => {
      b += 1;
    });
    expect(() => publishShoppingChanged()).not.toThrow();
    expect(a).toBe(1);
    expect(b).toBe(1);
    offA();
    offB();
  });

  it("is a no-op with no subscribers", () => {
    expect(() => publishShoppingChanged()).not.toThrow();
  });
});
