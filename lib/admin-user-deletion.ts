export type UnassignedRecordKind = "auth_user" | "rights_holder";

export function parseUnassignedRecordId(value: unknown, kind: UnassignedRecordKind) {
  const raw = String(value ?? "").trim();
  const expectedPrefix = kind === "auth_user" ? "auth:" : "rights-holder:";
  return raw.startsWith(expectedPrefix) ? raw.slice(expectedPrefix.length) : raw;
}

export function isStillUnassigned(counts: { affiliations?: number | null; roles?: number | null; profiles?: number | null }) {
  return (counts.affiliations ?? 0) === 0
    && (counts.roles ?? 0) === 0
    && (counts.profiles ?? 0) === 0;
}
