import { MAX_PLAYLIST_ITEMS, isDelivery, isMediaFormat, isValidQuality } from "@/lib/types";
import type { DownloadOptions, VideoEntry } from "@/lib/types";

export class InputError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "InputError";
    this.status = status;
  }
}

export interface ValidatedSource {
  inputUrl: string;
  canonicalUrl: string;
  kind: "playlist" | "video";
  playlistId: string;
  videoId: string | null;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

export function validateYouTubeUrl(input: unknown): ValidatedSource {
  if (typeof input !== "string" || !input.trim()) {
    throw new InputError("Paste a YouTube playlist link to get started.");
  }
  const trimmed = input.trim();
  if (trimmed.length > 2048) throw new InputError("That link is too long. Please paste a standard YouTube URL.");

  const candidate = !/^https?:\/\//i.test(trimmed) && /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\//i.test(trimmed)
    ? `https://${trimmed}`
    : trimmed;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new InputError("That doesn't look like a YouTube playlist link. Please check and try again.");
  }

  const host = url.hostname.toLowerCase();
  const isShortHost = host === "youtu.be" || host === "www.youtu.be";
  if ((!YOUTUBE_HOSTS.has(host) && !isShortHost) || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new InputError("That doesn't look like a YouTube playlist link. Please check and try again.");
  }
  if (url.username || url.password) throw new InputError("Links with embedded credentials are not supported.");

  const listId = url.searchParams.get("list")?.trim() ?? "";
  let videoId = url.searchParams.get("v")?.trim() || null;
  if (isShortHost) videoId = url.pathname.split("/").filter(Boolean)[0] ?? videoId;
  const parts = url.pathname.split("/").filter(Boolean);
  if (!videoId && (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") && parts[1]) {
    videoId = parts[1];
  }

  if (listId) {
    if (!/^[a-zA-Z0-9_-]{2,150}$/.test(listId)) throw new InputError("This playlist ID is invalid. Copy the link again from YouTube.");
    return {
      inputUrl: url.toString(),
      canonicalUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`,
      kind: "playlist",
      playlistId: listId,
      videoId: videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId) ? videoId : null,
    };
  }

  if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
    return {
      inputUrl: url.toString(),
      canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      kind: "video",
      playlistId: videoId,
      videoId,
    };
  }

  throw new InputError("That doesn't look like a YouTube playlist link. Please check and try again.");
}

export function parseDownloadOptions(value: unknown): DownloadOptions {
  if (!value || typeof value !== "object") throw new InputError("Choose a format, quality, and delivery method.");
  const input = value as Record<string, unknown>;
  if (!isMediaFormat(input.format)) throw new InputError("Choose MP4 video, MP3 audio, or M4A audio.");
  if (!isValidQuality(input.format, input.quality)) throw new InputError("That quality is not available for the selected format.");
  if (!isDelivery(input.delivery)) throw new InputError("Choose ZIP archive or individual files.");
  return {
    format: input.format,
    quality: input.quality,
    delivery: input.delivery,
    embedMetadata: input.embedMetadata !== false,
    embedThumbnail: input.embedThumbnail !== false,
  };
}

export function resolveSelectedEntries(value: unknown, entries: VideoEntry[]): VideoEntry[] {
  if (!Array.isArray(value)) throw new InputError("Select at least one available video.");
  const requested = [...new Set(value.filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
  if (requested.length === 0) throw new InputError("Select at least one available video.");
  if (requested.length > MAX_PLAYLIST_ITEMS) {
    throw new InputError("This playlist has more videos than the limit. Select up to 200 videos.");
  }

  const available = entries.filter((entry) => entry.available);
  const bySelectionKey = new Map(available.map((entry) => [entry.selectionKey, entry]));
  const byVideoId = new Map<string, VideoEntry[]>();
  for (const entry of available) {
    const list = byVideoId.get(entry.id) ?? [];
    list.push(entry);
    byVideoId.set(entry.id, list);
  }

  const chosen = new Map<string, VideoEntry>();
  for (const rawKey of requested) {
    const exact = bySelectionKey.get(rawKey);
    if (exact) {
      chosen.set(exact.selectionKey, exact);
      continue;
    }
    const videoIdOnly = rawKey.split(":")[0] ?? rawKey;
    const candidates = byVideoId.get(videoIdOnly);
    const unused = candidates?.find((candidate) => !chosen.has(candidate.selectionKey));
    if (unused) {
      chosen.set(unused.selectionKey, unused);
      continue;
    }
    throw new InputError("Your selection changed or contains an unavailable video. Fetch the playlist again.");
  }

  return [...chosen.values()].sort((a, b) => a.position - b.position);
}
