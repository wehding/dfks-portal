export const dynamic = "force-dynamic"
/**
 * app/api/validate/extract-allonge/route.ts
 *
 * Kører et lille, afgrænset AI-udtræk på én allonge — kun løn, arbejdsuger
 * og kommentarer. Bruges fra allonge-fanen i valideringsdialogen
 * (app/admin/validering/page.tsx), adskilt fra den fulde kontrakt-udtræk.
 */

import { NextRequest, NextResponse } from "next/server"
import { maskPersonalData } from "@/lib/mask-text"
import { getApiKey } from "@/lib/ai-key-store"
import { hentAttachmentTekst } from "@/lib/allonge-text"

const SYSTEM_PROMPT = `Du er ekspert i at læse allonger/tillæg til danske filmkontrakter.
En allonge ændrer typisk kun enkelte vilkår i en eksisterende kontrakt — fx forlænger perioden,
tilføjer arbejdsuger, eller ændrer lønnen fremadrettet.
Returner KUN JSON — ingen forklaringstekst.

VIGTIGT — Maskerede tokens: Teksten er forbehandlet og personoplysninger er erstattet med tokens:
[CPR-NUMMER], [KONTONUMMER], [IBAN], [TELEFON], [EMAIL], [ADRESSE], [POSTNR-BY], [CVR-NUMMER].
Disse tokens er IKKE de faktiske værdier.`

const EXTRACTION_PROMPT = `Udtræk KUN følgende fra allongen og returner som JSON — ingen andre felter:
{
  "salary": "den NYE løn aftalt i allongen, som tal uden valuta — den løn der gælder FREMADRETTET fra allongens dato. Sæt null hvis allongen ikke ændrer lønnen. (number|null)",
  "salaryUnit": "monthly|weekly|daily|total — enheden for lønnen ovenfor. (string|null)",
  "workingWeeks": "antal EKSTRA arbejdsuger som allongen tilføjer (ikke det samlede antal, kun tillægget) som tal. Hvis allongen angiver klippedage/arbejdsdage — divider med 5. Hvis måneder — multiplicer med 4,33. Sæt null hvis allongen ikke tilføjer arbejdstid. (number|null)",
  "specialNotes": "kort opsummering af hvad allongen konkret ændrer (fx 'Forlænget med 2 uger og lønstigning til 45.000 kr/md fra 1/9'). (string|null)"
}`

export async function POST(req: NextRequest) {
    try {
        const { attachmentId } = await req.json()
        if (!attachmentId) return NextResponse.json({ error: "attachmentId påkrævet" }, { status: 400 })

        const apiKey = getApiKey("anthropic")
        if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY mangler" }, { status: 500 })

        const result = await hentAttachmentTekst(attachmentId)
        if (!result || !result.text.trim()) {
            return NextResponse.json({ error: "Kunne ikke udtrække tekst fra allongen" }, { status: 404 })
        }

        const masked = maskPersonalData(result.text)

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 1024,
                system: SYSTEM_PROMPT + "\n\n" + EXTRACTION_PROMPT,
                messages: [{ role: "user", content: `---ALLONGE---\n${masked.slice(0, 20000)}` }],
            }),
        })
        if (!response.ok) throw new Error(`Anthropic fejl: ${response.status}`)
        const aiData = await response.json()
        const raw = aiData.content?.[0]?.text ?? ""

        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) return NextResponse.json({ error: "Ugyldigt AI-svar" }, { status: 500 })

        const extracted = JSON.parse(jsonMatch[0])
        return NextResponse.json({ ok: true, data: extracted })
    } catch (err: any) {
        console.error("[validate/extract-allonge]", err)
        return NextResponse.json({ error: err.message ?? "Ukendt fejl" }, { status: 500 })
    }
}
