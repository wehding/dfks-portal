export const EXPERIENCE_GROUPS = [
  { value: "new_graduate", label: "Nyuddannet", description: "0–3 års erfaring", minimum: 0, maximum: 3 },
  { value: "early_career", label: "Ny i branchen", description: "4–7 års erfaring", minimum: 4, maximum: 7 },
  { value: "experienced", label: "Erfaren", description: "8–17 års erfaring", minimum: 8, maximum: 17 },
  { value: "veteran", label: "Veteran", description: "18+ års erfaring", minimum: 18, maximum: null },
] as const;

export type ExperienceGroup = typeof EXPERIENCE_GROUPS[number]["value"];

export function experienceYearsAt(professionalStartYear: number | null | undefined, contractYear: number) {
  if (!Number.isInteger(professionalStartYear) || !Number.isInteger(contractYear)) return null;
  const years = contractYear - Number(professionalStartYear);
  return years >= 0 ? years : null;
}

export function experienceGroupAt(
  professionalStartYear: number | null | undefined,
  contractYear: number,
): ExperienceGroup | null {
  const years = experienceYearsAt(professionalStartYear, contractYear);
  if (years == null) return null;
  return EXPERIENCE_GROUPS.find(group => years >= group.minimum && (group.maximum == null || years <= group.maximum))?.value ?? null;
}

export function isExperienceGroup(value: string | null | undefined): value is ExperienceGroup {
  return EXPERIENCE_GROUPS.some(group => group.value === value);
}
