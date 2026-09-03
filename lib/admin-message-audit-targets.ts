type MessageAuditParticipant = {
  member_rights_holder_id?: string | null;
};

/**
 * Contract comments keep the member who actually participated in the thread.
 * That stable participant must win over the contract's current owner after an
 * ownership change. Other thread types use their current, immutable member as
 * a fallback because they do not yet store a participant on each comment.
 */
export function resolveAdminMessageAuditTargets(
  affectedMessages: readonly MessageAuditParticipant[],
  fallbackMemberUuid: string | null,
): string[] {
  if (affectedMessages.length === 0) return [];

  const stableParticipants = [...new Set(
    affectedMessages
      .map(message => message.member_rights_holder_id)
      .filter((id): id is string => Boolean(id)),
  )];

  if (stableParticipants.length > 0) return stableParticipants;
  return fallbackMemberUuid ? [fallbackMemberUuid] : [];
}
