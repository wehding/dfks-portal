export type WorkShareTaskReference = {
  work_id: string;
  season_number?: number | null;
  episode_number?: number | null;
};

export function workShareTaskKey(reference: WorkShareTaskReference) {
  return `${reference.work_id}:${reference.season_number ?? 0}:${reference.episode_number ?? 0}`;
}

export function countUniqueWorkShareTasks(references: WorkShareTaskReference[]) {
  return new Set(references.map(workShareTaskKey)).size;
}
