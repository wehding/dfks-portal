import "server-only"

import { createServiceClient } from "@/lib/supabase/service"
import { logWarn } from "@/lib/server-log"

/**
 * Kanonisk oversættelse fra klassifikatorens korte id'er til agreements.short_code.
 *
 * Klassifikatoren kan returnere "faf", "de4", "faf-dokumentar" osv.
 * short_code i DB bruger mere eksplicitte navne for at undgå tvetydighed.
 * Hvis klassifikator og short_code er identiske, er denne mapping overflødig for det id.
 */
const SHORT_CODE_MAP: Record<string, string> = {
    "de4":          "de4-fiktion",
    "de4-fiktion":  "de4-fiktion",
    "faf":          "faf-fiktion",
    "faf-fiktion":  "faf-fiktion",
    "faf-dokumentar": "faf-dokumentar",
    "faf-tv-ansat":     "faf-tv-ansat",
    "faf-tv-freelance": "faf-tv-freelance",
    "dj":           "dj-tv",
    "dj-tv":        "dj-tv",
    "metal":        "metal",
}

/** Normalisér whitespace/underscore til bindestreg, så mindre formateringsvariationer
 *  i AI'ens output (fx "faf dokumentar", "faf_dokumentar") stadig matcher kortet. */
function normaliseSeparators(value: string): string {
    return value.trim().replace(/[\s_]+/g, "-")
}

/** Normalisér klassifikator-id til agreements.short_code — null hvis ukendt. */
export function toShortCode(classifierCode: string | null | undefined): string | null {
    if (!classifierCode) return null
    const lc = classifierCode.toLowerCase()
    if (SHORT_CODE_MAP[lc]) return SHORT_CODE_MAP[lc]
    // Fald tilbage til en separator-normaliseret opslagsnøgle, hvis det eksakte
    // match fejlede — dækker mindre formateringsvariationer uden at kræve, at
    // hver enkelt variation er hardkodet i kortet på forhånd.
    return SHORT_CODE_MAP[normaliseSeparators(lc)] ?? null
}

export type AgreementVersionResult =
    | { found: true;  id: string; code: string; title: string; validFrom: string | null; validTo: string | null }
    | { found: false; reason: "no_short_code" | "no_version_for_date" | "no_versions_at_all" | "db_error" }

/**
 * Dato-bevidst opslag af agreements-række.
 *
 * Søger på `short_code` og vælger den version hvis gyldighedsperiode dækker `contractDate`.
 * Ved manglende dato: vælg nyeste version men log en advarsel.
 * Returnerer `found: false` med en specifik `reason` hvis ingen version kan vælges.
 */
export async function resolveAgreementByDate(
    classifierCode: string | null | undefined,
    contractDate: string | null | undefined,
): Promise<AgreementVersionResult> {
    const shortCode = toShortCode(classifierCode)
    if (!shortCode) {
        return { found: false, reason: "no_short_code" }
    }

    try {
        const supabase = createServiceClient()

        // Hent alle versioner med dette short_code, nyeste først
        const { data: versions, error } = await supabase
            .from("agreements")
            .select("id, code, title, valid_from, valid_to")
            .eq("short_code", shortCode)
            .order("valid_from", { ascending: false, nullsFirst: false })

        if (error) {
            logWarn("agreement-version-resolver", "DB-fejl ved versionopslag", { shortCode, error: error.message })
            return { found: false, reason: "db_error" }
        }

        if (!versions || versions.length === 0) {
            return { found: false, reason: "no_versions_at_all" }
        }

        const toResult = (v: typeof versions[0]) => ({
            found: true as const,
            id: v.id,
            code: v.code,
            title: v.title,
            validFrom: v.valid_from,
            validTo: v.valid_to,
        })

        if (!contractDate) {
            // Ingen kontraktdato — brug nyeste version men log advarsel
            logWarn("agreement-version-resolver", "Ingen kontraktdato — falder tilbage til nyeste version", {
                shortCode,
                valgtVersion: versions[0].code,
            })
            return toResult(versions[0])
        }

        // Find første version hvis periode dækker contractDate
        // valid_from <= contractDate AND (valid_to IS NULL OR contractDate <= valid_to)
        const match = versions.find(v => {
            const fromOk = !v.valid_from || v.valid_from <= contractDate
            const toOk   = !v.valid_to   || contractDate <= v.valid_to
            return fromOk && toOk
        })

        if (match) return toResult(match)

        // Ingen version dækker datoen
        logWarn("agreement-version-resolver", "Ingen overenskomstversion dækker kontraktdatoen", {
            shortCode,
            contractDate,
            tilgængeligeVersioner: JSON.stringify(versions.map(v => ({ code: v.code, fra: v.valid_from, til: v.valid_to }))),
        })
        return { found: false, reason: "no_version_for_date" }

    } catch (e) {
        logWarn("agreement-version-resolver", "Uventet fejl ved versionopslag", {
            shortCode,
            error: e instanceof Error ? e.message : String(e),
        })
        return { found: false, reason: "db_error" }
    }
}
