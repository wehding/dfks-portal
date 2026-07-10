export type DfiMetadata = Record<string, unknown>;
export type DfiWorkType = "kortfilm" | "spillefilm" | "tv-serie" | "dokumentar-serie" | "dokumentarfilm";

const DFI_CATEGORY_TO_WORK_TYPE: Record<string, DfiWorkType> = {
  "dk/spillefilm": "spillefilm",
  "u/spillefilm": "spillefilm",
  "tv-film": "spillefilm",
  "dk/dokumentarfilm": "dokumentarfilm",
  "u/dokumentarfilm": "dokumentarfilm",
  "tv-dokumentar": "dokumentarfilm",
  "dokumentariske optagelser": "dokumentarfilm",
  dokumentarserie: "dokumentar-serie",
  "tv-serie": "tv-serie",
  fiktionsserie: "tv-serie",
  "dk/kort fiktion": "kortfilm",
  "u/kort fiktion": "kortfilm",
};

const DFI_AMBIGUOUS_CATEGORIES = new Set(["", "dk/eksperimentalfilm", "antologi"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveYear(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function normalizeDfiLabel(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function mapDfiTypeFallback(type: unknown) {
  const normalized = normalizeDfiLabel(type);
  if (!normalized) return null;
  return DFI_CATEGORY_TO_WORK_TYPE[normalized] ?? null;
}

export function mapDfiWorkType(
  category: unknown,
  type: unknown,
  fallback: DfiWorkType = "spillefilm"
): DfiWorkType {
  const normalizedCategory = normalizeDfiLabel(category);
  const categoryMatch = DFI_CATEGORY_TO_WORK_TYPE[normalizedCategory];
  if (categoryMatch) return categoryMatch;

  if (DFI_AMBIGUOUS_CATEGORIES.has(normalizedCategory)) {
    return mapDfiTypeFallback(type) ?? fallback;
  }

  return fallback;
}

function imagePath(image: Record<string, unknown>) {
  const cropped = Array.isArray(image.ScaledCropped) ? image.ScaledCropped : [];
  const preferredNames = ["portrait34s", "portrait34m", "portrait34l"];
  const portrait = preferredNames
    .map(preferredName => cropped.find(item => {
      if (!isRecord(item)) return false;
      return textValue(item.Name)?.toLowerCase() === preferredName;
    }))
    .find(Boolean);
  if (isRecord(portrait)) {
    const path = textValue(portrait.Path);
    if (path) return path;
  }
  return textValue(image.PathMicr) ?? textValue(image.PathMini) ?? textValue(image.Path);
}

export function extractDfiPosterUrl(metadata: unknown) {
  if (!isRecord(metadata)) return null;

  const posters = Array.isArray(metadata.Posters) ? metadata.Posters : [];
  for (const poster of posters) {
    if (!isRecord(poster)) continue;
    const path = imagePath(poster);
    if (path) return path;
  }

  return null;
}

export function extractDfiPremiereYear(metadata: unknown) {
  if (!isRecord(metadata)) return null;

  const premiere = Array.isArray(metadata.Premiere) ? metadata.Premiere : [];
  const premiereYears = premiere
    .map(item => {
      if (!isRecord(item)) return null;
      const date = textValue(item.PremiereDate);
      return date ? positiveYear(date.substring(0, 4)) : null;
    })
    .filter((year): year is number => year !== null)
    .sort((a, b) => a - b);

  return premiereYears[0]
    ?? positiveYear(metadata.ReleaseYear)
    ?? positiveYear(metadata.Year)
    ?? positiveYear(metadata.ProductionYear)
    ?? positiveYear(metadata.ReleaseYearEnd);
}

export function extractDfiDirectors(metadata: unknown) {
  if (!isRecord(metadata)) return [];

  const directFields = [
    metadata.Director,
    metadata.Directors,
    metadata.Director1,
    metadata.Director2,
  ];
  const directNames = directFields.flatMap(value => {
    if (Array.isArray(value)) {
      return value
        .map(item => {
          if (typeof item === "string") return item.trim();
          if (isRecord(item)) return textValue(item.Name) ?? textValue(item.FullName) ?? textValue(item.Title) ?? "";
          return "";
        })
        .filter(Boolean);
    }
    const text = textValue(value);
    return text ? [text] : [];
  });

  const credits = Array.isArray(metadata.PersonCredits) ? metadata.PersonCredits : [];
  const creditNames = credits
    .filter(item => {
      if (!isRecord(item)) return false;
      const typeCode = String(item.TypeCode ?? "").trim().toLowerCase();
      const type = String(item.Type ?? "").trim().toLowerCase();
      const description = String(item.Description ?? "").trim().toLowerCase();
      const functionText = String(item.Function ?? "").trim().toLowerCase();
      const credit = String(item.Credit ?? "").trim().toLowerCase();
      const role = String(item.Role ?? "").trim().toLowerCase();
      const roleText = [description, functionText, credit, role].filter(Boolean).join(" ");

      if (typeCode === "instr" && type === "instruktion" && !roleText) return true;
      return ["instruktør", "director"].includes(description)
        || ["instruktør", "director"].includes(functionText)
        || ["instruktør", "director"].includes(credit)
        || ["instruktør", "director"].includes(role);
    })
    .map(item => isRecord(item) ? textValue(item.Name) ?? textValue(item.FullName) ?? "" : "")
    .filter(Boolean);

  return Array.from(new Set([...directNames, ...creditNames]));
}

export function parseDfiEpisodeCount(comment: string | null | undefined): number | null {
  if (!comment) return null;
  const match = comment.match(/(\d+)\s+afsnit/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

export function parseDfiEpisodeTitleInfo(title: string | null | undefined) {
  if (!title) return null;
  // F.eks. "Velkommen til frontlinjen 1:6 - Vi kommer med fred" -> episode 1, total 6, subtitle: "Vi kommer med fred"
  const regex = /(?:^|\s)(\d+):(\d+)(?:\s*-\s*|\s+)(.*)$/i;
  const match = title.match(regex);
  if (match) {
    const episodeNumber = parseInt(match[1], 10);
    const totalEpisodes = parseInt(match[2], 10);
    const subtitle = match[3] ? match[3].trim() : "";
    return { episodeNumber, totalEpisodes, subtitle };
  }
  const simpleRegex = /(?:^|\s)(\d+):(\d+)/i;
  const simpleMatch = title.match(simpleRegex);
  if (simpleMatch) {
    const episodeNumber = parseInt(simpleMatch[1], 10);
    const totalEpisodes = parseInt(simpleMatch[2], 10);
    return { episodeNumber, totalEpisodes, subtitle: "" };
  }
  return null;
}

function romanToNumber(value: string) {
  const roman: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
    XI: 11,
    XII: 12,
  };
  return roman[value.toUpperCase()] ?? null;
}

export function parseSeasonNumberFromTitle(title: string | null | undefined): number | null {
  const cleaned = cleanDfiTitle(title)
    .replace(/\([^)]*\)\s*$/g, "")
    .replace(/\[[^\]]*\]\s*$/g, "")
    .trim();
  if (!cleaned) return null;

  const token = String.raw`(\d{1,2}|[ivx]{1,5})`;
  const explicit = cleaned.match(new RegExp(String.raw`\b(?:sæson|season)\s*${token}\s*$`, "i"));
  const suffix = explicit
    ?? cleaned.match(new RegExp(String.raw`(?:\s|[-–—:/])${token}\s*$`, "i"))
    ?? cleaned.match(new RegExp(String.raw`(?:\s|[-–—:/])${token}(?=\s*[-–—:/])`, "i"));
  if (!suffix) return null;

  const raw = suffix[1];
  const parsed = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : romanToNumber(raw);
  return parsed != null && parsed >= 1 && parsed <= 30 ? parsed : null;
}


/**
 * Fjerner "oversigt" fra DFI parent-titler (fx serie-oversigter).
 * "Velkommen til frontlinjen - oversigt" -> "Velkommen til frontlinjen".
 * No-op hvis "oversigt" ikke er i titlen.
 */
export function cleanDfiTitle(title: string | null | undefined): string {
  return (title ?? "")
    .replace(/\s*[-–—:]\s*oversigt\s*$/i, "")
    .replace(/\boversigt\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—:]\s*$/, "")
    .trim();
}
