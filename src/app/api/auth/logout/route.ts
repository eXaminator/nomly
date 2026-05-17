import { NextResponse } from "next/server";
import { getSession } from "@/lib/server-session";
import { env } from "@/lib/env";

async function clear(): Promise<NextResponse> {
  const session = await getSession();
  session.destroy();
  const target = env.OIDC_END_SESSION_URL
    ? env.OIDC_END_SESSION_URL
    : new URL("/", env.BASE_URL).toString();
  return NextResponse.redirect(target);
}

export async function POST() {
  return clear();
}

export async function GET() {
  return clear();
}
