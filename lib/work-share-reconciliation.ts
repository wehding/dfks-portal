export type WorkCreditSource = "local" | "member" | "dfi" | "tmdb";

export type WorkCreditCandidate = {
  name: string;
  role?: string | null;
  source: WorkCreditSource;
  externalPersonId?: string | null;
  rightsHolderId?: string | null;
  proposedPercent?: number | null;
};

export type ReconciledWorkCredit = {
  key: string;
  name: string;
  roles: string[];
  sources: WorkCreditSource[];
  externalPersonIds: string[];
  rightsHolderId: string | null;
  proposedPercent: number | null;
};

export type RightsHolderCreditMatch = {
  rightsHolderId: string | null;
  matchType: "existing" | "external_id" | "exact_name" | "unmatched" | "conflict";
};

export function isMissingWorkCreditCacheSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: unknown; message?: unknown };
  const code = typeof row.code === "string" ? row.code : "";
  const message = typeof row.message === "string" ? row.message.toLocaleLowerCase("da-DK") : "";
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(code)) {
    return message.includes("work_credit_source_syncs")
      || message.includes("claim_work_credit_source_refresh")
      || message.includes("replace_work_credit_evidence");
  }
  return false;
}

export function resolveRightsHolderCreditMatch(input: {
  existingRightsHolderId?: string | null;
  externalRightsHolderIds?: Iterable<string>;
  exactNameRightsHolderIds?: Iterable<string>;
}): RightsHolderCreditMatch {
  if (input.existingRightsHolderId) return { rightsHolderId: input.existingRightsHolderId, matchType: "existing" };
  const external = [...new Set(input.externalRightsHolderIds ?? [])];
  if (external.length > 1) return { rightsHolderId: null, matchType: "conflict" };
  const externalId = external[0] ?? null;
  const exactNames = [...new Set(input.exactNameRightsHolderIds ?? [])];
  if (externalId && exactNames.length === 1 && externalId !== exactNames[0]) return { rightsHolderId: null, matchType: "conflict" };
  if (externalId) return { rightsHolderId: externalId, matchType: "external_id" };
  if (exactNames.length > 1) return { rightsHolderId: null, matchType: "conflict" };
  if (exactNames[0]) return { rightsHolderId: exactNames[0], matchType: "exact_name" };
  return { rightsHolderId: null, matchType: "unmatched" };
}

export function normalizeCreditName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da-DK")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isEligibleWorkShareRole(role: string | null | undefined) {
  const normalized = normalizeCreditName(role ?? "");
  if (!normalized) return true;
  if (
    normalized.includes("b klipper")
    || normalized.includes("klipperassistent")
    || normalized.includes("assistant editor")
    || normalized.includes("assistant klipper")
    || normalized.includes("trailer klip")
    || normalized.includes("pilot klip")
    || normalized.includes("klippekonsulent")
    || normalized.includes("supplerende klipper")
  ) return false;
  return normalized.includes("klip") || normalized.includes("edit");
}

function candidateKey(candidate: WorkCreditCandidate) {
  return candidate.rightsHolderId
    ? `holder:${candidate.rightsHolderId}`
    : `name:${normalizeCreditName(candidate.name)}`;
}

