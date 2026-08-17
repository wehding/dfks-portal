/**
 * Server-owned defaults for the legacy agreement-license assistants.
 *
 * These values are deliberately not configurable by the browser. Permanent
 * model choices for contract extraction, advice and statistics live in
 * `ai_runtime_settings` and are managed from AI-kontrolrummet.
 */
export type AiProvider = "anthropic" | "openai" | "google";
export type AftalelicensAiUseCase = "soeg" | "grovsorter";

export const AI_CONFIG_DEFAULTS: Record<AftalelicensAiUseCase, { provider: AiProvider; model: string }> = {
  soeg: { provider: "anthropic", model: "claude-sonnet-4-6" },
  grovsorter: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
};
