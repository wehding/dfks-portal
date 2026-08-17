import { after, NextRequest, NextResponse } from "next/server";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { assertContractReviewInOrg } from "@/lib/authz";
import { triggerContractReviewWorker } from "@/lib/contract-review-intake";
import { createServiceClient } from "@/lib/supabase/service";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];

function isAllowedFileName(fileName: string) {
  return ALLOWED_EXTENSIONS.some(extension => fileName.toLowerCase().endsWith(extension));
}

// POST /api/admin/contracts/[id]/reanalyse
// Genstarter samme sikre koeflow som den automatiske Gmail-/portalimport.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffModuleApi("contract_reviews", "write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const db = createServiceClient({
    audit: { actorUserId: auth.userId, actorOrgId: auth.orgId, actorRole: auth.role, source: "admin" },
  });

  let review: Awaited<ReturnType<typeof assertContractReviewInOrg>>;
  try {
    review = await assertContractReviewInOrg(db, id, auth.orgId);
  } catch {
    return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  }

  let uploadedStoragePath: string | null = null;
  const updates: Record<string, unknown> = {
    ai_status: "analyserer",
    intake_status: "queued",
  };

  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Ingen fil i upload" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Filen er for stor. Maksimum er 25 MB." }, { status: 413 });
    }
    if (!isAllowedFileName(file.name)) {
      return NextResponse.json({ error: "Brug PDF, DOC eller DOCX." }, { status: 400 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    uploadedStoragePath = `${auth.orgId}/${crypto.randomUUID()}/${safeName}`;
    const upload = await db.storage.from("contract-reviews").upload(
      uploadedStoragePath,
      Buffer.from(await file.arrayBuffer()),
      { contentType: file.type || "application/octet-stream", upsert: false },
    );
    if (upload.error) {
      return NextResponse.json({ error: "Filen kunne ikke gemmes sikkert." }, { status: 500 });
    }
    updates.storage_path = uploadedStoragePath;
    updates.file_name = file.name;
    updates.file_size_bytes = file.size;
  } else if (!review.storage_path) {
    return NextResponse.json({
      error: "Filen er ikke gemt i systemet. Upload filen for at starte analysen igen.",
      missing_file: true,
    }, { status: 400 });
  }

  const { error: reviewError } = await db.from("contract_reviews")
    .update(updates)
    .eq("id", id)
    .eq("org_id", auth.orgId);
  if (reviewError) {
    if (uploadedStoragePath) await db.storage.from("contract-reviews").remove([uploadedStoragePath]);
    return NextResponse.json({ error: "Kontraktgennemgangen kunne ikke sættes i kø." }, { status: 500 });
  }

  const { data: jobs, error: jobsError } = await db.from("contract_review_jobs")
    .select("id,status,attempts")
    .eq("review_id", id)
    .eq("org_id", auth.orgId)
    .order("created_at", { ascending: false });
  if (jobsError) {
    return NextResponse.json({ error: "Analysejobbet kunne ikke læses." }, { status: 500 });
  }

  const activeJob = (jobs ?? []).find(job => job.status === "queued" || job.status === "processing");
  const jobPayload = {
      status: "queued",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      error_message: null,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
  };
  if (activeJob?.status === "queued") {
    const { error } = await db.from("contract_review_jobs").update(jobPayload).eq("id", activeJob.id).eq("org_id", auth.orgId);
    if (error) return NextResponse.json({ error: "Analysejobbet kunne ikke sættes i kø." }, { status: 500 });
  } else if (!activeJob) {
    const reusableJob = jobs?.[0];
    const jobResult = reusableJob
      ? await db.from("contract_review_jobs").update(jobPayload).eq("id", reusableJob.id).eq("org_id", auth.orgId)
      : await db.from("contract_review_jobs").insert({ review_id: id, org_id: auth.orgId, ...jobPayload });
    if (jobResult.error) {
      return NextResponse.json({ error: "Analysejobbet kunne ikke sættes i kø." }, { status: 500 });
    }
  }

  after(triggerContractReviewWorker(request.nextUrl.origin));
  return NextResponse.json({ accepted: true, analysisStatus: activeJob?.status ?? "queued" }, { status: 202 });
}
