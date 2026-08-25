import type { AftalelicensVaerk } from "@/lib/streaming-types"

type RerunCandidate = Pick<
    AftalelicensVaerk,
    "id" | "rawTitle" | "episodeId" | "season" | "episode" | "episodeTitle" | "broadcastDate" | "broadcastTime" | "isGenudsendelse"
>

function normalizeIdentityPart(value: string | undefined): string {
    return (value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
}

function rerunIdentity(item: RerunCandidate): string {
    if (item.episodeId?.trim()) return `episode:${item.episodeId.trim()}`

    const title = normalizeIdentityPart(item.rawTitle)
    if (item.season != null && item.episode != null) {
        return `series:${title}:s${item.season}:e${item.episode}`
    }
    if (item.episodeTitle?.trim()) {
        return `series:${title}:episode-title:${normalizeIdentityPart(item.episodeTitle)}`
    }
    return `title:${title}`
}

function screeningTimestamp(item: RerunCandidate): number | null {
    const match = item.broadcastDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return null

    const timeMatch = item.broadcastTime?.match(/^(\d{1,2}):(\d{2})/)
    const timestamp = Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        timeMatch ? Number(timeMatch[1]) : 0,
        timeMatch ? Number(timeMatch[2]) : 0,
    )
    return Number.isNaN(timestamp) ? null : timestamp
}

function addMonths(timestamp: number, months: number): number {
    const source = new Date(timestamp)
    const day = source.getUTCDate()
    const result = new Date(timestamp)
    result.setUTCDate(1)
    result.setUTCMonth(result.getUTCMonth() + months)
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
    result.setUTCDate(Math.min(day, lastDay))
    return result.getTime()
}

/**
 * Marks later screenings of the same work as reruns within the configured,
 * rolling time window. Imported episode_id is the primary identity key.
 */
export function markAftalelicensReruns<T extends RerunCandidate>(items: T[], months: number): T[] {
    const result = items.map(item => ({ ...item, isGenudsendelse: item.isGenudsendelse ?? false }))
    if (months <= 0) return result

    const groups = new Map<string, Array<{ index: number; timestamp: number }>>()
    result.forEach((item, index) => {
        const timestamp = screeningTimestamp(item)
        if (timestamp == null) return
        const identity = rerunIdentity(item)
        const group = groups.get(identity) ?? []
        group.push({ index, timestamp })
        groups.set(identity, group)
    })

    for (const group of groups.values()) {
        group.sort((a, b) => a.timestamp - b.timestamp)
        let premiereTimestamp = group[0]?.timestamp
        for (const screening of group.slice(1)) {
            if (screening.timestamp <= addMonths(premiereTimestamp, months)) {
                result[screening.index].isGenudsendelse = true
            } else {
                premiereTimestamp = screening.timestamp
            }
        }
    }

    return result
}

export function applyAftalelicensRerunFactor(points: number, isRerun: boolean, factor: number): number {
    return isRerun ? points * factor : points
}
