import { NextRequest, NextResponse } from "next/server";
import { getEmbedding } from "@/lib/embedding-provider";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function GET() {
  const auth = await requireStaffModuleApi("contract_reviews", "read");
  if (!auth.ok) return auth.response;
  const db = createServiceClient();
  let patternsQuery = db.from("learned_patterns").select("*").order("created_at", { ascending: false });
  let feedbackQuery = db.from("analysis_feedback")
    .select("id,org_id,fund_titel,fund_svaerhedsgrad,korrektion_beskrivelse,jurist_korrektion,created_at")
    .eq("godkendt", false)
    .eq("skal_ignoreres", false)
    .order("created_at", { ascending: false });
  if (!auth.global) {
    patternsQuery = patternsQuery.or(`org_id.is.null,org_id.eq.${auth.orgId}`);
    feedbackQuery = feedbackQuery.or(`org_id.is.null,org_id.eq.${auth.orgId}`);
  }
  const [patternsRes, feedbackRes] = await Promise.all([patternsQuery, feedbackQuery]);
  if (patternsRes.error || feedbackRes.error) {
    console.error("[learned-patterns] read failed", {
      patterns: patternsRes.error?.code,
      feedback: feedbackRes.error?.code,
    });
    return NextResponse.json({ error: "Læringsmønstrene kunne ikke hentes." }, { status: 500 });
  }
  return NextResponse.json({ patterns: patternsRes.data ?? [], pending: feedbackRes.data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireStaffModuleApi("contract_reviews", "write");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const titel = text(body?.titel, 200);
  const regel = text(body?.regel, 10_000);
  const semantiskBeskrivelse = text(body?.semantisk_beskrivelse, 5_000);
  const sourceFeedbackId = text(body?.kilde_feedback_id, 64) || null;
  const globalPattern = body?.global === true;
  if (!titel || !regel || !semantiskBeskrivelse) {
    return NextResponse.json({ error: "Titel, regel og semantisk beskrivelse er påkrævet." }, { status: 400 });
  }
  if (globalPattern && !auth.global) {
    return NextResponse.json({ error: "Kun superadmin kan oprette globale mønstre." }, { status: 403 });
  }
  try {
    const embedding = await getEmbedding(semantiskBeskrivelse, true);
    const { data, error } = await createServiceClient().from("learned_patterns").insert({
      org_id: globalPattern ? null : auth.orgId,
      titel,
      regel,
      semantisk_beskrivelse: semantiskBeskrivelse,
      embedding,
      kilde_feedback_id: sourceFeedbackId,
      godkendt_af: auth.userId,
      aktiv: true,
    }).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error("[learned-patterns] create failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Læringsmønstret kunne ikke gemmes." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireStaffModuleApi("contract_reviews", "write");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const id = text(body?.id, 64);
  if (!id) return NextResponse.json({ error: "Id mangler." }, { status: 400 });
  const db = createServiceClient();
  const { data: current } = await db.from("learned_patterns").select("id,org_id").eq("id", id).maybeSingle();
  if (!current || (!auth.global && current.org_id !== auth.orgId)) {
    return NextResponse.json({ error: "Læringsmønstret findes ikke." }, { status: 404 });
  }
  const patch: Record<string, unknown> = {};
  if ("titel" in (body ?? {})) patch.titel = text(body?.titel, 200);
  if ("regel" in (body ?? {})) patch.regel = text(body?.regel, 10_000);
  if ("aktiv" in (body ?? {})) patch.aktiv = body?.aktiv === true;
  if ("semantisk_beskrivelse" in (body ?? {})) {
    const description = text(body?.semantisk_beskrivelse, 5_000);
    if (!description) return NextResponse.json({ error: "Semantisk beskrivelse må ikke være tom." }, { status: 400 });
    patch.semantisk_beskrivelse = description;
    patch.embedding = await getEmbedding(description, true);
  }
  let updateQuery = db.from("learned_patterns").update(patch).eq("id", id);
  updateQuery = current.org_id ? updateQuery.eq("org_id", current.org_id) : updateQuery.is("org_id", null);
  const { data, error } = await updateQuery.select().single();
  if (error) {
    console.error("[learned-patterns] update failed", error.code);
    return NextResponse.json({ error: "Læringsmønstret kunne ikke opdateres." }, { status: 500 });
  }
  return NextResponse.json(data);
}
