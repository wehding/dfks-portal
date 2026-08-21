/**
 * Synkron adminanalyse af en ny kontraktgennemgang.
 *
 * Selve oprettelsen går gennem den fælles intake-service, så portal, admin og
 * Gmail får samme deduplikering, storage-oprydning og jobstatus. Admin venter
 * fortsat på analysen, fordi resultatet vises direkte i editoren.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { analyseExistingContractReview } from "@/lib/contract-review-analysis";
import { createContractReviewIntake } from "@/lib/contract-review-intake";
import { createServiceClient } from "@/lib/supabase/service";
import { errorMessage, logInfo, logWarn } from "@/lib/server-log";

const MAX_CONTRACT_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];

function parseList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 20) : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
  }
}

function optionalString(value: FormDataEntryValue | null, maxLength: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffModuleApi("contract_reviews", "write");
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Ingen fil modtaget" }, { status: 400 });
    }
    if (file.size > MAX_CONTRACT_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Filen er for stor. Maksimum er 25 MB." }, { status: 413 });
    }
    if (!ALLOWED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) {
      return NextResponse.json({ error: "Brug PDF, DOC eller DOCX." }, { status: 400 });
    }

    const memberName = optionalString(formData.get("memberName"), 500);
    const memberEmail = optionalString(formData.get("memberEmail"), 500);
    const memberId = optionalString(formData.get("memberId"), 100);
    const contractType = optionalString(formData.get("contractType"), 100);
    const productionType = optionalString(formData.get("productionType"), 100);
    const producerName = optionalString(formData.get("producerName"), 500);
    const producerDfksId = optionalString(formData.get("producerDfksId"), 100);
    const producerDfiId = optionalString(formData.get("producerDfiId"), 100);
    const producerOverenskomstRaw = optionalString(formData.get("producerOverenskomst"), 10);
    const producerOverenskomst = producerOverenskomstRaw === "true"
      ? true
      : producerOverenskomstRaw === "false"
        ? false
        : null;
    const distributionChannels = parseList(formData.get("distributionChannels"));
    const focusAreas = parseList(formData.get("focusAreas"));
    const notes = optionalString(formData.get("notes"), 50_000);
    const submissionId = optionalString(formData.get("submissionId"), 100);
    const externalSourceId = submissionId
      ? `${auth.userId}:${submissionId}`
      : `${auth.userId}:${crypto.randomUUID()}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    logInfo("gennemgang", "Opretter adminindsendelse gennem fælles intake", {
      orgId: auth.orgId,
      fileType: file.type || "ukendt",
    });

    const intake = await createContractReviewIntake({
      orgId: auth.orgId,
      source: "admin",
      externalSourceId,
      fileName: file.name,
      contentType: file.type,
      fileBuffer,
      memberId,
      memberName,
      memberEmail,
      metadata: {
        contract_type: contractType,
        production_type: productionType,
        distribution_channels: distributionChannels,
        producer_name: producerName,
        producer_dfks_id: producerDfksId,
        producer_dfi_id: producerDfiId,
        producer_overenskomst_bound: producerOverenskomst,
        focus_areas: focusAreas,
        notes,
      },
    });

    const db = createServiceClient({
      audit: { source: "admin", actorUserId: auth.userId, actorOrgId: auth.orgId },
    });

    try {
      const analysed = await analyseExistingContractReview({
        reviewId: intake.reviewId,
        orgId: auth.orgId,
        fileBuffer,
        fileName: file.name,
        memberName,
        memberEmail,
        memberId,
        contractType,
        productionType,
        distributionChannels,
        producerName,
        producerOverenskomst: producerOverenskomst == null ? null : String(producerOverenskomst),
        focusAreas,
        notes,
        actorUserId: auth.userId,
        source: "admin",
      });

      await Promise.all([
        db.from("contract_reviews")
          .update({ intake_status: "complete" })
          .eq("id", intake.reviewId)
          .eq("org_id", auth.orgId),
        db.from("contract_review_jobs")
          .update({
            status: "done",
            error_message: null,
            locked_at: null,
            locked_by: null,
            updated_at: new Date().toISOString(),
          })
          .eq("review_id", intake.reviewId)
          .eq("org_id", auth.orgId)
          .in("status", ["queued", "processing", "error"]),
      ]);

      return NextResponse.json({
        result: analysed.analysis.result,
        contractText: analysed.analysis.contractText,
        klassifikation: analysed.analysis.klassifikation,
        risk_level: analysed.analysis.risk_level,
        should_escalate: analysed.analysis.should_escalate,
        reviewId: intake.reviewId,
        duplicate: intake.duplicate,
      });
    } catch (error) {
      const message = errorMessage(error, "Analyse fejlede");
      await Promise.all([
        db.from("contract_reviews")
          .update({ ai_status: "fejl", intake_status: "retryable" })
          .eq("id", intake.reviewId)
          .eq("org_id", auth.orgId),
        db.from("contract_review_jobs")
          .update({
            status: "error",
            error_message: message.slice(0, 500),
            locked_at: null,
            locked_by: null,
            next_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("review_id", intake.reviewId)
          .eq("org_id", auth.orgId)
          .neq("status", "done"),
      ]);
      const status = message.includes("Ikke-understøttet") || message.includes("PDF-analyse kræver")
        ? 400
        : message.includes("Ingen tekst") || message.includes("læsbar tekst")
          ? 422
          : 500;
      return NextResponse.json({ error: message, reviewId: intake.reviewId }, { status });
    }
  } catch (error) {
    logWarn("gennemgang", "Adminindsendelse fejlede", { error: errorMessage(error) });
    return NextResponse.json({ error: "Indsendelsen kunne ikke gemmes." }, { status: 500 });
  }
}
