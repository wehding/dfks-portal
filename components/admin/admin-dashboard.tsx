"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle, Clock, FileText, MessageSquare, Scale, UserCheck, Users2 } from "lucide-react";
import type { AdminDashboardMetrics } from "@/lib/admin-dashboard";
import { formatResponseDuration } from "@/lib/admin-dashboard";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";
import { AdminInboxPanel } from "@/components/admin/admin-inbox-panel";
import { Badge } from "@/components/ui/badge";

function MetricCard({ icon: Icon, label, value, href, attention }: { icon: React.ElementType; label: string; value: number; href: string; attention?: boolean }) {
  return <Link href={href} className={`rounded-lg border p-5 transition-colors hover:bg-muted/40 ${attention && value ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : ""}`}>
    <Icon className={`h-5 w-5 ${attention && value ? "text-amber-600" : "text-muted-foreground"}`} />
    <p className="mt-3 text-3xl font-bold tabular-nums">{value}</p>
    <p className="text-sm text-muted-foreground">{label}</p>
  </Link>;
}

export function AdminDashboard({ metrics }: { metrics: AdminDashboardMetrics }) {
  const { t, locale } = useI18n();
  const totalMessages = Object.values(metrics.messages).reduce((sum, count) => sum + count, 0);
  const shortcuts = [
    { id: "contracts", href: "/admin/kontrakter?status=kladde", icon: CheckCircle, label: t("admin.dashboard.validateContracts"), description: t("admin.dashboard.validateContractsDescription"), tasks: metrics.tasks.contractDrafts, messages: metrics.messages.contracts },
    { id: "reviews", href: "/admin/kontraktgennemgang?status=afventer,behandling", icon: Scale, label: t("nav.contractReview"), description: t("admin.dashboard.contractReviewDescription"), tasks: metrics.tasks.contractReviews, messages: 0 },
    { id: "works", href: "/admin/vaerker?status=pending", icon: FileText, label: t("nav.works"), description: t("admin.dashboard.worksDescription"), tasks: metrics.tasks.workRequests, messages: metrics.messages.works },
    { id: "screenings", href: "/admin/aftalelicens?status=pending", icon: FileText, label: t("nav.visningsadmin"), description: t("admin.dashboard.screeningsDescription"), tasks: metrics.tasks.screeningClaims, messages: metrics.messages.screenings },
  ];
  return <div className="max-w-5xl space-y-8">
    <PageHeader title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <MetricCard icon={Clock} label={t("admin.dashboard.pendingTasks")} value={Object.values(metrics.tasks).reduce((sum, count) => sum + count, 0)} href="#shortcuts" attention />
      <MetricCard icon={MessageSquare} label={t("admin.dashboard.unreadMessages")} value={totalMessages} href="#messages" attention />
      <MetricCard icon={CheckCircle} label={t("admin.dashboard.validatedContracts")} value={metrics.validatedContracts} href="/admin/kontrakter?status=valideret" />
      <MetricCard icon={UserCheck} label={t("admin.dashboard.activeMembers")} value={metrics.members} href="/admin/rettighedshavere" />
    </div>

    <section className="space-y-3" aria-labelledby="response-time-title">
      <h2 id="response-time-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("admin.dashboard.responseTime")}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{t("admin.dashboard.median30Days")}</p><p className="mt-1 text-2xl font-semibold">{formatResponseDuration(metrics.responseTimes.medianMs, locale)}</p></div>
        <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{t("admin.dashboard.p90")}</p><p className="mt-1 text-2xl font-semibold">{formatResponseDuration(metrics.responseTimes.p90Ms, locale)}</p></div>
        <div className={`rounded-lg border p-4 ${metrics.responseTimes.unansweredCount ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : ""}`}><p className="text-xs text-muted-foreground">{t("admin.dashboard.unanswered")}</p><p className="mt-1 text-2xl font-semibold">{metrics.responseTimes.unansweredCount}</p></div>
      </div>
    </section>

    <section id="shortcuts" className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("admin.dashboard.shortcuts")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {shortcuts.map(item => <Link key={item.id} href={item.href} className="flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/40">
          <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.label}</p><p className="truncate text-xs text-muted-foreground">{item.description}</p></div>
          {item.messages > 0 && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">{item.messages}</Badge>}
          {item.tasks > 0 && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{item.tasks}</Badge>}
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>)}
      </div>
    </section>

    {metrics.tasks.contractReviews > 0 && <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 dark:bg-amber-950/20"><div className="flex items-center gap-3"><AlertCircle className="h-5 w-5 text-amber-600" /><span className="text-sm font-medium">{t("admin.dashboard.reviewsWaiting", { count: metrics.tasks.contractReviews })}</span></div><Link href="/admin/kontraktgennemgang?status=afventer,behandling" className="text-sm font-medium text-amber-800 underline">{t("admin.dashboard.openQueue")}</Link></div>}

    <section id="messages" className="space-y-3"><h2 className="flex items-center gap-2 text-lg font-semibold"><Users2 className="h-5 w-5 text-blue-500" />{t("admin.dashboard.memberMessages")}</h2><AdminInboxPanel /></section>
  </div>;
}
