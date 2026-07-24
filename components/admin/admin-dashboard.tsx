"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle, FileText, Scale, Users2 } from "lucide-react";
import type { AdminDashboardMetrics } from "@/lib/admin-dashboard";
import { formatResponseDuration } from "@/lib/admin-dashboard";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";
import { AdminInboxPanel } from "@/components/admin/admin-inbox-panel";
import { Badge } from "@/components/ui/badge";

export function AdminDashboard({ metrics }: { metrics: AdminDashboardMetrics }) {
  const { t, locale } = useI18n();
  const shortcuts = [
    { id: "contracts", href: "/admin/kontrakter?status=validationPending", icon: CheckCircle, label: t("admin.dashboard.validateContracts"), description: t("admin.dashboard.validateContractsDescription"), tasks: metrics.tasks.contractValidationsPending, messages: metrics.messages.contracts, secondary: t("admin.dashboard.validatedContracts"), secondaryValue: metrics.validatedContracts },
    { id: "reviews", href: "/admin/kontraktgennemgang?status=afventer,behandling", icon: Scale, label: t("nav.contractReview"), description: t("admin.dashboard.contractReviewDescription"), tasks: metrics.tasks.contractReviews, messages: 0 },
    { id: "works", href: "/admin/vaerker?status=pending", icon: FileText, label: t("nav.works"), description: t("admin.dashboard.worksDescription"), tasks: metrics.tasks.workRequests, messages: metrics.messages.works },
    { id: "screenings", href: "/admin/aftalelicens?status=pending", icon: FileText, label: t("nav.visningsadmin"), description: t("admin.dashboard.screeningsDescription"), tasks: metrics.tasks.screeningClaims, messages: metrics.messages.screenings },
  ];
  return <div className="max-w-5xl space-y-8">
    <PageHeader title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {shortcuts.map(item => <Link key={item.id} href={item.href} className={`group flex min-h-44 flex-col rounded-lg border p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.tasks ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
        <div className="flex items-start justify-between gap-3"><item.icon className={`h-5 w-5 ${item.tasks ? "text-amber-600" : "text-muted-foreground"}`} /><ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div>
        <p className="mt-3 text-sm font-semibold">{item.label}</p>
        <p className="mt-1 flex items-end gap-2"><span className="text-3xl font-bold tabular-nums">{item.tasks}</span><span className="pb-1 text-xs text-muted-foreground">{t("admin.dashboard.pendingTasks")}</span></p>
        <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {item.messages > 0 && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">{item.messages} {t("admin.dashboard.unreadMessages").toLocaleLowerCase(locale)}</Badge>}
          {item.secondary && <Badge variant="outline">{item.secondaryValue} {item.secondary.toLocaleLowerCase(locale)}</Badge>}
        </div>
      </Link>)}
    </div>

    <section className="space-y-3" aria-labelledby="response-time-title">
      <h2 id="response-time-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("admin.dashboard.responseTime")}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{t("admin.dashboard.median30Days")}</p><p className="mt-1 text-2xl font-semibold">{formatResponseDuration(metrics.responseTimes.medianMs, locale)}</p></div>
        <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{t("admin.dashboard.p90")}</p><p className="mt-1 text-2xl font-semibold">{formatResponseDuration(metrics.responseTimes.p90Ms, locale)}</p></div>
        <div className={`rounded-lg border p-4 ${metrics.responseTimes.unansweredCount ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : ""}`}><p className="text-xs text-muted-foreground">{t("admin.dashboard.unanswered")}</p><p className="mt-1 text-2xl font-semibold">{metrics.responseTimes.unansweredCount}</p></div>
      </div>
    </section>

    {metrics.tasks.contractReviews > 0 && <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 dark:bg-amber-950/20"><div className="flex items-center gap-3"><AlertCircle className="h-5 w-5 text-amber-600" /><span className="text-sm font-medium">{t("admin.dashboard.reviewsWaiting", { count: metrics.tasks.contractReviews })}</span></div><Link href="/admin/kontraktgennemgang?status=afventer,behandling" className="text-sm font-medium text-amber-800 underline">{t("admin.dashboard.openQueue")}</Link></div>}

    <section id="messages" className="space-y-3"><div className="flex flex-wrap items-center gap-2"><h2 className="flex items-center gap-2 text-lg font-semibold"><Users2 className="h-5 w-5 text-blue-500" />{t("admin.dashboard.memberMessages")}</h2><Badge variant="outline">{metrics.members} {t("admin.dashboard.activeMembers").toLocaleLowerCase(locale)}</Badge>{metrics.messages.inbox > 0 && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">{metrics.messages.inbox} {t("admin.dashboard.unreadMessages").toLocaleLowerCase(locale)}</Badge>}</div><AdminInboxPanel /></section>
  </div>;
}
