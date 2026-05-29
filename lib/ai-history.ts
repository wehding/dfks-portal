/**
 * lib/ai-history.ts
 *
 * Persistent historik over sorteringsbeslutninger på tværs af batches/år.
 * Bruges som pre-filter i grovsortering — kendte titler klassificeres direkte
 * uden AI-kald, baseret på hvad der er godkendt/afvist i tidligere batches.
 */

const HISTORY_KEY = "dfks-sort-history"
const MAX_HISTORY = 10000

// Samme strip-logik som stripEpisodeId i page.tsx
function stripForKey(title: string): string {
    return title
        .replace(/\s*[Ss]\d+\s*[Ee]\d+/g, "")   // S1E1 / S01E01
        .replace(/\s*[Ss]æson\s*\d+/gi, "")       // Sæson 3
        .replace(/\s*[Aa]fsnit\s*\d+/gi, "")      // Afsnit 7
        .replace(/\s*[-–]\s*\d+\s*$/g, "")        // - 4 til sidst
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
}

export interface HistoryEntry {
    baseTitle: string
    channel?: string
    decision: "approved" | "rejected"
    vaerkType?: string
    count: number           // Antal gange beslutningen er set
    lastSeen: string        // ISO-dato
}

/**
 * Gem en sorteringsbeslutning i historikken.
 * Kalder ved enhver godkend/afvis — uanset om det er AI, bruger eller DB-match.
 */
export function recordDecision(
    rawTitle: string,
    decision: "approved" | "rejected",
    channel?: string,
    vaerkType?: string,
): void {
    if (typeof window === "undefined") return
    const history = loadHistory()
    const base = stripForKey(rawTitle)
    const ch = (channel ?? "").toLowerCase()
    const idx = history.findIndex(
        h => h.baseTitle === base && (h.channel ?? "").toLowerCase() === ch
    )
    if (idx >= 0) {
        history[idx].decision = decision
        history[idx].vaerkType = vaerkType
        history[idx].count++
        history[idx].lastSeen = new Date().toISOString()
    } else {
        history.unshift({
            baseTitle: base,
            channel,
            decision,
            vaerkType,
            count: 1,
            lastSeen: new Date().toISOString(),
        })
    }
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
    } catch {
        // localStorage quota overskredet — ignorer
    }
}

/**
 * Find en tidligere beslutning for en titel+kanal.
 * Bruger stripped titel så episodenumre ignoreres.
 */
export function findInHistory(rawTitle: string, channel?: string): HistoryEntry | undefined {
    const base = stripForKey(rawTitle)
    const ch = (channel ?? "").toLowerCase()
    return loadHistory().find(
        h => h.baseTitle === base && (h.channel ?? "").toLowerCase() === ch
    )
}

export function loadHistory(): HistoryEntry[] {
    if (typeof window === "undefined") return []
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]")
    } catch {
        return []
    }
}

export function historyCount(): number {
    return loadHistory().length
}
