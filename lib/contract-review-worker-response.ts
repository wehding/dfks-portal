type ContractReviewWorkerResult = {
  processed: number;
  succeeded: number;
  failed: number;
  hasMore: boolean;
};

export async function isContractReviewWorkerResponse(response: Response) {
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return false;
  }

  const payload = await response.json().catch(() => null) as Partial<ContractReviewWorkerResult> | null;
  return Boolean(
    payload
    && typeof payload.processed === "number"
    && typeof payload.succeeded === "number"
    && typeof payload.failed === "number"
    && typeof payload.hasMore === "boolean",
  );
}
