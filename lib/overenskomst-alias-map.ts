/**
 * Autoritativ mapping fra kort kanonisk overenskomst-id → agreements.code (langt, versioneret format).
 *
 * Denne fil er den ene kilde til sandheden. Kopiér IKKE mappingen til andre filer —
 * importér herfra. Identisk indhold som `known_mappings` i
 * supabase/migrations/20260817174224_knowledge_chunks_agreement_id.sql.
 */
export const OVERENSKOMST_ALIAS_MAP: Readonly<Record<string, string>> = {
    "de4":               "de4-fiction-2022",
    "de4-fiktion":       "de4-fiction-2022",
    "de4-fiction-2022":  "de4-fiction-2022",
    "faf":               "faf-fiction-2025",
    "faf-fiction-2025":  "faf-fiction-2025",
    "faf-dokumentar":    "faf-documentary",
    "faf-documentary":   "faf-documentary",
    "dj":                "dj-tv-2024",
    "dj-tv-2024":        "dj-tv-2024",
    "metal":             "dr-metal-2025",
    "dr-metal-2025":     "dr-metal-2025",
} as const

/**
 * Slår et kort eller langt overenskomst-id op og returnerer agreements.code.
 * Returnerer null hvis id'et ikke kendes.
 */
export function resolveAgreementsCode(shortOrLong: string | null | undefined): string | null {
    if (!shortOrLong) return null
    return OVERENSKOMST_ALIAS_MAP[shortOrLong.toLowerCase()] ?? null
}
