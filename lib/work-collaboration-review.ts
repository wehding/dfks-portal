export type CollaborationReviewStatus = "pending" | "solo_confirmed" | "coeditors_reported" | "disputed";

export function collaborationReviewStatusForSoloClaim(otherRightsHolderCount: number): CollaborationReviewStatus {
  return Number.isFinite(otherRightsHolderCount) && otherRightsHolderCount > 0 ? "disputed" : "solo_confirmed";
}

export function isOpenCollaborationReview(status: CollaborationReviewStatus) {
  return status === "pending" || status === "disputed";
}
