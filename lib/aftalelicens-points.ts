import type { AftalelicensVaegtExtra, VaerkType } from "@/lib/streaming-types"

export const DEFAULT_AFTALELICENS_WEIGHTS: Record<VaerkType, number> = {
  spillefilm: 200,
  tv_serie_lang: 100,
  tv_serie_kort: 50,
  kortfilm: 150,
  dokumentarfilm: 200,
  dokumentarserie: 100,
  dokuDrama: 200,
  kort_dokumentar: 100,
  ikke_relevant: 0,
}

export const DEFAULT_AFTALELICENS_WEIGHT_EXTRA: AftalelicensVaegtExtra = {
  dokLangPoints: 200,
  dokMellemPoints: 150,
  dokKortPoints: 100,
  dokLangMin: 61,
  dokMellemMin: 21,
  dokSerieLangMin: 38,
  dokSerieKortPoints: 50,
  supplerendeKlipFaktor: 0.3,
  genudsendelseFaktor: 0.5,
  genudsendelseMaaneder: 1,
}

export function calculateAftalelicensPoints(
  workType: VaerkType,
  duration: number | undefined,
  weights: Record<VaerkType, number>,
  extra: AftalelicensVaegtExtra,
): { points: number; base: number; tierLabel?: string } {
  const minutes = duration ?? 0
  if (workType === "dokumentarfilm") {
    let base: number
    let tierLabel: string
    if (minutes >= extra.dokLangMin) {
      base = extra.dokLangPoints
      tierLabel = `≥${extra.dokLangMin} min`
    } else if (minutes >= extra.dokMellemMin) {
      base = extra.dokMellemPoints
      tierLabel = `${extra.dokMellemMin}–${extra.dokLangMin} min`
    } else {
      base = extra.dokKortPoints
      tierLabel = `<${extra.dokMellemMin} min`
    }
    return { points: base * minutes, base, tierLabel }
  }
  if (workType === "dokumentarserie") {
    const base = minutes >= extra.dokSerieLangMin
      ? weights.dokumentarserie
      : extra.dokSerieKortPoints
    return {
      points: base * minutes,
      base,
      tierLabel: minutes >= extra.dokSerieLangMin
        ? `≥${extra.dokSerieLangMin} min`
        : `<${extra.dokSerieLangMin} min`,
    }
  }
  const base = weights[workType]
  return { points: base * minutes, base }
}

