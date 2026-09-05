"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ArchiveTaskButtonProps = {
  label: string;
  count: number | null;
  icon: ReactNode;
  loading?: boolean;
  tone?: "amber" | "blue";
  onClick: () => void;
};

export function ArchiveTaskButton({ label, count, icon, loading = false, tone = "amber", onClick }: ArchiveTaskButtonProps) {
  const active = count !== null && count > 0;
  const activeClass = tone === "blue"
    ? "border-blue-300 bg-blue-50 text-blue-950 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100"
    : "border-amber-300 bg-amber-50/80 text-amber-950 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100";
  const badgeClass = tone === "blue"
    ? "bg-blue-200/80 text-blue-900 dark:bg-blue-900/60 dark:text-blue-100"
    : "bg-amber-200/80 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100";

  return <Button
    type="button"
    variant="outline"
    className={`h-auto min-w-0 justify-start gap-2.5 whitespace-normal px-3.5 py-2.5 text-left text-xs font-semibold sm:text-sm ${active ? activeClass : "text-muted-foreground"}`}
    onClick={onClick}
    disabled={loading || count === 0}
    title={count === null ? "Opgavetallet kunne ikke hentes" : undefined}
  >
    {icon}
    <span className="min-w-0 flex-1 leading-tight">{label}</span>
    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${active ? badgeClass : "bg-muted text-muted-foreground"}`}>
      {count ?? "–"}
    </span>
  </Button>;
}
