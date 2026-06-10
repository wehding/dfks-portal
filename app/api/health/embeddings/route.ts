import { NextResponse } from "next/server"

async function checkGoogle(): Promise<{ ok: boolean; ms: number }> {
    const start = Date.now()
    try {
        const key = process.env.GOOGLE_API_KEY
        if (!key) return { ok: false, ms: 0 }
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "models/text-embedding-004",
                    content: { parts: [{ text: "test" }] },
                }),
                signal: AbortSignal.timeout(5000),
            }
        )
        return { ok: res.ok, ms: Date.now() - start }
    } catch {
        return { ok: false, ms: Date.now() - start }
    }
}

async function checkSyv(): Promise<{ ok: boolean; ms: number }> {
    const start = Date.now()
    try {
        const res = await fetch("https://embed.syv.ai/v1/embeddings", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer none" },
            body: JSON.stringify({
                model: "intfloat/multilingual-e5-large-instruct",
                input: "test",
            }),
            signal: AbortSignal.timeout(5000),
        })
        return { ok: res.ok, ms: Date.now() - start }
    } catch {
        return { ok: false, ms: Date.now() - start }
    }
}

export async function GET() {
    const [google, syv] = await Promise.all([checkGoogle(), checkSyv()])
    return NextResponse.json({
        google,
        syv,
        aktiv: process.env.EMBEDDING_PROVIDER || "google",
    })
}
