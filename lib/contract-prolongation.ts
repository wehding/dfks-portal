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
  const totalLimitMatch = evidence.match(/prolongation\s+i\s+indtil\s+(\d+(?:[.,]\d+)?)\s+(?:arbejds)?uger\b/i)
  const totalLimitWeeks = totalLimitMatch ? finiteNumber(totalLimitMatch[1]) : null

  if (workingWeeks != null && totalLimitWeeks != null && totalLimitWeeks >= workingWeeks) {
    const prolongationWeeks = totalLimitWeeks - workingWeeks
    return {
      prolongationWeeks,
      prolongationTotalWeeks: totalLimitWeeks,
      prolongationInterpretation: "total_limit" as const,
      needsManualProlongationReview: true,
      prolongationNote: `Prolongation op til ${prolongationWeeks} uger (${totalLimitWeeks} uger samlet minus ${workingWeeks} engagerede uger).`,
    }
  }

  return {
    prolongationWeeks: extractedWeeks,
    prolongationTotalWeeks: finiteNumber(data.prolongationTotalWeeks),
    prolongationInterpretation: data.prolongationInterpretation === "total_limit" || data.prolongationInterpretation === "unclear"
      ? data.prolongationInterpretation
      : extractedWeeks != null ? "additional" as const : "unclear" as const,
    needsManualProlongationReview: data.needsManualProlongationReview === true,
    prolongationNote: typeof data.prolongationNote === "string" ? data.prolongationNote : null,
  }
}
