"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle, FileText, Scale, Users2 } from "lucide-react";
import type { AdminDashboardMetrics } from "@/lib/admin-dashboard";
import { formatResponseDuration } from "@/lib/admin-dashboard";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";
import { AdminInboxPanel } from "@/components/admin/admin-inbox-panel";
import { Badge } from "@/components/ui/badge";
import { OrgContextNotice } from "@/components/navigation/org-context-notice";

export function AdminDashboard({ metrics, notice }: { metrics: AdminDashboardMetrics; notice?: string | null }) {
  const { t, locale } = useI18n();
  const shortcuts = [
    { id: "contracts", href: "/admin/kontrakter?tab=valideringskoe", icon: CheckCircle, label: t("admin.dashboard.validateContracts"), description: t("admin.dashboard.validateContractsDescription"), tasks: metrics.tasks.contractValidationsPending, messages: metrics.messages.contracts, secondary: t("admin.dashboard.validatedContracts"), secondaryValue: metrics.validatedContracts },
    { id: "reviews", href: "/admin/kontraktgennemgang?status=afventer,behandling", icon: Scale, label: t("nav.contractReview"), description: t("admin.dashboard.contractReviewDescription"), tasks: metrics.tasks.contractReviews, messages: 0 },
    { id: "works", href: "/admin/vaerker?status=pending", messageHref: "/admin/vaerker?status=beskeder", icon: FileText, label: t("nav.works"), description: t("admin.dashboard.worksDescription"), tasks: metrics.tasks.workRequests, messages: metrics.messages.works },
    { id: "work-shares", href: "/admin/vaerker?tab=arbejdsandele", icon: Scale, label: "Afstem arbejdsandele", description: "Gennemgå medlemmers procentbud og eventuelle konflikter på værker.", tasks: metrics.tasks.workShareCases, messages: 0 },
    { id: "screenings", href: "/admin/aftalelicens?status=pending", icon: FileText, label: t("nav.visningsadmin"), description: t("admin.dashboard.screeningsDescription"), tasks: metrics.tasks.screeningClaims, messages: metrics.messages.screenings },
  ].filter(item => process.env.NODE_ENV !== "production" || item.id !== "screenings");
  return <div className="max-w-5xl space-y-5">
    <PageHeader title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />
    <OrgContextNotice notice={notice} />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {shortcuts.map(item => <div key={item.id} className={`group flex flex-col justify-between rounded-lg border p-3.5 transition-colors hover:bg-muted/40 ${item.tasks ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20" : "bg-card"}`}>
        <Link href={item.href} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-start justify-between gap-2"><item.icon className={`h-4 w-4 ${item.tasks ? "text-amber-600" : "text-muted-foreground"}`} /><ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div>
          <p className="mt-2 text-xs font-semibold text-foreground">{item.label}</p>
          <p className="mt-1 flex items-baseline gap-1.5"><span className="text-2xl font-bold tabular-nums text-foreground">{item.tasks}</span><span className="text-[11px] text-muted-foreground">{t("admin.dashboard.pendingTasks")}</span></p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground line-clamp-2">{item.description}</p>
        </Link>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/50">
          {item.messages > 0 && ("messageHref" in item && item.messageHref
            ? <Link href={item.messageHref} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-[10px] px-1.5 py-0">{item.messages} {t("admin.dashboard.unreadMessages").toLocaleLowerCase(locale)}</Badge></Link>
            : <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-[10px] px-1.5 py-0">{item.messages} {t("admin.dashboard.unreadMessages").toLocaleLowerCase(locale)}</Badge>)}
          {item.secondary && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{item.secondaryValue} {item.secondary.toLocaleLowerCase(locale)}</Badge>}
        </div>
      </div>)}
    </div>

    <section className="space-y-2.5" aria-labelledby="response-time-title">
      <h2 id="response-time-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("admin.dashboard.responseTime")}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card px-3.5 py-2.5"><p className="text-[11px] font-medium text-muted-foreground">{t("admin.dashboard.median30Days")}</p><p className="mt-1 text-xl font-bold tabular-nums">{formatResponseDuration(metrics.responseTimes.medianMs, locale)}</p></div>
        <div className="rounded-lg border bg-card px-3.5 py-2.5"><p className="text-[11px] font-medium text-muted-foreground">{t("admin.dashboard.p90")}</p><p className="mt-1 text-xl font-bold tabular-nums">{formatResponseDuration(metrics.responseTimes.p90Ms, locale)}</p></div>
        {metrics.responseTimes.unansweredCount && metrics.responseTimes.oldestUnansweredThreadId ? <Link href={`/admin?thread=${encodeURIComponent(metrics.responseTimes.oldestUnansweredThreadId)}#messages`} className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-amber-950/20 dark:hover:bg-amber-950/35"><p className="text-[11px] font-medium text-muted-foreground">{t("admin.dashboard.unanswered")}</p><p className="mt-1 text-xl font-bold tabular-nums text-foreground">{metrics.responseTimes.unansweredCount}</p><p className="mt-1 text-[11px] font-medium text-amber-800 dark:text-amber-300">Åbn ældste ubesvarede henvendelse →</p></Link> : <div className="rounded-lg border bg-card px-3.5 py-2.5"><p className="text-[11px] font-medium text-muted-foreground">{t("admin.dashboard.unanswered")}</p><p className="mt-1 text-xl font-bold tabular-nums text-foreground">{metrics.responseTimes.unansweredCount}</p></div>}
      </div>
    </section>

    {metrics.tasks.contractReviews > 0 && <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 dark:bg-amber-950/20"><div className="flex items-center gap-2.5"><AlertCircle className="h-4 w-4 text-amber-600" /><span className="text-xs font-medium">{t("admin.dashboard.reviewsWaiting", { count: metrics.tasks.contractReviews })}</span></div><Link href="/admin/kontraktgennemgang?status=afventer,behandling" className="text-xs font-semibold text-amber-800 underline">{t("admin.dashboard.openQueue")}</Link></div>}

    <section id="messages" className="space-y-2.5"><div className="flex flex-wrap items-center gap-2"><h2 className="flex items-center gap-2 text-base font-semibold"><Users2 className="h-4 w-4 text-blue-500" />{t("admin.dashboard.memberMessages")}</h2><Badge variant="outline" className="text-xs">{metrics.members} {t("admin.dashboard.activeMembers").toLocaleLowerCase(locale)}</Badge>{metrics.messages.inbox > 0 && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-xs">{metrics.messages.inbox} {t("admin.dashboard.unreadMessages").toLocaleLowerCase(locale)}</Badge>}</div><AdminInboxPanel /></section>
  </div>;
}
