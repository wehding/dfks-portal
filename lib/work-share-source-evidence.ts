export type WorkShareSourceDetails = Record<string, unknown>;

function asSourceDetails(value: unknown): WorkShareSourceDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as WorkShareSourceDetails;
}

export function mergeWorkShareSourceEvidence(params: {
  existingTags?: string[] | null;
  existingDetails?: unknown;
  incomingTags?: string[] | null;
  incomingDetails?: unknown;
}) {
  return {
    sourceTags: [...new Set([...(params.existingTags ?? []), ...(params.incomingTags ?? [])])].sort(),
    sourceDetails: {
      ...asSourceDetails(params.existingDetails),
      ...asSourceDetails(params.incomingDetails),
    },
  };
}
