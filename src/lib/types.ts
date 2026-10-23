export const MAX_PLAYLIST_ITEMS = 200;

export type SourceKind = "playlist" | "video";
export type MediaFormat = "mp4" | "mp3" | "m4a";
export type VideoQuality = "360" | "480" | "720" | "1080";
export type AudioQuality = "128" | "192" | "320";
export type Delivery = "zip" | "individual";
export type JobStatus = "queued" | "processing" | "packaging" | "completed" | "failed" | "canceled";
export type ItemStatus = "queued" | "downloading" | "converting" | "done" | "failed" | "skipped" | "canceled";

export interface VideoEntry {
  id: string;
  selectionKey: string;
  url: string;
  position: number;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string;
  available: boolean;
  unavailableReason: string | null;
}

export interface PlaylistData {
  kind: SourceKind;
  sourceUrl: string;
  canonicalUrl: string;
  playlistId: string;
  title: string;
  channel: string;
  totalCount: number;
  totalDuration: number;
  truncated: boolean;
  entries: VideoEntry[];
}

export interface PlaylistPreview extends PlaylistData {
  previewId: string;
  fetchedAt: string;
}

export interface DownloadOptions {
  format: MediaFormat;
  quality: VideoQuality | AudioQuality;
  delivery: Delivery;
  embedMetadata: boolean;
  embedThumbnail: boolean;
}

export interface JobItemDto {
  id: string;
  videoId: string;
  position: number;
  title: string;
  duration: number | null;
  thumbnail: string;
  status: ItemStatus;
  progress: number;
  attempts: number;
  error: string | null;
  skipReason: string | null;
  fileName: string | null;
  fileSize: number | null;
  downloadUrl: string | null;
}

export interface JobDto {
  id: string;
  sourceUrl: string;
  title: string;
  channel: string;
  status: JobStatus;
  options: DownloadOptions;
  totalItems: number;
  totalDuration: number;
  zipFileName: string | null;
  zipSize: number | null;
  zipDownloadUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  items: JobItemDto[];
  summary: {
    done: number;
    failed: number;
    skipped: number;
    queued: number;
    active: number;
    canceled: number;
    selected: number;
    progress: number;
  };
}

export interface JobSummaryDto extends Omit<JobDto, "items"> {}

export const DEFAULT_OPTIONS: DownloadOptions = {
  format: "mp3",
  quality: "192",
  delivery: "zip",
  embedMetadata: true,
  embedThumbnail: true,
};

export function isMediaFormat(value: unknown): value is MediaFormat {
  return value === "mp4" || value === "mp3" || value === "m4a";
}

export function isDelivery(value: unknown): value is Delivery {
  return value === "zip" || value === "individual";
}

export function isValidQuality(format: MediaFormat, quality: unknown): quality is DownloadOptions["quality"] {
  return format === "mp4"
    ? quality === "360" || quality === "480" || quality === "720" || quality === "1080"
    : quality === "128" || quality === "192" || quality === "320";
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatLongDuration(seconds: number): string {
  if (seconds <= 0) return "Duration unavailable";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours && minutes) return `${hours} hr ${minutes} min`;
  if (hours) return `${hours} hr`;
  return `${Math.max(1, minutes)} min`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
