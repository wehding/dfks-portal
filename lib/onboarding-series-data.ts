import { isSeriesType } from "@/lib/series-episodes";

type LocalWorkEntry = {
  work?: {
    id?: string | null;
    type?: string | null;
    parent_work_id?: string | null;
  } | null;
};

export function onboardingSeriesParentIds(entries: Iterable<LocalWorkEntry>): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const work = entry.work;
    if (work?.parent_work_id) {
      ids.add(work.parent_work_id);
    } else if (work?.id && isSeriesType(work.type)) {
      ids.add(work.id);
    }
  }
  return [...ids];
}
