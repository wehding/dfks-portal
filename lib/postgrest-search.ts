/**
 * PostgREST `.or()` takes a filter expression rather than a plain value.
 * Keep user text out of that grammar by stripping its structural characters
 * before embedding it in an `ilike` clause.
 */
export function sanitizePostgrestSearchTerm(value: string, maxLength = 100): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[,()\\"%*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function postgrestIlikePattern(value: string, maxLength = 100): string | null {
  const safe = sanitizePostgrestSearchTerm(value, maxLength);
  return safe ? `%${safe}%` : null;
}
