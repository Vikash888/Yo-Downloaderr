"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileAudio,
  FileVideo,
  Info,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SkipForward,
  SlidersHorizontal,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDirectStreamUrl,
  buildOrderedClientFilename,
  fetchVideoBlobWithProgress,
  packageBlobsIntoZip,
  sanitizeClientFilename,
  triggerBlobDownload,
} from "@/lib/browser-downloader";
import { safeGetStorage, safeSetStorage } from "@/lib/client-owner";
import { saveLocalHistoryEntry } from "@/lib/history-store";
import type { DownloadOptions, ItemStatus, MediaFormat, PlaylistPreview, VideoEntry } from "@/lib/types";
import { formatBytes, formatDuration, formatLongDuration } from "@/lib/types";

const PAGE_SIZE = 12;
const VIDEO_QUALITIES = ["360", "480", "720", "1080"] as const;
const AUDIO_QUALITIES = ["128", "192", "320"] as const;
const COOKIES_STORAGE_KEY = "yo-user-cookies";
const PROXY_STORAGE_KEY = "yo-user-proxy";

interface RowDownloadState {
  status: ItemStatus;
  progress: number;
  loadedBytes: number;
  totalBytes: number | null;
  fileName: string | null;
  blobUrl: string | null;
  blob: Blob | null;
  error: string | null;
}

