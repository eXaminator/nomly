import { asc, eq } from "drizzle-orm";
import * as ical from "node-ical";
import { db } from "@/db";
import { icalFeed } from "@/db/schema";

export type CalendarEvent = {
  feedId: number;
  feedName: string;
  feedColor: string;
  /** The owning feed's sort position — used to break ties between events
   *  that share a timeslot (e.g. all-day events on the same day). */
  feedSortOrder: number;
  uid: string;
  title: string;
  /** Start instant as ISO 8601 string. */
  start: string;
  /** End instant as ISO 8601 string, or null if unspecified. */
  end: string | null;
  allDay: boolean;
  location: string | null;
};

export type EventsByDate = Record<string, CalendarEvent[]>;

/**
 * Return events from every enabled feed expanded into the [fromIso, toIso]
 * window (inclusive), bucketed by date. Multi-day events appear in every
 * date they touch. Times are interpreted in the server's local timezone for
 * bucketing — matching how `dates.ts` derives "today".
 */
export function getEventsForRange(fromIso: string, toIso: string): EventsByDate {
  const feeds = db
    .select({
      id: icalFeed.id,
      name: icalFeed.name,
      color: icalFeed.color,
      sortOrder: icalFeed.sortOrder,
      rawIcs: icalFeed.rawIcs,
    })
    .from(icalFeed)
    .where(eq(icalFeed.enabled, true))
    .orderBy(asc(icalFeed.sortOrder), asc(icalFeed.name))
    .all();

  const rangeStart = new Date(`${fromIso}T00:00:00`);
  const rangeEnd = new Date(`${toIso}T23:59:59.999`);

  const buckets: EventsByDate = {};
  for (const feed of feeds) {
    if (!feed.rawIcs) continue;
    let parsed: ical.CalendarResponse;
    try {
      parsed = ical.parseICS(feed.rawIcs);
    } catch {
      continue;
    }
    for (const component of Object.values(parsed)) {
      if (!component || component.type !== "VEVENT") continue;
      const instances = expandEvent(component, rangeStart, rangeEnd);
      for (const inst of instances) {
        bucketEvent(buckets, inst, feed, fromIso, toIso);
      }
    }
  }

  for (const date of Object.keys(buckets)) {
    buckets[date].sort(sortEvents);
  }
  return buckets;
}

function expandEvent(
  event: ical.VEvent,
  from: Date,
  to: Date,
): ical.EventInstance[] {
  // `expandRecurringEvent` covers both single events and RRULE expansion in
  // one call — for non-recurring events it returns just the base instance.
  try {
    return ical.expandRecurringEvent(event, {
      from,
      to,
      includeOverrides: true,
      excludeExdates: true,
      expandOngoing: true,
    });
  } catch {
    return [];
  }
}

function bucketEvent(
  buckets: EventsByDate,
  instance: ical.EventInstance,
  feed: { id: number; name: string; color: string; sortOrder: number },
  fromIso: string,
  toIso: string,
): void {
  const start = instance.start;
  const end = instance.end ?? instance.start;
  const allDay = instance.isFullDay;
  const title = unwrapParameterValue(instance.summary) ?? "(ohne Titel)";
  const location =
    unwrapParameterValue(instance.event.location ?? undefined) ?? null;
  const uid = instance.event.uid ?? "";
  const instanceKey = `${uid}@${start.toISOString()}`;

  // All-day events: end is exclusive per RFC 5545. node-ical represents this
  // as a `dateOnly` Date. Iterate dates from start up to (not including) end.
  const fromDate = isoDate(start);
  const toDate = allDay ? isoDate(addMillis(end, -1)) : isoDate(end);
  for (const date of datesBetween(fromDate, toDate, fromIso, toIso)) {
    if (!buckets[date]) buckets[date] = [];
    buckets[date].push({
      feedId: feed.id,
      feedName: feed.name,
      feedColor: feed.color,
      feedSortOrder: feed.sortOrder,
      uid: instanceKey,
      title,
      start: start.toISOString(),
      end: instance.end ? instance.end.toISOString() : null,
      allDay,
      location,
    });
  }
}

function sortEvents(a: CalendarEvent, b: CalendarEvent): number {
  // All-day events first, then by start time. Events sharing a timeslot
  // (all-day events on the same day, or timed events at the same instant)
  // fall back to the calendar's sort order, then title.
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.start !== b.start) return a.start.localeCompare(b.start);
  if (a.feedSortOrder !== b.feedSortOrder) {
    return a.feedSortOrder - b.feedSortOrder;
  }
  return a.title.localeCompare(b.title);
}

function unwrapParameterValue<T>(v: ical.ParameterValue<T> | undefined): T | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "object" && v !== null && "val" in v) {
    return (v as { val: T }).val;
  }
  return v as T;
}

function isoDate(d: Date): string {
  // Use local time so the bucket key matches the user's calendar day, which
  // is what `dates.ts` does for "today".
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addMillis(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

function datesBetween(
  startIso: string,
  endIso: string,
  windowFromIso: string,
  windowToIso: string,
): string[] {
  const lo = startIso < windowFromIso ? windowFromIso : startIso;
  const hi = endIso > windowToIso ? windowToIso : endIso;
  if (lo > hi) return [];
  const out: string[] = [];
  let cur = lo;
  while (cur <= hi) {
    out.push(cur);
    cur = nextIsoDate(cur);
  }
  return out;
}

function nextIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return isoDate(dt);
}
