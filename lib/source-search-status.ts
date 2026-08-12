export type SourceAttemptStatus = {
  successes: number;
  failures: number;
};

export function sourceSearchFailed(status: SourceAttemptStatus): boolean {
  return status.failures > 0 && status.successes === 0;
}
