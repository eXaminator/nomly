import { describe, expect, it } from "vitest";
import { tagForUserName } from "@/lib/users/favorite-seed";

describe("tagForUserName", () => {
  it("maps Steven (partial, ci) to Familywall-Favorit", () => {
    expect(tagForUserName("Steven")).toBe("Familywall-Favorit");
    expect(tagForUserName("steven weingärtner")).toBe("Familywall-Favorit");
  });
  it("maps Janine (partial, ci) to Janine", () => {
    expect(tagForUserName("Janine")).toBe("Janine");
    expect(tagForUserName("JANINE B.")).toBe("Janine");
  });
  it("returns null for anyone else", () => {
    expect(tagForUserName("Opa")).toBeNull();
    expect(tagForUserName("")).toBeNull();
  });
});
