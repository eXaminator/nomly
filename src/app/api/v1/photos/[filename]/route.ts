import { NextResponse } from "next/server";
import { readPhoto } from "@/lib/photos";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ filename: string }> },
) {
  const { filename } = await ctx.params;
  try {
    const { data, size } = await readPhoto(filename);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": "image/webp",
        "content-length": String(size),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
