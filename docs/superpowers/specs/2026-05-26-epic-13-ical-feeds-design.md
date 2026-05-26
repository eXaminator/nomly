# Epic 13: iCal Calendar Feeds in the Meal Planner

**Date:** 2026-05-26
**Status:** Approved (autonomous implementation)

## Goal

Subscribe to one or more external iCal/ICS calendar feeds, give each a
human-readable name and a colour, and surface their events in the meal
planner alongside meal cards. The reserved "Termine" slot in `DayCell`
(currently a placeholder labelled "Epic 13") is the target render
location.

## Out of scope

- Editing event content (we are a viewer, not an editor)
- Two-way sync (CalDAV)
- Free/busy aggregation, reminders, attendee management
- Per-event colour overrides (colour lives on the feed, not the event)

## Data model

Three tables in `src/db/schema.ts` already exist but lack a migration
(`icalFeed`, `apiToken`, `appSetting`). One additive column is needed:

```ts
icalFeed: {
  id, name, url, color (default #3b82f6),
  enabled (default true),
  lastFetchedAt, lastErrorAt, lastErrorMessage,
  rawIcs: text | null,                  // NEW — cached body
  rawIcsFetchedAt: int | null,          // NEW — when rawIcs was captured
  createdAt
}
```

Recurring events are expanded on demand. We do **not** persist exploded
event instances — RRULE handling stays in the parser.

Migration generated via `npm run db:generate`. This will pick up the
pre-existing `icalFeed`/`apiToken`/`appSetting` definitions in the same
migration, which is correct because they have never been migrated yet.

## Refresh strategy

- Cache `rawIcs` per feed.
- Considered fresh if `rawIcsFetchedAt > now() - 15 min`.
- The planner page kicks off background refreshes for any stale,
  enabled feed (fire-and-forget Promise — does not block render).
- "Aktualisieren" button on the settings page does a synchronous
  refresh.
- Errors (network, non-200, invalid ICS) populate `lastErrorAt` and
  `lastErrorMessage`. The previous `rawIcs` is preserved so the planner
  keeps working on the last-known-good copy.

## Parsing

`node-ical` (`async-parse`, no global state). Handles RRULE, EXDATE,
RECURRENCE-ID overrides, and timezones via `tzdata`. Events are
expanded for the planner's visible window and normalised to:

```ts
type CalendarEvent = {
  feedId: number;
  feedName: string;
  feedColor: string;
  uid: string;            // ICS UID + instance suffix for recurrences
  title: string;
  start: string;          // ISO 8601, UTC for timed, "YYYY-MM-DD" for all-day
  end: string | null;
  allDay: boolean;
  location: string | null;
};
```

Events that span multiple days are split into per-date entries so
DayCell rendering stays trivial.

## Service layer

`src/lib/ical/feeds.ts` — CRUD modeled on `src/lib/staples/groups.ts`.
Custom `IcalFeedError` with status codes.

`src/lib/ical/fetch.ts` — `refreshFeed(id, { force? })`. Sets a 10s
timeout, requires `text/calendar` or a body starting with
`BEGIN:VCALENDAR`. Writes either `rawIcs` + success timestamps or
`lastErrorAt` + `lastErrorMessage` (preserving prior body on error).

`src/lib/ical/events.ts` — `getEventsForRange(fromIso, toIso)`. Reads
all `enabled` feeds, parses each `rawIcs`, expands recurrences against
the range, returns `Map<dateIso, CalendarEvent[]>` sorted by start.

## API routes

```
GET    /api/v1/ical-feeds                  list
POST   /api/v1/ical-feeds                  create
GET    /api/v1/ical-feeds/[id]             read
PATCH  /api/v1/ical-feeds/[id]             update (name/url/color/enabled)
DELETE /api/v1/ical-feeds/[id]             delete
POST   /api/v1/ical-feeds/[id]/refresh     synchronous re-fetch
```

The planner consumes events through the server component path
(`getEventsForRange` called from `plan/page.tsx`); no public
events endpoint is required for the MVP.

## UI

### Settings — `/einstellungen/kalender`

List page modeled on `/einstellungen/standards`:

- Row per feed with: colour swatch, name, URL (truncated), enabled
  toggle, last-sync status badge ("vor 3 min" / "Fehler", with
  tooltip), `Aktualisieren` button, edit (`...`) menu with Bearbeiten
  and Löschen.
- "Hinzufügen" button opens a modal with name (required), URL
  (required, validated as `http(s)://`), and a colour picker (an
  8-swatch palette + a hex input). Save triggers an initial
  synchronous refresh so the user sees errors immediately.
- Edit modal reuses the same form. Disabling a feed keeps its data
  but hides events in the planner.

### Planner — `DayCell` "Termine" column

The placeholder block at `day-cell.tsx:78-83` is replaced with the
real list. Each event becomes a row:

- Left border tinted to `feed.color`
- Time on the left (`HH:mm` for timed; "ganztägig" for all-day)
- Title truncated to one line with `title` attribute for the full
  string
- Tooltip on hover with location + feed name

Empty days render no events row at all (no "keine Termine" filler).

Mobile: the events column is currently `hidden md:flex`. We promote
it to flex on all sizes but make it the second column instead of the
first on small screens, so meals (the primary action) still appear
above events.

### Settings index

The "Kommt noch / Kalender (iCal)" placeholder card is removed and
replaced with a real Stammdaten link to `/einstellungen/kalender`.

## Risks / notes

- ICS parsing is CPU work; we cap per-feed bytes (1MB) and per-request
  parse time by only parsing the events we already have cached. A
  malicious giant ICS at refresh time is bounded by the 1MB cap.
- `node-ical`'s `async-parse` returns a record keyed by UID — careful
  to iterate `Object.values()` rather than treating it as iterable.
- Drizzle generates `icalFeed`, `apiToken`, `appSetting` together in
  the next migration. If `apiToken` is being introduced by another
  in-flight branch, resolve at merge time by re-running
  `db:generate`.
