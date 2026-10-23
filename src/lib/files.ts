import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { path as ffprobePath } from "ffprobe-static";

export const STORAGE_ROOT =
  process.env.YO_STORAGE_DIR ||
  path.join(os.tmpdir(), "yo-download-stream");

const YO_POT_PLUGIN_SOURCE = `from __future__ import annotations

import json
import os
import urllib.parse

from yt_dlp.extractor.youtube.pot.provider import (
    PoTokenContext,
    PoTokenProvider,
    PoTokenProviderError,
    PoTokenProviderRejectedRequest,
    PoTokenRequest,
    PoTokenResponse,
    register_preference,
    register_provider,
)
from yt_dlp.extractor.youtube.pot.utils import WEBPO_CLIENTS, get_webpo_content_binding
from yt_dlp.networking import Request


@register_provider
class YoBotGuardPTP(PoTokenProvider):
    PROVIDER_VERSION = '1.0.0'
    BUG_REPORT_LOCATION = 'local-yo-botguard'
    _SUPPORTED_CLIENTS = WEBPO_CLIENTS
    _SUPPORTED_CONTEXTS = (
        PoTokenContext.GVS,
        PoTokenContext.PLAYER,
        PoTokenContext.SUBS,
    )
    _SUPPORTED_EXTERNAL_REQUEST_FEATURES = None

    def is_available(self) -> bool:
        return True

    def _real_request_pot(self, request: PoTokenRequest) -> PoTokenResponse:
        content_binding, _ = get_webpo_content_binding(request, bind_to_visitor_id=True)
        if not content_binding:
            content_binding = request.video_id or request.visitor_data or 'youtube'

        port = os.environ.get('YO_POT_PORT') or os.environ.get('PORT') or '3000'
        url = f'http://127.0.0.1:{port}/api/pot?cb={urllib.parse.quote(str(content_binding))}'
        try:
            res = self._request_webpage(
                Request(url, proxies={'all': None}, extensions={'timeout': 10.0}),
                note=False,
            )
            payload = json.loads(res.read().decode('utf-8'))
            token = payload.get('poToken')
            if not token:
                raise PoTokenProviderError('Empty PO token from local BotGuard minter')
            return PoTokenResponse(po_token=token, expires_at=payload.get('expiresAt'))
        except Exception as exc:
            raise PoTokenProviderError(f'Local BotGuard minter error: {exc}') from exc


@register_preference(YoBotGuardPTP)
def yo_botguard_preference(provider, request):
    return 100
`;

export async function ensureMediaToolsDir(): Promise<string | undefined> {
  if (!ffmpegPath && !ffprobePath) return undefined;
  try {
    const toolsDir = path.join(/*turbopackIgnore: true*/ STORAGE_ROOT, "_tools");
    await mkdir(/*turbopackIgnore: true*/ toolsDir, { recursive: true });
    const ext = process.platform === "win32" ? ".exe" : "";
    if (ffmpegPath) {
      const target = path.join(/*turbopackIgnore: true*/ toolsDir, `ffmpeg${ext}`);
      const ok = await stat(/*turbopackIgnore: true*/ target).then(() => true).catch(() => false);
      if (!ok) {
        await unlink(/*turbopackIgnore: true*/ target).catch(() => undefined);
        await symlink(/*turbopackIgnore: true*/ ffmpegPath, /*turbopackIgnore: true*/ target).catch(() => undefined);
      }
    }
    if (ffprobePath) {
      const target = path.join(/*turbopackIgnore: true*/ toolsDir, `ffprobe${ext}`);
      const ok = await stat(/*turbopackIgnore: true*/ target).then(() => true).catch(() => false);
      if (!ok) {
        await unlink(/*turbopackIgnore: true*/ target).catch(() => undefined);
        await symlink(/*turbopackIgnore: true*/ ffprobePath, /*turbopackIgnore: true*/ target).catch(() => undefined);
      }
    }
    return toolsDir;
  } catch {
    return ffmpegPath || undefined;
  }
}

