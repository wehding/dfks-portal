export type LargestRemainderItem = {
  id: string
  weight: number
}

export type LargestRemainderAllocation = {
  id: string
  amount: number
}

/**
 * Fordeler et helt beløb i valutaens mindste enhed deterministisk.
 * Ved samme decimalrest vinder stigende stabilt kilde-id.
 */
export function allocateByLargestRemainder(
  totalMinor: number,
  items: LargestRemainderItem[],
): LargestRemainderAllocation[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new Error("Totalbeløbet skal være et ikke-negativt heltal i mindste valutaenhed.")
  }
  if (items.length === 0) {
    if (totalMinor === 0) return []
    throw new Error("Et positivt beløb kan ikke fordeles uden modtagere.")
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Fordelings-id'er skal være unikke.")
  }
  if (items.some((item) => !Number.isFinite(item.weight) || item.weight < 0)) {
    throw new Error("Fordelingsvægte skal være endelige og ikke-negative.")
  }

  const weightTotal = items.reduce((sum, item) => sum + item.weight, 0)
  if (weightTotal <= 0) {
    if (totalMinor === 0) return items.map((item) => ({ id: item.id, amount: 0 }))
    throw new Error("Et positivt beløb kræver en positiv samlet vægt.")
  }

  const rows = items.map((item) => {
    const exact = (totalMinor * item.weight) / weightTotal
    const floor = Math.floor(exact)
    return { id: item.id, amount: floor, remainder: exact - floor }
  })
  const remaining = totalMinor - rows.reduce((sum, row) => sum + row.amount, 0)

  const order = [...rows].sort((a, b) =>
    b.remainder - a.remainder || a.id.localeCompare(b.id, "en"),
  )
  for (let index = 0; index < remaining; index += 1) {
    order[index].amount += 1
  }

  return rows.map(({ id, amount }) => ({ id, amount }))
}
