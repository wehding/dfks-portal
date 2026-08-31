"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { fetchAdminShareQueue, type AdminShareQueueParams } from "@/app/actions/work-share-cases";
import { WorkShareReconciliationWizard } from "@/components/admin/work-share-reconciliation-wizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AdminWorkShareQueueItem, WorkShareQueuePage, WorkShareQueueTaskType } from "@/lib/work-share-admin-queue";
import { useI18n } from "@/lib/i18n";
import { ListReadinessMarker } from "@/components/performance/list-readiness-marker";

export function WorkShareReconciliationTab({
  initialPage,
  onCountChange,
}: {
  initialPage: WorkShareQueuePage;
  onCountChange?: (count: number) => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [result, setResult] = useState(initialPage);
  const [search, setSearch] = useState(searchParams.get("shareQ") ?? "");
  const [taskType, setTaskType] = useState<WorkShareQueueTaskType>((searchParams.get("shareType") as WorkShareQueueTaskType) ?? "all");
  const [pageSize, setPageSize] = useState([20, 50, 100].includes(Number(searchParams.get("sharePageSize"))) ? Number(searchParams.get("sharePageSize")) : initialPage.pageSize);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const reasonLabels: Record<AdminWorkShareQueueItem["reasons"][number], string> = {
    shares: t("works.shareQueue.reasonShares"),
    dispute: t("works.shareQueue.reasonDispute"),
    unresolved: t("works.shareQueue.reasonUnresolved"),
    missing_responses: t("works.shareQueue.reasonMissingResponses"),
  };
  const activeTask = searchParams.get("shareTask");
  const initialLoadKey = JSON.stringify({ page: initialPage.page, pageSize: initialPage.pageSize, search: searchParams.get("shareQ") ?? "", taskType: searchParams.get("shareType") ?? "all" });
  const lastLoadKey = useRef(initialLoadKey);

  const navigateParams = useCallback((updates: Record<string, string | null>, history: "replace" | "push" = "replace") => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "arbejdsandele");
    next.delete("shareTasks");
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const href = `/admin/vaerker?${next.toString()}`;
    if (history === "push") router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }, [router, searchParams]);

  const load = useCallback((params: AdminShareQueueParams) => {
    setError(null);
    startTransition(() => {
      void fetchAdminShareQueue(params).then(next => {
        setResult(next);
        onCountChange?.(next.totalCount);
      }).catch(cause => setError(cause instanceof Error ? cause.message : t("works.shareQueue.loadError")));
    });
  }, [onCountChange, t]);

  useEffect(() => {
    if (activeTask) return;
    const timeout = window.setTimeout(() => {
      const filtersChanged = search.trim() !== (searchParams.get("shareQ") ?? "")
        || taskType !== (searchParams.get("shareType") ?? "all")
        || pageSize !== Number(searchParams.get("sharePageSize") ?? "20");
      const page = filtersChanged ? 1 : Math.max(1, Number(searchParams.get("sharePage") ?? "1") || 1);
      const loadKey = JSON.stringify({ page, pageSize, search: search.trim(), taskType });
      if (loadKey === lastLoadKey.current) return;
      lastLoadKey.current = loadKey;
      navigateParams({ shareQ: search.trim() || null, shareType: taskType === "all" ? null : taskType, sharePageSize: pageSize === 20 ? null : String(pageSize), sharePage: page === 1 ? null : String(page) });
      load({ page, pageSize, search, taskType });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [activeTask, load, navigateParams, pageSize, search, searchParams, taskType]);

  const activeIndex = useMemo(() => activeTask ? result.rows.findIndex(row => row.key === activeTask) : -1, [activeTask, result.rows]);
  const openTask = (task: string | null) => navigateParams({ shareTask: task }, "push");
  const goToPage = (page: number) => {
    lastLoadKey.current = JSON.stringify({ page, pageSize, search: search.trim(), taskType });
    navigateParams({ sharePage: page === 1 ? null : String(page), shareTask: null });
    load({ page, pageSize, search, taskType });
  };
  const handleResolved = () => {
    const nextCandidate = result.rows[activeIndex + 1] ?? result.rows[activeIndex - 1] ?? null;
    fetchAdminShareQueue({ page: result.page, pageSize, search, taskType }).then(next => {
      setResult(next);
      onCountChange?.(next.totalCount);
      const stillPending = nextCandidate && next.rows.some(row => row.key === nextCandidate.key) ? nextCandidate.key : next.rows[0]?.key ?? null;
      openTask(stillPending);
    }).catch(cause => setError(cause instanceof Error ? cause.message : t("works.shareQueue.updateError")));
  };

  if (activeTask) {
    return <div className="space-y-4">
      <Button variant="outline" onClick={() => openTask(null)}><ChevronLeft className="mr-2 h-4 w-4" />{t("works.shareQueue.back")}</Button>
      <WorkShareReconciliationWizard
        key={activeTask}
        taskKey={activeTask}
        position={activeIndex >= 0 ? activeIndex + 1 : 1}
        total={result.filteredCount}
        onPrevious={activeIndex > 0 ? () => openTask(result.rows[activeIndex - 1].key) : undefined}
        onNext={activeIndex >= 0 && activeIndex < result.rows.length - 1 ? () => openTask(result.rows[activeIndex + 1].key) : undefined}
        onResolved={handleResolved}
      />
    </div>;
  }

  const totalPages = Math.max(1, Math.ceil(result.filteredCount / result.pageSize));
  return <section className="space-y-4" aria-labelledby="work-share-queue-heading">
    <ListReadinessMarker route="admin-work-shares" stage="primary" />
    {result.rows.length > 0 && <ListReadinessMarker route="admin-work-shares" stage="first-row" />}
    <div>
      <h2 id="work-share-queue-heading" className="text-xl font-semibold">{t("works.shareQueue.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("works.shareQueue.description")}</p>
    </div>
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_120px]">
      <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("works.shareQueue.search")} aria-label={t("works.shareQueue.search")} /></div>
      <Select value={taskType} onValueChange={value => setTaskType(value as WorkShareQueueTaskType)}><SelectTrigger aria-label={t("works.shareQueue.taskType")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("works.shareQueue.allTasks")}</SelectItem><SelectItem value="shares">{t("works.shareQueue.shares")}</SelectItem><SelectItem value="missing_responses">{t("works.shareQueue.missingResponses")}</SelectItem><SelectItem value="unresolved">{t("works.shareQueue.unresolvedPeople")}</SelectItem><SelectItem value="disputes">{t("works.shareQueue.disputes")}</SelectItem></SelectContent></Select>
      <Select value={String(pageSize)} onValueChange={value => setPageSize(Number(value))}><SelectTrigger aria-label={t("works.shareQueue.rowsPerPage")}><SelectValue /></SelectTrigger><SelectContent>{[20, 50, 100].map(size => <SelectItem key={size} value={String(size)}>{size} {t("works.shareQueue.perPage")}</SelectItem>)}</SelectContent></Select>
    </div>
    {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    {isPending && <p role="status" className="text-sm text-muted-foreground">{t("works.shareQueue.updating")}</p>}
    {!isPending && !result.rows.length ? <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">{t("works.shareQueue.empty")}</div> : <div className="space-y-2">
      {result.rows.map(row => <button key={row.key} type="button" onClick={() => openTask(row.key)} className="grid w-full gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
        <div><p className="font-medium">{row.title}{row.seasonNumber != null ? ` · ${t("works.shareQueue.season")} ${row.seasonNumber}` : ""}{row.episodeNumber != null ? ` · ${t("works.shareQueue.episode")} ${row.episodeNumber}` : ""}</p><div className="mt-2 flex flex-wrap gap-1">{row.reasons.map(reason => <Badge key={reason} variant={reason === "dispute" ? "destructive" : "secondary"}>{reasonLabels[reason]}</Badge>)}</div></div>
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground"><span><strong className="block text-base text-foreground">{row.participantCount}</strong>{t("works.shareQueue.editors")}</span><span><strong className="block text-base text-foreground">{row.missingResponseCount}</strong>{t("works.shareQueue.missingResponses")}</span><span><strong className="block text-base text-foreground">{row.unresolvedCount}</strong>{t("works.shareQueue.unresolved")}</span></div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground md:justify-end"><span>{new Date(row.updatedAt).toLocaleDateString()}</span><ChevronRight className="h-4 w-4" aria-hidden="true" /></div>
      </button>)}
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">{t("works.shareQueue.page")} {result.page} {t("works.shareQueue.of")} {totalPages} · {result.filteredCount} {t("works.shareQueue.tasks")}</p><div className="flex gap-2"><Button variant="outline" disabled={result.page <= 1 || isPending} onClick={() => goToPage(result.page - 1)}><ChevronLeft className="mr-1 h-4 w-4" />{t("works.shareQueue.previous")}</Button><Button variant="outline" disabled={!result.hasNextPage || isPending} onClick={() => goToPage(result.page + 1)}>{t("works.shareQueue.next")}<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>
  </section>;
}
