function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : null
}

export function resolveContractProlongation(data: Record<string, unknown>) {
  const sources = data._sources && typeof data._sources === "object"
    ? data._sources as Record<string, unknown>
    : {}
  const evidence = [sources.prolongation, data.prolongationNote]
    .filter(value => typeof value === "string")
    .join(" ")
  const workingWeeks = finiteNumber(data.workingWeeks)
  const extractedWeeks = finiteNumber(data.prolongationWeeks)
  const extractedAmount = finiteNumber(data.prolongationAmount)
  const extractedUnit = data.prolongationUnit === "days" ? "days" as const : "weeks" as const
  const explicitDaysMatch = evidence.match(/(?:prolongation|forlængelse)[^\d]{0,40}(\d+(?:[.,]\d+)?)[_\s]*(?:arbejds)?dage\b/i)
    ?? evidence.match(/(\d+(?:[.,]\d+)?)[_\s]*(?:arbejds)?dages?\s+(?:prolongation|forlængelse)\b/i)
  const explicitDays = explicitDaysMatch ? finiteNumber(explicitDaysMatch[1]) : null
  const totalLimitMatch = evidence.match(/prolongation\s+i\s+indtil\s+(\d+(?:[.,]\d+)?)\s+(?:arbejds)?uger\b/i)
  const totalLimitWeeks = totalLimitMatch ? finiteNumber(totalLimitMatch[1]) : null

  if (workingWeeks != null && totalLimitWeeks != null && totalLimitWeeks >= workingWeeks) {
    const prolongationWeeks = totalLimitWeeks - workingWeeks
    return {
      prolongationWeeks,
      prolongationAmount: prolongationWeeks,
      prolongationUnit: "weeks" as const,
      prolongationTotalWeeks: totalLimitWeeks,
      prolongationInterpretation: "total_limit" as const,
      needsManualProlongationReview: true,
      prolongationNote: `Prolongation op til ${prolongationWeeks} uger (${totalLimitWeeks} uger samlet minus ${workingWeeks} engagerede uger).`,
    }
  }

  if (explicitDays != null) {
    return {
      prolongationWeeks: explicitDays / 5,
      prolongationAmount: explicitDays,
      prolongationUnit: "days" as const,
      prolongationTotalWeeks: null,
      prolongationInterpretation: "additional" as const,
      needsManualProlongationReview: false,
      prolongationNote: typeof data.prolongationNote === "string" ? data.prolongationNote : `${explicitDays} dages prolongation.`,
    }
  }

  return {
    prolongationWeeks: extractedAmount != null ? extractedAmount / (extractedUnit === "days" ? 5 : 1) : extractedWeeks,
    prolongationAmount: extractedAmount ?? extractedWeeks,
    prolongationUnit: extractedUnit,
    prolongationTotalWeeks: finiteNumber(data.prolongationTotalWeeks),
    prolongationInterpretation: data.prolongationInterpretation === "total_limit" || data.prolongationInterpretation === "unclear"
      ? data.prolongationInterpretation
      : extractedWeeks != null ? "additional" as const : "unclear" as const,
    needsManualProlongationReview: data.needsManualProlongationReview === true,
    prolongationNote: typeof data.prolongationNote === "string" ? data.prolongationNote : null,
  }
}
