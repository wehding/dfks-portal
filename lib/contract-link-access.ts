export function canLinkContractWork(input: {
  canManageContract: boolean;
  ownRightsHolderId: string | null;
  contractRightsHolderId: string | null;
  requestedRightsHolderId?: string | null;
}) {
  if (input.canManageContract) return true;
  if (!input.ownRightsHolderId || input.contractRightsHolderId !== input.ownRightsHolderId) return false;
  return !input.requestedRightsHolderId || input.requestedRightsHolderId === input.ownRightsHolderId;
}
