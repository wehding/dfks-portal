const MAX_BULK_REVIEW_DELETE = 50
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseContractReviewDeleteIds(value: unknown) {
    if (!Array.isArray(value)) return { ids: [] as string[], error: "Vælg mindst én kontraktgennemgang" }
    const ids = [...new Set(value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean))]
    if (ids.length === 0) return { ids, error: "Vælg mindst én kontraktgennemgang" }
    if (ids.length > MAX_BULK_REVIEW_DELETE) return { ids: [], error: `Der kan højst slettes ${MAX_BULK_REVIEW_DELETE} kontraktgennemgange ad gangen` }
    if (ids.some(id => !UUID_PATTERN.test(id))) return { ids: [], error: "En eller flere kontraktgennemgange har et ugyldigt id" }
    return { ids, error: null }
}
