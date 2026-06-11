import { createClient } from "@supabase/supabase-js"

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY)!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
}

export interface NavneTjekResultat {
    status: "match" | "delvist-match" | "ikke-fundet"
    navnIKontrakt: string
    navnIRegister?: string
    afvigendeSteder?: string[]
    feedbackpunkt?: {
        id: string
        type: "kritisk" | "advarsel" | "info"
        titel: string
        beskrivelse: string
        anbefaling: string
        citat: string
        paragraf: string
    }
}

/**
 * Find alle stavevarianter af et navn i kontraktteksten.
 * Søger på efternavnet og returnerer alle forekomster der afviger fra registernavnet.
 * GDPR: kontraktteksten forlader ikke serveren — kun afvigelserne returneres.
 */
export function tjekAlleNavneforekomster(
    kontraktTekst: string,
    registerNavn: string
): string[] {
    const efternavn = registerNavn.split(" ").pop() ?? registerNavn
    const escaped = efternavn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

    // Match navne der slutter med efternavnet (inkl. evt. suffikser)
    const regex = new RegExp(
        `[A-ZÆØÅ][a-zæøå]+(?:\\s+[A-ZÆØÅ][a-zæøå]+)*\\s+${escaped}[a-zæøå]*`,
        "g"
    )

    const forekomster = [...new Set(kontraktTekst.match(regex) ?? [])]
    return forekomster.filter(f => f.toLowerCase() !== registerNavn.toLowerCase())
}

export async function tjekNavn(
    navnIKontrakt: string,
    kontraktTekst?: string
): Promise<NavneTjekResultat> {
    if (!navnIKontrakt?.trim()) return { status: "ikke-fundet", navnIKontrakt }

    // 1. Eksakt match på full_name ELLER alternative_names
    const { data: eksakt } = await getSupabase()
        .from("rettighedshavere")
        .select("full_name, alternative_names")
        .or(
            `full_name.ilike.${navnIKontrakt},` +
            `alternative_names.cs.{${navnIKontrakt}}`
        )
        .limit(1)

    if (eksakt && eksakt.length > 0) {
        const registerNavn = eksakt[0].full_name

        // Tjek alle forekomster i kontraktteksten mod registernavnet som facit
        if (kontraktTekst) {
            const afvigende = tjekAlleNavneforekomster(kontraktTekst, registerNavn)
            if (afvigende.length > 0) {
                return {
                    status: "delvist-match",
                    navnIKontrakt,
                    navnIRegister: registerNavn,
                    afvigendeSteder: afvigende,
                    feedbackpunkt: {
                        id: "navnetjek",
                        type: "advarsel",
                        titel: "Stavefejl i navn",
                        beskrivelse: `Dit navn er stavet forkert ét eller flere steder i kontrakten. Korrekt stavning ifølge DFKS-registeret: "${registerNavn}". Forkert stavning fundet: ${afvigende.map(s => `"${s}"`).join(", ")}. Ret disse steder så stavningen er konsistent og korrekt.`,
                        anbefaling: `Erstat alle forekomster med den korrekte stavning: "${registerNavn}"`,
                        citat: afvigende[0],
                        paragraf: "",
                    },
                }
            }
        }

        return {
            status: "match",
            navnIKontrakt,
            navnIRegister: registerNavn,
        }
    }

    // 2. Fuzzy match — søg på hvert ord i navnet
    const ord = navnIKontrakt.split(/\s+/).filter(o => o.length > 2)
    for (const o of ord) {
        const { data: fuzzy } = await getSupabase()
            .from("rettighedshavere")
            .select("full_name")
            .ilike("full_name", `%${o}%`)
            .limit(3)

        if (fuzzy && fuzzy.length > 0) {
            const registerNavn = fuzzy[0].full_name
            const afvigende = kontraktTekst
                ? tjekAlleNavneforekomster(kontraktTekst, registerNavn)
                : []

            const beskrivelse = afvigende.length > 0
                ? `Dit navn er stavet forkert ét eller flere steder i kontrakten. Korrekt stavning ifølge DFKS-registeret: "${registerNavn}". Forkert stavning fundet: ${afvigende.map(s => `"${s}"`).join(", ")}. Ret disse steder så stavningen er konsistent og korrekt.`
                : `Kontrakten bruger "${navnIKontrakt}" men DFKS-registeret har "${registerNavn}". Bekræft at den ønskede stavemåde er brugt — det er den der kommer i rulleteksterne.`

            return {
                status: "delvist-match",
                navnIKontrakt,
                navnIRegister: registerNavn,
                afvigendeSteder: afvigende.length > 0 ? afvigende : undefined,
                feedbackpunkt: {
                    id: "navnetjek",
                    type: "info",
                    titel: "Kreditering — navneforskel",
                    beskrivelse,
                    anbefaling: `Tjek at krediteringen "${registerNavn}" er aftalt og korrekt stavet i kontrakten.`,
                    citat: afvigende[0] ?? navnIKontrakt,
                    paragraf: "",
                },
            }
        }
    }

    // 3. Ikke fundet
    return {
        status: "ikke-fundet",
        navnIKontrakt,
        feedbackpunkt: {
            id: "navnetjek",
            type: "advarsel",
            titel: "Navn ikke fundet i DFKS-register",
            beskrivelse: `"${navnIKontrakt}" findes ikke i DFKS's medlemsregister. Tjek at navnet er stavet korrekt — det er den stavemåde der bruges i krediteringen.`,
            anbefaling: "Bekræft stavning af navn mod DFKS-registeret inden underskrift.",
            citat: navnIKontrakt,
            paragraf: "",
        },
    }
}
