import { describe, expect, it } from "vitest";
import { addMonths } from "@/lib/meal-plans/dates";

describe("addMonths", () => {
  it("shifts backwards across a year boundary", () => {
    expect(addMonths("2026-06-03", -12)).toBe("2025-06-03");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-31");
    expect(addMonths("2026-02-15", -14)).toBe("2024-12-15");
  });

  it("shifts forwards", () => {
    expect(addMonths("2026-06-03", 1)).toBe("2026-07-03");
    expect(addMonths("2026-12-03", 1)).toBe("2027-01-03");
  });

  it("clamps the day to the target month's length", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
    expect(addMonths("2028-02-29", -12)).toBe("2027-02-28");
    expect(addMonths("2026-05-31", 1)).toBe("2026-06-30");
  });

  it("is a no-op for n = 0", () => {
    expect(addMonths("2026-06-03", 0)).toBe("2026-06-03");
  });
});
