// Google: text-embedding-004 (768 dim) — default
// syv.ai: multilingual-e5-large-instruct (1024 dim) — via EMBEDDING_PROVIDER=syv

const SYV_EMBEDDING_URL = "https://embed.syv.ai/v1/embeddings"
const SYV_EMBEDDING_MODEL = "intfloat/multilingual-e5-large-instruct"

// Cache syv.ai-status i samme server-instans (nulstilles ved genstart)
let syvTilgaengelig: boolean | null = null

async function erSyvOppe(): Promise<boolean> {
    if (syvTilgaengelig !== null) return syvTilgaengelig
    try {
        const apiKey = process.env.SYV_API_KEY || "none"
        const res = await fetch(SYV_EMBEDDING_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ model: SYV_EMBEDDING_MODEL, input: "test" }),
            signal: AbortSignal.timeout(3000),
        })
        syvTilgaengelig = res.ok
    } catch {
        syvTilgaengelig = false
    }
    return syvTilgaengelig
}

export async function getEmbedding(tekst: string, erVidenbase = false): Promise<number[]> {
    const provider = process.env.EMBEDDING_PROVIDER || "google"
    if (provider === "syv") {
        if (await erSyvOppe()) return getSyvEmbedding(tekst, erVidenbase)
        console.warn("[embedding] syv.ai nede — falder tilbage til Google")
    }
    return getGoogleEmbedding(tekst)
}

export async function getEmbeddingWithFallback(tekst: string): Promise<number[]> {
    return getEmbedding(tekst)
}

async function getGoogleEmbedding(tekst: string): Promise<number[]> {
    const key = process.env.GOOGLE_API_KEY
    if (!key) throw new Error("GOOGLE_API_KEY mangler i miljøvariable")
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "models/gemini-embedding-001",
                content: { parts: [{ text: tekst.slice(0, 8000) }] },
                outputDimensionality: 768,
            }),
        }
    )
    if (!res.ok) {
        const err = await res.text()
        throw new Error(`Google Embedding API fejl ${res.status}: ${err}`)
    }
    const data = await res.json()
    return data.embedding.values // 768 dim
}

async function getSyvEmbedding(tekst: string, erVidenbase: boolean): Promise<number[]> {
    const apiKey = process.env.SYV_API_KEY
    if (!apiKey) throw new Error("SYV_API_KEY mangler i miljøvariable")

    const prefix = erVidenbase
        ? "Represent this Danish legal clause for retrieval: "
        : "Represent this Danish legal contract text for retrieval: "

    const res = await fetch(SYV_EMBEDDING_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: SYV_EMBEDDING_MODEL,
            input: prefix + tekst.slice(0, 8000),
        }),
        signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
        const err = await res.text()
        throw new Error(`syv.ai embedding API fejl ${res.status}: ${err}`)
    }

    const data = await res.json() as { data?: Array<{ embedding?: number[] }> }
    const embedding = data.data?.[0]?.embedding
    if (!Array.isArray(embedding)) throw new Error("syv.ai embedding API returnerede ikke en embedding")
    return embedding // 1024 dim
}
