export function resolveOnboardingFirstStep(isRepeatOnboarding: boolean): number {
  // En administrativ nulstilling betyder, at hele onboardingforløbet skal
  // gennemgås igen. Eksisterende profildata er fortsat forudfyldt, men ingen
  // af de tidligere trin må springes over.
  if (isRepeatOnboarding) return 1;
  return 1;
}
