import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import youtubedl from "youtube-dl-exec";
import type { Flags } from "youtube-dl-exec";
import { NODE_JS_RUNTIME, friendlyExtractorError } from "@/lib/extractor";
import {
  createIsolatedStreamDir,
  ensureMediaToolsDir,
  ensureYtCacheDir,
  ensureYtPotPluginDir,
  fileSize,
  findOutputFile,
  prepareCookiesFile,
  sanitizeFilename,
} from "@/lib/files";
import { getPotSession } from "@/lib/pot-minter";
import { isMediaFormat, isValidQuality } from "@/lib/types";
import type { MediaFormat } from "@/lib/types";
import { InputError } from "@/lib/validation";

const ytdlInternal = youtubedl as unknown as {
  args: (flags?: Flags) => string[];
  constants: { YOUTUBE_DL_PATH: string };
};

// Keep concurrency low so Render Free (512MB RAM) never runs out of memory.
const MAX_CONCURRENT_STREAMS = Math.max(1, Math.min(3, Number(process.env.YO_STREAM_CONCURRENCY) || 2));

type SemaphoreState = {
  active: number;
  waiters: Array<() => void>;
};

const globalForSem = globalThis as typeof globalThis & { __yoStreamSem?: SemaphoreState };
const sem: SemaphoreState = globalForSem.__yoStreamSem ?? { active: 0, waiters: [] };
globalForSem.__yoStreamSem = sem;

async function acquireSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw new Error("STREAM_ABORTED");
  if (sem.active < MAX_CONCURRENT_STREAMS) {
    sem.active += 1;
  } else {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const idx = sem.waiters.indexOf(wake);
        if (idx >= 0) sem.waiters.splice(idx, 1);
        reject(new Error("STREAM_ABORTED"));
      };
      const wake = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      sem.waiters.push(wake);
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = sem.waiters.shift();
    if (next) {
      next();
    } else {
      sem.active = Math.max(0, sem.active - 1);
    }
  };
}

export interface StreamMediaRequest {
  videoId: string;
  format: MediaFormat;
  quality: string;
  fileName?: string | null;
  durationSec?: number | null;
  embedMetadata?: boolean;
  embedThumbnail?: boolean;
  cookies?: string | null;
  proxy?: string | null;
  signal?: AbortSignal;
}

export interface StreamMediaResult {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  fileName: string;
}

const CONTENT_TYPES: Record<MediaFormat, string> = {
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
};

const CLIENT_PROFILES = [
  "youtube:player_client=mweb,tv,visionos,web_embedded",
  "youtube:player_client=tv_samsung,android_vr,visionos",
  "youtube:player_client=default,web_safari",
];

function validateStreamRequest(req: StreamMediaRequest): {
  videoId: string;
  format: MediaFormat;
  quality: string;
  safeFileName: string;
} {
  const videoId = req.videoId?.trim() ?? "";
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
    throw new InputError("Invalid YouTube video ID.", 400);
  }
  if (!isMediaFormat(req.format)) {
    throw new InputError("Choose MP4, MP3, or M4A.", 400);
  }
  if (!isValidQuality(req.format, req.quality)) {
    throw new InputError("Invalid quality for the selected format.", 400);
  }
  const rawBase = req.fileName?.trim()
    ? req.fileName.trim().replace(/\.(mp4|mp3|m4a)$/i, "")
    : videoId;
  const safeFileName = `${sanitizeFilename(rawBase)}.${req.format}`;
  return { videoId, format: req.format, quality: req.quality, safeFileName };
}