export function reconcileWorkCredits(candidates: readonly WorkCreditCandidate[]): ReconciledWorkCredit[] {
  const byKey = new Map<string, ReconciledWorkCredit>();
  const holderKeyByName = new Map<string, string>();

  for (const candidate of candidates) {
    const name = candidate.name.trim();
    const normalizedName = normalizeCreditName(name);
    if (!normalizedName) continue;
    const explicitKey = candidateKey({ ...candidate, name });
    const key = candidate.rightsHolderId
      ? explicitKey
      : holderKeyByName.get(normalizedName) ?? explicitKey;
    const existing = byKey.get(key);
    if (existing) {
      if (candidate.role?.trim() && !existing.roles.includes(candidate.role.trim())) existing.roles.push(candidate.role.trim());
      if (!existing.sources.includes(candidate.source)) existing.sources.push(candidate.source);
      if (candidate.externalPersonId && !existing.externalPersonIds.includes(candidate.externalPersonId)) existing.externalPersonIds.push(candidate.externalPersonId);
      if (!existing.rightsHolderId && candidate.rightsHolderId) existing.rightsHolderId = candidate.rightsHolderId;
      if (existing.proposedPercent == null && candidate.proposedPercent != null) existing.proposedPercent = candidate.proposedPercent;
      continue;
    }
    const row: ReconciledWorkCredit = {
      key,
      name,
      roles: candidate.role?.trim() ? [candidate.role.trim()] : [],
      sources: [candidate.source],
      externalPersonIds: candidate.externalPersonId ? [candidate.externalPersonId] : [],
      rightsHolderId: candidate.rightsHolderId ?? null,
      proposedPercent: candidate.proposedPercent ?? null,
    };
    byKey.set(key, row);
    if (candidate.rightsHolderId) {
      const nameKey = `name:${normalizedName}`;
      const nameOnly = byKey.get(nameKey);
      if (nameOnly) {
        row.roles = [...new Set([...row.roles, ...nameOnly.roles])];
        row.sources = [...new Set([...row.sources, ...nameOnly.sources])];
        row.externalPersonIds = [...new Set([...row.externalPersonIds, ...nameOnly.externalPersonIds])];
        if (row.proposedPercent == null) row.proposedPercent = nameOnly.proposedPercent;
        byKey.delete(nameKey);
      }
      holderKeyByName.set(normalizedName, key);
    }
  }

  return [...byKey.values()].sort((left, right) => {
    if (Boolean(left.rightsHolderId) !== Boolean(right.rightsHolderId)) return left.rightsHolderId ? -1 : 1;
    return left.name.localeCompare(right.name, "da");
  });
}

export function proposeWorkShareCompromise(
  participants: readonly { id: string; proposedPercent?: number | null }[],
  reservePercent: number,
) {
  if (!Number.isFinite(reservePercent) || reservePercent < 0 || reservePercent > 100) {
    throw new Error("Reserven skal være mellem 0 og 100 procent.");
  }
  if (participants.length === 0) return [];
  const targetTenths = Math.round((100 - reservePercent) * 10);
  const explicit = participants
    .map(row => row.proposedPercent)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const fallbackWeight = explicit.length ? explicit.reduce((sum, value) => sum + value, 0) / explicit.length : 1;
  const weights = participants.map(row => row.proposedPercent == null ? fallbackWeight : Math.max(0, row.proposedPercent));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || participants.length;
  const rawTenths = weights.map(weight => targetTenths * (totalWeight ? weight / totalWeight : 1 / participants.length));
  const floors = rawTenths.map(value => Math.floor(value));
  let remainder = targetTenths - floors.reduce((sum, value) => sum + value, 0);
  const order = rawTenths
    .map((value, index) => ({ index, fraction: value - floors[index], id: participants[index].id }))
    .sort((left, right) => right.fraction - left.fraction || left.id.localeCompare(right.id));
  for (let index = 0; index < remainder; index += 1) floors[order[index % order.length].index] += 1;
  remainder = targetTenths - floors.reduce((sum, value) => sum + value, 0);
  if (remainder !== 0) floors[0] += remainder;
  return participants.map((participant, index) => ({ participantId: participant.id, finalPercent: floors[index] / 10 }));
}

export function renderInvitationTemplate(template: string, values: {
  name: string;
  organisation: string;
  worksText: string;
  primaryWork: string;
}) {
  return template
    .replaceAll("{navn}", values.name)
    .replaceAll("{organisation}", values.organisation)
    .replaceAll("{værker}", values.worksText)
    .replaceAll("{værk}", values.primaryWork);
}
