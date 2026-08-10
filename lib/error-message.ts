export function errorMessage(error: unknown, fallback = "Ukendt fejl") {
  return error instanceof Error ? error.message : fallback;
}
