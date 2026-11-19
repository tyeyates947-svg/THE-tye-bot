import { NextRequest, NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (session) {
      const { error } = await getSupabaseAdmin().from("auth_sessions").delete().eq("token_hash", session.tokenHash);
      if (error) throw new Error(`Could not end session: ${error.message}`);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-out failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
