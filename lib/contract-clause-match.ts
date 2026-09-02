import type { ContractLayout } from "@/lib/contract-layout";
import { norm } from "@/lib/resolveAnker";

/**
 * Find the single contract clause that contains a citation.
 *
 * This helper is deliberately free of server dependencies so evidence matching
 * can be verified without loading Supabase or document parsing infrastructure.
 */
export function matchCitationToClause(
  citation: string | null | undefined,
  layout: ContractLayout | null | undefined,
  minLength = 10,
): string | null {
  if (!citation || !layout) return null;

  const needle = norm(citation);
  if (needle.length < minLength) return null;

  const needleSlice = needle.slice(0, 60);
  const matchIds = (haystacks: [string, string][]): string[] =>
    haystacks.filter(([, haystack]) => haystack.includes(needleSlice)).map(([id]) => id);

  const normalizedClauses: [string, string][] = layout.clauses.map(clause => [clause.id, norm(clause.text)]);
  const normalizedMatches = matchIds(normalizedClauses);
  if (normalizedMatches.length === 1) return normalizedMatches[0];

  if (normalizedMatches.length === 0) {
    const stripWhitespace = (value: string) => norm(value).replace(/\s+/g, "");
    const strippedNeedle = stripWhitespace(citation).slice(0, 60);
    if (strippedNeedle.length >= minLength) {
      const strippedMatches = layout.clauses
        .filter(clause => stripWhitespace(clause.text).includes(strippedNeedle))
        .map(clause => clause.id);
      if (strippedMatches.length === 1) return strippedMatches[0];
    }
  }

  return null;
}
