export type ContractSupplement = Record<string, unknown>

function parseDanishAmount(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

function resolveSupplementUnit(data: Record<string, unknown>, sourceText: unknown): string | null {
  const evidence = typeof sourceText === "string" ? sourceText : ""
  if (/\b(?:pr\.?|per)\s+uge\b/i.test(evidence)) return "pr. uge"

  return data.salaryUnit === "weekly" ? "pr. uge" : null
}

function isEmployeePaidCost(supplement: ContractSupplement): boolean {
  const evidence = `${supplement.note ?? ""} ${supplement.sourceText ?? ""}`
  return /(?:trækkes|trukket|fratrækkes|fratrukket|modregnes|modregnet)[\s\S]{0,60}(?:løn|honorar|vederlag)|(?:egenbetaling|egen\s+betaling)|(?:medarbejderen|leverandøren|lønmodtageren)\s+(?:skal\s+)?betale|betales\s+af\s+(?:medarbejderen|leverandøren|lønmodtageren)/i.test(evidence)
}

/**
 * Backfills the structured supplement when an older/partial AI result found the
 * source clause but omitted otherSupplements[]. The narrow phrase match avoids
 * turning arbitrary salary prose into a supplement.
 */
export function resolveOtherSupplements(data: Record<string, unknown>): ContractSupplement[] {
  if (Array.isArray(data.otherSupplements) && data.otherSupplements.length > 0) {
    return data.otherSupplements
      .filter(item => item && typeof item === "object")
      .filter(item => !isEmployeePaidCost(item as ContractSupplement))
      .map(item => {
        const supplement = item as ContractSupplement
        const evidence = `${supplement.note ?? ""} ${supplement.sourceText ?? ""}`
        const normalized = /fast\s+tillæg\s+for\s+over-?\s*og\s+forskudttid/i.test(evidence)
          ? { ...supplement, category: "overtidstillaeg" }
          : supplement
        const inferredUnit = normalized.unit == null
          ? resolveSupplementUnit(data, normalized.sourceText)
          : null
        return inferredUnit ? { ...normalized, unit: inferredUnit } : normalized
      })
  }

  const sources = data._sources && typeof data._sources === "object"
    ? data._sources as Record<string, unknown>
    : {}
  const sourceText = typeof sources.otherSupplements === "string" ? sources.otherSupplements.trim() : ""
  const match = sourceText.match(/fast\s+tillæg\s+for\s+over-?\s*og\s+forskudttid[^\d]*(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?)/i)
  const amount = match ? parseDanishAmount(match[1]) : null
  if (!match || amount === null) return []

  return [{
    category: "overtidstillaeg",
    amount,
    unit: resolveSupplementUnit(data, sourceText),
    note: "Fast tillæg for over- og forskudttid",
    sourceText,
    clauseId: typeof sources.otherSupplements_clause_id === "string" ? sources.otherSupplements_clause_id : null,
  }]
}
