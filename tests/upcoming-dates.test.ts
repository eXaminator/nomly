import { describe, expect, it } from "vitest";
import { filterUpcomingDates } from "@/lib/meal-plans/upcoming-dates";

describe("filterUpcomingDates", () => {
  const dates = ["2026-06-02", "2026-06-03", "2026-06-04"];

  it("keeps all dates when today is the first", () => {
    expect(filterUpcomingDates(dates, "2026-06-02")).toEqual(dates);
  });

  it("drops days before today (stale cached snapshot)", () => {
    expect(filterUpcomingDates(dates, "2026-06-04")).toEqual(["2026-06-04"]);
  });

  it("returns empty when the whole snapshot window is in the past", () => {
    expect(filterUpcomingDates(dates, "2026-06-10")).toEqual([]);
  });

  it("keeps future-only windows untouched", () => {
    expect(filterUpcomingDates(dates, "2026-06-01")).toEqual(dates);
  });
});
