export type StatisticsTriState = "yes" | "no" | "implicit" | "unknown";

export function statisticsDataValue(
  data: Record<string, unknown> | null | undefined,
  paths: string[],
): unknown {
  for (const path of paths) {
    let value: unknown = data;
    for (const segment of path.split(".")) {
      value = value && typeof value === "object"
        ? (value as Record<string, unknown>)[segment]
        : undefined;
    }
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function statisticsNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let normalized = value.trim().replace(/\s|\u00a0/g, "").replace(/(?:dkk|kr\.?|%)/gi, "");
  if (!normalized) return null;
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function statisticsBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLocaleLowerCase("da");
  if (["true", "yes", "ja", "1", "fundet", "til stede"].includes(normalized)) return true;
  if (["false", "no", "nej", "0", "ikke fundet", "ikke til stede"].includes(normalized)) return false;
  return null;
}

export function statisticsTriState(value: unknown): StatisticsTriState {
  const boolean = statisticsBoolean(value);
  if (boolean === true) return "yes";
  if (boolean === false) return "no";
  const normalized = String(value ?? "").trim().toLocaleLowerCase("da");
  if (normalized.includes("implicit") || normalized.includes("via overenskomst")) return "implicit";
  return "unknown";
}
