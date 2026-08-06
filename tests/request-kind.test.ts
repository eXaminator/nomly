import { describe, it, expect } from "vitest";
import { isTopLevelNavigation } from "@/lib/request-kind";

/**
 * The header shapes below are copied verbatim from Chromium against the built
 * app (logged in the proxy). They are the contract this helper exists for: the
 * proxy may only answer a request with a cross-origin redirect to the IdP when
 * the browser will follow it as a full-page load.
 */
function check(
  headers: Record<string, string>,
  search = "",
): boolean {
  return isTopLevelNavigation(
    new Headers(headers),
    new URLSearchParams(search),
  );
}

const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
  + "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";

describe("isTopLevelNavigation", () => {
  it("accepts a plain browser page load", () => {
    expect(
      check({
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        accept: HTML_ACCEPT,
      }),
    ).toBe(true);
  });

  it("accepts a navigation re-issued by the service worker", () => {
    // `fetch(event.request)` inside the SW drops the destination to "empty"
    // while keeping mode "navigate". Reading the destination here is what made
    // every SW-mediated page load render the JSON 401 instead of the login page.
    expect(
      check({
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "navigate",
        accept: HTML_ACCEPT,
      }),
    ).toBe(true);
  });

  it("rejects an RSC prefetch, which the SW leaves untouched", () => {
    expect(
      check(
        {
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          accept: "*/*",
        },
        "_rsc=5CB68i4pnAekjehf",
      ),
    ).toBe(false);
  });

  it("rejects an RSC request even if it somehow looks like a navigation", () => {
    expect(
      check(
        { "sec-fetch-mode": "navigate", accept: HTML_ACCEPT },
        "_rsc=Vwk9sW2uY8OS9gtj",
      ),
    ).toBe(false);
    expect(check({ "sec-fetch-mode": "navigate", rsc: "1" })).toBe(false);
    expect(
      check({ "sec-fetch-mode": "navigate", "next-router-prefetch": "1" }),
    ).toBe(false);
  });

  it("rejects an ordinary API fetch", () => {
    expect(
      check({
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "same-origin",
        accept: "application/json",
      }),
    ).toBe(false);
  });

  it("rejects a framed page — the IdP refuses to be framed", () => {
    expect(
      check({
        "sec-fetch-dest": "iframe",
        "sec-fetch-mode": "navigate",
        accept: HTML_ACCEPT,
      }),
    ).toBe(false);
  });

  it("falls back to the destination when the mode is missing", () => {
    expect(check({ "sec-fetch-dest": "document" })).toBe(true);
    expect(check({ "sec-fetch-dest": "empty" })).toBe(false);
  });

  it("falls back to Accept for webviews without Sec-Fetch-* at all", () => {
    expect(check({ accept: HTML_ACCEPT })).toBe(true);
    expect(check({ accept: "*/*" })).toBe(false);
    expect(check({})).toBe(false);
  });
});
