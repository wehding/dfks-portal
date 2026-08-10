export type ListDirection = "asc" | "desc";

export type ListQuery = {
  search: string;
  filters: Record<string, string | string[]>;
  sort: string;
  direction: ListDirection;
  page: number;
  pageSize: number;
};

export type ListResult<T> = {
  rows: T[];
  filteredCount: number;
  totalCount: number;
  page: number;
  pageSize: number;
};

export function normalizedPage(value: unknown, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizedPageSize(value: unknown, fallback = 20, maximum = 200) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}
