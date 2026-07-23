// Fælles UUID-validering. Bruges bl.a. før rå strenginterpolation i PostgREST `.or(...)`-filtre,
// så et id aldrig kan bryde ud af filter-syntaksen (defense-in-depth mod filter-injection).
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
