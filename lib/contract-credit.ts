import { extractClauseIdFromCitation, stripClauseIdPrefix } from "@/lib/ai-sources"

const CREDIT_ROLES = [
  "Supervising Editor",
  "Supplerende klipper",
  "Klipperassistent",
  "Co-manuskriptforfatter og klipper",
  "Medklipper",
  "B-klipper",
  "Film Editor",
  "Picture Editor",
  "Klipper",
] as const

function creditClauseFromText(contractText: string) {
  return contractText
    .split(/\r?\n/)
    .find(line => /vedrørende\s+kreditering|krediteres\s+som|\bcredit(?:ed)?\s+as\b/i.test(line))
    ?.trim() ?? null
}

function roleFromClause(clause: string | null | undefined) {
  if (!clause) return null
  return CREDIT_ROLES.find(role => new RegExp(`\\b${role.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(clause)) ?? null
}

export function resolveContractCredit(data: Record<string, unknown>, contractText = "") {
  const sources = data._sources && typeof data._sources === "object"
    ? data._sources as Record<string, unknown>
    : {}
  const existingSource = typeof sources.creditedRoles === "string" ? sources.creditedRoles.trim() : ""
  const annotatedClause = existingSource || creditClauseFromText(contractText)
  const sourceText = stripClauseIdPrefix(annotatedClause)
  const role = typeof data.creditedRoles === "string" && data.creditedRoles.trim()
    ? data.creditedRoles.trim()
    : roleFromClause(sourceText)

  return {
    creditedRoles: role,
    sourceText,
    clauseId: typeof sources.creditedRoles_clause_id === "string" && sources.creditedRoles_clause_id
      ? sources.creditedRoles_clause_id
      : extractClauseIdFromCitation(annotatedClause),
  }
}
