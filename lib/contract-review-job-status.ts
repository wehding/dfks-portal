export type ContractReviewJobState = "queued" | "processing" | "error" | "dead" | "done";
export type ContractReviewAnalysisState = "queued" | "processing" | "retrying" | "failed" | "ready";

export type ContractReviewJobSnapshot = {
  status: ContractReviewJobState;
  attempts: number;
  next_attempt_at: string | null;
  error_message: string | null;
};

export function normalizeContractReviewAnalysisStatus(input: {
  aiStatus?: string | null;
  intakeStatus?: string | null;
  job?: ContractReviewJobSnapshot | null;
}): ContractReviewAnalysisState {
  if (input.aiStatus === "klar") return "ready";
  if (input.job?.status === "dead" || input.intakeStatus === "dead") return "failed";
  if (input.job?.status === "error" || input.intakeStatus === "retryable") return "retrying";
  if (input.job?.status === "processing") return "processing";
  if (input.aiStatus === "fejl") return "failed";
  return "queued";
}

export function isActiveContractReviewAnalysis(state: ContractReviewAnalysisState) {
  return state === "queued" || state === "processing" || state === "retrying";
}

export function canTriggerContractReviewAnalysis(state: ContractReviewAnalysisState) {
  return state !== "processing";
}
