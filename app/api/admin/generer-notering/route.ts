import { NextResponse } from "next/server"
import { requireAdminApi } from "@/lib/api-auth"

export async function POST(request: Request) {
    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response
    try {
        const { fritekst, prioritet } = await request.json()

        if (!fritekst?.trim()) {
            return NextResponse.json({ error: "Fritekst mangler" }, { status: 400 })
        }

        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) {
            return NextResponse.json({ error: "ANTHROPIC_API_KEY er ikke konfigureret" }, { status: 500 })
        }

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: "claude-opus-4-5",
                max_tokens: 1500,
                system: `Du konverterer faglige beskrivelser til præcise AI-noteringer
til brug i et kontraktgennemgangssystem for danske filmklippere.

En god notering skal følge dette format præcist:

1. Start med hvad Claude skal tjekke (én sætning)
2. Angiv hvornår noteringen er relevant (betingelse)
3. Beskriv hvad Claude skal gøre hvis betingelsen er opfyldt
4. Inkludér PRÆCIS standardtekst der skal bruges i mailen
5. Angiv dansk OG engelsk version hvis relevant
6. Slut med: VIGTIGT: Brug PRÆCIS denne ordlyd — skriv den ikke om.

Eksempel på god notering:
"Tjek om kontrakten indeholder en klausul om [X].
Hvis [X] mangler: kommenter det og foreslå PRÆCIS denne tekst — ingen omskrivning, brug ordret:
[præcis dansk tekst]
Ved engelsk kontrakt:
[præcis engelsk tekst]
VIGTIGT: Brug PRÆCIS denne ordlyd — skriv den ikke om."

Returnér KUN valid JSON uden markdown:
{
  "titel": "kort beskrivende titel",
  "body": "den komplette noteringstekst"
}`,
                messages: [{
                    role: "user",
                    content: `Konvertér denne faglige beskrivelse til en præcis AI-notering:

${fritekst}

Prioritet: ${prioritet}

Husk at inkludere standardklausuler på både dansk og engelsk hvis relevant.`,
                }],
            }),
        })

        if (!response.ok) {
            const err = await response.text()
            console.error("[generer-notering] Anthropic error:", err)
            return NextResponse.json({ error: `Claude API fejl ${response.status}` }, { status: response.status })
        }

        const data = await response.json()
        const raw = data.content
            ?.filter((b: { type: string; text?: string }) => b.type === "text")
            .map((b: { text?: string }) => b.text)
            .join("") ?? ""

        const first = raw.indexOf("{")
        const last = raw.lastIndexOf("}")
        if (first === -1 || last === -1) {
            return NextResponse.json({ error: "AI returnerede ugyldigt svar" }, { status: 500 })
        }

        const parsed = JSON.parse(raw.slice(first, last + 1))
        return NextResponse.json(parsed)

    } catch (err: any) {
        console.error("[generer-notering] Fejl:", err)
        return NextResponse.json({ error: err.message ?? "Ukendt fejl" }, { status: 500 })
    }
}
