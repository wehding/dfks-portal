import type { CSSProperties } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function TableSkeleton({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  const gridStyle = { "--columns": columns } as CSSProperties;
  return (
    <div className="overflow-hidden rounded-lg border" aria-label="Indlæser tabel" role="status">
      <div className="hidden gap-4 border-b bg-muted/40 p-4 md:grid md:grid-cols-[repeat(var(--columns),minmax(0,1fr))]" style={gridStyle}>
        {Array.from({ length: columns }, (_, index) => <Skeleton key={index} className="h-4 w-3/4" />)}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="grid gap-3 p-4 md:grid-cols-[repeat(var(--columns),minmax(0,1fr))]" style={gridStyle}>
            {Array.from({ length: columns }, (_, column) => <Skeleton key={column} className={column === 0 ? "h-5 w-4/5" : "h-4 w-2/3"} />)}
          </div>
        ))}
      </div>
      <span className="sr-only">Indlæser data</span>
    </div>
  );
}

export function ListSkeleton({ items = 5 }: { items?: number }) {
  return <div className="grid gap-3" role="status" aria-label="Indlæser liste">{Array.from({ length: items }, (_, index) => <div key={index} className="rounded-lg border p-4"><Skeleton className="h-5 w-2/3" /><Skeleton className="mt-3 h-4 w-1/2" /><Skeleton className="mt-2 h-4 w-1/3" /></div>)}</div>;
}
