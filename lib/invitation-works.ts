export type InvitationWorkSource = "Portal" | "Indtastet" | "DFI" | "TMDb";
export type InvitationSourceStatus = "ok" | "none" | "ambiguous" | "unavailable";

export type InvitationWorkCandidate = {
  id: string;
  title: string;
  year: number | null;
  sources: InvitationWorkSource[];
  verification: "linked" | "external_candidate";
  identityKeys?: string[];
  preferred?: boolean;
};

export type InvitationWork = Omit<InvitationWorkCandidate, "identityKeys" | "preferred">;

export type InvitationWorkLookup = {
  works: InvitationWork[];
  counts: { local: number; external: number; total: number };
  sourceStatus: { local: "ok" | "none"; dfi: InvitationSourceStatus; tmdb: InvitationSourceStatus };
  warnings: string[];
};

export function normalizeInvitationIdentity(value: string) {
  return value
    .toLocaleLowerCase("da-DK")
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "aa")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function resolveExactInvitationPerson(
  acceptedNames: readonly string[],
  candidates: readonly { id: string | number | null | undefined; name: string | null | undefined }[],
): { status: "matched"; id: number } | { status: "none" | "ambiguous"; id: null } {
  const accepted = new Set(acceptedNames.map(normalizeInvitationIdentity).filter(Boolean));
  const matches = new Map<number, true>();
  for (const candidate of candidates) {
    const id = Number(candidate.id);
    if (!Number.isFinite(id) || !accepted.has(normalizeInvitationIdentity(candidate.name ?? ""))) continue;
    matches.set(id, true);
  }
  const ids = [...matches.keys()];
  if (ids.length === 1) return { status: "matched", id: ids[0] };
  return { status: ids.length > 1 ? "ambiguous" : "none", id: null };
}

function sameTitleAndYear(left: InvitationWorkCandidate, right: InvitationWorkCandidate) {
  if (normalizeInvitationIdentity(left.title) !== normalizeInvitationIdentity(right.title)) return false;
  if (left.year && right.year) return Math.abs(left.year - right.year) <= 1;
  return true;
}

const SOURCE_ORDER: InvitationWorkSource[] = ["Portal", "Indtastet", "DFI", "TMDb"];

export function reconcileInvitationWorks(candidates: readonly InvitationWorkCandidate[]): InvitationWork[] {
  const merged: InvitationWorkCandidate[] = [];
  for (const candidate of candidates.filter(item => item.title.trim())) {
    const keys = new Set(candidate.identityKeys ?? []);
    const existing = merged.find(item =>
      (item.identityKeys ?? []).some(key => keys.has(key)) || sameTitleAndYear(item, candidate)
    );
    if (!existing) {
      merged.push({ ...candidate, sources: [...new Set(candidate.sources)], identityKeys: [...keys] });
      continue;
    }
    existing.sources = [...new Set([...existing.sources, ...candidate.sources])];
    existing.identityKeys = [...new Set([...(existing.identityKeys ?? []), ...keys])];
    existing.verification = existing.verification === "linked" || candidate.verification === "linked" ? "linked" : "external_candidate";
    existing.preferred = Boolean(existing.preferred || candidate.preferred);
    if (!existing.year && candidate.year) existing.year = candidate.year;
  }

  return merged
    .sort((left, right) => Number(Boolean(right.preferred)) - Number(Boolean(left.preferred))
      || (right.year ?? 0) - (left.year ?? 0)
      || left.title.localeCompare(right.title, "da-DK"))
    .map(work => ({
      id: work.id,
      title: work.title,
      year: work.year,
      verification: work.verification,
      sources: SOURCE_ORDER.filter(source => work.sources.includes(source)),
    }));
}

export function formatInvitationWorks(works: readonly InvitationWork[], maximum = 10) {
  const shown = works.slice(0, maximum);
  if (!shown.length) {
    return "Vi kunne ikke hente en værksliste nu. Du kan gennemgå og tilføje dine værker i portalen.";
  }
  const lines = shown.map(work => {
    const candidateLabel = work.verification === "external_candidate" ? " · mulig kreditering" : "";
    return `• ${work.title}${work.year ? ` (${work.year})` : ""} · ${work.sources.join(" · ")}${candidateLabel}`;
  });
  if (works.length > shown.length) lines.push(`• ${works.length - shown.length} øvrige titler kan ses i portalen`);
  return lines.join("\n");
}

export function formatInvitationWorkTitles(works: readonly InvitationWork[], maximum = 10) {
  const shown = works.slice(0, maximum);
  if (!shown.length) {
    return "Vi kunne ikke hente en værksliste nu. Du kan gennemgå og tilføje dine værker i portalen.";
  }
  const lines = shown.map(work => `• ${work.title}`);
  if (works.length > shown.length) lines.push(`• ${works.length - shown.length} øvrige titler kan ses i portalen`);
  return lines.join("\n");
}
