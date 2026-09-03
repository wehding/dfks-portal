import "server-only";

import { recordPageTiming } from "@/lib/list-load-timing-stats";

export {
  getKeyPageTimingStats,
  recordPageTiming,
  type KeyPageTiming,
} from "@/lib/list-load-timing-stats";

type TimingFields = Record<string, string | number | boolean | null>;

export type ListLoadTiming = {
  totalMs: number;
  stages: Record<string, number>;
};

export function createListLoadTimer(label: string, clock: () => number = () => performance.now()) {
  const startedAt = clock();
  let previousAt = startedAt;
  const stages: Record<string, number> = {};

  function mark(stage: string) {
    const now = clock();
    stages[stage] = Math.round((now - previousAt) * 10) / 10;
    previousAt = now;
  }

  function finish(fields: TimingFields = {}): ListLoadTiming {
    const totalMs = Math.round((clock() - startedAt) * 10) / 10;
    recordPageTiming(label, totalMs);
    const timing = {
      totalMs,
      stages,
    };
    console.info("[list-performance]", JSON.stringify({ label, ...timing, ...fields }));
    return timing;
  }

  return { mark, finish };
}