function streamZeroDiskLivePipe(opts: {
  videoId: string;
  format: MediaFormat;
  quality: string;
  safeFileName: string;
  cacheDir?: string;
  pluginDir?: string;
  cookieHandle: { path: string; cleanup: () => Promise<void> } | null;
  proxy?: string;
  releaseSlot: () => void;
  signal?: AbortSignal;
}): StreamMediaResult {
  const { videoId, format, quality, safeFileName, cacheDir, pluginDir, cookieHandle, proxy, releaseSlot, signal } = opts;
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const ytdlpFlags: Flags = {
    output: "-",
    noPlaylist: true,
    forceIpv4: true,
    noWarnings: true,
    jsRuntimes: NODE_JS_RUNTIME,
    cacheDir,
    pluginDirs: pluginDir,
    cookies: cookieHandle?.path,
    proxy,
    extractorArgs: CLIENT_PROFILES[0],
    retries: 2,
    fragmentRetries: 3,
    socketTimeout: 30,
    format:
      format === "mp4"
        ? `best[ext=mp4][height<=${quality}]/18/best[ext=mp4]/best`
        : format === "m4a"
          ? "bestaudio[ext=m4a]/bestaudio/best"
          : "bestaudio/best",
  };

  const cliArgs = [...ytdlInternal.args(ytdlpFlags), "--", sourceUrl];
  const ytProc = spawn(/*turbopackIgnore: true*/ ytdlInternal.constants.YOUTUBE_DL_PATH, cliArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, YO_POT_PORT: process.env.PORT || "3000" },
  });

  // For MP4 progressive or M4A native stream, pipe yt-dlp stdout directly; for MP3 transcode on the fly with FFmpeg.
  const needsFfmpeg = format === "mp3" && Boolean(ffmpegPath);
  const ffProc = needsFfmpeg
    ? spawn(/*turbopackIgnore: true*/ ffmpegPath as string, [
        "-loglevel", "error",
        "-i", "pipe:0",
        "-vn",
        "-acodec", "libmp3lame",
        "-b:a", `${quality}k`,
        "-f", "mp3",
        "pipe:1",
      ], { stdio: ["pipe", "pipe", "pipe"] })
    : null;

  if (ffProc && ytProc.stdout && ffProc.stdin) {
    ytProc.stdout.pipe(ffProc.stdin);
    ffProc.stdin.on("error", () => undefined);
  }

  const outputStdout = ffProc ? ffProc.stdout : ytProc.stdout;
  let cleaned = false;
  const cleanupAll = () => {
    if (cleaned) return;
    cleaned = true;
    if (!ytProc.killed) ytProc.kill("SIGTERM");
    if (ffProc && !ffProc.killed) ffProc.kill("SIGTERM");
    void cookieHandle?.cleanup();
    releaseSlot();
  };

  signal?.addEventListener("abort", cleanupAll, { once: true });
  ytProc.on("close", () => {
    if (!ffProc) cleanupAll();
  });
  ffProc?.on("close", cleanupAll);

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      outputStdout?.on("data", (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          cleanupAll();
        }
      });
      outputStdout?.on("end", () => {
        cleanupAll();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
      outputStdout?.on("error", (err) => {
        cleanupAll();
        try {
          controller.error(err);
        } catch {
          /* ignore */
        }
      });
    },
    cancel() {
      cleanupAll();
    },
  });

  return {
    stream: webStream,
    contentType: CONTENT_TYPES[format],
    contentLength: null,
    fileName: safeFileName,
  };
}

