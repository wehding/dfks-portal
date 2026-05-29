/**
 * lib/ai-feedback.ts
 *
 * Gemmer brugerens korrektioner af AI-sortering i localStorage.
 * Bruges som few-shot eksempler i fremtidige AI-kald for løbende at skærpe modellen.
 */

const FEEDBACK_KEY = "dfks-ai-feedback"
const MAX_FEEDBACK = 150

export interface AiFeedback {
    rawTitle: string
    channel?: string
    productionYear?: number
    duration?: number
    aiRelevant: "ja" | "nej" | "usikker"
    aiVaerkType: string | null
    userDecision: "approved" | "rejected"
    timestamp: string
}

export function saveFeedback(fb: AiFeedback): void {
    const existing = loadFeedback()
    // Undgå dubletter for samme titel+beslutning
    const deduped = existing.filter(f => !(f.rawTitle === fb.rawTitle && f.userDecision === fb.userDecision))
    const updated = [fb, ...deduped].slice(0, MAX_FEEDBACK)
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(updated))
}

export function loadFeedback(): AiFeedback[] {
    if (typeof window === "undefined") return []
    try {
        return JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? "[]")
    } catch {
        return []
    }
}

/**
 * Returnerer de mest nyttige eksempler til AI-prompten.
 * Prioriterer korrektioner (AI tog fejl) over bekræftelser.
 */
export function getTrainingExamples(limit = 20): AiFeedback[] {
    const all = loadFeedback()
    const corrections = all.filter(f =>
        (f.aiRelevant === "ja" && f.userDecision === "rejected") ||
        (f.aiRelevant === "nej" && f.userDecision === "approved") ||
        f.aiRelevant === "usikker"
    )
    const agreements = all.filter(f =>
        (f.aiRelevant === "ja" && f.userDecision === "approved") ||
        (f.aiRelevant === "nej" && f.userDecision === "rejected")
    )
    return [...corrections, ...agreements].slice(0, limit)
}

export function feedbackCount(): number {
    return loadFeedback().length
}
