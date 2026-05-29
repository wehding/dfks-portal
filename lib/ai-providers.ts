/**
 * lib/ai-providers.ts
 *
 * Konfiguration af AI-udbydere og modeller.
 * Bruges i Stamdata → Indstillinger og sendes med i API-kald.
 */

export type AiProvider = "anthropic" | "openai" | "google"

export interface AiModel {
    id: string
    label: string
    description: string
}

export interface AiProviderDef {
    id: AiProvider
    label: string
    models: AiModel[]
}

export const AI_PROVIDERS: AiProviderDef[] = [
    {
        id: "anthropic",
        label: "Anthropic (Claude)",
        models: [
            { id: "claude-haiku-4-5-20251001", label: "Claude Haiku",  description: "Hurtig og billig — god til batch-sortering" },
            { id: "claude-sonnet-4-6",         label: "Claude Sonnet", description: "Præcis og nuanceret — anbefalet til enkelt-opslag" },
            { id: "claude-opus-4-6",           label: "Claude Opus",   description: "Mest præcis — bedst til svære vurderinger" },
        ],
    },
    {
        id: "openai",
        label: "OpenAI (GPT)",
        models: [
            { id: "gpt-4o-mini", label: "GPT-4o mini", description: "Hurtig og billig" },
            { id: "gpt-4o",      label: "GPT-4o",      description: "Præcis og alsidig" },
            { id: "o3-mini",     label: "o3 mini",     description: "Stærk ræsonnering" },
        ],
    },
    {
        id: "google",
        label: "Google (Gemini)",
        models: [
            { id: "gemini-2.0-flash",   label: "Gemini 2.0 Flash", description: "Hurtig og effektiv" },
            { id: "gemini-2.5-pro",     label: "Gemini 2.5 Pro",   description: "Præcis med langt kontekstvindue" },
        ],
    },
]

export interface AiConfig {
    provider: AiProvider
    model: string
}

// Standardkonfigurationer per use case
export const AI_CONFIG_DEFAULTS: Record<AiUseCase, AiConfig> = {
    soeg:        { provider: "anthropic", model: "claude-sonnet-4-6" },
    grovsorter:  { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    kontrakt:    { provider: "anthropic", model: "claude-sonnet-4-6" },
}

export type AiUseCase = "soeg" | "grovsorter" | "kontrakt"

const STORAGE_KEY = (useCase: AiUseCase) => `dfks-ai-config-${useCase}`

export function loadAiConfig(useCase: AiUseCase): AiConfig {
    if (typeof window === "undefined") return AI_CONFIG_DEFAULTS[useCase]
    try {
        const raw = localStorage.getItem(STORAGE_KEY(useCase))
        if (!raw) return AI_CONFIG_DEFAULTS[useCase]
        const parsed = JSON.parse(raw) as AiConfig
        // Valider at provider + model stadig eksisterer i kataloget
        const providerDef = AI_PROVIDERS.find(p => p.id === parsed.provider)
        if (!providerDef) return AI_CONFIG_DEFAULTS[useCase]
        if (!providerDef.models.find(m => m.id === parsed.model)) return AI_CONFIG_DEFAULTS[useCase]
        return parsed
    } catch {
        return AI_CONFIG_DEFAULTS[useCase]
    }
}

export function saveAiConfig(useCase: AiUseCase, config: AiConfig): void {
    localStorage.setItem(STORAGE_KEY(useCase), JSON.stringify(config))
}

export function getProviderDef(provider: AiProvider): AiProviderDef {
    return AI_PROVIDERS.find(p => p.id === provider) ?? AI_PROVIDERS[0]
}
