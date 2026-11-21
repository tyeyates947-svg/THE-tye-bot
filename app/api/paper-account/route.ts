import { NextRequest, NextResponse } from "next/server";
import { fetchPaperAccountStats, refreshPaperAccount, removePaperAccount, storePaperAccount, validatePaperAccountRequest } from "@/lib/paper-accounts";
import { getSessionProfile } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (!session) return NextResponse.json({ error: "Sign in to connect a paper account." }, { status: 401 });
    const body: unknown = await request.json();
    if (body && typeof body === "object" && (body as Record<string, unknown>).action === "sync") {
      const stats = await refreshPaperAccount(session.profile.id);
      if (!stats) return NextResponse.json({ error: "No paper account is connected." }, { status: 404 });
      return NextResponse.json({ stats });
    }
    const { provider, credentials } = validatePaperAccountRequest(body);
    const stats = await fetchPaperAccountStats(provider, credentials);
    await storePaperAccount(session.profile.id, provider, credentials, stats);
    return NextResponse.json({ stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify the paper account.";
    const status = message.includes("Supabase is not configured") ? 503 : message.includes("Choose a provider") || message.includes("PAPER_ACCOUNT_ENCRYPTION_KEY") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (!session) return NextResponse.json({ error: "Sign in to disconnect a paper account." }, { status: 401 });
    await removePaperAccount(session.profile.id);
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not disconnect the paper account.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
