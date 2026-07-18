import { NextRequest, NextResponse } from "next/server";
import { getPublicProfile } from "@/server/profile";

/** §8.2 GET /api/profiles/{handle} — publicUser + paginated publicPick log. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const data = await getPublicProfile(handle);
  if (!data) {
    return NextResponse.json({ error: { code: "not_found", message: "Profile not found" } }, { status: 404 });
  }
  return NextResponse.json(data);
}
