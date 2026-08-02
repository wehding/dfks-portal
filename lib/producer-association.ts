import { companyMatchScore, normalizeCompanyBaseName, normalizeCompanyName, type ProductionCompanyOption } from "@/lib/production-companies";

export const PRODUCENTFORENINGEN_GROUPS = [
  { code: "documentary", label: "Dokumentarfilm", url: "https://pro-f.dk/dokumentarfilm" },
  { code: "fiction", label: "Spillefilm - fiktion", url: "https://pro-f.dk/spillefilm-fiktion" },
  { code: "tv", label: "TV", url: "https://pro-f.dk/tv-1" },
  { code: "advertising", label: "Reklamefilm", url: "https://pro-f.dk/reklamefilm-1" },
  { code: "dubbing", label: "Dubbing", url: "https://pro-f.dk/dubbing-2" },
  { code: "animation", label: "Animation", url: "https://pro-f.dk/animation-0" },
] as const;

export type ProducerAssociationGroupCode = typeof PRODUCENTFORENINGEN_GROUPS[number]["code"];
export type ProducerAssociationMembershipType = "ordinary" | "associate" | "unknown";

export type ProducerAssociationSourceRow = {
  groupCode: ProducerAssociationGroupCode;
  groupLabel: string;
  sourceUrl: string;
  sourceName: string;
  address: string | null;
  postalCity: string | null;
  ownerCeoText: string | null;
  website: string | null;
  membershipType: ProducerAssociationMembershipType;
  sourceHash?: string;
};

export type ProducerAssociationSourceProducer = {
  sourceKey: string;
  sourceName: string;
  ownerCeoText: string | null;
  website: string | null;
  groups: ProducerAssociationSourceRow[];
};

export type ProducerAssociationCandidate = {
  id: string;
  name: string;
  score: number;
  matchMethod: "website" | "exact_name" | "fuzzy_name";
};

export type ProducerAssociationPreviewItem = ProducerAssociationSourceProducer & {
  recommendation: "match" | "create" | "review";
  suggestedEmployerId: string | null;
  suggestedEmployerName: string | null;
  candidates: ProducerAssociationCandidate[];
};

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " " };
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, entity: string) => named[entity.toLowerCase()] ?? `&${entity};`)
    .replace(/\s+/g, " ")
    .trim();
}

