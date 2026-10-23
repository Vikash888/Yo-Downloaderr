import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { prepareMediaStream } from "@/lib/streamer";
import type { MediaFormat } from "@/lib/types";
import { InputError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildAttachmentHeaders(fileName: string, contentType: string, contentLength: number | null): Headers {
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (contentLength !== null && contentLength > 0) {
    headers.set("Content-Length", String(contentLength));
  }
  return headers;
}

export async function GET(request: NextRequest) {
  const limit = rateLimit(request, "stream-media", 120, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many downloads at once. Wait a moment and retry." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  try {
    const sp = request.nextUrl.searchParams;
    const videoId = sp.get("v") || "";
    const format = (sp.get("format") || "mp3") as MediaFormat;
    const quality = sp.get("quality") || (format === "mp4" ? "720" : "192");
    const fileName = sp.get("name");
    const durationRaw = sp.get("dur");
    const durationSec = durationRaw ? Number(durationRaw) : null;
    const embedMetadata = sp.get("meta") !== "0";
    const embedThumbnail = sp.get("thumb") !== "0";

    const result = await prepareMediaStream({
      videoId,
      format,
      quality,
      fileName,
      durationSec: Number.isFinite(durationSec) ? durationSec : null,
      embedMetadata,
      embedThumbnail,
      signal: request.signal,
    });

    return new NextResponse(result.stream, {
      headers: buildAttachmentHeaders(result.fileName, result.contentType, result.contentLength),
    });
  } catch (error) {
    if (error instanceof InputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Couldn't download this video right now. Tap Retry." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const limit = rateLimit(request, "stream-media", 120, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many downloads at once. Wait a moment and retry." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  try {
    const body = (await request.json()) as {
      videoId?: unknown;
      format?: unknown;
      quality?: unknown;
      fileName?: unknown;
      durationSec?: unknown;
      embedMetadata?: unknown;
      embedThumbnail?: unknown;
      cookies?: unknown;
      proxy?: unknown;
    };

    const format = (typeof body.format === "string" ? body.format : "mp3") as MediaFormat;
    const quality = typeof body.quality === "string" ? body.quality : format === "mp4" ? "720" : "192";

    const result = await prepareMediaStream({
      videoId: typeof body.videoId === "string" ? body.videoId : "",
      format,
      quality,
      fileName: typeof body.fileName === "string" ? body.fileName : null,
      durationSec: typeof body.durationSec === "number" ? body.durationSec : null,
      embedMetadata: body.embedMetadata !== false,
      embedThumbnail: body.embedThumbnail !== false,
      cookies: typeof body.cookies === "string" ? body.cookies : null,
      proxy: typeof body.proxy === "string" ? body.proxy : null,
      signal: request.signal,
    });

    return new NextResponse(result.stream, {
      headers: buildAttachmentHeaders(result.fileName, result.contentType, result.contentLength),
    });
  } catch (error) {
    if (error instanceof InputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Couldn't download this video right now. Tap Retry." },
      { status: 500 },
    );
  }
}
