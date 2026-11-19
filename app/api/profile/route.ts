import { NextRequest, NextResponse } from "next/server";
import { getSessionProfile, publicProfile } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (!session) return NextResponse.json({ error: "Sign in to load your profile." }, { status: 401 });
    return NextResponse.json({ profile: session.profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (!session) return NextResponse.json({ error: "Sign in to update your profile." }, { status: 401 });
    const body = await request.json() as { avatarUrl?: string };
    const avatarUrl = String(body.avatarUrl ?? "");
    if (avatarUrl.length > 100_000 || (!avatarUrl.startsWith("pulse:") && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarUrl))) {
      return NextResponse.json({ error: "Avatar must be a preset or a compressed image under 75 KB." }, { status: 400 });
    }
    const { data: row, error } = await getSupabaseAdmin().from("profiles")
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq("id", session.profile.id)
      .select("id, username, avatar_url, balance_gbp, total_profit_gbp, wins, losses").single();
    if (error) throw new Error(`Could not save avatar: ${error.message}`);
    return NextResponse.json({ profile: publicProfile(row) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile update failed.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
