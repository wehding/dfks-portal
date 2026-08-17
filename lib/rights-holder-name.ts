export function normalizeRightsHolderName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isDuplicateProfileName(input: {
  candidate: string;
  canonicalName: string;
  variants: string[];
}) {
  const normalized = normalizeRightsHolderName(input.candidate);
  if (!normalized) return true;
  return normalized === normalizeRightsHolderName(input.canonicalName)
    || input.variants.some(variant => normalizeRightsHolderName(variant) === normalized);
}
