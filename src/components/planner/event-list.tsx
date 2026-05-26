"use client";

import type { CalendarEvent } from "@/lib/ical/events";

type Props = { events: CalendarEvent[] };

export function EventList({ events }: Props) {
  if (events.length === 0) {
    return (
      // The empty slot stays in the layout so meals don't shift between
      // days with and without events.
      <div className="hidden md:block" aria-hidden />
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {events.map((event) => (
        <li
          key={event.uid}
          className="flex flex-col gap-0.5 rounded-md border-l-2 bg-[var(--color-muted)]/30 py-1 pl-2 pr-1.5"
          style={{ borderLeftColor: event.feedColor }}
          title={titleText(event)}
        >
          <span className="line-clamp-2 text-xs font-medium leading-tight text-[var(--color-fg)]">
            {event.title}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-[var(--color-muted-fg)]">
            <span className="shrink-0">{formatTime(event)}</span>
            <span aria-hidden className="shrink-0">
              ·
            </span>
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: event.feedColor }}
            />
            <span className="truncate font-medium">{event.feedName}</span>
          </span>
          {event.location ? (
            <span className="truncate text-[10px] text-[var(--color-muted-fg)]">
              {event.location}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function formatTime(event: CalendarEvent): string {
  if (event.allDay) return "ganztägig";
  const start = new Date(event.start);
  const hh = String(start.getHours()).padStart(2, "0");
  const mm = String(start.getMinutes()).padStart(2, "0");
  if (!event.end) return `${hh}:${mm}`;
  const end = new Date(event.end);
  // Same-day timed event → show range.
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (!sameDay) return `ab ${hh}:${mm}`;
  const eh = String(end.getHours()).padStart(2, "0");
  const em = String(end.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}–${eh}:${em}`;
}

function titleText(event: CalendarEvent): string {
  const parts = [event.title, event.feedName];
  if (event.location) parts.push(event.location);
  return parts.join(" — ");
}
