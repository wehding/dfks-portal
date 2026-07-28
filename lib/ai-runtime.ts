import "server-only"

import { createServiceClient } from "@/lib/supabase/service"
import {
    CONTRACT_AI_DEFAULTS,
    getContractAiModel,
    type AiProvider,
    type ContractAiUseCase,
} from "@/lib/ai-models"

export type AiRuntimeConfig = {
    useCase: ContractAiUseCase
    provider: AiProvider
    model: string
    promptCachingEnabled: boolean
}

export async function getAiRuntimeConfig(useCase: ContractAiUseCase): Promise<AiRuntimeConfig> {
    const fallback = CONTRACT_AI_DEFAULTS[useCase]
    try {
        const db = createServiceClient()
        const { data, error } = await db
            .from("ai_runtime_settings")
            .select("provider,model,prompt_caching_enabled")
            .eq("use_case", useCase)
            .maybeSingle()
        if (error || !data || !getContractAiModel(useCase, data.provider, data.model)) {
            return { useCase, ...fallback }
        }
        return {
            useCase,
            provider: data.provider as AiProvider,
            model: data.model,
            promptCachingEnabled: Boolean(data.prompt_caching_enabled),
        }
    } catch {
        return { useCase, ...fallback }
    }
}

