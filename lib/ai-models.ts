export type AiProvider = "anthropic" | "google"
export type ContractAiUseCase = "contract_extraction" | "contract_advice" | "statistics_query"

export type ContractAiModel = {
    provider: AiProvider
    model: string
    label: string
    description: string
    useCases: ContractAiUseCase[]
    thinkingLevel?: "minimal" | "medium"
}

export const CONTRACT_AI_MODELS: ContractAiModel[] = [
    {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        description: "Nuværende standard med stærk juridisk nuance.",
        useCases: ["contract_extraction", "contract_advice", "statistics_query"],
    },
    {
        provider: "google",
        model: "gemini-3.5-flash-lite",
        label: "Gemini 3.5 Flash-Lite",
        description: "Billig, hurtig model til dokumentaflæsning og struktureret JSON.",
        useCases: ["contract_extraction"],
        thinkingLevel: "minimal",
    },
    {
        provider: "google",
        model: "gemini-3.6-flash",
        label: "Gemini 3.6 Flash",
        description: "Stærkere reasoning-model til kontraktrådgivning.",
        useCases: ["contract_advice", "statistics_query"],
        thinkingLevel: "medium",
    },
]

export const CONTRACT_AI_DEFAULTS: Record<ContractAiUseCase, { provider: AiProvider; model: string; promptCachingEnabled: boolean }> = {
    contract_extraction: { provider: "anthropic", model: "claude-sonnet-4-6", promptCachingEnabled: false },
    contract_advice: { provider: "anthropic", model: "claude-sonnet-4-6", promptCachingEnabled: false },
    statistics_query: { provider: "anthropic", model: "claude-sonnet-4-6", promptCachingEnabled: false },
}

export function getContractAiModel(useCase: ContractAiUseCase, provider: string, model: string) {
    return CONTRACT_AI_MODELS.find(candidate =>
        candidate.provider === provider && candidate.model === model && candidate.useCases.includes(useCase)
    ) ?? null
}

export function isContractAiUseCase(value: unknown): value is ContractAiUseCase {
    return value === "contract_extraction" || value === "contract_advice" || value === "statistics_query"
}
