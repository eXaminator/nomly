import { describe, it, expect } from "vitest";
import { initialDeleteMode } from "@/components/settings/stammdaten/delete-mode";

describe("initialDeleteMode", () => {
  it("uses a plain delete when nothing references the row (the bug: unused articles were stuck on 'replace')", () => {
    // Unused + force-delete not allowed (ingredients) must still be deletable.
    expect(initialDeleteMode(false, false)).toBe("hard");
    expect(initialDeleteMode(false, true)).toBe("hard");
  });

  it("requires a replacement for referenced rows that can't be force-deleted", () => {
    expect(initialDeleteMode(true, false)).toBe("replace");
  });

  it("allows force-delete for referenced rows when the entity permits it", () => {
    expect(initialDeleteMode(true, true)).toBe("hard");
  });
});
