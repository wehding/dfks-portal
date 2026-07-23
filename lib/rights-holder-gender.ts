// Fælles fallback-detektor for den (nu deployede) gender-kolonne på rettighedshavere.
// Bruges begge steder hvor koden retry'er uden gender, hvis en gammel database mangler kolonnen.
// Dækker både skrivefejl (PGRST204 fra schema-cache) og læsefejl (42703 undefined_column).
export function isMissingGenderColumn(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  const message = error?.message ?? "";
  if (!message.includes("gender")) return false;
  return error?.code === "PGRST204" || error?.code === "42703" || message.includes("column");
}
