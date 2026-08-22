import type { VaerkType } from "@/lib/streaming-types"

const VALID_TYPES = new Set<VaerkType>([
    "spillefilm",
    "tv_serie_lang",
    "tv_serie_kort",
    "kortfilm",
    "dokumentarfilm",
    "dokumentarserie",
    "dokuDrama",
    "kort_dokumentar",
    "ikke_relevant",
])

function normalize(value: string | null | undefined): string {
    return (value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
}

function seriesType(duration?: number): VaerkType {
    return (duration ?? 0) > 30 ? "tv_serie_lang" : "tv_serie_kort"
}

export function resolveAftalelicensWorkType(input: {
    storedType?: string | null
    matchedWorkType?: string | null
    sourceCategory?: string | null
    duration?: number
    season?: number
    episode?: number
}): VaerkType | undefined {
    if (input.storedType && VALID_TYPES.has(input.storedType as VaerkType)) {
        return input.storedType as VaerkType
    }

    const workType = normalize(input.matchedWorkType)
    if (["spillefilm", "feature", "featurefilm", "movie", "movies"].includes(workType)) return "spillefilm"
    if (["kortfilm", "short", "shortfilm"].includes(workType)) return "kortfilm"
    if (["dokumentarfilm", "documentary", "documentaryfilm"].includes(workType)) return "dokumentarfilm"
    if (["dokumentarserie", "docseries", "documentaryseries"].includes(workType)) return "dokumentarserie"
    if (["dokudrama", "docudrama"].includes(workType)) return "dokuDrama"
    if (["kortdokumentar", "shortdocumentary"].includes(workType)) return "kort_dokumentar"
    if (["tvserie", "series", "tvseries"].includes(workType)) return seriesType(input.duration)

    const category = normalize(input.sourceCategory)
    if (["movie", "movies", "film"].includes(category)) return "spillefilm"
    if (["series", "tvseries"].includes(category)) return seriesType(input.duration)
    if (["documentary", "documentaries"].includes(category)) {
        return input.season != null || input.episode != null ? "dokumentarserie" : "dokumentarfilm"
    }

    return undefined
}
