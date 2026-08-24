export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      try { results[current] = { status: "fulfilled", value: await worker(items[current]) }; }
      catch (reason) { results[current] = { status: "rejected", reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, run));
  return results;
}

export function roundRobinByOrganisation<T extends { orgId: string }>(items: readonly T[], limit: number): T[] {
  const queues = new Map<string, T[]>();
  for (const item of items) queues.set(item.orgId, [...(queues.get(item.orgId) ?? []), item]);
  const result: T[] = [];
  while (result.length < limit && [...queues.values()].some(queue => queue.length > 0)) {
    for (const queue of queues.values()) {
      const item = queue.shift();
      if (item) result.push(item);
      if (result.length >= limit) break;
    }
  }
  return result;
}
