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
  return textValue(image.PathMini) ?? textValue(image.PathMicr) ?? textValue(image.Path);
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
