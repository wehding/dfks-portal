export function shouldAutoOpenContextualHelp({
  autoOpenOnFirstVisit,
  storageKey,
  seen,
}: {
  autoOpenOnFirstVisit: boolean;
  storageKey?: string;
  seen: boolean;
}) {
  return autoOpenOnFirstVisit && Boolean(storageKey) && !seen;
}
