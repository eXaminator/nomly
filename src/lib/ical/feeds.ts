import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { icalFeed, type IcalFeed } from "@/db/schema";

export type IcalFeedErrorCode =
  | "invalid_name"
  | "invalid_url"
  | "invalid_color"
  | "not_found";

export class IcalFeedError extends Error {
  code: IcalFeedErrorCode;
  status: number;
  constructor(code: IcalFeedErrorCode, message: string, status = 400) {
    super(message);
    this.name = "IcalFeedError";
    this.code = code;
    this.status = status;
  }
}

export type IcalFeedSummary = {
  id: number;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
  sortOrder: number;
  lastFetchedAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  rawIcsFetchedAt: number | null;
  hasCachedBody: boolean;
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new IcalFeedError("invalid_name", "Name darf nicht leer sein");
  }
  if (trimmed.length > 80) {
    throw new IcalFeedError("invalid_name", "Name ist zu lang (max. 80 Zeichen)");
  }
  return trimmed;
}

function validateUrl(url: string): string {
  const trimmed = url.trim();
  // WHATWG URL won't let us reassign `protocol` between non-special and
  // special schemes, so rewrite webcal:// → https:// up front.
  const normalised = /^webcal:\/\//i.test(trimmed)
    ? "https://" + trimmed.slice("webcal://".length)
    : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(normalised);
  } catch {
    throw new IcalFeedError("invalid_url", "URL ist ungültig");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new IcalFeedError(
      "invalid_url",
      "Nur http(s)- und webcal-URLs werden unterstützt",
    );
  }
  return parsed.toString();
}

function validateColor(color: string): string {
  if (!HEX_COLOR_RE.test(color)) {
    throw new IcalFeedError(
      "invalid_color",
      "Farbe muss ein Hex-Wert sein (z. B. #3b82f6)",
    );
  }
  return color.toLowerCase();
}

function toSummary(row: IcalFeed): IcalFeedSummary {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    color: row.color,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    lastFetchedAt: row.lastFetchedAt,
    lastErrorAt: row.lastErrorAt,
    lastErrorMessage: row.lastErrorMessage,
    rawIcsFetchedAt: row.rawIcsFetchedAt,
    hasCachedBody: row.rawIcs !== null && row.rawIcs !== "",
  };
}

export function listFeeds(): IcalFeedSummary[] {
  return db
    .select()
    .from(icalFeed)
    .orderBy(asc(icalFeed.sortOrder), asc(icalFeed.name))
    .all()
    .map(toSummary);
}

export function getFeed(id: number): IcalFeedSummary | null {
  const row = db.select().from(icalFeed).where(eq(icalFeed.id, id)).get();
  return row ? toSummary(row) : null;
}

export type CreateFeedInput = {
  name: string;
  url: string;
  color?: string;
};

export function createFeed(input: CreateFeedInput): IcalFeedSummary {
  const name = validateName(input.name);
  const url = validateUrl(input.url);
  const color = input.color ? validateColor(input.color) : "#3b82f6";
  const maxSort =
    db
      .select({ max: sql<number | null>`MAX(${icalFeed.sortOrder})` })
      .from(icalFeed)
      .get()?.max ?? -1;
  const inserted = db
    .insert(icalFeed)
    .values({
      name,
      url,
      color,
      sortOrder: maxSort + 1,
    })
    .returning()
    .all()[0];
  return toSummary(inserted);
}

export type UpdateFeedInput = {
  name?: string;
  url?: string;
  color?: string;
  enabled?: boolean;
};

export function updateFeed(id: number, input: UpdateFeedInput): IcalFeedSummary {
  const patch: Partial<typeof icalFeed.$inferInsert> = {};
  if (input.name !== undefined) patch.name = validateName(input.name);
  if (input.url !== undefined) {
    const newUrl = validateUrl(input.url);
    patch.url = newUrl;
    // Changing the URL invalidates the cached body.
    const existing = db
      .select({ url: icalFeed.url })
      .from(icalFeed)
      .where(eq(icalFeed.id, id))
      .get();
    if (existing && existing.url !== newUrl) {
      patch.rawIcs = null;
      patch.rawIcsFetchedAt = null;
      patch.lastErrorAt = null;
      patch.lastErrorMessage = null;
    }
  }
  if (input.color !== undefined) patch.color = validateColor(input.color);
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (Object.keys(patch).length === 0) {
    const current = getFeed(id);
    if (!current) {
      throw new IcalFeedError("not_found", "Kalender nicht gefunden", 404);
    }
    return current;
  }
  const updated = db
    .update(icalFeed)
    .set(patch)
    .where(eq(icalFeed.id, id))
    .returning()
    .all();
  if (updated.length === 0) {
    throw new IcalFeedError("not_found", "Kalender nicht gefunden", 404);
  }
  return toSummary(updated[0]);
}

export function deleteFeed(id: number): void {
  const result = db.delete(icalFeed).where(eq(icalFeed.id, id)).run();
  if (result.changes === 0) {
    throw new IcalFeedError("not_found", "Kalender nicht gefunden", 404);
  }
}

export function reorderFeeds(orderedIds: number[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, idx) => {
      tx.update(icalFeed)
        .set({ sortOrder: idx })
        .where(eq(icalFeed.id, id))
        .run();
    });
  });
}
