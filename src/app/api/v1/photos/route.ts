import { NextResponse } from "next/server";
import { savePhotoBuffer } from "@/lib/photos";

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const ct = request.headers.get("content-type") ?? "";
  let buf: Buffer;
  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("photo");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "missing photo field" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "photo too large" }, { status: 413 });
    }
    buf = Buffer.from(await file.arrayBuffer());
  } else {
    const ab = await request.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "photo too large" }, { status: 413 });
    }
    buf = Buffer.from(ab);
  }

  try {
    const path = await savePhotoBuffer(buf);
    return NextResponse.json({ path }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "decode failed" },
      { status: 415 },
    );
  }
}
