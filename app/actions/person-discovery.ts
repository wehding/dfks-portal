"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getDFIPersonCredits, searchDFIPerson } from "@/app/actions/dfi";
import { getTMDBPersonCombinedCredits, getTMDBPersonExternalIds, searchTMDBPerson } from "@/app/actions/tmdb";
import { searchWikidataPeople } from "@/app/actions/wikidata";
import { personSearchVariants, scorePersonName } from "@/lib/person-name-match";

export type PersonCandidate = {
  key: string;
  source: "dfi" | "tmdb" | "wikidata";
  name: string;
  score: number;
  reason: "exact" | "without-middle-name" | "initial-variant" | "spelling-variant" | "weak";
  knownFor: string[];
  description?: string | null;
  imageUrl?: string | null;
  portraitUrls?: string[];
  sourceId: string;
};

function candidateName(value: Record<string, unknown>) {
  return String(value.FullName ?? value.Name ?? value.name ?? [value.FirstName, value.LastName].filter(Boolean).join(" ") ?? "").trim();
}

function includeCandidate(query: string, name: string, variant?: string) {
  // Scor mod både den oprindelige query og den variant, der gav hittet —
  // ellers kan en korrekt profil fundet via en stavevariant falde under tærsklen.
  const primary = scorePersonName(query, name);
  const secondary = variant && variant.trim() && variant !== query ? scorePersonName(variant, name) : null;
  const match = secondary && secondary.score > primary.score ? secondary : primary;
  const threshold = query.trim().split(/\s+/).length === 1 ? 0.8 : 0.62;
  return { ...match, include: match.score >= threshold };
}

function extensionFromContentType(contentType: string | null) {
  if (!contentType) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "jpg";
}

