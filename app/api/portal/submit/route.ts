import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createContractReviewIntake, triggerContractReviewWorker } from "@/lib/contract-review-intake";
import { analyseExistingContractReview } from "@/lib/contract-review-analysis";
import { resolveOrgId } from "@/lib/org";

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
  const orgId = await resolveOrgId(db, user.id);
  if (!orgId) return NextResponse.json({ error: "Din bruger er ikke knyttet til en organisation" }, { status: 403 });
  const { data: affiliation } = await db.from("org_affiliations")
    .select("org_id,rettighedshavere!inner(user_id,full_name,email)")
    .eq("org_id", orgId)
    .eq("rettighedshavere.user_id", user.id)
    .maybeSingle();
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
      // Kør analysen direkte i after() — ingen HTTP-runde til worker-endpointet,
      // ingen afhængighed af CONTRACT_REVIEW_JOB_SECRET. Fald tilbage til
      // HTTP-workeren hvis direkte analyse fejler, så cron-jobbet kan genoptage.
      after(async () => {
        try {
          const db = createServiceClient();
          const { data: review } = await db
            .from("contract_reviews")
            .select("*")
            .eq("id", intake.reviewId)
            .single();
          if (!review?.storage_path) throw new Error("Fil mangler i storage");
          const { data: file, error: fileError } = await db.storage
            .from("contract-reviews")
            .download(review.storage_path);
          if (fileError || !file) throw new Error("Kunne ikke hente fil");
          await analyseExistingContractReview({
            reviewId: review.id,
            orgId: review.org_id,
            fileBuffer: Buffer.from(await file.arrayBuffer()),
            fileName: review.file_name ?? intake.reviewId,
            memberName: review.member_name,
            memberId: review.member_id,
            memberEmail: review.member_email,
            contractType: review.contract_type,
            productionType: review.production_type,
            distributionChannels: review.distribution_channels ?? [],
            producerName: review.producer_name,
            producerOverenskomst: review.producer_overenskomst_bound == null
              ? null
              : String(review.producer_overenskomst_bound),
            focusAreas: review.focus_areas ?? [],
            notes: review.notes,
            source: "portal",
          });
          await db
            .from("contract_review_jobs")
            .update({ status: "done", locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
            .eq("review_id", intake.reviewId);
        } catch {
          // Fejl logges ikke her da after() kører efter response — cron-job
          // eller manuel genkørsel tager sig af genoptagelse.
          triggerContractReviewWorker(request.nextUrl.origin).catch(() => undefined);
        }
      });
    }
    return NextResponse.json({ success: true, review_id: intake.reviewId, duplicate: intake.duplicate });
  } catch (error) {
    console.error("[review-intake] Portalindsendelse fejlede", error instanceof Error ? error.message : "Ukendt fejl");
    return NextResponse.json({ error: "Kontrakten kunne ikke gemmes sikkert" }, { status: 500 });
  }
}
