const PERCENT_EPSILON = 0.01;

type ShareParticipant = {
  rights_holder_id?: string | null;
  final_percent?: number | string | null;
  excluded_at?: string | null;
};

type ShareCase = {
  status?: string | null;
  reserve_percent?: number | string | null;
  work_share_participants?: ShareParticipant[] | ShareParticipant | null;
};

type Assignment = {
  rights_holder_id?: string | null;
  share_percent?: number | string | null;
};

function finitePercent(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumsToOneHundred(values: number[]) {
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) <= PERCENT_EPSILON;
}

export function hasResolvedShareDistribution(shareCase: ShareCase) {
  if (shareCase.status !== "resolved") return false;
  const raw = shareCase.work_share_participants;
  const participants = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .filter(participant => !participant.excluded_at && Boolean(participant.rights_holder_id));
  if (participants.length < 2) return false;
  const values = participants.map(participant => finitePercent(participant.final_percent));
  const reserve = finitePercent(shareCase.reserve_percent) ?? 0;
  return values.every((value): value is number => value !== null) && sumsToOneHundred([...values, reserve]);
}

export function hasCompleteAssignmentDistribution(assignments: Assignment[]) {
  const unique = new Map<string, number | null>();
  for (const assignment of assignments) {
    if (!assignment.rights_holder_id) continue;
    unique.set(assignment.rights_holder_id, finitePercent(assignment.share_percent));
  }
  if (unique.size < 2) return false;
  const values = [...unique.values()];
  return values.every((value): value is number => value !== null) && sumsToOneHundred(values);
}
