import { NextRequest, NextResponse } from "next/server";
import { getEmbedding } from "@/lib/embedding-provider";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function GET() {
  const auth = await requireStaffModuleApi("contract_reviews", "read");
  if (!auth.ok) return auth.response;
  let query = createServiceClient().from("knowledge_chunks")
    .select("kilde_id,kilde_titel,tekst,metadata,kilde_type,sidst_opdateret,org_id")
    .order("kilde_id");
  if (!auth.global) query = query.or(`org_id.is.null,org_id.eq.${auth.orgId}`);
  const { data, error } = await query;
  if (error) {
    console.error("[videnbase] read failed", error.code);
    return NextResponse.json({ error: "Videnbasen kunne ikke hentes." }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function PATCH(req: NextRequest) {
  const auth = await requireStaffModuleApi("contract_reviews", "write");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const sourceId = text(body?.kilde_id, 300);
  const interpretation = text(body?.dfks_fortolkning, 10_000) || null;
  if (!sourceId) return NextResponse.json({ error: "Kilde-id mangler." }, { status: 400 });
  const db = createServiceClient();
  const { data: chunk } = await db.from("knowledge_chunks").select("kilde_id,tekst,metadata,org_id").eq("kilde_id", sourceId).maybeSingle();
  if (!chunk || (!auth.global && chunk.org_id !== auth.orgId)) {
    return NextResponse.json({ error: "Kilden findes ikke." }, { status: 404 });
  }
  if (chunk.org_id === null && !auth.global) {
    return NextResponse.json({ error: "Kun superadmin kan ændre globale kilder." }, { status: 403 });
  }
  try {
    const metadata = { ...(chunk.metadata ?? {}), dfks_fortolkning: interpretation };
    const embeddingInput = [chunk.tekst, interpretation ? `Fortolkning: ${interpretation}` : ""].filter(Boolean).join(" ");
    const embedding = await getEmbedding(embeddingInput, true);
    const { error } = await db.from("knowledge_chunks").update({ metadata, embedding }).eq("kilde_id", sourceId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[videnbase] update failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Kilden kunne ikke opdateres." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireStaffModuleApi("contract_reviews", "write");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const requestedId = text(body?.kilde_id, 200);
  const title = text(body?.kilde_titel, 300);
  const content = text(body?.tekst, 50_000);
  const sourceType = text(body?.kilde_type, 100) || "lovtekst";
  const interpretation = text(body?.dfks_fortolkning, 10_000) || null;
  const globalSource = body?.global === true;
  if (!requestedId || !title || !content) {
    return NextResponse.json({ error: "Kilde-id, titel og tekst er påkrævet." }, { status: 400 });
  }
  if (globalSource && !auth.global) {
    return NextResponse.json({ error: "Kun superadmin kan oprette globale kilder." }, { status: 403 });
  }
  try {
    const orgId = globalSource ? null : auth.orgId;
    const sourceId = `${orgId ?? "global"}:${requestedId.replace(/[^a-zA-Z0-9._:-]/g, "-")}`;
    const embeddingInput = [content, interpretation ? `Fortolkning: ${interpretation}` : ""].filter(Boolean).join(" ");
    const embedding = await getEmbedding(embeddingInput, true);
    const { error } = await createServiceClient().from("knowledge_chunks").upsert({
      org_id: orgId,
      kilde_id: sourceId,
      kilde_titel: title,
      tekst: content,
      kilde_type: sourceType,
      metadata: { dfks_fortolkning: interpretation, original_kilde_id: requestedId },
      embedding,
    }, { onConflict: "kilde_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true, kilde_id: sourceId });
  } catch (error) {
    console.error("[videnbase] create failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Kilden kunne ikke gemmes." }, { status: 500 });
  }
}