async function downloadPortraitToStorage(userId: string, sourceUrl: string) {
  const response = await fetch(sourceUrl, { headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*,*/*" } });
  if (!response.ok) throw new Error("Portrættet kunne ikke hentes fra kilden.");
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error("Portrætkilden returnerede ikke et billede.");
  const buffer = await response.arrayBuffer();
  const db = createServiceClient();
  const path = `${userId}/external-${Date.now()}.${extensionFromContentType(contentType)}`;
  const { error } = await db.storage.from("avatars").upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

export async function discoverPersonCandidates(fullName: string, alternativeNames: string[] = []) {
  const query = fullName.trim();
  if (!query) return { success: false, error: "Skriv dit navn.", candidates: [] as PersonCandidate[] };
  const variants = personSearchVariants(query, alternativeNames);
  const candidates = new Map<string, PersonCandidate>();
  const sourceErrors = { dfi: false, tmdb: false, wikidata: false };

  await Promise.all(variants.map(async variant => {
    const [dfi, tmdb, wikidata] = await Promise.all([
      searchDFIPerson(undefined, undefined, variant).catch(() => ({ success: false, results: [] })),
      searchTMDBPerson(variant).catch(() => ({ success: false, results: [] })),
      searchWikidataPeople(variant).catch(() => { sourceErrors.wikidata = true; return []; }),
    ]);
    if (!dfi.success) sourceErrors.dfi = true;
    if (!tmdb.success) sourceErrors.tmdb = true;

    for (const row of dfi.success ? dfi.results ?? [] : []) {
      const sourceId = String(row.Id ?? "");
      const name = candidateName(row);
      const match = includeCandidate(query, name, variant);
      if (!sourceId || !name || !match.include) continue;
      const key = `dfi:${sourceId}`;
      const previous = candidates.get(key);
      if (!previous || previous.score < match.score) {
        const details = await getDFIPersonCredits(Number(sourceId)).catch(() => null);
        const knownFor = details?.success
          ? (details.credits ?? []).map((credit: Record<string, unknown>) => String(credit.Title ?? credit.DanishTitle ?? "")).filter(Boolean).slice(0, 5)
          : [];
        const portraitUrls = details?.success ? details.portraitUrls ?? [] : [];
        candidates.set(key, {
          key,
          source: "dfi",
          sourceId,
          name,
          score: match.score,
          reason: match.reason,
          knownFor,
          imageUrl: portraitUrls[0] ?? (details?.success ? details.portraitUrl ?? null : null),
          portraitUrls,
        });
      }
    }

    for (const row of tmdb.success ? tmdb.results ?? [] : []) {
      const sourceId = String(row.id ?? "");
      const name = String(row.name ?? "").trim();
      const match = includeCandidate(query, name, variant);
      if (!sourceId || !name || !match.include) continue;
      const knownFor = Array.isArray(row.known_for) ? row.known_for.map((item: Record<string, unknown>) => String(item.title ?? item.name ?? "")).filter(Boolean).slice(0, 4) : [];
      const key = `tmdb:${sourceId}`;
      const previous = candidates.get(key);
      const portraitUrl = row.profile_path ? `https://image.tmdb.org/t/p/original${row.profile_path}` : null;
      if (!previous || previous.score < match.score) candidates.set(key, { key, source: "tmdb", sourceId, name, score: match.score, reason: match.reason, knownFor, imageUrl: portraitUrl, portraitUrls: portraitUrl ? [portraitUrl] : [] });
    }

    for (const row of wikidata) {
      const match = includeCandidate(query, row.name, variant);
      if (!match.include) continue;
      const key = `wikidata:${row.qid}`;
      const previous = candidates.get(key);
      if (!previous || previous.score < match.score) candidates.set(key, { key, source: "wikidata", sourceId: row.qid, name: row.name, score: match.score, reason: match.reason, knownFor: [], description: row.description });
    }
  }));

  const result = Array.from(candidates.values()).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "da-DK"));
  return { success: true, candidates: result, sourceErrors };
}

export async function enrichPersonCandidate(candidate: PersonCandidate) {
  if (candidate.source === "dfi") {
    const credits = await getDFIPersonCredits(Number(candidate.sourceId));
    return { ...candidate, knownFor: (credits.success ? credits.credits ?? [] : []).map((credit: Record<string, unknown>) => String(credit.Title ?? credit.DanishTitle ?? "")).filter(Boolean).slice(0, 5) };
  }
  if (candidate.source === "tmdb") {
    const credits = await getTMDBPersonCombinedCredits(Number(candidate.sourceId));
    return { ...candidate, knownFor: (credits.success ? credits.crew ?? [] : []).map((credit: Record<string, unknown>) => String(credit.title ?? credit.name ?? "")).filter(Boolean).slice(0, 5) };
  }
  return candidate;
}

export async function confirmExternalPersonIdentity(
  selected: PersonCandidate[],
  searchedName?: string,
  submittedAlternativeNames: string[] = [],
  selectedPortraitUrl?: string | null
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: holder } = await db.from("rettighedshavere").select("id, full_name, alternative_names").eq("user_id", user.id).maybeSingle();
  if (!holder) return { success: false, error: "Rettighedshaveren blev ikke fundet." };
  const verifiedSearchName = searchedName?.trim() || holder.full_name;
  if (holder.full_name && scorePersonName(holder.full_name, verifiedSearchName).score < 0.62) return { success: false, error: "Søgenavnet afviger for meget fra din profil." };
  const verifiedAlternativeNames = Array.from(new Set([...(holder.alternative_names ?? []), ...submittedAlternativeNames.map(name => name.trim()).filter(Boolean)]));
  const discovery = await discoverPersonCandidates(verifiedSearchName, verifiedAlternativeNames);
  const allowed = new Map((discovery.success ? discovery.candidates : []).map(candidate => [candidate.key, candidate]));
  const trustedSelected = selected.map(candidate => allowed.get(candidate.key)).filter((candidate): candidate is PersonCandidate => Boolean(candidate));
  if (trustedSelected.length !== selected.length) return { success: false, error: "Et personmatch kunne ikke verificeres. Søg igen." };
  const tmdb = trustedSelected.filter(candidate => candidate.source === "tmdb");
  const tmdbExternal = await Promise.all(tmdb.map(candidate => getTMDBPersonExternalIds(Number(candidate.sourceId))));
  const variants = Array.from(new Set([...verifiedAlternativeNames, ...trustedSelected.map(candidate => candidate.name)])).filter(Boolean);
  const rows: Array<{ rights_holder_id: string; source: "dfi" | "tmdb" | "wikidata" | "imdb"; external_id: string; display_name: string | null; match_score: number; match_reason: string; selected_automatically: boolean }> = trustedSelected.map(candidate => ({
    rights_holder_id: holder.id,
    source: candidate.source,
    external_id: candidate.sourceId,
    display_name: candidate.name,
    match_score: candidate.score,
    match_reason: candidate.reason,
    selected_automatically: candidate.score >= 0.78,
  }));
  tmdbExternal.forEach((external, index) => {
    if (external.wikidata_qid && !rows.some(row => row.source === "wikidata" && row.external_id === external.wikidata_qid)) rows.push({ rights_holder_id: holder.id, source: "wikidata", external_id: external.wikidata_qid, display_name: tmdb[index]?.name ?? null, match_score: tmdb[index]?.score ?? 0, match_reason: "tmdb-external-id", selected_automatically: true });
    if (external.imdb_nm && !rows.some(row => row.source === "imdb" && row.external_id === external.imdb_nm)) rows.push({ rights_holder_id: holder.id, source: "imdb", external_id: external.imdb_nm, display_name: tmdb[index]?.name ?? null, match_score: tmdb[index]?.score ?? 0, match_reason: "tmdb-external-id", selected_automatically: true });
  });
  const externalIds = rows.map(row => row.external_id);
  if (externalIds.length) {
    const { data: conflicts } = await db.from("rights_holder_external_identities").select("source,external_id,rights_holder_id").in("external_id", externalIds).neq("rights_holder_id", holder.id);
    const conflict = (conflicts ?? []).find(item => rows.some(row => row.source === item.source && row.external_id === item.external_id));
    if (conflict) return { success: false, error: "En valgt navneprofil er allerede knyttet til en anden bruger. Kontakt admin." };
  }
  const portraitCandidates = trustedSelected.flatMap(candidate => candidate.portraitUrls?.length ? candidate.portraitUrls : candidate.imageUrl ? [candidate.imageUrl] : []);
  const portraitUrl = selectedPortraitUrl && portraitCandidates.includes(selectedPortraitUrl)
    ? selectedPortraitUrl
    : portraitCandidates.length === 1
      ? portraitCandidates[0]
      : null;
  let storedPortraitUrl: string | null = null;
  if (portraitUrl) {
    try {
      storedPortraitUrl = await downloadPortraitToStorage(user.id, portraitUrl);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Portrættet kunne ikke gemmes." };
    }
  }
  const { error } = await db
    .from("rettighedshavere")
    .update({ alternative_names: variants, ...(storedPortraitUrl ? { portrait_url: storedPortraitUrl } : {}) })
    .eq("id", holder.id);
  if (error) return { success: false, error: error.message };
  const { error: deleteError } = await db.from("rights_holder_external_identities").delete().eq("rights_holder_id", holder.id);
  if (deleteError) return { success: false, error: deleteError.message };
  if (rows.length) {
    const { error: insertError } = await db.from("rights_holder_external_identities").insert(rows);
    if (insertError) return { success: false, error: insertError.message };
  }
  return { success: true, portraitUrl: storedPortraitUrl };
}