function tableCells(markup: string, tag: "th" | "td") {
  return [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
    .map(match => decodeHtml(match[1]));
}

export function extractAssociationScriptUrl(pageHtml: string) {
  const sources = [...pageHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  const source = sources.find(value => {
    try { return new URL(value, "https://pro-f.dk").hostname === "cms.workflow-automation.podio.com"; }
    catch { return false; }
  });
  if (!source) throw new Error("Producentforeningens medlemsdatakilde blev ikke fundet.");
  const url = new URL(source, "https://pro-f.dk");
  if (url.protocol !== "https:" || url.hostname !== "cms.workflow-automation.podio.com") throw new Error("Medlemsdatakilden har et ugyldigt domæne.");
  return url.toString();
}

export function parseAssociationTableScript(
  script: string,
  group: { code: ProducerAssociationGroupCode; label: string; url: string },
) {
  const prefix = "document.write(";
  const start = script.indexOf(prefix);
  const end = script.lastIndexOf(");");
  if (start < 0 || end <= start) throw new Error(`Medlemslisten for ${group.label} har et ukendt format.`);
  const stringLiteral = script.slice(start + prefix.length, end).trim();
  if (!stringLiteral.startsWith('"') || !stringLiteral.endsWith('"')) throw new Error(`Medlemslisten for ${group.label} kunne ikke aflæses sikkert.`);

  let tableHtml = "";
  try { tableHtml = JSON.parse(stringLiteral) as string; }
  catch { throw new Error(`Medlemslisten for ${group.label} indeholder ugyldige data.`); }

  const headerRow = tableHtml.match(/<thead\b[^>]*>[\s\S]*?<tr\b[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/i)?.[1] ?? "";
  const headers = tableCells(headerRow, "th");
  if (!headers.includes("Virksomhedsnavn") || !headers.includes("Ejere / CEO") || !headers.includes("Website")) {
    throw new Error(`Medlemslisten for ${group.label} mangler forventede kolonner.`);
  }

  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(match => tableCells(match[1], "td"))
    .filter(cells => cells.length > 0)
    .map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
  if (!rows.length) throw new Error(`Medlemslisten for ${group.label} er tom. Ingen data er ændret.`);

  return rows.map(row => ({
    groupCode: group.code,
    groupLabel: group.label,
    sourceUrl: group.url,
    sourceName: row["Virksomhedsnavn"].trim(),
    address: row.Adresse?.trim() || null,
    postalCity: row["Post nr. & By"]?.trim() || null,
    ownerCeoText: row["Ejere / CEO"]?.trim() || null,
    website: normalizeSourceWebsite(row.Website),
    membershipType: row.Medlemstype?.trim() ? normalizeMembershipType(row.Medlemstype) : "ordinary",
  } satisfies ProducerAssociationSourceRow)).filter(row => row.sourceName);
}

export function normalizeMembershipType(value?: string | null): ProducerAssociationMembershipType {
  const normalized = normalizeCompanyName(value ?? "");
  if (normalized === "associate" || normalized.startsWith("associeret")) return "associate";
  if (normalized === "ordinary" || normalized.startsWith("ordinaer") || normalized.startsWith("ordinær")) return "ordinary";
  return "unknown";
}

export function normalizeSourceWebsite(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || /^https?:\/\/(?:n\/?a)?\/?$/i.test(trimmed)) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString().replace(/\/$/, "") : null;
  } catch { return null; }
}

export function websiteDomain(value?: string | null) {
  if (!value) return "";
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

export function groupAssociationRows(rows: ProducerAssociationSourceRow[]) {
  const grouped = new Map<string, ProducerAssociationSourceProducer>();
  for (const row of rows) {
    const sourceKey = normalizeCompanyBaseName(row.sourceName) || normalizeCompanyName(row.sourceName);
    const current = grouped.get(sourceKey);
    if (!current) {
      grouped.set(sourceKey, { sourceKey, sourceName: row.sourceName, ownerCeoText: row.ownerCeoText, website: row.website, groups: [row] });
      continue;
    }
    if (!current.ownerCeoText && row.ownerCeoText) current.ownerCeoText = row.ownerCeoText;
    if (!current.website && row.website) current.website = row.website;
    current.groups.push(row);
  }
  return [...grouped.values()].sort((left, right) => left.sourceName.localeCompare(right.sourceName, "da-DK"));
}

export function buildAssociationPreview(
  rows: ProducerAssociationSourceRow[],
  employers: Array<ProductionCompanyOption & { websites?: string[] }>,
) {
  return groupAssociationRows(rows).map(producer => {
    const sourceDomain = websiteDomain(producer.website);
    const candidates = employers.map(employer => {
      const employerDomains = (employer.websites ?? employer.legalEntities.map(entity => entity.website ?? "")).map(websiteDomain).filter(Boolean);
      const websiteMatch = Boolean(sourceDomain && employerDomains.includes(sourceDomain));
      const score = websiteMatch ? 120 : companyMatchScore(employer, producer.sourceName);
      const exact = [employer.canonicalName, ...employer.aliases, ...employer.legalEntities.map(entity => entity.legalName)]
        .some(name => normalizeCompanyBaseName(name) === normalizeCompanyBaseName(producer.sourceName));
      return { id: employer.employerId, name: employer.canonicalName, score, matchMethod: websiteMatch ? "website" as const : exact ? "exact_name" as const : "fuzzy_name" as const };
    }).filter(candidate => candidate.score > 0).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "da-DK")).slice(0, 3);
    const best = candidates[0];
    const second = candidates[1];
    const secure = Boolean(best && best.score >= 100 && (!second || best.score - second.score >= 5));
    return {
      ...producer,
      recommendation: secure ? "match" as const : best && best.score >= 70 ? "review" as const : "create" as const,
      suggestedEmployerId: best?.id ?? null,
      suggestedEmployerName: best?.name ?? null,
      candidates,
    } satisfies ProducerAssociationPreviewItem;
  });
}