export async function ensureYtCacheDir(): Promise<string | undefined> {
  try {
    const cacheDir = path.join(/*turbopackIgnore: true*/ STORAGE_ROOT, "_ytcache");
    await mkdir(/*turbopackIgnore: true*/ cacheDir, { recursive: true });
    return cacheDir;
  } catch {
    return undefined;
  }
}

export async function ensureYtPotPluginDir(): Promise<string | undefined> {
  try {
    const rootDir = path.join(/*turbopackIgnore: true*/ STORAGE_ROOT, "_plugins");
    const extractorDir = path.join(/*turbopackIgnore: true*/ rootDir, "yo-pot", "yt_dlp_plugins", "extractor");
    await mkdir(/*turbopackIgnore: true*/ extractorDir, { recursive: true });
    const pluginFile = path.join(/*turbopackIgnore: true*/ extractorDir, "yo_pot.py");
    const exists = await stat(/*turbopackIgnore: true*/ pluginFile).then(() => true).catch(() => false);
    if (!exists) {
      await writeFile(/*turbopackIgnore: true*/ pluginFile, YO_POT_PLUGIN_SOURCE, "utf8");
    }
    return rootDir;
  } catch {
    return undefined;
  }
}

function decodeCookieInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.includes("\t") || trimmed.startsWith("# Netscape")) {
    return trimmed;
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.includes("\t") || decoded.includes("youtube.com")) {
      return decoded;
    }
  } catch {
    /* Not base64; ignore. */
  }
  return trimmed;
}

export async function prepareCookiesFile(clientCookies?: string | null): Promise<{ path: string; cleanup: () => Promise<void> } | null> {
  const source = clientCookies?.trim() || process.env.YOUTUBE_COOKIES?.trim() || "";
  if (!source) return null;
  const content = decodeCookieInput(source);
  if (!content || content.length > 512_000) return null;

  const dir = path.join(/*turbopackIgnore: true*/ STORAGE_ROOT, "_cookies");
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  const filePath = path.join(/*turbopackIgnore: true*/ dir, `${randomUUID()}.txt`);
  const normalized = content.startsWith("# Netscape")
    ? content
    : `# Netscape HTTP Cookie File\n${content}\n`;
  await writeFile(/*turbopackIgnore: true*/ filePath, normalized, { encoding: "utf8", mode: 0o600 });
  return {
    path: filePath,
    cleanup: () => unlink(/*turbopackIgnore: true*/ filePath).catch(() => undefined),
  };
}

export async function createIsolatedStreamDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = path.join(/*turbopackIgnore: true*/ STORAGE_ROOT, `dl-${randomUUID()}`);
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  return {
    dir,
    cleanup: () => rm(/*turbopackIgnore: true*/ dir, { recursive: true, force: true }).catch(() => undefined),
  };
}

export function sanitizeFilename(input: string): string {
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

export function orderedFileName(position: number, title: string, extension: string, totalCount: number): string {
  const width = Math.max(2, String(Math.max(totalCount, 1)).length);
  return `${String(position).padStart(width, "0")} - ${sanitizeFilename(title)}.${extension}`;
}

export async function findOutputFile(directory: string, baseName: string, extension: string): Promise<string | null> {
  const files = await readdir(/*turbopackIgnore: true*/ directory);
  const expected = `${baseName}.${extension}`.toLowerCase();
  const match =
    files.find((file) => file.toLowerCase() === expected) ??
    files.find((file) => file.startsWith(`${baseName}.`) && file.toLowerCase().endsWith(`.${extension}`)) ??
    files.find((file) => file.toLowerCase().endsWith(`.${extension}`));
  return match ? path.join(/*turbopackIgnore: true*/ directory, match) : null;
}

export async function fileSize(filePath: string): Promise<number> {
  return (await stat(/*turbopackIgnore: true*/ filePath)).size;
}
