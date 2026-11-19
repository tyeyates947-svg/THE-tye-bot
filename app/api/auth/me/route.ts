import { NextRequest, NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (!session) return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
    return NextResponse.json({ profile: session.profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
