import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDFIPersonCredits, normalizeDfiSeriesResults, searchDFIPerson } from "@/app/actions/dfi";
import { getTMDBPersonCombinedCredits, searchTMDBPerson } from "@/app/actions/tmdb";
import { cleanDfiTitle, extractDfiPremiereYear } from "@/lib/dfi-metadata";
import { isRightBearingOnboardingRole } from "@/lib/onboarding-credit-role";
import {
  reconcileInvitationWorks,
  resolveExactInvitationPerson,
  type InvitationSourceStatus,
  type InvitationWorkCandidate,
  type InvitationWorkLookup,
} from "@/lib/invitation-works";

const SOURCE_REQUEST_TIMEOUT_MS = 2_500;
const LOOKUP_DEADLINE_MS = 6_000;
const DEFAULT_KEYWORDS = ["klip", "edit"];

type LooseRow = Record<string, unknown>;

function asRows(value: unknown): LooseRow[] {
  return Array.isArray(value) ? value.filter((item): item is LooseRow => Boolean(item && typeof item === "object")) : [];
}

function dfiPersonName(row: LooseRow) {
  return String(row.FullName ?? row.Name ?? [row.FirstName, row.LastName].filter(Boolean).join(" ") ?? "").trim();
}

function relevantRole(role: unknown, keywords: readonly string[]) {
  const value = String(role ?? "").trim();
  if (!value || /assist|elev|trainee|prakt/i.test(value)) return false;
  return keywords.some(keyword => value.toLocaleLowerCase("da-DK").includes(keyword))
    && isRightBearingOnboardingRole(value);
}

function timeoutResult<T>(promise: Promise<T>, fallback: T) {
  return new Promise<T>(resolve => {
    const timeout = setTimeout(() => resolve(fallback), LOOKUP_DEADLINE_MS);
    void promise.then(value => {
      clearTimeout(timeout);
      resolve(value);
    }).catch(() => {
      clearTimeout(timeout);
      resolve(fallback);
    });
  });
}

async function resolveDfi(names: string[], savedIds: number[], keywords: string[]) {
  return timeoutResult((async (): Promise<{ status: InvitationSourceStatus; works: InvitationWorkCandidate[] }> => {
    let ids = savedIds;
    if (!ids.length) {
      const searches = await Promise.all(names.map(name => searchDFIPerson(undefined, undefined, name, { timeoutMs: SOURCE_REQUEST_TIMEOUT_MS })));
      if (searches.every(result => !result.success)) return { status: "unavailable", works: [] };
      const candidates = searches.flatMap(result => result.success ? asRows(result.results) : [])
        .map(row => ({ id: row.Id as string | number | undefined, name: dfiPersonName(row) }));
      const match = resolveExactInvitationPerson(names, candidates);
      if (match.status !== "matched") return { status: match.status, works: [] };
      ids = [match.id];
    }
    const details = await Promise.all(ids.map(id => getDFIPersonCredits(id, { timeoutMs: SOURCE_REQUEST_TIMEOUT_MS })));
    const successful = details.filter(result => result.success);
    if (!successful.length) return { status: "unavailable", works: [] };
    const rawCredits = successful.flatMap(result => asRows(result.credits))
      .filter(credit => relevantRole(credit.Description ?? credit.Type, keywords));
    const credits = await normalizeDfiSeriesResults(rawCredits as never[], { timeoutMs: SOURCE_REQUEST_TIMEOUT_MS });
    const works = asRows(credits).flatMap(credit => {
      const title = cleanDfiTitle(String(credit.Title ?? credit.DanishTitle ?? "")).trim();
      const externalId = String(credit.Id ?? "").trim();
      if (!title) return [];
      return [{
        id: externalId ? `dfi-${externalId}` : `dfi-title-${title}`,
        title,
        year: extractDfiPremiereYear(credit as never) ?? null,
        sources: ["DFI" as const],
        verification: "external_candidate" as const,
        identityKeys: externalId ? [`dfi:${externalId}`] : [],
      }];
    });
    return { status: "ok", works };
  })(), { status: "unavailable" as const, works: [] });
}

async function resolveTmdb(names: string[], savedIds: number[], keywords: string[]) {
  return timeoutResult((async (): Promise<{ status: InvitationSourceStatus; works: InvitationWorkCandidate[] }> => {
    let ids = savedIds;
    if (!ids.length) {
      const searches = await Promise.all(names.map(name => searchTMDBPerson(name, { timeoutMs: SOURCE_REQUEST_TIMEOUT_MS, retry: false })));
      if (searches.every(result => !result.success)) return { status: "unavailable", works: [] };
      const candidates = searches.flatMap(result => result.success ? asRows(result.results) : [])
        .map(row => ({ id: row.id as string | number | undefined, name: String(row.name ?? "") }));
      const match = resolveExactInvitationPerson(names, candidates);
      if (match.status !== "matched") return { status: match.status, works: [] };
      ids = [match.id];
    }
    const details = await Promise.all(ids.map(id => getTMDBPersonCombinedCredits(id, { timeoutMs: SOURCE_REQUEST_TIMEOUT_MS, retry: false })));
    const successful = details.filter(result => result.success);
    if (!successful.length) return { status: "unavailable", works: [] };
    const works = successful.flatMap(result => asRows(result.crew))
      .filter(credit => relevantRole(credit.job, keywords))
      .flatMap(credit => {
        const title = String(credit.title ?? credit.name ?? "").trim();
        const externalId = String(credit.id ?? "").trim();
        const date = String(credit.release_date ?? credit.first_air_date ?? "");
        const parsedYear = Number.parseInt(date.slice(0, 4), 10);
        if (!title) return [];
        return [{
          id: externalId ? `tmdb-${externalId}` : `tmdb-title-${title}`,
          title,
          year: Number.isFinite(parsedYear) ? parsedYear : null,
          sources: ["TMDb" as const],
          verification: "external_candidate" as const,
          identityKeys: externalId ? [`tmdb:${externalId}`] : [],
        }];
      });
    return { status: "ok", works };
  })(), { status: "unavailable" as const, works: [] });
}

