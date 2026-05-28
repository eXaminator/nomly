import { describe, it, expect } from "vitest";
import {
  applyParamOps,
  cycleSort,
  decodeSort,
  encodeSort,
} from "@/lib/url-state";

describe("encodeSort / decodeSort", () => {
  it("round-trips an asc sort", () => {
    const sort = { key: "name", dir: "asc" as const };
    expect(decodeSort(encodeSort(sort))).toEqual(sort);
  });
  it("round-trips a desc sort", () => {
    const sort = { key: "diet", dir: "desc" as const };
    expect(decodeSort(encodeSort(sort))).toEqual(sort);
  });
  it("encodes null as null (drop the param)", () => {
    expect(encodeSort(null)).toBeNull();
  });
  it("decodes missing or empty inputs as null", () => {
    expect(decodeSort(null)).toBeNull();
    expect(decodeSort(undefined)).toBeNull();
    expect(decodeSort("")).toBeNull();
  });
  it("rejects malformed direction tokens", () => {
    expect(decodeSort("name:sideways")).toBeNull();
    expect(decodeSort("name")).toBeNull();
  });
});

describe("cycleSort", () => {
  it("inactive column → asc", () => {
    expect(cycleSort(null, "name")).toEqual({ key: "name", dir: "asc" });
  });
  it("different column → asc on the new column", () => {
    expect(cycleSort({ key: "diet", dir: "desc" }, "name")).toEqual({
      key: "name",
      dir: "asc",
    });
  });
  it("same column asc → desc", () => {
    expect(cycleSort({ key: "name", dir: "asc" }, "name")).toEqual({
      key: "name",
      dir: "desc",
    });
  });
  it("same column desc → cleared", () => {
    expect(cycleSort({ key: "name", dir: "desc" }, "name")).toBeNull();
  });
});

describe("applyParamOps", () => {
  it("sets a fresh param", () => {
    const out = applyParamOps(new URLSearchParams(""), [
      { key: "q", value: "tomato" },
    ]);
    expect(out).toBe("q=tomato");
  });
  it("replaces an existing param value", () => {
    const out = applyParamOps(new URLSearchParams("q=old"), [
      { key: "q", value: "new" },
    ]);
    expect(out).toBe("q=new");
  });
  it("strips a param when the value is null", () => {
    const out = applyParamOps(new URLSearchParams("q=old&sort=name:asc"), [
      { key: "q", value: null },
    ]);
    expect(out).toBe("sort=name%3Aasc");
  });
  it("strips a param when the value matches dropIfEqualTo", () => {
    const out = applyParamOps(new URLSearchParams("kind=food"), [
      { key: "kind", value: "all", dropIfEqualTo: "all" },
    ]);
    expect(out).toBe("");
  });
  it("strips when value is the empty string", () => {
    const out = applyParamOps(new URLSearchParams("q=x"), [
      { key: "q", value: "" },
    ]);
    expect(out).toBe("");
  });
  it("appends repeated values for array params", () => {
    const out = applyParamOps(new URLSearchParams(""), [
      { key: "tag", value: ["foo", "bar"] },
    ]);
    expect(out).toBe("tag=foo&tag=bar");
  });
  it("replaces ALL existing instances of an array param", () => {
    const out = applyParamOps(new URLSearchParams("tag=old1&tag=old2"), [
      { key: "tag", value: ["new"] },
    ]);
    expect(out).toBe("tag=new");
  });
  it("strips an array param when given an empty array", () => {
    const out = applyParamOps(new URLSearchParams("tag=foo"), [
      { key: "tag", value: [] },
    ]);
    expect(out).toBe("");
  });
  it("leaves unrelated params untouched", () => {
    const out = applyParamOps(new URLSearchParams("q=tomato&sort=name:asc"), [
      { key: "kind", value: "food" },
    ]);
    expect(out).toBe("q=tomato&sort=name%3Aasc&kind=food");
  });
});
