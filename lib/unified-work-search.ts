export type WorkMatchCandidate = {
  title: string;
  year?: number | null;
  type?: string | null;
};

export function normalizeWorkSearchTitle(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/\b(the|en|et|den|det)\b/g, " ")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function workTypeFamily(type: string | null | undefined) {
  const normalized = (type ?? "").toLocaleLowerCase("da").replace(/[_\s]+/g, "-");
  if (normalized.includes("serie") || normalized === "tv") return "series";
  if (normalized.includes("dokumentar")) return "documentary";
  if (normalized.includes("film") || normalized === "movie") return "film";
  return normalized || "unknown";
}

export function shouldMergeWorkSearchResults(left: WorkMatchCandidate, right: WorkMatchCandidate) {
  if (!normalizeWorkSearchTitle(left.title) || normalizeWorkSearchTitle(left.title) !== normalizeWorkSearchTitle(right.title)) return false;
  const leftFamily = workTypeFamily(left.type);
  const rightFamily = workTypeFamily(right.type);
  if (leftFamily !== "unknown" && rightFamily !== "unknown" && leftFamily !== rightFamily) return false;

  if (left.year && right.year) return Math.abs(left.year - right.year) <= 1;
  // DFI's serieoversigter mangler ofte premiereår. Titel + serietype er her
  // stærkt nok, mens årsløse film beholdes som separate resultater.
  return leftFamily === "series" && rightFamily === "series";
}
