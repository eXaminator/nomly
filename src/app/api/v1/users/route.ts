import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/users/current";
import { listUsers } from "@/lib/users/service";

/** List household users (id, name, last login) for the favorites filter and the
 *  settings management screen. Requires an authenticated session. */
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ items: listUsers() });
}
