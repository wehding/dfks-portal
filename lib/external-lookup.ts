export const INTERACTIVE_EXTERNAL_LOOKUP_TIMEOUT_MS = 3_000;

export type ExternalLookupSource = "dfi" | "tmdb";
export type ExternalLookupStatus = "success" | "timeout" | "error";

export type ExternalLookupResult<T> =
  | { source: ExternalLookupSource; status: "success"; value: T }
  | { source: ExternalLookupSource; status: "timeout" }
  | { source: ExternalLookupSource; status: "error"; error: string };

export type LookupDeadlineResult<T> =
  | { status: "success"; value: T }
  | { status: "timeout" }
  | { status: "error"; error: string };

function safeErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Eksternt opslag fejlede";
}

export function isExternalLookupTimeout(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const message = safeErrorMessage(error).toLocaleLowerCase("da-DK");
  return message.includes("timeout")
    || message.includes("timed out")
    || message.includes("tidsafbrydelse")
    || message.includes("abort");
}

export async function runWithLookupDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs = INTERACTIVE_EXTERNAL_LOOKUP_TIMEOUT_MS,
): Promise<LookupDeadlineResult<T>> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { status: "error", error: "Ugyldig tidsgrænse" };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<LookupDeadlineResult<T>>(resolve => {
    timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });
  const execution = Promise.resolve()
    .then(operation)
    .then<LookupDeadlineResult<T>>(value => ({ status: "success", value }))
    .catch<LookupDeadlineResult<T>>(error => isExternalLookupTimeout(error)
      ? { status: "timeout" }
      : { status: "error", error: safeErrorMessage(error) });

  try {
    return await Promise.race([execution, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runExternalLookup<T>(
  source: ExternalLookupSource,
  operation: () => Promise<T>,
  timeoutMs = INTERACTIVE_EXTERNAL_LOOKUP_TIMEOUT_MS,
): Promise<ExternalLookupResult<T>> {
  const result = await runWithLookupDeadline(operation, timeoutMs);
  return result.status === "success"
    ? { source, status: "success", value: result.value }
    : result.status === "timeout"
      ? { source, status: "timeout" }
      : { source, status: "error", error: result.error };
}

export function externalLookupWarning(
  statuses: Partial<Record<ExternalLookupSource, ExternalLookupStatus>> | null | undefined,
  locale: string,
) {
  const unavailable = (["dfi", "tmdb"] as const).filter(source => statuses?.[source] === "timeout" || statuses?.[source] === "error");
  if (!unavailable.length) return null;
  const sources = unavailable.map(source => source === "tmdb" ? "TMDb" : "DFI").join(" og ");
  return locale === "da"
    ? `${sources} svarede ikke. Du kan fortsætte med lokal eller manuel indtastning.`
    : `${sources} did not respond. You can continue with local or manual entry.`;
}
