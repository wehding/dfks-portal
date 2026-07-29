type ContractMessageStatus = {
  author_role: "member" | "admin";
  member_read_at?: string | null;
};

export function unreadAdminMessageCount(comments: ContractMessageStatus[] | null | undefined) {
  return (comments ?? []).filter(comment => comment.author_role === "admin" && !comment.member_read_at).length;
}

export function hasLinkedWork(workId: string | null | undefined) {
  return Boolean(workId);
}

export function isPendingContractValidation(contract: {
  work_id?: string | null;
  status?: string | null;
}) {
  return hasLinkedWork(contract.work_id)
    && contract.status !== "valideret"
    && contract.status !== "arkiveret";
}

export function shouldShowWorkLinkBadge(hasLinkedWork: boolean, status: string) {
  return !(hasLinkedWork && status === "valideret");
}

export type TriState = "yes" | "no" | "unknown" | "implicit";
export type ContractReadiness = "recommended" | "recommended_with_warnings" | "needs_information" | "blocked" | "not_applicable";

function nestedValue(data: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    let value: unknown = data;
    for (const segment of path.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[segment] : undefined;
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

export function normalizeTriState(value: unknown): TriState {
  if (value === true) return "yes";
  if (value === false) return "no";
  const normalized = String(value ?? "").trim().toLocaleLowerCase("da");
  if (["ja", "yes", "true", "fundet", "underskrevet"].includes(normalized)) return "yes";
  if (["nej", "no", "false", "ikke fundet", "ikke underskrevet"].includes(normalized)) return "no";
  if (normalized.includes("implicit")) return "implicit";
  return "unknown";
}

export function contractReadiness(contract: { status?: string | null; work_id?: string | null; employer_id?: string | null; overenskomst?: string | null; validation_data?: Record<string, unknown> | null }): ContractReadiness {
  if (contract.status === "valideret" || contract.status === "arkiveret") return "not_applicable";
  const data = contract.validation_data ?? {};
  if (data.validationBlocked === true) return "blocked";
  if (!contract.work_id || !contract.employer_id) return "needs_information";
  const copydan = normalizeTriState(nestedValue(data, ["copydan", "copydanReservation", "rightsOverview.copydanforbehold"]));
  const streaming = normalizeTriState(nestedValue(data, ["svod", "streaming", "streamingReservation", "rightsOverview.streamingforbehold"]));
  if (data.rightsNotApplicable !== true && ![copydan, streaming].some(value => value === "yes" || value === "implicit")) return "needs_information";
  const signature = normalizeTriState(nestedValue(data, ["signatureStatus", "hasSignature", "signature", "signed", "isSigned"]));
  const agreement = normalizeTriState(nestedValue(data, ["agreementStatus", "collectiveAgreement", "rightsOverview.overenskomst"]));
  const agreementKnown = Boolean(contract.overenskomst && contract.overenskomst !== "ingen") || agreement === "yes" || agreement === "implicit";
  return (signature === "yes" || signature === "implicit") && agreementKnown ? "recommended" : "recommended_with_warnings";
}
