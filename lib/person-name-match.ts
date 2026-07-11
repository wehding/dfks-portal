export type PersonNameMatch = {
  score: number;
  reason: "exact" | "without-middle-name" | "initial-variant" | "spelling-variant" | "weak";
};

function transliterateDanish(value: string) {
  return value.replaceAll("æ", "ae").replaceAll("ø", "o").replaceAll("å", "aa");
}

export function normalizePersonName(value: string) {
  return transliterateDanish(value.toLocaleLowerCase("da-DK").normalize("NFKD"))
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(left: string, right: string) {
  if (!left) return right.length;
  if (!right) return left.length;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + Number(left[i - 1] !== right[j - 1]));
      previous = current;
    }
  }
  return row[right.length];
}

function tokenMatch(queryToken: string, candidateToken: string) {
  if (queryToken === candidateToken) return 1;
  if (queryToken.length === 1 && candidateToken.startsWith(queryToken)) return 0.9;
  if (candidateToken.length === 1 && queryToken.startsWith(candidateToken)) return 0.9;
  const longest = Math.max(queryToken.length, candidateToken.length);
  return longest ? 1 - levenshtein(queryToken, candidateToken) / longest : 0;
}

export function scorePersonName(query: string, candidate: string): PersonNameMatch {
  const normalizedQuery = normalizePersonName(query);
  const normalizedCandidate = normalizePersonName(candidate);
  if (!normalizedQuery || !normalizedCandidate) return { score: 0, reason: "weak" };
  if (normalizedQuery === normalizedCandidate) return { score: 1, reason: "exact" };

  const queryTokens = normalizedQuery.split(" ");
  const candidateTokens = normalizedCandidate.split(" ");
  const charLength = Math.max(normalizedQuery.length, normalizedCandidate.length);
  const characterScore = 1 - levenshtein(normalizedQuery, normalizedCandidate) / charLength;
  const tokenScores = queryTokens.map(token => Math.max(...candidateTokens.map(candidateToken => tokenMatch(token, candidateToken))));
  const tokenScore = tokenScores.reduce((sum, score) => sum + score, 0) / tokenScores.length;
  const firstScore = tokenMatch(queryTokens[0], candidateTokens[0]);
  const lastScore = tokenMatch(queryTokens.at(-1) ?? "", candidateTokens.at(-1) ?? "");
  const anchorScore = (firstScore + lastScore) / 2;
  let score = characterScore * 0.55 + tokenScore * 0.35 + anchorScore * 0.1;

  const outerNamesMatch = firstScore >= 0.9 && lastScore >= 0.9;
  if (outerNamesMatch && queryTokens.length !== candidateTokens.length) score = Math.max(score, 0.84);
  const hasInitial = [...queryTokens, ...candidateTokens].some(token => token.length === 1);
  const reason = outerNamesMatch && hasInitial
    ? "initial-variant"
    : outerNamesMatch && queryTokens.length !== candidateTokens.length
    ? "without-middle-name"
    : score >= 0.62 ? "spelling-variant" : "weak";
  return { score: Math.max(0, Math.min(1, score)), reason };
}

export function personSearchVariants(fullName: string, alternativeNames: string[] = []) {
  const values = [fullName, ...alternativeNames].flatMap(value => {
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    return tokens.length > 2 ? [value, `${tokens[0]} ${tokens.at(-1)}`] : [value];
  });
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean))).slice(0, 8);
}
