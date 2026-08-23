export type ContractSupplement = Record<string, unknown>

function parseDanishAmount(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
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
      .map(item => {
        const supplement = item as ContractSupplement
        const evidence = `${supplement.note ?? ""} ${supplement.sourceText ?? ""}`
        return /fast\s+tillæg\s+for\s+over-?\s*og\s+forskudttid/i.test(evidence)
          ? { ...supplement, category: "overtidstillaeg" }
          : supplement
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
    unit: null,
    note: "Fast tillæg for over- og forskudttid",
    sourceText,
    clauseId: typeof sources.otherSupplements_clause_id === "string" ? sources.otherSupplements_clause_id : null,
  }]
}
