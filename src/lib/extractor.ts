import { spawn } from "node:child_process";
import youtubedl from "youtube-dl-exec";
import type { Flags, JSRuntimeLocation } from "youtube-dl-exec";
import { ensureYtCacheDir, ensureYtPotPluginDir, prepareCookiesFile } from "@/lib/files";
import { createConfiguredInnertube } from "@/lib/pot-minter";
import { MAX_PLAYLIST_ITEMS } from "@/lib/types";
import type { PlaylistData, VideoEntry } from "@/lib/types";
import { InputError, validateYouTubeUrl } from "@/lib/validation";
import type { ValidatedSource } from "@/lib/validation";

export const NODE_JS_RUNTIME: JSRuntimeLocation = `node:${process.execPath}`;

const ytdlInternal = youtubedl as unknown as {
  args: (flags?: Flags) => string[];
  constants: { YOUTUBE_DL_PATH: string };
};

type RawEntry = {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  channel?: unknown;
  uploader?: unknown;
  duration?: unknown;
  availability?: unknown;
  live_status?: unknown;
};

type RawPlaylist = {
  id?: unknown;
  title?: unknown;
  channel?: unknown;
  uploader?: unknown;
  playlist_count?: unknown;
  duration?: unknown;
  entries?: unknown;
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numericDuration(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function parseClockDuration(clock: unknown): number | null {
  if (typeof clock !== "string" || !clock.trim()) return null;
  const parts = clock.trim().split(":").map((part) => Number(part));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function thumbnailFor(id: string): string {
  return /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : "";
}

function reasonFromTitle(rawTitle: string, isLive = false, isUpcoming = false): string | null {
  const lower = rawTitle.toLowerCase();
  if (lower === "[private video]" || lower.includes("private video")) return "Private video.";
  if (lower === "[deleted video]" || lower.includes("deleted video") || lower === "[unavailable]") {
    return "This video is unavailable or deleted.";
  }
  if (isUpcoming) return "This premiere has not started.";
  if (isLive) return "Active livestreams cannot be downloaded until they finish.";
  return null;
}

function unavailableReason(entry: RawEntry | null): string | null {
  if (!entry) return "This video is unavailable or region-blocked.";
  const availability = text(entry.availability).toLowerCase();
  const title = text(entry.title);
  const liveStatus = text(entry.live_status).toLowerCase();
  if (availability === "private") return "Private video.";
  if (availability === "premium_only" || availability === "subscriber_only" || availability === "needs_auth") {
    return "Paid, members-only, or sign-in required.";
  }
  if (availability === "unavailable") return "This video is unavailable or region-blocked.";
  return reasonFromTitle(title, liveStatus === "is_live", liveStatus === "is_upcoming");
}

function normalizeYtdlpEntry(entry: RawEntry | null, position: number, fallbackChannel: string): VideoEntry {
  const rawUrl = text(entry?.url);
  const idFromUrl = rawUrl.match(/[?&]v=([a-zA-Z0-9_-]{6,20})/)?.[1];
  const id = text(entry?.id) || idFromUrl || `unavailable-${position}`;
  const reason = unavailableReason(entry);
  const validId = /^[a-zA-Z0-9_-]{6,20}$/.test(id);
  const title = text(entry?.title, reason ? "Unavailable video" : `Video ${position}`);
  return {
    id,
    selectionKey: `${id}:${position}`,
    url: validId ? `https://www.youtube.com/watch?v=${id}` : rawUrl,
    position,
    title,
    channel: text(entry?.channel) || text(entry?.uploader) || fallbackChannel || "Unknown channel",
    duration: numericDuration(entry?.duration),
    thumbnail: thumbnailFor(id),
    available: !reason && validId,
    unavailableReason: reason ?? (!validId ? "This video is unavailable or region-blocked." : null),
  };
}

export function friendlyExtractorError(error: unknown): string {
  const candidate = error as { stderr?: unknown; message?: unknown; shortMessage?: unknown };
  const stderrOnly = typeof candidate?.stderr === "string" ? candidate.stderr.toLowerCase() : "";
  const detail = [candidate?.stderr, candidate?.shortMessage, candidate?.message]
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .toLowerCase();

  if (/private video|playlist is private|members-only|members only|login required|sign in to confirm your age|age-restricted/.test(detail)) {
    return "We can't access this playlist or video. It may be private, age-restricted, or members-only.";
  }
  if (/copyright|drm|paid video|requires payment/.test(detail)) {
    return "This content can't be downloaded because it is paid, DRM-protected, or restricted.";
  }
  if (/confirm you.?re not a bot|sign in to confirm|\bhttp error 429\b|\b429\s+too many requests\b|too many requests/.test(stderrOnly || detail)) {
    return "YouTube challenged this cloud IP. Open 'Anti-Bot / Cloud Settings' to paste YouTube cookies.txt, or tap Retry.";
  }
  if (/unsupported url|not a valid url/.test(detail)) {
    return "That doesn't look like a supported YouTube playlist link.";
  }
  if (/no such playlist|playlist does not exist|empty playlist|video unavailable|this video has been removed/.test(detail)) {
    return "We can't access this playlist or video. It may be unavailable, private, or empty.";
  }
  return "Couldn't reach YouTube for this item right now. Tap Retry to try again.";
}

async function fetchViaInnertube(source: ValidatedSource): Promise<PlaylistData> {
  const yt = await createConfiguredInnertube();

  if (source.kind === "video") {
    const videoId = source.videoId || source.playlistId;
    const clients = ["ANDROID_VR", "VISIONOS", "MWEB", "WEB"] as const;
    let lastErr: unknown = null;
    for (const client of clients) {
      try {
        const info = await yt.getBasicInfo(videoId, { client });
        const basic = info.basic_info;
        const title = text(basic?.title, "YouTube video");
        const channel = text(basic?.author) || text(basic?.channel?.name, "Unknown channel");
        const duration = numericDuration(basic?.duration);
        const reason = reasonFromTitle(title, Boolean(basic?.is_live), Boolean(basic?.is_upcoming));
        if (!basic?.id && !basic?.title) continue;
        return {
          kind: "video",
          sourceUrl: source.inputUrl,
          canonicalUrl: source.canonicalUrl,
          playlistId: videoId,
          title,
          channel,
          totalCount: 1,
          totalDuration: duration ?? 0,
          truncated: false,
          entries: [
            {
              id: videoId,
              selectionKey: `${videoId}:1`,
              url: `https://www.youtube.com/watch?v=${videoId}`,
              position: 1,
              title,
              channel,
              duration,
              thumbnail: thumbnailFor(videoId),
              available: !reason,
              unavailableReason: reason,
            },
          ],
        };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("Could not resolve video metadata via InnerTube");
  }

  let playlist = await yt.getPlaylist(source.playlistId);
  const rawItems: Record<string, unknown>[] = [...(playlist.videos as unknown as Record<string, unknown>[])];
  while (playlist.has_continuation && rawItems.length < MAX_PLAYLIST_ITEMS + 1) {
    playlist = await playlist.getContinuation();
    rawItems.push(...(playlist.videos as unknown as Record<string, unknown>[]));
  }

  if (rawItems.length === 0) {
    throw new InputError("We can't access this playlist. It may be private or empty.", 422);
  }

  const playlistAuthor =
    typeof playlist.info.author === "string"
      ? playlist.info.author
      : text((playlist.info.author as { name?: unknown } | undefined)?.name, "YouTube");
  const playlistTitle = text(playlist.info.title, "YouTube playlist");
  const parsedDeclared = Number(String(playlist.info.total_items ?? "").replace(/[^\d]/g, ""));
  const totalCount = Number.isFinite(parsedDeclared) && parsedDeclared > 0 ? Math.max(parsedDeclared, rawItems.length) : rawItems.length;

  const entries: VideoEntry[] = rawItems.slice(0, MAX_PLAYLIST_ITEMS).map((item, idx) => {
    const position = idx + 1;
    const rawId = text(item.content_id) || text(item.id) || `unavailable-${position}`;
    const validId = /^[a-zA-Z0-9_-]{6,20}$/.test(rawId);

    const lockupMeta = item.metadata as
      | {
          title?: { text?: unknown };
          metadata?: { metadata_rows?: Array<{ metadata_parts?: Array<{ text?: { text?: unknown } }> }> };
        }
      | undefined;

    const legacyTitle = item.title as { text?: unknown; toString?: () => string } | undefined;
    const title =
      text(lockupMeta?.title?.text) ||
      text(legacyTitle?.text) ||
      text(typeof legacyTitle?.toString === "function" ? legacyTitle.toString() : "") ||
      `Video ${position}`;

    const itemChannel =
      text(lockupMeta?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text?.text) ||
      text((item.author as { name?: unknown } | undefined)?.name) ||
      playlistAuthor ||
      "Unknown channel";

    const durObj = item.duration as { seconds?: unknown; text?: unknown } | undefined;
    const duration = numericDuration(durObj?.seconds) ?? parseClockDuration(durObj?.text);

    const reason = reasonFromTitle(title, Boolean(item.is_live), Boolean(item.is_upcoming));
    return {
      id: rawId,
      selectionKey: `${rawId}:${position}`,
      url: validId ? `https://www.youtube.com/watch?v=${rawId}` : "",
      position,
      title,
      channel: itemChannel,
      duration,
      thumbnail: thumbnailFor(rawId),
      available: !reason && validId,
      unavailableReason: reason ?? (!validId ? "This video is unavailable or region-blocked." : null),
    };
  });

  return {
    kind: "playlist",
    sourceUrl: source.inputUrl,
    canonicalUrl: source.canonicalUrl,
    playlistId: source.playlistId,
    title: playlistTitle,
    channel: playlistAuthor,
    totalCount,
    totalDuration: entries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0),
    truncated: rawItems.length > MAX_PLAYLIST_ITEMS || totalCount > MAX_PLAYLIST_ITEMS,
    entries,
  };
}

async function fetchViaYtdlp(source: ValidatedSource, clientCookies?: string | null): Promise<PlaylistData> {
  const [cacheDir, pluginDir, cookieHandle] = await Promise.all([
    ensureYtCacheDir(),
    ensureYtPotPluginDir(),
    prepareCookiesFile(clientCookies),
  ]);

  try {
    const flags: Flags = {
      dumpSingleJson: true,
      skipDownload: true,
      flatPlaylist: source.kind === "playlist",
      noPlaylist: source.kind === "video" ? true : undefined,
      forceIpv4: true,
      noWarnings: true,
      jsRuntimes: NODE_JS_RUNTIME,
      cacheDir,
      pluginDirs: pluginDir,
      cookies: cookieHandle?.path,
      proxy: process.env.YOUTUBE_PROXY?.trim() || undefined,
      extractorArgs: "youtube:player_client=mweb,tv,visionos,web_embedded",
      playlistEnd: source.kind === "playlist" ? MAX_PLAYLIST_ITEMS + 1 : undefined,
      socketTimeout: 25,
      retries: 2,
      extractorRetries: 2,
    };

    const cliArgs = [...ytdlInternal.args(flags), "--", source.canonicalUrl];
    const jsonText = await new Promise<string>((resolve, reject) => {
      const child = spawn(/*turbopackIgnore: true*/ ytdlInternal.constants.YOUTUBE_DL_PATH, cliArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, YO_POT_PORT: process.env.PORT || "3000" },
      });
      let out = "";
      let err = "";
      child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-8192); });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0 && out.trim()) resolve(out);
        else reject(Object.assign(new Error(err || `yt-dlp exited with ${code}`), { stderr: err }));
      });
    });

    const raw = JSON.parse(jsonText) as RawPlaylist;
    const channel = text(raw.channel) || text(raw.uploader) || "Unknown channel";
    const rawEntries = source.kind === "playlist" && Array.isArray(raw.entries) ? raw.entries : [raw];
    const capped = rawEntries.slice(0, MAX_PLAYLIST_ITEMS);
    const entries = capped.map((entry, index) => normalizeYtdlpEntry((entry ?? null) as RawEntry | null, index + 1, channel));
    const declaredCount = typeof raw.playlist_count === "number" ? raw.playlist_count : rawEntries.length;
    const totalCount = Math.max(declaredCount, rawEntries.length);
    const title = text(raw.title, source.kind === "video" ? "YouTube video" : "YouTube playlist");
    if (source.kind === "playlist" && entries.length === 0) {
      throw new InputError("We can't access this playlist. It may be private or empty.", 422);
    }
    return {
      kind: source.kind,
      sourceUrl: source.inputUrl,
      canonicalUrl: source.canonicalUrl,
      playlistId: source.playlistId,
      title,
      channel,
      totalCount,
      totalDuration: entries.reduce((total, entry) => total + (entry.duration ?? 0), 0),
      truncated: rawEntries.length > MAX_PLAYLIST_ITEMS || totalCount > MAX_PLAYLIST_ITEMS,
      entries,
    };
  } finally {
    await cookieHandle?.cleanup();
  }
}

export async function extractPlaylist(input: unknown, clientCookies?: string | null): Promise<PlaylistData> {
  const source = validateYouTubeUrl(input);

  // If user didn't pass custom auth cookies, try ultra-fast pure-Node InnerTube first (~150ms, zero Python spawn).
  if (!clientCookies?.trim() && !process.env.YOUTUBE_COOKIES?.trim()) {
    try {
      return await fetchViaInnertube(source);
    } catch {
      /* Fall back to yt-dlp + BotGuard PO-token plugin below. */
    }
  }

  try {
    return await fetchViaYtdlp(source, clientCookies);
  } catch (firstError) {
    if (source.kind === "playlist" && source.videoId) {
      const singleSource: ValidatedSource = {
        inputUrl: source.inputUrl,
        canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(source.videoId)}`,
        kind: "video",
        playlistId: source.videoId,
        videoId: source.videoId,
      };
      try {
        return await fetchViaInnertube(singleSource);
      } catch {
        try {
          return await fetchViaYtdlp(singleSource, clientCookies);
        } catch {
          /* Fall through. */
        }
      }
    }
    if (firstError instanceof InputError) throw firstError;
    throw new InputError(friendlyExtractorError(firstError), 422);
  }
}
