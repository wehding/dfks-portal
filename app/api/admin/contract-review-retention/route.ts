import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireCronOrAdminApi } from "@/lib/api-auth";
import { drainContractReviewStorageDeletionQueue } from "@/lib/contract-review-retention";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

async function candidates(orgId?: string) {
  const db = createServiceClient();
  let query = db.from("contract_reviews").select("id,org_id,member_id,storage_path,completed_at,organisations!inner(contract_review_retention_months)")
    .eq("legal_hold", false).not("completed_at", "is", null).neq("intake_status", "deleted");
  if (orgId) query = query.eq("org_id", orgId);
  const { data, error } = await query.limit(500);
  if (error) throw new Error(error.message);
  const now = Date.now();
  return (data ?? []).filter(row => {
    const org = Array.isArray(row.organisations) ? row.organisations[0] : row.organisations;
    const due = new Date(row.completed_at as string); due.setMonth(due.getMonth() + Number(org?.contract_review_retention_months ?? 24));
    return due.getTime() <= now;
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireCronOrAdminApi(request, ["superadmin", "admin", "org-admin"]);
  if (!auth.ok) return auth.response;
  const rows = await candidates("isCron" in auth ? undefined : auth.orgId);
  const memberUserIds = [...new Set(rows.map(row => row.member_id).filter((id): id is string => Boolean(id)))];
  const { data: holders } = memberUserIds.length ? await createServiceClient().from("rettighedshavere").select("id").in("user_id", memberUserIds) : { data: [] };
  await recordSensitiveFlow({ actor: { userId: "isCron" in auth ? null : auth.userId, orgId: "isCron" in auth ? null : auth.orgId, role: "isCron" in auth ? "integration" : auth.role, source: "isCron" in auth ? "cron" : "admin" }, action: "security_review", component: "admin.contract-review-retention.preview", entityType: "contract_reviews", targetMemberUuids: (holders ?? []).map(holder => holder.id), orgIds: [...new Set(rows.map(row => row.org_id))], purposeCode: "retention_review", legalBasis: "GDPR Art. 5(1)(e), 6(1)(f), 9(2)(d) og 32", dataCategories: ["contract_data", "document_metadata", "union_membership_data"], counts: { candidates: rows.length } });
  return NextResponse.json({ count: rows.length, reviews: rows.map(row => ({ id: row.id, orgId: row.org_id, completedAt: row.completed_at })) });
}

export async function POST(request: NextRequest) {
  const auth = await requireCronOrAdminApi(request, ["superadmin"]);
  if (!auth.ok) return auth.response;
  const db = createServiceClient();
  const rows = await candidates("isCron" in auth ? undefined : auth.orgId);
  const memberUserIds = [...new Set(rows.map(row => row.member_id).filter((id): id is string => Boolean(id)))];
  const { data: holders } = memberUserIds.length ? await db.from("rettighedshavere").select("id").in("user_id", memberUserIds) : { data: [] };
  let deleted = 0;
  for (const row of rows) {
    const actorId = "isCron" in auth ? null : auth.userId;
    const { data } = await db.rpc("finalize_contract_review_deletion", { target_review_id: row.id, actor_id: actorId, deletion_origin: "isCron" in auth ? "cron" : "admin" });
    if (data) deleted += 1;
  }

  // Storage slettes først efter den atomiske databasekontrol. Hvis Storage er
  // midlertidigt utilgængeligt, forbliver stien i den private sletteattest og
  // forsøges igen ved næste kørsel.
  let storageResult: { deleted: number; failed: number };
  try {
    storageResult = await drainContractReviewStorageDeletionQueue(500);
  } catch {
    return NextResponse.json({ error: "Sagerne blev slettet, men storage-køen kunne ikke læses", deleted, examined: rows.length }, { status: 500 });
  }

  await recordSensitiveFlow({ actor: { userId: "isCron" in auth ? null : auth.userId, orgId: "isCron" in auth ? null : auth.orgId, role: "isCron" in auth ? "integration" : auth.role, source: "isCron" in auth ? "cron" : "admin" }, action: "retention", component: "admin.contract-review-retention.execute", entityType: "contract_reviews", targetMemberUuids: (holders ?? []).map(holder => holder.id), orgIds: [...new Set(rows.map(row => row.org_id))], purposeCode: "retention_enforcement", legalBasis: "GDPR Art. 5(1)(e), 6(1)(f), 9(2)(d) og 32", dataCategories: ["contract_data", "document_metadata", "union_membership_data"], counts: { examined: rows.length, deleted, storageDeleted: storageResult.deleted, storageFailed: storageResult.failed } });

  return NextResponse.json({
    deleted,
    examined: rows.length,
    storageDeleted: storageResult.deleted,
    storageFailed: storageResult.failed,
  });
}
