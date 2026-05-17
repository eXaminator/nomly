import { NextResponse } from "next/server";

const VERSION = process.env.npm_package_version ?? "0.1.0";

export function GET() {
  return NextResponse.json({ ok: true, version: VERSION });
}
