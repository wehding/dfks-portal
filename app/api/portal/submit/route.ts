import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createContractReviewIntake } from "@/lib/contract-review-intake";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = [".pdf", ".doc", ".docx"];

function list(value: FormDataEntryValue | null | undefined) {
  if (typeof value !== "string" || !value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return value.split(",").map(item => item.trim()).filter(Boolean); }
}

export async function POST(request: NextRequest) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const db = createServiceClient();
  const { data: affiliation } = await db.from("org_affiliations").select("org_id,rettighedshavere!inner(user_id,full_name,email)").eq("rettighedshavere.user_id", user.id).limit(1).maybeSingle();
  const { data: role } = affiliation ? { data: null } : await db.from("user_org_roles").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
  const orgId = affiliation?.org_id ?? role?.org_id;
  if (!orgId) return NextResponse.json({ error: "Din bruger er ikke knyttet til en organisation" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Ingen fil" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Filen er for stor. Maksimum er 25 MB." }, { status: 413 });
  if (!ALLOWED.some(extension => file.name.toLowerCase().endsWith(extension))) return NextResponse.json({ error: "Brug PDF, DOC eller DOCX." }, { status: 400 });
  const holder = Array.isArray(affiliation?.rettighedshavere) ? affiliation?.rettighedshavere[0] : affiliation?.rettighedshavere;
  const submittedId = form?.get("submissionId");
  const externalSourceId = typeof submittedId === "string" && /^[0-9a-f-]{36}$/i.test(submittedId)
    ? `${user.id}:${submittedId}`
    : `${user.id}:${crypto.randomUUID()}`;
  try {
    const intake = await createContractReviewIntake({
      orgId, source: "portal", externalSourceId,
      fileName: file.name, contentType: file.type, fileBuffer: Buffer.from(await file.arrayBuffer()),
      memberId: user.id,
      memberName: String(holder?.full_name ?? user.user_metadata?.full_name ?? ""),
      memberEmail: String(holder?.email ?? user.email ?? ""),
      metadata: {
        contract_type: form?.get("contractType") || null, production_type: form?.get("productionType") || null,
        distribution_channels: list(form?.get("distributionChannels")), producer_name: form?.get("producerName") || null,
        producer_overenskomst_bound: form?.get("producerOverenskomst") === "true" ? true : form?.get("producerOverenskomst") === "false" ? false : null,
        focus_areas: list(form?.get("focusAreas")), notes: form?.get("notes") || null,
      },
    });
    if (!intake.duplicate) {
      const secret = process.env.CONTRACT_AI_JOB_SECRET ?? process.env.INTERNAL_API_SECRET ?? process.env.CRON_SECRET;
      if (secret) after(fetch(new URL("/api/contracts/reviews/jobs/process", request.url), { method: "POST", headers: { Authorization: `Bearer ${secret}` } }).catch(() => undefined));
    }
    return NextResponse.json({ success: true, review_id: intake.reviewId, duplicate: intake.duplicate });
  } catch (error) {
    console.error("[review-intake] Portalindsendelse fejlede", error instanceof Error ? error.message : "Ukendt fejl");
    return NextResponse.json({ error: "Kontrakten kunne ikke gemmes sikkert" }, { status: 500 });
  }
}
