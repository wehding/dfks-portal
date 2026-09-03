export type ClaimedContractUploadIntentCleanup = {
  intent_id: string;
  storage_path: string;
  contract_id: string | null;
  cleanup_claim_token: string;
  cleanup_kind: "expired" | "purge";
};

type CleanupResult = {
  examined: number;
  storageObjectsRemoved: number;
  completed: number;
  storageRemovalFailed: number;
  completionFailed: number;
  invalidClaims: number;
};

const CONTRACT_UPLOAD_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|doc|docx|txt)$/;

/**
 * Storage deletion is allowed only for a lease returned by the service-only
 * database claim RPC. A failed deletion releases the lease for retry; a lost
 * completion response leaves it claimed until the database lease expires.
 */
export async function processClaimedContractUploadIntentCleanup(input: {
  claims: ClaimedContractUploadIntentCleanup[];
  removeStorageObject: (path: string) => Promise<{ error: unknown | null }>;
  finishClaim: (claim: ClaimedContractUploadIntentCleanup, success: boolean) => Promise<{
    completed: boolean;
    error: unknown | null;
  }>;
}): Promise<CleanupResult> {
  const result: CleanupResult = {
    examined: input.claims.length,
    storageObjectsRemoved: 0,
    completed: 0,
    storageRemovalFailed: 0,
    completionFailed: 0,
    invalidClaims: 0,
  };

  for (const claim of input.claims) {
    const valid = Boolean(
      claim.intent_id
      && CONTRACT_UPLOAD_PATH.test(claim.storage_path)
      && claim.cleanup_claim_token
      && (claim.cleanup_kind === "expired" || claim.cleanup_kind === "purge")
      && !(claim.cleanup_kind === "expired" && claim.contract_id),
    );
    if (!valid) {
      result.invalidClaims += 1;
      continue;
    }

    const mustRemoveObject = !claim.contract_id;
    let storageSucceeded = true;
    if (mustRemoveObject) {
      const removal = await input.removeStorageObject(claim.storage_path);
      storageSucceeded = !removal.error;
      if (storageSucceeded) result.storageObjectsRemoved += 1;
      else result.storageRemovalFailed += 1;
    }

    const completion = await input.finishClaim(claim, storageSucceeded);
    if (completion.error || !completion.completed) {
      result.completionFailed += 1;
    } else if (storageSucceeded) {
      result.completed += 1;
    }
  }

  return result;
}
