import { NextResponse } from "next/server"
import { requireStaffModuleApi } from "@/lib/api-auth"
import { GENERER_NOTERING_SYSTEM_PROMPT } from "@/lib/generer-notering-prompt"

export async function POST(request: Request) {
    const auth = await requireStaffModuleApi("contract_reviews", "write")
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
                system: GENERER_NOTERING_SYSTEM_PROMPT,
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

    } catch (err: unknown) {
        console.error("[generer-notering] Fejl:", err)
        return NextResponse.json({ error: "Noteringen kunne ikke genereres." }, { status: 502 })
    }
}
