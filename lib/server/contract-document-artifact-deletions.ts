import "server-only";

import { parseContractDocumentLeaseArtifactPath } from "@/lib/server/contract-document-lease-artifacts";
import { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type ArtifactDeletionResult = {
  id: string;
  orgId: string;
  contractId: string;
  succeeded: boolean;
};

export async function processContractDocumentArtifactDeletions(
  db: ServiceClient,
  options: { limit?: number; replacementJobId?: string | null } = {},
): Promise<ArtifactDeletionResult[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const { data, error } = await db.rpc("claim_contract_document_artifact_deletions", {
    p_limit: limit,
    p_replacement_job_id: options.replacementJobId ?? null,
  });
  if (error || !Array.isArray(data)) return [];

  const results: ArtifactDeletionResult[] = [];
  for (const row of data as Array<Record<string, unknown>>) {
    const id = typeof row.id === "string" ? row.id : null;
    const orgId = typeof row.org_id === "string" ? row.org_id : null;
    const contractId = typeof row.contract_id === "string" ? row.contract_id : null;
    const storagePath = typeof row.storage_path === "string" ? row.storage_path : null;
    const parsed = storagePath ? parseContractDocumentLeaseArtifactPath(storagePath) : null;
    const valid = Boolean(id && orgId && contractId && parsed
      && parsed.orgId === orgId && parsed.contractId === contractId);
    let succeeded = false;
    let errorCode = "invalid_artifact_path";
    if (valid && storagePath) {
      const removed = await db.storage.from("kontrakter").remove([storagePath]);
      succeeded = !removed.error;
      errorCode = succeeded ? "" : "storage_delete_failed";
    }
    if (id) {
      await db.rpc("finish_contract_document_artifact_deletion", {
        p_deletion_id: id,
        p_succeeded: succeeded,
        p_error_code: errorCode || null,
      });
    }
    if (id && orgId && contractId) results.push({ id, orgId, contractId, succeeded });
  }
  return results;
}
