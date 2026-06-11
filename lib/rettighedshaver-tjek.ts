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

export async function tjekNavn(
    navnIKontrakt: string
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
        return {
            status: "match",
            navnIKontrakt,
            navnIRegister: eksakt[0].full_name,
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
            return {
                status: "delvist-match",
                navnIKontrakt,
                navnIRegister: fuzzy[0].full_name,
                feedbackpunkt: {
                    id: "navnetjek",
                    type: "info",
                    titel: "Kreditering — navneforskel",
                    beskrivelse: `Kontrakten bruger "${navnIKontrakt}" men DFKS-registeret har "${fuzzy[0].full_name}". Bekræft at den ønskede stavemåde er brugt — det er den der kommer i rulleteksterne.`,
                    anbefaling: `Tjek at krediteringen "${fuzzy[0].full_name}" er aftalt og korrekt stavet i kontrakten.`,
                    citat: navnIKontrakt,
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