export async function resolveInvitationWorks(input: {
  db: SupabaseClient;
  orgId: string;
  rightsHolderId: string;
  preferredWorkId?: string | null;
}): Promise<InvitationWorkLookup> {
  const { db, orgId, rightsHolderId, preferredWorkId } = input;
  const [{ data: holder, error: holderError }, { data: identities, error: identityError }, { data: org }, { data: assignments }, { data: participants }] = await Promise.all([
    db.from("rettighedshavere").select("full_name,alternative_names,dfi_person_id,tmdb_person_id,org_affiliations!inner(org_id)").eq("id", rightsHolderId).eq("org_affiliations.org_id", orgId).maybeSingle(),
    db.from("rights_holder_external_identities").select("source,external_id").eq("rights_holder_id", rightsHolderId).in("source", ["dfi", "tmdb"]),
    db.from("organisations").select("terminology").eq("id", orgId).maybeSingle(),
    db.from("work_assignments").select("work_id,works(title,year,dfi_id,tmdb_id)").eq("org_id", orgId).eq("rights_holder_id", rightsHolderId).limit(100),
    db.from("work_share_participants").select("work_id,source_tags,work_share_cases!inner(org_id),works(title,year,dfi_id,tmdb_id)").eq("rights_holder_id", rightsHolderId).eq("work_share_cases.org_id", orgId).is("excluded_at", null).limit(100),
  ]);
  if (holderError || identityError || !holder) throw new Error(holderError?.message ?? identityError?.message ?? "Rettighedshaveren blev ikke fundet i organisationen.");

  const names = [...new Set([holder.full_name, ...(holder.alternative_names ?? [])].map(value => String(value ?? "").trim()).filter(Boolean))].slice(0, 8);
  const terminology = org?.terminology as { onboarding_keywords?: unknown } | null;
  const configuredKeywords = Array.isArray(terminology?.onboarding_keywords)
    ? terminology.onboarding_keywords.map(value => String(value).trim().toLocaleLowerCase("da-DK")).filter(Boolean)
    : [];
  const keywords = configuredKeywords.length ? configuredKeywords : DEFAULT_KEYWORDS;
  const savedDfiIds = [...new Set([
    ...(identities ?? []).filter(row => row.source === "dfi").map(row => Number(row.external_id)),
    Number(holder.dfi_person_id),
  ].filter(value => Number.isFinite(value) && value > 0))];
  const savedTmdbIds = [...new Set([
    ...(identities ?? []).filter(row => row.source === "tmdb").map(row => Number(row.external_id)),
    Number(holder.tmdb_person_id),
  ].filter(value => Number.isFinite(value) && value > 0))];

  const localRows = [
    ...(assignments ?? []).map(row => ({ ...row, sources: ["Portal" as const] })),
    ...(participants ?? []).map(row => ({
      ...row,
      sources: (Array.isArray(row.source_tags) && row.source_tags.length
        ? row.source_tags.map(source => source === "dfi" ? "DFI" : source === "tmdb" ? "TMDb" : source === "member" ? "Indtastet" : "Portal")
        : ["Portal"]) as InvitationWorkCandidate["sources"],
    })),
  ].flatMap(row => {
    const work = row.works as unknown as { title?: string | null; year?: number | null; dfi_id?: string | null; tmdb_id?: number | null } | null;
    if (!work?.title) return [];
    return [{
      id: String(row.work_id),
      title: work.title,
      year: work.year ?? null,
      sources: row.sources,
      verification: "linked" as const,
      identityKeys: [work.dfi_id ? `dfi:${work.dfi_id}` : "", work.tmdb_id ? `tmdb:${work.tmdb_id}` : ""].filter(Boolean),
      preferred: row.work_id === preferredWorkId,
    }];
  });

  const [dfi, tmdb] = names.length
    ? await Promise.all([resolveDfi(names, savedDfiIds, keywords), resolveTmdb(names, savedTmdbIds, keywords)])
    : [{ status: "none" as const, works: [] }, { status: "none" as const, works: [] }];
  const works = reconcileInvitationWorks([...localRows, ...dfi.works, ...tmdb.works]);
  const localCount = works.filter(work => work.verification === "linked").length;
  const warnings = [
    ...(dfi.status === "ambiguous" ? ["DFI fandt flere personer med samme navn. DFI-værker er derfor ikke medtaget."] : []),
    ...(tmdb.status === "ambiguous" ? ["TMDb fandt flere personer med samme navn. TMDb-værker er derfor ikke medtaget."] : []),
    ...(dfi.status === "unavailable" ? ["DFI kunne ikke kontaktes. Invitationen kan stadig sendes med øvrige værker."] : []),
    ...(tmdb.status === "unavailable" ? ["TMDb kunne ikke kontaktes. Invitationen kan stadig sendes med øvrige værker."] : []),
  ];
  return {
    works,
    counts: { local: localCount, external: works.length - localCount, total: works.length },
    sourceStatus: { local: localRows.length ? "ok" : "none", dfi: dfi.status, tmdb: tmdb.status },
    warnings,
  };
}
