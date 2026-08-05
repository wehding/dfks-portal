const EXCLUDED_ROLE_FRAGMENTS = [
  "color grading",
  "kolorist",
  "teaser klipper",
  "grading",
  "colorist",
  "trailer klipper",
  "dft",
  "colorist assistant",
];

const EXCLUDED_ROLE_PATTERN = /\b(?:pilot|trailer|teaser)\s*klip(?:per|ning)?\b|\bklip(?:pe)?\s*konsulent\b|\b(?:editing|editorial) consultant\b|\bconsult(?:ing|ant) editor\b/;

export function isRightBearingOnboardingRole(role: string | null | undefined): boolean {
  if (!role) return true;
  const normalized = role
    .toLocaleLowerCase("da")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return !EXCLUDED_ROLE_FRAGMENTS.some(fragment => normalized.includes(fragment))
    && !EXCLUDED_ROLE_PATTERN.test(normalized);
}
