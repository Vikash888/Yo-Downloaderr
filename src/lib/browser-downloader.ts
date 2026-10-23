"use client";

import { makeZip } from "client-zip";
import type { DownloadOptions, MediaFormat } from "@/lib/types";

export function sanitizeClientFilename(input: string): string {
  const cleaned = input
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/[.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, "");
  const safe = cleaned || "Untitled";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe) ? `_${safe}` : safe;
}

export function buildOrderedClientFilename(position: number, title: string, format: MediaFormat, totalCount: number): string {
  const width = Math.max(2, String(Math.max(totalCount, 1)).length);
  return `${String(position).padStart(width, "0")} - ${sanitizeClientFilename(title)}.${format}`;
}

export function buildDirectStreamUrl(params: {
  videoId: string;
  format: MediaFormat;
  quality: string;
  fileName: string;
  durationSec?: number | null;
  embedMetadata?: boolean;
  embedThumbnail?: boolean;
}): string {
  const qs = new URLSearchParams({
    v: params.videoId,
    format: params.format,
    quality: params.quality,
    name: params.fileName,
    meta: params.embedMetadata === false ? "0" : "1",
    thumb: params.embedThumbnail === false ? "0" : "1",
  });
  if (params.durationSec && params.durationSec > 0) {
    qs.set("dur", String(Math.round(params.durationSec)));
  }
  return `/api/stream?${qs.toString()}`;
}

export function triggerBlobDownload(blob: Blob, fileName: string): string {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  return objectUrl;
}

export async function fetchVideoBlobWithProgress(opts: {
  videoId: string;
  fileName: string;
  durationSec: number | null;
  options: DownloadOptions;
  cookies?: string;
  proxy?: string;
  signal: AbortSignal;
  onProgress: (info: { percent: number; loadedBytes: number; totalBytes: number | null }) => void;
}): Promise<Blob> {
  const hasCustomBypass = Boolean(opts.cookies?.trim() || opts.proxy?.trim());
  const url = buildDirectStreamUrl({
    videoId: opts.videoId,
    format: opts.options.format,
    quality: opts.options.quality,
    fileName: opts.fileName,
    durationSec: opts.durationSec,
    embedMetadata: opts.options.embedMetadata,
    embedThumbnail: opts.options.embedThumbnail,
  });

  opts.onProgress({ percent: 8, loadedBytes: 0, totalBytes: null });

  const response = hasCustomBypass
    ? await fetch("/api/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: opts.videoId,
          format: opts.options.format,
          quality: opts.options.quality,
          fileName: opts.fileName,
          durationSec: opts.durationSec,
          embedMetadata: opts.options.embedMetadata,
          embedThumbnail: opts.options.embedThumbnail,
          cookies: opts.cookies,
          proxy: opts.proxy,
        }),
        signal: opts.signal,
      })
    : await fetch(url, { signal: opts.signal });

  if (!response.ok) {
    let errMsg = "Couldn't download this video. Tap Retry.";
    try {
      const json = (await response.json()) as { error?: string };
      if (json.error) errMsg = json.error;
    } catch {
      /* ignore */
    }
    throw new Error(errMsg);
  }

  const contentLengthHeader = response.headers.get("Content-Length");
  const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : null;
  const contentType = response.headers.get("Content-Type") || "application/octet-stream";

  if (!response.body) {
    const blob = await response.blob();
    opts.onProgress({ percent: 100, loadedBytes: blob.size, totalBytes: blob.size });
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      // Copy into standard ArrayBuffer slice for strict BlobPart compatibility
      chunks.push(value.slice().buffer);
      loadedBytes += value.byteLength;
      const percent =
        totalBytes && totalBytes > 0
          ? Math.min(99, Math.max(12, Math.round((loadedBytes / totalBytes) * 100)))
          : Math.min(92, 15 + Math.round(Math.log10(Math.max(1, loadedBytes / 50_000)) * 28));
      opts.onProgress({ percent, loadedBytes, totalBytes });
    }
  }

  if (loadedBytes === 0) {
    throw new Error("Empty media stream returned. Tap Retry.");
  }

  opts.onProgress({ percent: 100, loadedBytes, totalBytes: loadedBytes });
  return new Blob(chunks, { type: contentType });
}

export async function packageBlobsIntoZip(
  files: Array<{ name: string; blob: Blob }>,
): Promise<Blob> {
  const zipStream = makeZip(
    files.map((item) => ({
      name: item.name,
      lastModified: new Date(),
      input: item.blob,
    })),
  );
  return new Response(zipStream, {
    headers: { "Content-Type": "application/zip" },
  }).blob();
}
