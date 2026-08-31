export type WorkShareAdminParticipantSummary = {
  rights_holder_id?: string | null;
  invited_by_rights_holder_id?: string | null;
  source_tags?: string[] | null;
  excluded_at?: string | null;
};

export function isActionableAdminWorkShareCase(input: {
  work_share_participants?: WorkShareAdminParticipantSummary[] | null;
}) {
  const participants = (input.work_share_participants ?? []).filter(participant => !participant.excluded_at);
  if (participants.length > 1) return true;
  const participant = participants[0];
  if (!participant) return false;

  const sources = new Set(participant.source_tags ?? []);
  return !participant.rights_holder_id
    || Boolean(participant.invited_by_rights_holder_id)
    || (!sources.has("local") && (sources.has("dfi") || sources.has("tmdb")));
}

export function workShareParticipantSourceText(input: {
  sourceTags?: string[] | null;
  reportedByName?: string | null;
}) {
  const sources = new Set(input.sourceTags ?? []);
  const labels: string[] = [];
  if (sources.has("member")) labels.push(input.reportedByName ? `Indtastet af ${input.reportedByName}` : "Indtastet af bruger");
  if (sources.has("local")) labels.push("Lokal");
  if (sources.has("dfi")) labels.push("DFI");
  if (sources.has("tmdb")) labels.push("TMDb");
  return `Kilde: ${labels.length ? labels.join(" · ") : "Ukendt"}`;
}
