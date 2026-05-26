import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { icalFeed } from "@/db/schema";
import { IcalFeedError } from "./feeds";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1_000_000;
const STALE_AFTER_MS = 15 * 60 * 1000;

export type RefreshResult =
  | { ok: true; bytes: number; fetchedAt: number }
  | { ok: false; error: string; failedAt: number };

/**
 * Fetch the ICS body and persist it. On error the previous body is kept so
 * the planner stays usable on the last-known-good snapshot.
 */
export async function refreshFeed(id: number): Promise<RefreshResult> {
  const row = db
    .select({ id: icalFeed.id, url: icalFeed.url })
    .from(icalFeed)
    .where(eq(icalFeed.id, id))
    .get();
  if (!row) {
    throw new IcalFeedError("not_found", "Kalender nicht gefunden", 404);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const now = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(row.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "text/calendar, text/plain;q=0.5, */*;q=0.1" },
    });
    if (!res.ok) {
      return await persistError(id, `HTTP ${res.status}`, now);
    }
    const body = await readBoundedText(res, MAX_BODY_BYTES);
    if (!looksLikeIcs(body)) {
      return await persistError(
        id,
        "Antwort enthält kein gültiges ICS (BEGIN:VCALENDAR nicht gefunden)",
        now,
      );
    }
    db.update(icalFeed)
      .set({
        rawIcs: body,
        rawIcsFetchedAt: now,
        lastFetchedAt: now,
        lastErrorAt: null,
        lastErrorMessage: null,
      })
      .where(eq(icalFeed.id, id))
      .run();
    return { ok: true, bytes: body.length, fetchedAt: now };
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timeout nach ${FETCH_TIMEOUT_MS / 1000}s`
          : err.message
        : "Unbekannter Fehler";
    return await persistError(id, msg, now);
  } finally {
    clearTimeout(timer);
  }
}

async function persistError(
  id: number,
  message: string,
  at: number,
): Promise<RefreshResult> {
  db.update(icalFeed)
    .set({
      lastFetchedAt: at,
      lastErrorAt: at,
      lastErrorMessage: message.slice(0, 500),
    })
    .where(eq(icalFeed.id, id))
    .run();
  return { ok: false, error: message, failedAt: at };
}

async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  // We can't trust Content-Length, so stream and bail if the body is huge.
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const decoder = new TextDecoder();
  let received = 0;
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      reader.cancel();
      throw new Error(`ICS-Datei zu groß (> ${maxBytes / 1000} KB)`);
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function looksLikeIcs(body: string): boolean {
  return /BEGIN:VCALENDAR/i.test(body.slice(0, 2048));
}

/**
 * Trigger a non-blocking refresh for every enabled feed whose cache is older
 * than `STALE_AFTER_MS`. Used by the planner page to keep events fresh
 * without making rendering wait on the network.
 */
export function refreshStaleEnabledFeeds(): void {
  const cutoff = Math.floor((Date.now() - STALE_AFTER_MS) / 1000);
  const stale = db
    .select({ id: icalFeed.id })
    .from(icalFeed)
    .where(
      sql`${icalFeed.enabled} = 1 AND (${icalFeed.rawIcsFetchedAt} IS NULL OR ${icalFeed.rawIcsFetchedAt} < ${cutoff})`,
    )
    .all();
  for (const { id } of stale) {
    // Fire and forget — refreshFeed swallows errors into the DB row.
    void refreshFeed(id);
  }
}