export async function prepareMediaStream(req: StreamMediaRequest): Promise<StreamMediaResult> {
  const { videoId, format, quality, safeFileName } = validateStreamRequest(req);
  const releaseSlot = await acquireSlot(req.signal);

  // Warm BotGuard PO-token minter in memory so yt-dlp's yo_pot plugin gets sub-millisecond tokens.
  void getPotSession().catch(() => undefined);

  const [toolsDir, cacheDir, pluginDir, cookieHandle] = await Promise.all([
    ensureMediaToolsDir(),
    ensureYtCacheDir(),
    ensureYtPotPluginDir(),
    prepareCookiesFile(req.cookies),
  ]);
  const proxy = req.proxy?.trim() || process.env.YOUTUBE_PROXY?.trim() || undefined;

  // For ultra-long videos (>45 min), stream zero-disk live pipe immediately so cloud proxies
  // like Cloudflare/Render Free (100s first-byte timeout) never time out waiting for muxing,
  // and 512MB RAM / small container disks never fill up!
  const isVeryLongVideo = Boolean(req.durationSec && req.durationSec > 2700);
  if (isVeryLongVideo) {
    return streamZeroDiskLivePipe({
      videoId,
      format,
      quality,
      safeFileName,
      cacheDir,
      pluginDir,
      cookieHandle,
      proxy,
      releaseSlot,
      signal: req.signal,
    });
  }

  const scratch = await createIsolatedStreamDir();
  const baseName = "media_out";
  const outputTemplate = path.join(scratch.dir, `${baseName}.%(ext)s`);
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;

  let lastError: unknown = null;
  let resolvedPath: string | null = null;

  try {
    for (let i = 0; i < CLIENT_PROFILES.length; i += 1) {
      if (req.signal?.aborted) throw new Error("STREAM_ABORTED");
      const profile = CLIENT_PROFILES[i];
      const isFinalAttempt = i === CLIENT_PROFILES.length - 1;

      const flags: Flags = {
        output: outputTemplate,
        noPlaylist: true,
        forceIpv4: true,
        noWarnings: true,
        jsRuntimes: NODE_JS_RUNTIME,
        cacheDir,
        pluginDirs: pluginDir,
        cookies: cookieHandle?.path,
        proxy,
        extractorArgs: profile,
        retries: 2,
        fragmentRetries: 3,
        socketTimeout: 25,
        concurrentFragments: i === 0 ? 4 : 2,
        forceOverwrites: true,
        print: "after_move:filepath",
        ffmpegLocation: toolsDir,
      };

      if (format === "mp4") {
        Object.assign(flags, {
          format: `bestvideo[vcodec^=avc1][height<=${quality}]+bestaudio[acodec^=mp4a]/bestvideo[ext=mp4][height<=${quality}]+bestaudio[ext=m4a]/best[ext=mp4][height<=${quality}]/bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`,
          mergeOutputFormat: "mp4",
          remuxVideo: "mp4",
        });
      } else {
        const shouldEmbedThumb = req.embedThumbnail !== false && !isFinalAttempt;
        Object.assign(flags, {
          format: format === "m4a" ? "bestaudio[ext=m4a]/bestaudio/best" : "bestaudio/best",
          extractAudio: true,
          audioFormat: format,
          audioQuality: `${quality}K`,
          addMetadata: req.embedMetadata !== false,
          noEmbedChapters: true,
          embedThumbnail: shouldEmbedThumb ? true : undefined,
          convertThumbnails: shouldEmbedThumb ? "jpg" : undefined,
          ppa: format === "m4a" && shouldEmbedThumb ? "EmbedThumbnail+ffmpeg_o:-f mp4" : undefined,
        });
      }

      const cliArgs = [...ytdlInternal.args(flags), "--", sourceUrl];
      try {
        let printed = "";
        await new Promise<void>((resolve, reject) => {
          const child = spawn(/*turbopackIgnore: true*/ ytdlInternal.constants.YOUTUBE_DL_PATH, cliArgs, {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, YO_POT_PORT: process.env.PORT || "3000" },
          });
          let outBuf = "";
          let errBuf = "";
          const onAbort = () => {
            if (!child.killed) child.kill("SIGTERM");
            reject(new Error("STREAM_ABORTED"));
          };
          req.signal?.addEventListener("abort", onAbort, { once: true });

          child.stdout?.on("data", (d: Buffer) => { outBuf += d.toString(); });
          child.stderr?.on("data", (d: Buffer) => { errBuf = (errBuf + d.toString()).slice(-8192); });
          child.on("error", (err) => {
            req.signal?.removeEventListener("abort", onAbort);
            reject(err);
          });
          child.on("close", (code) => {
            req.signal?.removeEventListener("abort", onAbort);
            const lines = outBuf.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            const lastLine = lines.at(-1);
            if (lastLine && path.isAbsolute(lastLine)) printed = lastLine;
            if (code === 0) resolve();
            else reject(Object.assign(new Error(errBuf || `yt-dlp exited with ${code}`), { stderr: errBuf }));
          });
        });

        const candidate =
          printed && (await fileSize(printed).catch(() => 0)) > 0
            ? printed
            : await findOutputFile(scratch.dir, baseName, format);
        if (candidate) {
          resolvedPath = candidate;
          break;
        }
      } catch (err) {
        if (err instanceof Error && err.message === "STREAM_ABORTED") throw err;
        lastError = err;
      }
    }

    if (!resolvedPath) {
      throw new InputError(friendlyExtractorError(lastError), 422);
    }

    const totalBytes = await fileSize(resolvedPath);
    const nodeStream = createReadStream(/*turbopackIgnore: true*/ resolvedPath);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      nodeStream.destroy();
      void cookieHandle?.cleanup();
      void scratch.cleanup();
      releaseSlot();
    };

    req.signal?.addEventListener("abort", cleanup, { once: true });
    nodeStream.on("close", cleanup);
    nodeStream.on("error", cleanup);

    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return {
      stream: webStream,
      contentType: CONTENT_TYPES[format],
      contentLength: totalBytes,
      fileName: safeFileName,
    };
  } catch (error) {
    await cookieHandle?.cleanup();
    await scratch.cleanup();
    releaseSlot();
    if (error instanceof InputError) throw error;
    if (error instanceof Error && error.message === "STREAM_ABORTED") {
      throw new InputError("Download canceled.", 499);
    }
    throw new InputError(friendlyExtractorError(error), 422);
  }
}
