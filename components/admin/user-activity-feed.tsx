"use client";

import Link from "next/link";
import { Activity, Clock, FileText, Film, User, CheckCircle2, ArrowRight } from "lucide-react";
import type { UserActivityItem } from "@/lib/admin-dashboard";
import { Badge } from "@/components/ui/badge";

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return "Lige nu";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `for ${diffMin} min. siden`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `for ${diffHours} t. siden`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "I går";
  if (diffDays < 30) return `for ${diffDays} dage siden`;
  return new Date(isoString).toLocaleDateString("da-DK", { day: "numeric", month: "short" });
}

function getEntityIcon(entityType: string) {
  if (entityType.startsWith("contract")) return FileText;
  if (entityType.startsWith("work")) return Film;
  if (entityType === "rettighedshavere" || entityType === "member_profile") return User;
  return Activity;
}

export function UserActivityFeed({ activities }: { activities: UserActivityItem[] }) {
  return (
    <section className="space-y-2.5" aria-labelledby="recent-user-activity-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <h2 id="recent-user-activity-title" className="text-sm font-semibold tracking-tight text-foreground">
            Seneste brugeraktivitet
          </h2>
          <Badge variant="outline" className="text-[10px] font-medium text-muted-foreground">
            {activities.length} {activities.length === 1 ? "handling" : "handlinger"}
          </Badge>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Handlinger foretaget af brugere i organisationen
        </span>
      </div>

      <div className="rounded-lg border bg-card p-0 shadow-sm overflow-hidden">
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-xs font-medium">Ingen nylige brugerhandlinger</p>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              Når medlemmer uploader kontrakter, forbinder værker eller færdiggør onboarding, vises det her.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {activities.map(item => {
              const Icon = getEntityIcon(item.entityType);
              const isContract = item.entityType.startsWith("contract");
              const isWork = item.entityType.startsWith("work");
              const href = isContract && item.entityId
                ? `/admin/kontrakter`
                : isWork && item.entityId
                ? `/admin/vaerker`
                : null;

              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/40 text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {item.description}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                        <span className="font-medium text-foreground/80">{item.actorName}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {formatRelativeTime(item.occurredAt)}
                        </span>
                        {item.entityLabel && (
                          <>
                            <span>•</span>
                            <span className="truncate max-w-[200px] text-foreground/70" title={item.entityLabel}>
                              {item.entityLabel}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {href && (
                    <Link
                      href={href}
                      className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
                    >
                      <span>Åbn</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
