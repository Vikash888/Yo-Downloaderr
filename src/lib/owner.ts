import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const OWNER_COOKIE = "yo_guest";
export const OWNER_HEADER = "x-yo-owner";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string | null | undefined): value is string {
  return Boolean(value && ANY_UUID_PATTERN.test(value.trim()));
}

function isOwnerUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value.trim()));
}

function downloadSecret(): string {
  return process.env.YO_DOWNLOAD_SECRET || process.env.DATABASE_URL || "yo-download-local-secret";
}

export function signDownloadToken(jobId: string, ownerToken: string): string {
  return createHmac("sha256", downloadSecret())
    .update(`${jobId}:${ownerToken}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyDownloadToken(jobId: string, ownerToken: string, candidate: string | null | undefined): boolean {
  if (!candidate || !/^[0-9a-f]{32}$/i.test(candidate)) return false;
  const expected = Buffer.from(signDownloadToken(jobId, ownerToken), "utf8");
  const actual = Buffer.from(candidate.toLowerCase(), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function getOwner(request: NextRequest): { token: string; isNew: boolean; isHttps: boolean; cookieMatches: boolean } {
  const queryToken = request.nextUrl.searchParams.get("owner")?.trim();
  const headerToken = request.headers.get(OWNER_HEADER)?.trim();
  const cookieToken = request.cookies.get(OWNER_COOKIE)?.value?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const isHttps = forwardedProto === "https" || request.nextUrl.protocol === "https:";

  if (isOwnerUuid(queryToken)) {
    return { token: queryToken, isNew: false, isHttps, cookieMatches: cookieToken === queryToken };
  }
  if (isOwnerUuid(headerToken)) {
    return { token: headerToken, isNew: false, isHttps, cookieMatches: cookieToken === headerToken };
  }
  if (isOwnerUuid(cookieToken)) {
    return { token: cookieToken, isNew: false, isHttps, cookieMatches: true };
  }
  return { token: randomUUID(), isNew: true, isHttps, cookieMatches: false };
}

export type OwnerContext = ReturnType<typeof getOwner>;

export function attachOwnerCookie(response: NextResponse, owner: OwnerContext): NextResponse {
  response.headers.set("X-Yo-Owner", owner.token);
  if (owner.isNew || !owner.cookieMatches) {
    response.cookies.set(OWNER_COOKIE, owner.token, {
      httpOnly: true,
      sameSite: owner.isHttps ? "none" : "lax",
      secure: owner.isHttps,
      ...(owner.isHttps ? { partitioned: true } : {}),
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}

export function jsonWithOwner(owner: OwnerContext, body: unknown, init?: ResponseInit): NextResponse {
  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), ownerToken: owner.token }
    : body;
  const response = NextResponse.json(payload, init);
  return attachOwnerCookie(response, owner);
}
