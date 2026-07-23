import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(["superadmin"]);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null) as { sourceId?: string; targetId?: string } | null;
  if (!body?.sourceId || !body.targetId || body.sourceId === body.targetId) {
    return NextResponse.json({ error: "Vælg to forskellige selskaber." }, { status: 400 });
  }
  const db = createServiceClient();
  const { error } = await db.rpc("merge_canonical_employers", {
    source_id: body.sourceId,
    target_id: body.targetId,
    actor_id: auth.userId,
  });
  if (error) {
    const safeError = /registration|CVR|same/i.test(error.message)
      ? "Selskaberne har modstridende registreringsoplysninger og kunne ikke sammenlægges."
      : "Selskaberne kunne ikke sammenlægges.";
    return NextResponse.json({ error: safeError }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}

