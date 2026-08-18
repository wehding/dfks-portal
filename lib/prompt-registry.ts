/**
 * lib/prompt-registry.ts
 *
 * Central list of every named AI prompt used in the system.
 * Import this in the "Prompter" tab of the AI-kontrolrum for read-only inspection.
 */

// Only import from pure (non-server-only) prompt files — this module is used by a client component.
import { OVERENSKOMST_ANALYSE_SYSTEM_PROMPT } from "@/lib/overenskomst-analyse-prompt"
import { SATSER_UDTRAEK_SYSTEM_PROMPT } from "@/lib/satser-udtraek-prompt"
import { GENERER_NOTERING_SYSTEM_PROMPT } from "@/lib/generer-notering-prompt"
import { CONTRACT_EXTRACTION_SYSTEM_PROMPT } from "@/lib/contract-extraction-prompt"
import { SOURCES_SCHEMA_PROMPT } from "@/lib/ai-sources"

export type PromptEntry = {
    id: string
    title: string
    group: "Kontraktgennemgang" | "Kontraktvalidering" | "Overenskomster" | "Hjælpeprompts"
    description: string
    prompt: string
    file: string
}

export const PROMPT_REGISTRY: PromptEntry[] = [
    {
        id: "base-system",
        title: "Kontraktgennemgang — base system prompt",
        group: "Kontraktgennemgang",
        description: "Juridisk rådgiver-identitet og JSON-struktur for kontraktgennemgang. Bruges i alle analyser via buildSystemPrompt() i lib/analyse.ts (server-only).",
        prompt: "Se lib/analyse.ts → BASE_SYSTEM_PROMPT (server-only — kan ikke vises i browser)",
        file: "lib/analyse.ts",
    },
    {
        id: "contract-extraction-system",
        title: "Kontraktvalidering — system prompt",
        group: "Kontraktvalidering",
        description: "Instruktion til AI om at udtrække strukturerede data fra en kontrakt og returnere JSON.",
        prompt: CONTRACT_EXTRACTION_SYSTEM_PROMPT,
        file: "lib/contract-extraction-prompt.ts",
    },
    {
        id: "sources-schema",
        title: "Kontraktvalidering — _sources skema",
        group: "Kontraktvalidering",
        description: "Beskriver _sources-felterne — eksakte tekststrenge fra kontrakten til PDF-highlight.",
        prompt: SOURCES_SCHEMA_PROMPT,
        file: "lib/ai-sources.ts",
    },
    {
        id: "overenskomst-analyse",
        title: "Overenskomster — sektionsanalyse",
        group: "Overenskomster",
        description: "Identificerer indholdsmæssigt relevante afsnit i et overenskomstdokument og kategoriserer dem.",
        prompt: OVERENSKOMST_ANALYSE_SYSTEM_PROMPT,
        file: "lib/overenskomst-analyse-prompt.ts",
    },
    {
        id: "satser-udtraek",
        title: "Overenskomster — satsudtræk",
        group: "Overenskomster",
        description: "Udtrækker alle lønsatser, pensionsprocenter og procentbaserede tillæg fra et lønskema eller overenskomstbilag.",
        prompt: SATSER_UDTRAEK_SYSTEM_PROMPT,
        file: "lib/satser-udtraek-prompt.ts",
    },
    {
        id: "generer-notering",
        title: "Noteringer — AI-generator",
        group: "Hjælpeprompts",
        description: "Konverterer en fritekstbeskrivelse af en juridisk regel til en struktureret AI-notering.",
        prompt: GENERER_NOTERING_SYSTEM_PROMPT,
        file: "lib/generer-notering-prompt.ts",
    },
]

export const PROMPT_GROUPS = [
    "Kontraktgennemgang",
    "Kontraktvalidering",
    "Overenskomster",
    "Hjælpeprompts",
] as const
