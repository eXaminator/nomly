import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-ical-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { icalFeed } = await import("@/db/schema");
  db.delete(icalFeed).run();
});

describe("ical feeds CRUD", () => {
  it("creates a feed with defaults and lists it", async () => {
    const { createFeed, listFeeds } = await import("@/lib/ical/feeds");
    const created = createFeed({ name: "Familie", url: "https://example.com/family.ics" });
    expect(created.name).toBe("Familie");
    expect(created.color).toBe("#3b82f6");
    expect(created.enabled).toBe(true);
    const feeds = listFeeds();
    expect(feeds).toHaveLength(1);
    expect(feeds[0].id).toBe(created.id);
  });

  it("normalises webcal:// to https://", async () => {
    const { createFeed } = await import("@/lib/ical/feeds");
    const created = createFeed({ name: "Sport", url: "webcal://example.com/sport.ics" });
    expect(created.url.startsWith("https://")).toBe(true);
  });

  it("rejects invalid url, color, and empty name", async () => {
    const { createFeed, IcalFeedError } = await import("@/lib/ical/feeds");
    expect(() => createFeed({ name: "", url: "https://x" })).toThrow(IcalFeedError);
    expect(() => createFeed({ name: "A", url: "not-a-url" })).toThrow(IcalFeedError);
    expect(() =>
      createFeed({ name: "A", url: "https://x", color: "blue" }),
    ).toThrow(IcalFeedError);
    expect(() =>
      createFeed({ name: "A", url: "ftp://x" }),
    ).toThrow(IcalFeedError);
  });

  it("updateFeed clears cached body when URL changes", async () => {
    const { createFeed, updateFeed, getFeed } = await import("@/lib/ical/feeds");
    const { db } = await import("@/db");
    const { icalFeed } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const f = createFeed({ name: "X", url: "https://example.com/a.ics" });
    db.update(icalFeed)
      .set({ rawIcs: "BEGIN:VCALENDAR\nEND:VCALENDAR", rawIcsFetchedAt: 1 })
      .where(eq(icalFeed.id, f.id))
      .run();
    updateFeed(f.id, { url: "https://example.com/b.ics" });
    const after = getFeed(f.id)!;
    expect(after.hasCachedBody).toBe(false);
    expect(after.rawIcsFetchedAt).toBeNull();
  });

  it("delete removes the feed", async () => {
    const { createFeed, deleteFeed, listFeeds } = await import("@/lib/ical/feeds");
    const f = createFeed({ name: "X", url: "https://example.com" });
    deleteFeed(f.id);
    expect(listFeeds()).toHaveLength(0);
  });

  it("reorderFeeds preserves the new order", async () => {
    const { createFeed, listFeeds, reorderFeeds } = await import("@/lib/ical/feeds");
    const a = createFeed({ name: "A", url: "https://a.example/x" });
    const b = createFeed({ name: "B", url: "https://b.example/x" });
    const c = createFeed({ name: "C", url: "https://c.example/x" });
    reorderFeeds([c.id, a.id, b.id]);
    const order = listFeeds().map((f) => f.id);
    expect(order).toEqual([c.id, a.id, b.id]);
  });
});

describe("ical event parsing", () => {
  const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//
BEGIN:VEVENT
UID:single@test
DTSTAMP:20260520T120000Z
DTSTART:20260526T143000Z
DTEND:20260526T153000Z
SUMMARY:Single event
LOCATION:Berlin
END:VEVENT
BEGIN:VEVENT
UID:allday@test
DTSTAMP:20260520T120000Z
DTSTART;VALUE=DATE:20260527
DTEND;VALUE=DATE:20260528
SUMMARY:Holiday
END:VEVENT
BEGIN:VEVENT
UID:weekly@test
DTSTAMP:20260520T120000Z
DTSTART:20260525T080000Z
DTEND:20260525T090000Z
SUMMARY:Weekly standup
RRULE:FREQ=WEEKLY;COUNT=4
END:VEVENT
END:VCALENDAR
`;

  async function seedFeedWithIcs(ics: string, color = "#ff0000") {
    const { db } = await import("@/db");
    const { icalFeed } = await import("@/db/schema");
    const inserted = db
      .insert(icalFeed)
      .values({
        name: "Test",
        url: "https://example.com/test.ics",
        color,
        rawIcs: ics,
        rawIcsFetchedAt: Math.floor(Date.now() / 1000),
      })
      .returning()
      .all()[0];
    return inserted.id;
  }

  it("returns single events bucketed by their start date", async () => {
    await seedFeedWithIcs(SAMPLE_ICS);
    const { getEventsForRange } = await import("@/lib/ical/events");
    const buckets = getEventsForRange("2026-05-26", "2026-05-26");
    expect(buckets["2026-05-26"]).toBeDefined();
    const titles = buckets["2026-05-26"].map((e) => e.title);
    expect(titles).toContain("Single event");
    const single = buckets["2026-05-26"].find((e) => e.title === "Single event")!;
    expect(single.allDay).toBe(false);
    expect(single.location).toBe("Berlin");
  });

  it("treats all-day events as allDay and excludes the DTEND exclusive boundary", async () => {
    await seedFeedWithIcs(SAMPLE_ICS);
    const { getEventsForRange } = await import("@/lib/ical/events");
    const buckets = getEventsForRange("2026-05-27", "2026-05-28");
    const day27 = buckets["2026-05-27"] ?? [];
    const day28 = buckets["2026-05-28"] ?? [];
    expect(day27.some((e) => e.title === "Holiday" && e.allDay)).toBe(true);
    // RFC 5545: DTEND is exclusive for VALUE=DATE.
    expect(day28.some((e) => e.title === "Holiday")).toBe(false);
  });

  it("expands weekly recurrences within the range", async () => {
    await seedFeedWithIcs(SAMPLE_ICS);
    const { getEventsForRange } = await import("@/lib/ical/events");
    const buckets = getEventsForRange("2026-05-25", "2026-06-15");
    const standupDates = Object.entries(buckets)
      .filter(([, evs]) => evs.some((e) => e.title === "Weekly standup"))
      .map(([d]) => d)
      .sort();
    expect(standupDates).toEqual([
      "2026-05-25",
      "2026-06-01",
      "2026-06-08",
      "2026-06-15",
    ]);
  });

  it("skips disabled feeds", async () => {
    const id = await seedFeedWithIcs(SAMPLE_ICS);
    const { db } = await import("@/db");
    const { icalFeed } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(icalFeed).set({ enabled: false }).where(eq(icalFeed.id, id)).run();
    const { getEventsForRange } = await import("@/lib/ical/events");
    const buckets = getEventsForRange("2026-05-26", "2026-05-26");
    expect(buckets["2026-05-26"]).toBeUndefined();
  });

  it("attaches feed colour to each event", async () => {
    await seedFeedWithIcs(SAMPLE_ICS, "#abcdef");
    const { getEventsForRange } = await import("@/lib/ical/events");
    const buckets = getEventsForRange("2026-05-26", "2026-05-26");
    expect(buckets["2026-05-26"][0].feedColor).toBe("#abcdef");
  });
});
