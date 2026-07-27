export type ResponseEvent = {
  threadId: string;
  role: "member" | "staff";
  createdAt: string;
};

export type ResponseTimeStats = {
  medianMs: number | null;
  p90Ms: number | null;
  answeredCount: number;
  unansweredCount: number;
  oldestUnansweredAt: string | null;
  oldestUnansweredThreadId: string | null;
};

export type ThreadResponseState = {
  requiresReply: boolean;
  waitingSince: string | null;
};

export type AdminDashboardMetrics = {
  tasks: {
    contractValidationsPending: number;
    workRequests: number;
    screeningClaims: number;
    contractReviews: number;
  };
  messages: {
    contracts: number;
    works: number;
    screenings: number;
    inbox: number;
  };
  validatedContracts: number;
  members: number;
  responseTimes: ResponseTimeStats;
};

function percentile(sorted: number[], fraction: number) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

export function calculateThreadResponseState(events: Pick<ResponseEvent, "role" | "createdAt">[]): ThreadResponseState {
  const rows = events
    .filter(event => Number.isFinite(new Date(event.createdAt).getTime()))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let waitingSince: string | null = null;
  for (const row of rows) {
    if (row.role === "member") waitingSince ??= row.createdAt;
    else if (waitingSince) waitingSince = null;
  }
  return { requiresReply: Boolean(waitingSince), waitingSince };
}

export function calculateResponseTimeStats(events: ResponseEvent[], responseWindowStart?: string): ResponseTimeStats {
  const threads = new Map<string, ResponseEvent[]>();
  for (const event of events) {
    if (!Number.isFinite(new Date(event.createdAt).getTime())) continue;
    const rows = threads.get(event.threadId) ?? [];
    rows.push(event);
    threads.set(event.threadId, rows);
  }

  const answered: number[] = [];
  const unanswered: Array<{ threadId: string; waitingSince: string }> = [];
  for (const [threadId, rows] of threads) {
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let waitingSince: string | null = null;
    for (const row of rows) {
      if (row.role === "member") {
        waitingSince ??= row.createdAt;
      } else if (waitingSince) {
        if (!responseWindowStart || waitingSince >= responseWindowStart) {
          answered.push(new Date(row.createdAt).getTime() - new Date(waitingSince).getTime());
        }
        waitingSince = null;
      }
    }
    if (waitingSince) unanswered.push({ threadId, waitingSince });
  }

  answered.sort((a, b) => a - b);
  unanswered.sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
  return {
    medianMs: percentile(answered, 0.5),
    p90Ms: percentile(answered, 0.9),
    answeredCount: answered.length,
    unansweredCount: unanswered.length,
    oldestUnansweredAt: unanswered[0]?.waitingSince ?? null,
    oldestUnansweredThreadId: unanswered[0]?.threadId ?? null,
  };
}

export function formatResponseDuration(milliseconds: number | null, locale: "da" | "en" = "da") {
  if (milliseconds === null) return "—";
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return locale === "da" ? `${minutes} min.` : `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return locale === "da" ? `${hours} t.` : `${hours} hr`;
  const days = Math.round(hours / 24);
  return locale === "da" ? `${days} dage` : `${days} days`;
}
