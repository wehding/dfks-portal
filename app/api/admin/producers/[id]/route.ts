import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const type = new URL(req.url).searchParams.get("type");
  if (type !== "works" && type !== "contracts") return NextResponse.json({ error: "Ugyldig detaljetype" }, { status: 400 });
  const db = createServiceClient();
  const { data: producer } = await db.from("employers").select("id").eq("id", id).maybeSingle();
  if (!producer) return NextResponse.json({ error: "Producent ikke fundet" }, { status: 404 });
  const result = type === "works"
    ? await db.from("works").select("id,title,type,year,status,created_at").eq("org_id", auth.orgId).eq("employer_id", id).order("created_at", { ascending: false })
    : await db.from("contracts").select("id,working_title,type,status,contract_date,created_at,rettighedshavere(full_name)").eq("org_id", auth.orgId).eq("employer_id", id).order("created_at", { ascending: false });
  if (result.error) return NextResponse.json({ error: "Detaljer kunne ikke hentes" }, { status: 500 });
  return NextResponse.json({ data: result.data ?? [] });
}
