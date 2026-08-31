export type DataSourceKind = "db" | "dfi" | "tmdb" | "imdb" | "member" | "unknown";

export function normalizeDataSource(value: string | null | undefined): DataSourceKind {
  const normalized = value?.trim().toLocaleLowerCase("da-DK") ?? "";
  if (["local", "lokal", "portal", "database", "db"].includes(normalized)) return "db";
  if (normalized === "dfi") return "dfi";
  if (normalized === "tmdb") return "tmdb";
  if (normalized === "imdb") return "imdb";
  if (["member", "user", "bruger", "indtastet"].includes(normalized)) return "member";
  return "unknown";
}

export function dataSourceLabel(value: string | null | undefined) {
  const source = normalizeDataSource(value);
  if (source === "db") return "DB";
  if (source === "dfi") return "DFI";
  if (source === "tmdb") return "TMDB";
  if (source === "imdb") return "IMDb";
  if (source === "member") return "Bruger";
  return value?.trim() || "Ukendt";
}
