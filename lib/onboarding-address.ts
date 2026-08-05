export type OnboardingAddress = {
  street: string;
  postalCode: string;
  city: string;
};

export function parseOnboardingAddress(value: string): OnboardingAddress {
  const normalized = value.replace(/\s*\n+\s*/g, ", ").trim();
  if (!normalized) return { street: "", postalCode: "", city: "" };

  const match = normalized.match(/^(.*?)(?:,\s*|\s+)(\d{4})\s+(.+)$/);
  if (!match) return { street: normalized, postalCode: "", city: "" };

  return {
    street: match[1].replace(/,\s*$/, "").trim(),
    postalCode: match[2],
    city: match[3].trim(),
  };
}
