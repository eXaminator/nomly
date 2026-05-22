import { NextResponse } from "next/server";

/**
 * Standard error mapper for any `*StammdatenError` thrown by the services —
 * they all expose `.status` and `.message`. Other errors fall through to a
 * 500 with the error message.
 */
export function errorToResponse(e: unknown) {
  if (
    e instanceof Error &&
    "status" in e &&
    typeof (e as { status: unknown }).status === "number"
  ) {
    return NextResponse.json(
      { error: e.message },
      { status: (e as { status: number }).status },
    );
  }
  const message = e instanceof Error ? e.message : "Unbekannter Fehler.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseIdList(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}
