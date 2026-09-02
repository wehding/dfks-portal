"use client";

import {
  Archive,
  Building2,
  Database,
  FileText,
  Film,
  Landmark,
  Pencil,
  Scale,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ContractFieldSource } from "@/lib/contract-workbench";
import { CONTRACT_SOURCE_LABELS } from "@/lib/contract-workbench";

const SOURCE_STYLE: Record<ContractFieldSource, { className: string; icon: typeof FileText }> = {
  contract: { className: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200", icon: FileText },
  agreement: { className: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200", icon: Scale },
  member: { className: "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200", icon: UserRound },
  work_archive: { className: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200", icon: Archive },
  dfi: { className: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200", icon: Film },
  tmdb: { className: "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200", icon: Database },
  wikidata: { className: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200", icon: Landmark },
  manual: { className: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200", icon: Pencil },
  unknown: { className: "border-border bg-muted/40 text-muted-foreground", icon: Building2 },
};

export function ContractSourceBadge({ source, label }: { source: ContractFieldSource; label?: string }) {
  const config = SOURCE_STYLE[source];
  const Icon = config.icon;
  return <Badge variant="outline" className={`h-5 shrink-0 gap-1 rounded-sm px-1.5 text-[9px] font-medium ${config.className}`}>
    <Icon className="h-3 w-3" aria-hidden />
    {label ?? CONTRACT_SOURCE_LABELS[source]}
  </Badge>;
}
