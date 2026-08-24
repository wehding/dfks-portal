function parseDanishAmount(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  if (!normalized) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

/**
 * Returns an explicit pension amount. If AI omitted the structured value, the
 * amount may be recovered from the same cited pension clause. This never
 * calculates an amount from the percentage.
 */
export function resolvePensionSupplement(data: Record<string, unknown>): number | null {
  if (data.pensionSupplement !== null && data.pensionSupplement !== undefined && data.pensionSupplement !== "") {
    const existing = typeof data.pensionSupplement === "number"
      ? data.pensionSupplement
      : parseDanishAmount(String(data.pensionSupplement))
    if (existing !== null) return existing
  }

  const sources = data._sources && typeof data._sources === "object"
    ? data._sources as Record<string, unknown>
    : {}
  const sourceText = typeof sources.pension === "string" ? sources.pension : ""
  if (!sourceText) return null

  const currencyBefore = sourceText.match(/(?:kr\.?|DKK)\s*([0-9][0-9.\s]*(?:,[0-9]{1,2})?)/i)
  const amountBefore = sourceText.match(/([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*(?:kr\.?|DKK)/i)
  return parseDanishAmount(currencyBefore?.[1] ?? amountBefore?.[1] ?? "")
}