export function PlaylistWorkspace({
  preview,
  selected,
  onSelectedChange,
  options,
  onOptionsChange,
  onBack,
  onToast,
}: {
  preview: PlaylistPreview;
  selected: Set<string>;
  onSelectedChange: (selected: Set<string>) => void;
  options: DownloadOptions;
  onOptionsChange: (options: DownloadOptions) => void;
  onBack: () => void;
  onToast: (msg: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filterView, setFilterView] = useState<"all" | "ready" | "failed">("all");
  const [rightsConfirmed, setRightsConfirmed] = useState(true);
  const [needsRightsAttention, setNeedsRightsAttention] = useState(false);
  const [showCloudBypass, setShowCloudBypass] = useState(false);
  const [userCookies, setUserCookies] = useState("");
  const [userProxy, setUserProxy] = useState("");

  const [batchRunning, setBatchRunning] = useState(false);
  const [packagingZip, setPackagingZip] = useState(false);
  const [zipReadyUrl, setZipReadyUrl] = useState<string | null>(null);
  const [zipReadyName, setZipReadyName] = useState<string | null>(null);
  const [zipReadyBytes, setZipReadyBytes] = useState<number | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowDownloadState>>({});
  const [singleBusyKey, setSingleBusyKey] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    setUserCookies(safeGetStorage(COOKIES_STORAGE_KEY) || "");
    setUserProxy(safeGetStorage(PROXY_STORAGE_KEY) || "");
    return () => {
      abortRef.current?.abort();
      for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
    };
  }, []);

  // Initialize skipped status for unavailable videos when preview loads
  useEffect(() => {
    const initial: Record<string, RowDownloadState> = {};
    for (const entry of preview.entries) {
      if (!entry.available) {
        initial[entry.selectionKey] = {
          status: "skipped",
          progress: 0,
          loadedBytes: 0,
          totalBytes: null,
          fileName: null,
          blobUrl: null,
          blob: null,
          error: entry.unavailableReason || "Unavailable video.",
        };
      }
    }
    setRowStates(initial);
    setZipReadyUrl(null);
    setZipReadyName(null);
    setZipReadyBytes(null);
  }, [preview.previewId, preview.entries]);

  const saveBypassSettings = (nextCookies: string, nextProxy: string) => {
    setUserCookies(nextCookies);
    setUserProxy(nextProxy);
    safeSetStorage(COOKIES_STORAGE_KEY, nextCookies);
    safeSetStorage(PROXY_STORAGE_KEY, nextProxy);
  };

  const available = useMemo(() => preview.entries.filter((entry) => entry.available), [preview.entries]);
  const selectedEntries = useMemo(
    () => available.filter((entry) => selected.has(entry.selectionKey)),
    [available, selected],
  );
  const selectedDuration = selectedEntries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0);
  const unavailableCount = preview.entries.length - available.length;

  const summary = useMemo(() => {
    let done = 0;
    let failed = 0;
    let skipped = 0;
    let active = 0;
    let queued = 0;
    let progressSum = 0;
    let trackedCount = 0;

    for (const entry of preview.entries) {
      const st = rowStates[entry.selectionKey];
      if (!st) continue;
      if (st.status === "skipped") {
        skipped += 1;
        continue;
      }
      trackedCount += 1;
      if (st.status === "done") {
        done += 1;
        progressSum += 100;
      } else if (st.status === "failed") {
        failed += 1;
        progressSum += 100;
      } else if (st.status === "canceled") {
        progressSum += 100;
      } else if (st.status === "downloading" || st.status === "converting") {
        active += 1;
        progressSum += st.progress;
      } else if (st.status === "queued") {
        queued += 1;
      }
    }

    const overallProgress = trackedCount > 0 ? Math.min(100, Math.round(progressSum / trackedCount)) : 0;
    return { done, failed, skipped, active, queued, trackedCount, overallProgress };
  }, [preview.entries, rowStates]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return preview.entries.filter((entry) => {
      if (query && !`${entry.title} ${entry.channel}`.toLowerCase().includes(query)) return false;
      const st = rowStates[entry.selectionKey];
      if (filterView === "ready") return st?.status === "done";
      if (filterView === "failed") return st?.status === "failed" || st?.status === "skipped";
      return true;
    });
  }, [preview.entries, search, filterView, rowStates]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [search, filterView]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedChange(next);
  };

  const setFormat = (format: MediaFormat) => {
    const quality =
      format === "mp4"
        ? VIDEO_QUALITIES.includes(options.quality as (typeof VIDEO_QUALITIES)[number])
          ? options.quality
          : "720"
        : AUDIO_QUALITIES.includes(options.quality as (typeof AUDIO_QUALITIES)[number])
          ? options.quality
          : "192";
    onOptionsChange({ ...options, format, quality });
  };

  const updateRow = (key: string, patch: Partial<RowDownloadState>) => {
    setRowStates((prev) => {
      const base: RowDownloadState = prev[key] ?? {
        status: "queued",
        progress: 0,
        loadedBytes: 0,
        totalBytes: null,
        fileName: null,
        blobUrl: null,
        blob: null,
        error: null,
      };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  };

  // Snaptube-style instant 1-click download for ANY single video row!
  const downloadSingleEntry = async (entry: VideoEntry, overrideFormat?: MediaFormat, overrideQuality?: string) => {
    if (!entry.available || batchRunning) return;
    if (!rightsConfirmed) {
      setNeedsRightsAttention(true);
      onToast("Please confirm download rights in the panel first.");
      return;
    }

    const fmt = overrideFormat ?? options.format;
    const qual = (overrideQuality ??
      (fmt === "mp4"
        ? options.format === "mp4"
          ? options.quality
          : "720"
        : options.format !== "mp4"
          ? options.quality
          : "192")) as DownloadOptions["quality"];

    const itemOptions: DownloadOptions = {
      ...options,
      format: fmt,
      quality: qual,
      delivery: "individual",
    };

    const fileName = buildOrderedClientFilename(entry.position, entry.title, fmt, preview.entries.length);
    const controller = new AbortController();
    abortRef.current = controller;
    setSingleBusyKey(entry.selectionKey);
    updateRow(entry.selectionKey, {
      status: "downloading",
      progress: 8,
      loadedBytes: 0,
      totalBytes: null,
      fileName,
      error: null,
    });

    try {
      let finalBlob: Blob | null = null;
      let lastErr: unknown = null;

      // Automatic up to 2 retries on transient network hiccup
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          finalBlob = await fetchVideoBlobWithProgress({
            videoId: entry.id,
            fileName,
            durationSec: entry.duration,
            options: itemOptions,
            cookies: userCookies,
            proxy: userProxy,
            signal: controller.signal,
            onProgress: ({ percent, loadedBytes, totalBytes }) => {
              updateRow(entry.selectionKey, {
                status: percent >= 96 ? "converting" : "downloading",
                progress: percent,
                loadedBytes,
                totalBytes,
              });
            },
          });
          break;
        } catch (err) {
          if (controller.signal.aborted) throw err;
          lastErr = err;
        }
      }

      if (!finalBlob) throw lastErr ?? new Error("Couldn't download this video.");

      const objUrl = triggerBlobDownload(finalBlob, fileName);
      objectUrlsRef.current.push(objUrl);
      updateRow(entry.selectionKey, {
        status: "done",
        progress: 100,
        loadedBytes: finalBlob.size,
        totalBytes: finalBlob.size,
        fileName,
        blobUrl: objUrl,
        blob: finalBlob,
        error: null,
      });
      onToast(`Saved ${fileName}`);
    } catch (err) {
      if (controller.signal.aborted) {
        updateRow(entry.selectionKey, { status: "canceled", progress: 0, error: "Canceled." });
      } else {
        updateRow(entry.selectionKey, {
          status: "failed",
          progress: 0,
          error: err instanceof Error ? err.message : "Couldn't download this video. Tap Retry.",
        });
      }
    } finally {
      setSingleBusyKey(null);
    }
  };

  // Batch download selected playlist items (or retry only failed items!)
  const runBatchDownload = async (entriesToRun: VideoEntry[], keepExistingBlobs = false) => {
    if (!entriesToRun.length || batchRunning) return;
    if (!rightsConfirmed) {
      setNeedsRightsAttention(true);
      return;
    }
    setNeedsRightsAttention(false);

    const controller = new AbortController();
    abortRef.current = controller;
    setBatchRunning(true);
    setPackagingZip(false);
    setZipReadyUrl(null);

    // Mark target items as queued
    setRowStates((prev) => {
      const next = { ...prev };
      for (const entry of entriesToRun) {
        next[entry.selectionKey] = {
          status: "queued",
          progress: 0,
          loadedBytes: 0,
          totalBytes: null,
          fileName: buildOrderedClientFilename(entry.position, entry.title, options.format, preview.entries.length),
          blobUrl: null,
          blob: null,
          error: null,
        };
      }
      return next;
    });

    const collectedForZip: Array<{ position: number; name: string; blob: Blob }> = [];
    if (keepExistingBlobs && options.delivery === "zip") {
      for (const entry of selectedEntries) {
        const existing = rowStates[entry.selectionKey];
        if (existing?.status === "done" && existing.blob && existing.fileName) {
          collectedForZip.push({ position: entry.position, name: existing.fileName, blob: existing.blob });
        }
      }
    }

    let doneCount = collectedForZip.length;
    let failedCount = 0;

    // Sort shorter items first for instant feedback while keeping original 01..NN filenames!
    const orderedQueue = [...entriesToRun].sort((a, b) => {
      const da = a.duration ?? Number.MAX_SAFE_INTEGER;
      const dbDur = b.duration ?? Number.MAX_SAFE_INTEGER;
      return da !== dbDur ? da - dbDur : a.position - b.position;
    });

    for (const entry of orderedQueue) {
      if (controller.signal.aborted) break;
      const fileName = buildOrderedClientFilename(entry.position, entry.title, options.format, preview.entries.length);
      updateRow(entry.selectionKey, {
        status: "downloading",
        progress: 6,
        loadedBytes: 0,
        totalBytes: null,
        fileName,
        error: null,
      });

      try {
        let blob: Blob | null = null;
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          if (controller.signal.aborted) break;
          try {
            blob = await fetchVideoBlobWithProgress({
              videoId: entry.id,
              fileName,
              durationSec: entry.duration,
              options,
              cookies: userCookies,
              proxy: userProxy,
              signal: controller.signal,
              onProgress: ({ percent, loadedBytes, totalBytes }) => {
                updateRow(entry.selectionKey, {
                  status: percent >= 96 ? "converting" : "downloading",
                  progress: percent,
                  loadedBytes,
                  totalBytes,
                });
              },
            });
            break;
          } catch (err) {
            if (controller.signal.aborted) throw err;
            lastErr = err;
            if (attempt < 2) {
              updateRow(entry.selectionKey, {
                status: "queued",
                progress: 0,
                error: "Retrying automatically…",
              });
              await new Promise((r) => setTimeout(r, 900));
            }
          }
        }

        if (!blob) throw lastErr ?? new Error("Couldn't download this video. Tap Retry.");

        const itemUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.push(itemUrl);

        if (options.delivery === "individual") {
          const anchor = document.createElement("a");
          anchor.href = itemUrl;
          anchor.download = fileName;
          anchor.style.display = "none";
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
        } else {
          collectedForZip.push({ position: entry.position, name: fileName, blob });
        }

        doneCount += 1;
        updateRow(entry.selectionKey, {
          status: "done",
          progress: 100,
          loadedBytes: blob.size,
          totalBytes: blob.size,
          fileName,
          blobUrl: itemUrl,
          blob: options.delivery === "zip" ? blob : null,
          error: null,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          updateRow(entry.selectionKey, { status: "canceled", progress: 0, error: "Canceled by you." });
          break;
        }
        failedCount += 1;
        updateRow(entry.selectionKey, {
          status: "failed",
          progress: 0,
          error: err instanceof Error ? err.message : "Couldn't download this video. Tap Retry.",
        });
      }
    }

    if (controller.signal.aborted) {
      setRowStates((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(next)) {
          if (v.status === "queued" || v.status === "downloading" || v.status === "converting") {
            next[k] = { ...v, status: "canceled", progress: 0, error: "Canceled by you." };
          }
        }
        return next;
      });
    } else if (options.delivery === "zip" && collectedForZip.length > 0) {
      setPackagingZip(true);
      try {
        collectedForZip.sort((a, b) => a.position - b.position);
        const zipBlob = await packageBlobsIntoZip(
          collectedForZip.map(({ name, blob }) => ({ name, blob })),
        );
        const zipFileName = `${sanitizeClientFilename(preview.title)}.zip`;
        const zUrl = triggerBlobDownload(zipBlob, zipFileName);
        objectUrlsRef.current.push(zUrl);
        setZipReadyUrl(zUrl);
        setZipReadyName(zipFileName);
        setZipReadyBytes(zipBlob.size);
        onToast(`Downloaded ${zipFileName} (${collectedForZip.length} files)!`);
      } catch {
        onToast("ZIP packaging hit a browser memory limit — click Save on each ready item below.");
      } finally {
        setPackagingZip(false);
      }
    } else if (doneCount > 0 && options.delivery === "individual") {
      onToast(`Finished downloading ${doneCount} ${doneCount === 1 ? "file" : "files"}!`);
    }

    saveLocalHistoryEntry({
      id: preview.previewId,
      sourceUrl: preview.canonicalUrl,
      title: preview.title,
      channel: preview.channel,
      options,
      totalSelected: selectedEntries.length,
      done: doneCount,
      failed: failedCount,
      skipped: unavailableCount,
      status: controller.signal.aborted
        ? "canceled"
        : doneCount > 0 && failedCount === 0
          ? "completed"
          : doneCount > 0
            ? "partial"
            : "failed",
      createdAt: new Date().toISOString(),
    });

    setBatchRunning(false);
  };

  const cancelBatch = () => {
    abortRef.current?.abort();
    onToast("Download canceled. Completed files remain ready to save below.");
  };

  const failedEntries = useMemo(
    () => available.filter((entry) => rowStates[entry.selectionKey]?.status === "failed"),
    [available, rowStates],
  );

  const estimatedAudioBytes =
    options.format !== "mp4" ? Math.round((selectedDuration * Number(options.quality) * 1000) / 8) : null;

  return (
    <motion.section
      className="workspace section-shell"
      id="workspace"
      aria-labelledby="playlist-title"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
    >
      <div className="workspace-topline">
        <button className="text-button" type="button" onClick={onBack} disabled={batchRunning}>
          <ArrowLeft size={16} /> New link
        </button>
        <span className="secure-note">
          <span className="live-dot" /> Auto Anti-Bot Active · Direct Stream Engine
        </span>
      </div>

      <div className="playlist-heading">
        <div className="playlist-collage" aria-hidden="true">
          {preview.entries
            .slice(0, 3)
            .map(
              (entry, index) =>
                entry.thumbnail && (
                  <img
                    key={entry.selectionKey}
                    src={entry.thumbnail}
                    alt=""
                    style={{ "--i": index } as React.CSSProperties}
                  />
                ),
            )}
          {!preview.entries.some((entry) => entry.thumbnail) && <FileVideo size={34} />}
        </div>
        <div className="playlist-heading-copy">
          <p className="eyebrow">{preview.kind === "video" ? "Single video ready" : "Playlist ready"}</p>
          <h2 id="playlist-title">{preview.title}</h2>
          <p>
            {preview.channel}
            <span>·</span>
            {preview.totalCount} {preview.totalCount === 1 ? "video" : "videos"}
            <span>·</span>
            {formatLongDuration(preview.totalDuration)}
          </p>
        </div>
      </div>

      {/* Live Progress / Result Banner whenever downloads start or complete */}
      {(batchRunning || packagingZip || summary.done > 0 || summary.failed > 0) && (
        <motion.div
          className="snaptube-progress-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="snaptube-progress-top">
            <div>
              <span className="eyebrow" style={{ marginBottom: 6, display: "block" }}>
                {packagingZip
                  ? "Building ZIP archive in your browser…"
                  : batchRunning
                    ? `Downloading ${summary.done + 1 <= summary.trackedCount ? summary.done + 1 : summary.done} of ${summary.trackedCount}`
                    : "Download summary"}
              </span>
              <strong>
                {summary.done} done · {summary.failed} failed · {summary.skipped} skipped
              </strong>
            </div>
            <div className="snaptube-progress-actions">
              {zipReadyUrl && zipReadyName && (
                <a className="primary-action" href={zipReadyUrl} download={zipReadyName} style={{ minHeight: 42, padding: "0 16px" }}>
                  <Archive size={17} />
                  <span>Save ZIP ({formatBytes(zipReadyBytes)})</span>
                </a>
              )}
              {!batchRunning && failedEntries.length > 0 && (
                <button
                  type="button"
                  className="secondary-action"
                  style={{ minHeight: 42, padding: "0 14px" }}
                  onClick={() => void runBatchDownload(failedEntries, true)}
                >
                  <RotateCcw size={16} /> Retry {failedEntries.length} failed
                </button>
              )}
              {batchRunning && (
                <button type="button" className="cancel-button" onClick={cancelBatch}>
                  <Square size={14} /> Cancel
                </button>
              )}
            </div>
          </div>
          <div
            className="overall-progress"
            style={{ marginTop: 14 }}
            role="progressbar"
            aria-label="Overall playlist download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.overallProgress}
          >
            <motion.span animate={{ width: `${summary.overallProgress}%` }} transition={{ duration: 0.3 }} />
          </div>
        </motion.div>
      )}

      {preview.truncated && (
        <div className="notice warning" role="status">
          <Info size={19} />
          <p>
            <strong>This playlist has more videos than the limit.</strong> Showing the first {preview.entries.length} videos (up to 200 per batch).
          </p>
        </div>
      )}
      {unavailableCount > 0 && (
        <div className="notice">
          <Info size={19} />
          <p>
            <strong>
              {unavailableCount} {unavailableCount === 1 ? "video is" : "videos are"} unavailable and automatically skipped.
            </strong>{" "}
            Everything else downloads normally.
          </p>
        </div>
      )}

      <div className="workspace-grid">
        <div className="video-browser">
          <div className="selection-toolbar">
            <div>
              <strong>{selected.size} selected</strong>
              <span> of {available.length} available · Click MP3/MP4 on any row for instant 1-click save</span>
            </div>
            <div className="selection-actions">
              <button
                type="button"
                onClick={() => onSelectedChange(new Set(available.map((entry) => entry.selectionKey)))}
                disabled={batchRunning || selected.size === available.length}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => onSelectedChange(new Set())}
                disabled={batchRunning || selected.size === 0}
              >
                Deselect all
              </button>
            </div>
          </div>

          <div className="snaptube-filter-bar">
            <label className="video-search" style={{ margin: 0, flex: 1 }}>
              <Search size={17} />
              <span className="sr-only">Filter videos</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title or channel…"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
                  <X size={15} />
                </button>
              )}
            </label>
            <div className="job-filter" style={{ margin: 0 }} role="group" aria-label="Filter items by status">
              <button type="button" className={filterView === "all" ? "active" : ""} onClick={() => setFilterView("all")}>
                All <span>{preview.entries.length}</span>
              </button>
              <button type="button" className={filterView === "ready" ? "active" : ""} onClick={() => setFilterView("ready")}>
                Done <span>{summary.done}</span>
              </button>
              <button type="button" className={filterView === "failed" ? "active" : ""} onClick={() => setFilterView("failed")}>
                Issues <span>{summary.failed + summary.skipped}</span>
              </button>
            </div>
          </div>

          <div className="video-list" aria-label="Playlist videos">
            <AnimatePresence mode="popLayout" initial={false}>
              {visible.map((entry) => {
                const st = rowStates[entry.selectionKey];
                const isRowActive = st?.status === "downloading" || st?.status === "converting";
                const directHref = entry.available
                  ? buildDirectStreamUrl({
                      videoId: entry.id,
                      format: options.format,
                      quality: options.quality,
                      fileName: buildOrderedClientFilename(entry.position, entry.title, options.format, preview.entries.length),
                      durationSec: entry.duration,
                      embedMetadata: options.embedMetadata,
                      embedThumbnail: options.embedThumbnail,
                    })
                  : null;

                return (
                  <motion.article
                    layout
                    key={entry.selectionKey}
                    className={`video-row snaptube-row ${!entry.available ? "unavailable" : ""}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <label className="video-check">
                      <input
                        type="checkbox"
                        checked={selected.has(entry.selectionKey)}
                        disabled={!entry.available || batchRunning}
                        onChange={() => toggle(entry.selectionKey)}
                        aria-label={`${selected.has(entry.selectionKey) ? "Deselect" : "Select"} ${entry.title}`}
                      />
                      <span aria-hidden="true">{selected.has(entry.selectionKey) && <Check size={14} />}</span>
                    </label>

                    <span className="video-position">{String(entry.position).padStart(2, "0")}</span>

                    <div className="video-thumb">
                      {entry.thumbnail ? <img src={entry.thumbnail} alt="" loading="lazy" /> : <FileVideo size={24} />}
                      <span>{formatDuration(entry.duration)}</span>
                    </div>

                    <div className="video-copy">
                      <h3>{entry.title}</h3>
                      <p>
                        {!entry.available ? (
                          <>
                            <b>Skipped</b> · {entry.unavailableReason}
                          </>
                        ) : st?.error ? (
                          <span style={{ color: "var(--danger)" }}>{st.error}</span>
                        ) : st?.status === "done" ? (
                          <span style={{ color: "var(--accent)" }}>
                            Ready · {formatBytes(st.loadedBytes)} · {st.fileName}
                          </span>
                        ) : isRowActive ? (
                          <span style={{ color: "var(--accent)" }}>
                            {st.status === "converting" ? "Finalizing file…" : "Downloading…"}{" "}
                            {st.loadedBytes > 0 ? `(${formatBytes(st.loadedBytes)})` : ""}
                          </span>
                        ) : (
                          entry.channel
                        )}
                      </p>
                      {isRowActive && (
                        <div className="item-progress" style={{ marginTop: 8 }}>
                          <motion.span animate={{ width: `${st.progress}%` }} />
                        </div>
                      )}
                    </div>

                    {/* Snaptube 1-Click Per-Item Action Buttons */}
                    <div className="snaptube-row-actions">
                      {!entry.available ? (
                        <span className="status-label skipped">
                          <SkipForward size={13} /> Skipped
                        </span>
                      ) : isRowActive ? (
                        <span className="status-label downloading">
                          <LoaderCircle className="spin" size={14} /> {st.progress}%
                        </span>
                      ) : st?.status === "done" && st.blobUrl ? (
                        <a
                          className="item-download"
                          href={st.blobUrl}
                          download={st.fileName ?? true}
                          title="Save this file again"
                        >
                          <CheckCheck size={15} />
                          <span>Save</span>
                        </a>
                      ) : st?.status === "failed" ? (
                        <button
                          type="button"
                          className="item-retry"
                          disabled={batchRunning || singleBusyKey !== null}
                          onClick={() => void downloadSingleEntry(entry)}
                        >
                          <RefreshCw size={14} /> Retry
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="snaptube-chip"
                            disabled={batchRunning || singleBusyKey !== null}
                            onClick={() => void downloadSingleEntry(entry, "mp3", options.format !== "mp4" ? options.quality : "192")}
                            title="Instant 1-click MP3 download"
                          >
                            <FileAudio size={13} /> MP3
                          </button>
                          <button
                            type="button"
                            className="snaptube-chip accent"
                            disabled={batchRunning || singleBusyKey !== null}
                            onClick={() => void downloadSingleEntry(entry, "mp4", options.format === "mp4" ? options.quality : "720")}
                            title="Instant 1-click MP4 download"
                          >
                            <ArrowDownToLine size={13} /> MP4
                          </button>
                          {directHref && !userCookies.trim() && !userProxy.trim() && (
                            <a
                              className="snaptube-ext-link"
                              href={directHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open direct download stream in new tab"
                              aria-label={`Open direct stream for ${entry.title}`}
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                        </>
                      )}
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>

            {!visible.length && (
              <div className="empty-filter">
                <Search size={25} />
                <p>No videos match the current filter.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setFilterView("all");
                  }}
                >
                  Show all videos
                </button>
              </div>
            )}
          </div>

          {pageCount > 1 && (
            <div className="pagination">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page === 1}
                aria-label="Previous page"
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                Page <b>{page}</b> of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                disabled={page === pageCount}
                aria-label="Next page"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>

        {/* Sticky Snaptube Format & 1-Click Batch Panel */}
        <aside className="options-panel" aria-label="Download options">
          <div className="options-heading">
            <span>
              <Zap size={15} style={{ display: "inline", verticalAlign: "-2px", color: "var(--accent)", marginRight: 6 }} />
              Quick Download Setup
            </span>
            <small>Saved automatically</small>
          </div>

          <fieldset className="option-group" disabled={batchRunning}>
            <legend>Format</legend>
            <div className="format-tabs">
              <button
                type="button"
                className={options.format === "mp4" ? "active" : ""}
                onClick={() => setFormat("mp4")}
                aria-pressed={options.format === "mp4"}
              >
                <FileVideo size={17} />
                Video <b>MP4</b>
              </button>
              <button
                type="button"
                className={options.format === "mp3" ? "active" : ""}
                onClick={() => setFormat("mp3")}
                aria-pressed={options.format === "mp3"}
              >
                <FileAudio size={17} />
                Audio <b>MP3</b>
              </button>
              <button
                type="button"
                className={options.format === "m4a" ? "active" : ""}
                onClick={() => setFormat("m4a")}
                aria-pressed={options.format === "m4a"}
              >
                <FileAudio size={17} />
                Audio <b>M4A</b>
              </button>
            </div>
          </fieldset>

          <fieldset className="option-group" disabled={batchRunning}>
            <legend>
              Quality <span>{options.format === "mp4" ? "best available fallback" : "audio bitrate"}</span>
            </legend>
            <div className="quality-options">
              {(options.format === "mp4" ? VIDEO_QUALITIES : AUDIO_QUALITIES).map((quality) => (
                <button
                  type="button"
                  key={quality}
                  className={options.quality === quality ? "active" : ""}
                  onClick={() => onOptionsChange({ ...options, quality })}
                  aria-pressed={options.quality === quality}
                >
                  {quality}
                  <small>{options.format === "mp4" ? "p" : "k"}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="option-group" disabled={batchRunning}>
            <legend>Save Mode</legend>
            <div className="delivery-options">
              <label className={options.delivery === "individual" ? "active" : ""}>
                <input
                  type="radio"
                  name="delivery"
                  checked={options.delivery === "individual"}
                  onChange={() => onOptionsChange({ ...options, delivery: "individual" })}
                />
                <ArrowDownToLine size={18} />
                <span>
                  <b>Direct files</b>
                  <small>Saves each immediately (best for cloud)</small>
                </span>
              </label>
              <label className={options.delivery === "zip" ? "active" : ""}>
                <input
                  type="radio"
                  name="delivery"
                  checked={options.delivery === "zip"}
                  onChange={() => onOptionsChange({ ...options, delivery: "zip" })}
                />
                <Archive size={18} />
                <span>
                  <b>Single ZIP</b>
                  <small>01 - Title.{options.format} archive</small>
                </span>
              </label>
            </div>
          </fieldset>

          {options.format !== "mp4" && (
            <div className="audio-extras">
              <Toggle
                checked={options.embedMetadata}
                onChange={(checked) => onOptionsChange({ ...options, embedMetadata: checked })}
                label="Embed metadata"
                detail="Artist & title tags"
              />
              <Toggle
                checked={options.embedThumbnail}
                onChange={(checked) => onOptionsChange({ ...options, embedThumbnail: checked })}
                label="Cover art thumbnail"
                detail="Embedded in audio file"
              />
            </div>
          )}

          {/* Optional Cloud / Render Anti-Bot Helper */}
          <div className="cloud-bypass-box">
            <button
              type="button"
              className="cloud-bypass-toggle"
              onClick={() => setShowCloudBypass((v) => !v)}
              aria-expanded={showCloudBypass}
            >
              <span>
                <SlidersHorizontal size={13} /> Cloud / Render Anti-Bot {userCookies.trim() ? "(Cookies set)" : "(Auto PO-Token)"}
              </span>
              <ChevronDown size={15} style={{ transform: showCloudBypass ? "rotate(180deg)" : "none", transition: "0.2s" }} />
            </button>
            {showCloudBypass && (
              <div className="cloud-bypass-body">
                <p>
                  Built-in <b>BotGuard PO-Token + Pure-Node InnerTube</b> runs automatically. If a shared Free Render IP is still login-challenged by YouTube, paste optional Netscape <code>cookies.txt</code> below (kept only in your browser):
                </p>
                <textarea
                  rows={3}
                  value={userCookies}
                  onChange={(e) => saveBypassSettings(e.target.value, userProxy)}
                  placeholder="# Optional: paste Netscape YouTube cookies.txt here…"
                />
                <input
                  type="text"
                  value={userProxy}
                  onChange={(e) => saveBypassSettings(userCookies, e.target.value)}
                  placeholder="Optional proxy URL (e.g. http://user:pass@host:port)"
                />
              </div>
            )}
          </div>

          <div className="output-estimate">
            <span>
              {selected.size} {selected.size === 1 ? "file" : "files"} · {formatLongDuration(selectedDuration)}
            </span>
            <strong>{estimatedAudioBytes !== null ? `≈ ${formatBytes(estimatedAudioBytes)}` : "Streamed directly"}</strong>
          </div>

          <label className={`rights-check ${needsRightsAttention && !rightsConfirmed ? "attention" : ""}`}>
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => {
                setRightsConfirmed(event.target.checked);
                if (event.target.checked) setNeedsRightsAttention(false);
              }}
            />
            <span className="rights-box">{rightsConfirmed && <Check size={14} />}</span>
            <span>
              <b>I have the right to download these videos.</b>
              <small>Personal backup, permitted content, or Creative Commons.</small>
            </span>
          </label>

          {needsRightsAttention && !rightsConfirmed && (
            <p className="start-error" role="alert">
              Check the rights confirmation box above to download.
            </p>
          )}

          {batchRunning ? (
            <button className="secondary-action" type="button" onClick={cancelBatch} style={{ width: "100%" }}>
              <Square size={17} />
              <span>Cancel active download ({summary.overallProgress}%)</span>
            </button>
          ) : (
            <button
              className="primary-action"
              type="button"
              disabled={!selectedEntries.length || singleBusyKey !== null || packagingZip}
              onClick={() => void runBatchDownload(selectedEntries, false)}
            >
              {packagingZip ? (
                <LoaderCircle className="spin" size={20} />
              ) : options.delivery === "zip" ? (
                <Archive size={20} />
              ) : (
                <ArrowDownToLine size={20} />
              )}
              <span>
                {packagingZip
                  ? "Packaging ZIP…"
                  : options.delivery === "zip"
                    ? `Download All as ZIP · ${selectedEntries.length}`
                    : `Download All (${options.format.toUpperCase()}) · ${selectedEntries.length}`}
              </span>
            </button>
          )}

          <p className="options-footnote">
            <ShieldCheck size={13} /> Zero server disk storage · Works on localhost &amp; Free Render.
          </p>
        </aside>
      </div>
    </motion.section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  detail: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <b>{label}</b>
        <small>{detail}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true">
        <span />
      </i>
    </label>
  );
}
