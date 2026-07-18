let clientIdSequence = 0;

export function createClientId(
  prefix = "item",
  randomUuid: () => string | undefined = () => globalThis.crypto?.randomUUID?.(),
) {
  try {
    const uuid = randomUuid();
    if (uuid) return uuid;
  } catch {
    // randomUUID kræver en sikker browserkontekst i nogle mobilbrowsere.
  }

  clientIdSequence += 1;
  return `${prefix}-${Date.now()}-${clientIdSequence}`;
}
