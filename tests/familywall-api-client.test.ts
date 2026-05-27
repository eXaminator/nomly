import { describe, it, expect } from "vitest";
import type { FamilywallRawRecipe } from "@/lib/familywall/types";

function makeRaw(over: Partial<FamilywallRawRecipe> = {}): FamilywallRawRecipe {
  return {
    title: "Bolognese",
    description: null,
    servings: 4,
    prepTimeMin: 15,
    cookTimeMin: 90,
    ingredients: ["500 g Hackfleisch"],
    instructions: ["Anbraten."],
    sourceUrl: null,
    imageUrl: null,
    isFavorite: false,
    tags: [],
    ...over,
  };
}

describe("postRawRecipe", () => {
  it("POSTs raw + base64 image with bearer auth and returns the outcome", async () => {
    const { postRawRecipe } = await import("@/lib/familywall/api-client");
    let captured: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return new Response(JSON.stringify({ outcome: "imported", id: 7 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const img = Buffer.from([1, 2, 3, 4]);
    const out = await postRawRecipe(
      fakeFetch,
      { baseUrl: "https://prod.example", token: "secret-tok", overwrite: false, dryRun: false },
      makeRaw({ title: "X" }),
      img,
    );

    expect(captured!.url).toBe("https://prod.example/api/v1/recipes/import-familywall");
    expect(captured!.init.method).toBe("POST");
    const headers = new Headers(captured!.init.headers);
    expect(headers.get("authorization")).toBe("Bearer secret-tok");
    expect(headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(captured!.init.body as string);
    expect(body.raw.title).toBe("X");
    expect(body.imageBase64).toBe(img.toString("base64"));
    expect(body.overwrite).toBe(false);
    expect(body.dryRun).toBe(false);
    expect(out.outcome).toBe("imported");
    if (out.outcome === "imported") expect(out.id).toBe(7);
  });

  it("sends null image when none provided and strips a trailing slash on baseUrl", async () => {
    const { postRawRecipe } = await import("@/lib/familywall/api-client");
    let capturedUrl = "";
    let capturedBody: { imageBase64: unknown } | null = null;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ outcome: "skipped" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const out = await postRawRecipe(
      fakeFetch,
      { baseUrl: "https://prod.example/", token: "t" },
      makeRaw(),
      null,
    );
    expect(capturedUrl).toBe("https://prod.example/api/v1/recipes/import-familywall");
    expect(capturedBody!.imageBase64).toBeNull();
    expect(out.outcome).toBe("skipped");
  });

  it("maps a non-2xx response to a failed outcome carrying the server error", async () => {
    const { postRawRecipe } = await import("@/lib/familywall/api-client");
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ outcome: "failed", error: "boom" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const out = await postRawRecipe(
      fakeFetch,
      { baseUrl: "https://p", token: "t" },
      makeRaw(),
      null,
    );
    expect(out.outcome).toBe("failed");
    if (out.outcome === "failed") expect(out.error).toBe("boom");
  });
});
