"use client";

const OWNER_STORAGE_KEY = "yo-owner-token";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let memoryOwnerToken: string | null = null;
const memoryFallbackStore = new Map<string, string>();

function generateUuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function safeGetStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memoryFallbackStore.get(key) ?? null;
  } catch {
    return memoryFallbackStore.get(key) ?? null;
  }
}

export function safeSetStorage(key: string, value: string): void {
  memoryFallbackStore.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Storage restricted in sandboxed/private iframe; in-memory fallback stays active. */
  }
}

export function safeRemoveStorage(key: string): void {
  memoryFallbackStore.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* Ignore storage restriction. */
  }
}

export function syncClientOwnerToken(candidate: unknown): void {
  if (typeof candidate === "string" && UUID_PATTERN.test(candidate.trim())) {
    const clean = candidate.trim();
    memoryOwnerToken = clean;
    if (typeof window !== "undefined") safeSetStorage(OWNER_STORAGE_KEY, clean);
  }
}

export function getClientOwnerToken(): string {
  if (memoryOwnerToken && UUID_PATTERN.test(memoryOwnerToken)) return memoryOwnerToken;
  const stored = typeof window !== "undefined" ? safeGetStorage(OWNER_STORAGE_KEY) : null;
  if (stored && UUID_PATTERN.test(stored)) {
    memoryOwnerToken = stored;
    return stored;
  }
  const created = generateUuidV4();
  memoryOwnerToken = created;
  if (typeof window !== "undefined") safeSetStorage(OWNER_STORAGE_KEY, created);
  return created;
}

export function withOwnerParam(url: string): string {
  const token = getClientOwnerToken();
  if (/[?&]owner=/.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}owner=${encodeURIComponent(token)}`;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getClientOwnerToken();
  headers.set("X-Yo-Owner", token);
  const response = await fetch(withOwnerParam(input), {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const serverOwner = response.headers.get("X-Yo-Owner")?.trim();
  if (serverOwner && UUID_PATTERN.test(serverOwner)) {
    memoryOwnerToken = serverOwner;
    safeSetStorage(OWNER_STORAGE_KEY, serverOwner);
  }
  return response;
}
