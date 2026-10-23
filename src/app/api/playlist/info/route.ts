import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { extractPlaylist } from "@/lib/extractor";
import { rateLimit } from "@/lib/rate-limit";
import { InputError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const limit = rateLimit(request, "playlist-info", 30, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Wait a minute and try again.", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  try {
    const body = (await request.json()) as { url?: unknown; cookies?: unknown };
    const cookies = typeof body.cookies === "string" ? body.cookies : null;
    const payload = await extractPlaylist(body.url, cookies);
    return NextResponse.json({
      preview: {
        ...payload,
        previewId: randomUUID(),
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof InputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "We couldn't load that playlist. Check the link and try again." },
      { status: 500 },
    );
  }
}
