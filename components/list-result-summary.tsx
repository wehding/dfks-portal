import { cn } from "@/lib/utils";

export function ListResultSummary({
  filteredCount,
  totalCount,
  selectedCount = 0,
  loading = false,
  className,
}: {
  filteredCount: number;
  totalCount: number;
  selectedCount?: number;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground", className)} aria-live="polite">
      <span>{loading ? "Indlæser listen…" : filteredCount === totalCount ? `${filteredCount} på listen` : `${filteredCount} resultater · ${totalCount} i alt`}</span>
      <span>{selectedCount} valgt</span>
    </div>
  );
}
