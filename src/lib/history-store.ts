"use client";

import { safeGetStorage, safeSetStorage } from "@/lib/client-owner";
import type { DownloadOptions } from "@/lib/types";

export interface LocalHistoryEntry {
  id: string;
  sourceUrl: string;
  title: string;
  channel: string;
  options: DownloadOptions;
  totalSelected: number;
  done: number;
  failed: number;
  skipped: number;
  status: "completed" | "partial" | "failed" | "canceled";
  createdAt: string;
}

const HISTORY_KEY = "yo-history-v2";

export function readLocalHistory(): LocalHistoryEntry[] {
  const raw = safeGetStorage(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is LocalHistoryEntry => Boolean(item && typeof item.id === "string" && typeof item.title === "string"));
  } catch {
    return [];
  }
}

export function saveLocalHistoryEntry(entry: LocalHistoryEntry): void {
  const existing = readLocalHistory().filter((item) => item.id !== entry.id);
  const updated = [entry, ...existing].slice(0, 30);
  safeSetStorage(HISTORY_KEY, JSON.stringify(updated));
}

export function clearLocalHistory(): void {
  safeSetStorage(HISTORY_KEY, "[]");
}
