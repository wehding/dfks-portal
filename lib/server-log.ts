import "server-only";

type Meta = Record<string, string | number | boolean | null | undefined>;

function cleanMeta(meta?: Meta) {
  if (!meta) return undefined;
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined));
}

export function logInfo(scope: string, message: string, meta?: Meta) {
  console.info(`[${scope}] ${message}`, cleanMeta(meta) ?? "");
}

export function logWarn(scope: string, message: string, meta?: Meta) {
  console.warn(`[${scope}] ${message}`, cleanMeta(meta) ?? "");
}

export function errorMessage(error: unknown, fallback = "Ukendt fejl") {
  return error instanceof Error ? error.message : fallback;
}
