import { extractClauseIdFromCitation, stripClauseIdPrefix } from "@/lib/ai-sources"

export type CreditClauseStatus = "precise" | "vague" | "role_only" | "conditional" | "absent" | "unclear"
export type ContractCredit = { title: string; sourceText: string | null; clauseId: string | null }

const CREDIT_ROLES = ["Konceptuerende klipper", "Supervising Editor", "Supplerende klipper", "Klipperassistent", "Co-manuskriptforfatter og klipper", "Medklipper", "B-klipper", "Film Editor", "Picture Editor", "Klipper"] as const

function creditClauseFromText(contractText: string) {
  return contractText.split(/\r?\n/).find(line => /vedrørende\s+kreditering|krediteres\s+som|skal\s+krediteres|\bcredit(?:ed)?\s+as\b/i.test(line))?.trim() ?? null
}

function titlesFromClause(clause: string | null | undefined) {
  if (!clause) return []
  let remainder = clause
  const titles: string[] = []
  for (const role of CREDIT_ROLES) {
    const expression = new RegExp(`\\b${role.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i")
    if (expression.test(remainder)) { titles.push(role); remainder = remainder.replace(expression, " ") }
  }
  return titles
}

function assessClause(sourceText: string | null, titles: ContractCredit[]): CreditClauseStatus {
  if (!sourceText) return titles.length ? "role_only" : "absent"
  if (/producentens\s+skøn|sædvanlig\s+(?:vis|praksis)|subject\s+to|forudsat|såfremt/i.test(sourceText)) return "conditional"
  const obligation = /skal\s+krediteres|krediteres\s+som|aftalt.+kreditering|credit(?:ed)?\s+as/i.test(sourceText)
  if (obligation && titles.length) return "precise"
  if (/krediter|credit/i.test(sourceText) && !titles.length) return "vague"
  return titles.length ? "role_only" : "unclear"
}

export function resolveContractCredit(data: Record<string, unknown>, contractText = "") {
  const sources = data._sources && typeof data._sources === "object" ? data._sources as Record<string, unknown> : {}
  const existingSource = typeof sources.creditedRoles === "string" ? sources.creditedRoles.trim() : ""
  const annotatedClause = existingSource || creditClauseFromText(contractText)
  const fallbackSource = stripClauseIdPrefix(annotatedClause)
  const fallbackClauseId = typeof sources.creditedRoles_clause_id === "string" && sources.creditedRoles_clause_id ? sources.creditedRoles_clause_id : extractClauseIdFromCitation(annotatedClause)
  const structured = Array.isArray(data.contractCredits) ? data.contractCredits.filter(item => item && typeof item === "object").map(item => {
    const credit = item as Record<string, unknown>
    const annotatedSource = typeof credit.sourceText === "string" ? credit.sourceText : fallbackSource
    return { title: String(credit.title ?? "").trim(), sourceText: stripClauseIdPrefix(annotatedSource), clauseId: typeof credit.clauseId === "string" ? credit.clauseId : extractClauseIdFromCitation(annotatedSource) ?? fallbackClauseId }
  }).filter(credit => credit.title) : []
  const legacyTitles = typeof data.creditedRoles === "string" ? data.creditedRoles.split(/[,;/]|\s+og\s+/i).map(title => title.trim()).filter(Boolean) : Array.isArray(data.creditedRoles) ? data.creditedRoles.map(String).filter(Boolean) : []
  const titles = structured.length ? structured : [...new Set([...legacyTitles, ...titlesFromClause(fallbackSource)])].map(title => ({ title, sourceText: fallbackSource, clauseId: fallbackClauseId }))
  const status = String(data.creditClauseStatus ?? "") as CreditClauseStatus
  const validStatuses: CreditClauseStatus[] = ["precise", "vague", "role_only", "conditional", "absent", "unclear"]
  return { contractCredits: titles, creditedRoles: titles.map(credit => credit.title).join(", ") || null, creditClauseStatus: validStatuses.includes(status) ? status : assessClause(fallbackSource, titles), sourceText: fallbackSource ?? titles[0]?.sourceText ?? null, clauseId: fallbackClauseId ?? titles[0]?.clauseId ?? null }
}
