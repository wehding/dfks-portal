import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

export async function drainContractReviewStorageDeletionQueue(batchSize = 100) {
  const db = createServiceClient();
  const { data: pending, error } = await db.rpc(
    "pending_contract_review_storage_deletions",
    { batch_size: Math.max(1, Math.min(batchSize, 500)) },
  );
  if (error) throw new Error(error.message);

  let deleted = 0;
  let failed = 0;
  for (const item of pending ?? []) {
    const removal = await db.storage.from("contract-reviews").remove([item.storage_path]);
    const deletionError = removal.error?.message ?? null;
    const { error: completionError } = await db.rpc(
      "complete_contract_review_storage_deletion",
      { target_certificate_id: item.certificate_id, deletion_error: deletionError },
    );
    if (completionError) throw new Error(completionError.message);
    if (deletionError) failed += 1;
    else deleted += 1;
  }
  return { deleted, failed };
}
