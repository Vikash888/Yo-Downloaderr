import { NextRequest, NextResponse } from "next/server";
import { mintPoTokenForBinding } from "@/lib/pot-minter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const contentBinding = request.nextUrl.searchParams.get("cb") || "youtube";
  const { poToken, expiresAt } = await mintPoTokenForBinding(contentBinding);
  return NextResponse.json(
    { poToken, expiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
