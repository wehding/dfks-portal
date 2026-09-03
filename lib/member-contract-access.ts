export type MemberOrgAffiliation = {
  org_id: string;
  rights_holder_id: string;
  valid_from: string | null;
  valid_to: string | null;
};

export function hasActiveMemberContractOwnership(input: {
  profileIds: string[];
  affiliations: MemberOrgAffiliation[];
  rightsHolderId: string | null;
  orgId: string;
  date: string;
}) {
  if (!input.rightsHolderId || !input.profileIds.includes(input.rightsHolderId)) return false;
  return input.affiliations.some(affiliation => (
    affiliation.rights_holder_id === input.rightsHolderId
    && affiliation.org_id === input.orgId
    && (!affiliation.valid_from || affiliation.valid_from <= input.date)
    && (!affiliation.valid_to || affiliation.valid_to >= input.date)
  ));
}
