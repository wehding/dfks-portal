"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Loader2, Search } from "lucide-react";
import { AUDIT_ACTIONS, AUDIT_SOURCES, auditEntityHref, type AuditEvent } from "@/lib/audit-log";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Option = { id: string; name: string };
type ResponseData = {
  items: AuditEvent[];
  nextCursor: string | null;
  organisations: Option[];
  actors: Option[];
  members: Option[];
  purposes: string[];
  components: string[];
  callerRole: string;
  callerOrgId: string;
};

const ACTION_LABELS: Record<string, string> = {
  create: "Oprettet", update: "Rettet", delete: "Slettet", archive: "Arkiveret",
  restore: "Gendannet", validate: "Valideret", approve: "Godkendt", merge: "Sammenlagt",
  link: "Tilknyttet", unlink: "Tilknytning fjernet",
  invite: "Invitation", reset_link: "Nulstillingslink", export: "Eksport", download: "Download",
  import: "Import", sync: "Synkronisering", job: "Systemjob", security_failure: "Afvist handling",
  retention: "Opbevaring",
  read: "Opslag", search: "Søgning", ai_analysis: "AI-analyse", sar_export: "Indsigtsudtræk",
  siem_delivery: "SIEM-levering", security_review: "Sikkerhedsgennemgang",
};

const ACTION_LABELS_EN: Record<string, string> = {
  create: "Created", update: "Updated", delete: "Deleted", archive: "Archived",
  restore: "Restored", validate: "Validated", approve: "Approved", merge: "Merged",
  link: "Linked", unlink: "Unlinked",
  invite: "Invitation", reset_link: "Reset link", export: "Export", download: "Download",
  import: "Import", sync: "Sync", job: "System job", security_failure: "Rejected action",
  retention: "Retention",
  read: "Read", search: "Search", ai_analysis: "AI analysis", sar_export: "Access export",
  siem_delivery: "SIEM delivery", security_review: "Security review",
};

function eventSummary(event: AuditEvent, labels: Record<string, string>, locale: "da" | "en") {
  if (!event.changes.length) return labels[event.action] ?? event.action;
  const fieldLabels: Record<string, { da: string; en: string }> = {
    work: { da: "værk", en: "work" },
    season: { da: "sæson", en: "season" },
    episodes: { da: "afsnit", en: "episodes" },
  };
  const fields = event.changes.slice(0, 3).map(change => fieldLabels[change.field]?.[locale] ?? change.field).join(", ");
  return locale === "da"
    ? `${event.changes.length} felt${event.changes.length === 1 ? "" : "er"}: ${fields}`
    : `${event.changes.length} field${event.changes.length === 1 ? "" : "s"}: ${fields}`;
}

export function AuditLogClient({ embedded = false }: { embedded?: boolean }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<ResponseData | null>(null);
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ query: "", from: "", to: "", orgId: "", actorUserId: "", role: "", action: "", entityType: "", source: "", targetMemberUuid: "", purposeCode: "", systemComponent: "", outcome: "" });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
    return params.toString();
  }, [filters]);

  const load = useCallback(async (cursor?: string, append = false) => {
    setLoading(true);
    setError("");
    try {
      const suffix = [queryString, cursor ? `cursor=${encodeURIComponent(cursor)}` : ""].filter(Boolean).join("&");
      const response = await fetch(`/api/admin/audit-log${suffix ? `?${suffix}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("load_failed");
      const result = await response.json() as ResponseData;
      setData(result);
      setItems(current => append ? [...current, ...result.items] : result.items);
    } catch {
      setError(t("audit.error"));
    } finally {
      setLoading(false);
    }
  }, [queryString, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), filters.query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, filters.query]);

  const setFilter = (key: keyof typeof filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const dateFormat = new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-GB", { dateStyle: "short", timeStyle: "short" });
  const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const actionLabels = locale === "da" ? ACTION_LABELS : ACTION_LABELS_EN;

  return (
    <div className={embedded ? "space-y-6" : "space-y-6 p-4 sm:p-6"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {!embedded && <div><h1 className="text-2xl font-semibold">{t("audit.title")}</h1><p className="text-sm text-muted-foreground">{t("audit.subtitle")}</p></div>}
        {embedded && <p className="text-sm text-muted-foreground">{locale === "da" ? "Filtrér det interne, uforanderlige revisionsspor." : "Filter the internal, immutable audit trail."}</p>}
        <Button asChild variant="outline"><a href={`/api/admin/audit-log/export${queryString ? `?${queryString}` : ""}`}><Download className="size-4" />{t("audit.export")}</a></Button>
      </div>

      <section aria-label={t("audit.filters")} className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative sm:col-span-2"><span className="sr-only">{t("audit.search")}</span><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={filters.query} onChange={event => setFilter("query", event.target.value)} placeholder={t("audit.search")} /></label>
        <Input type="date" aria-label={t("audit.from")} value={filters.from} onChange={event => setFilter("from", event.target.value)} />
        <Input type="date" aria-label={t("audit.to")} value={filters.to} onChange={event => setFilter("to", event.target.value)} />
        {data?.callerRole === "superadmin" && <select className={selectClass} aria-label={t("audit.organisation")} value={filters.orgId} onChange={event => setFilter("orgId", event.target.value)}><option value="">{t("audit.allOrganisations")}</option>{data.organisations.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>}
        <select className={selectClass} aria-label={t("audit.actor")} value={filters.actorUserId} onChange={event => setFilter("actorUserId", event.target.value)}><option value="">{t("audit.allActors")}</option>{data?.actors.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
        <select className={selectClass} aria-label={t("audit.role")} value={filters.role} onChange={event => setFilter("role", event.target.value)}><option value="">{t("audit.allRoles")}</option>{["superadmin", "admin", "org-admin", "jurist", "viewer", "member"].map(role => <option key={role} value={role}>{role}</option>)}</select>
        <select className={selectClass} aria-label={t("audit.action")} value={filters.action} onChange={event => setFilter("action", event.target.value)}><option value="">{t("audit.allActions")}</option>{AUDIT_ACTIONS.map(action => <option key={action} value={action}>{actionLabels[action] ?? action}</option>)}</select>
        <select className={selectClass} aria-label={t("audit.source")} value={filters.source} onChange={event => setFilter("source", event.target.value)}><option value="">{t("audit.allSources")}</option>{AUDIT_SOURCES.map(source => <option key={source} value={source}>{source}</option>)}</select>
        <select className={selectClass} aria-label="Medlem" value={filters.targetMemberUuid} onChange={event => setFilter("targetMemberUuid", event.target.value)}><option value="">{locale === "da" ? "Alle medlemmer" : "All members"}</option>{data?.members.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
        <select className={selectClass} aria-label="Formål" value={filters.purposeCode} onChange={event => setFilter("purposeCode", event.target.value)}><option value="">{locale === "da" ? "Alle formål" : "All purposes"}</option>{data?.purposes.map(value => <option key={value}>{value}</option>)}</select>
        <select className={selectClass} aria-label="Systemkomponent" value={filters.systemComponent} onChange={event => setFilter("systemComponent", event.target.value)}><option value="">{locale === "da" ? "Alle komponenter" : "All components"}</option>{data?.components.map(value => <option key={value}>{value}</option>)}</select>
        <select className={selectClass} aria-label="Resultat" value={filters.outcome} onChange={event => setFilter("outcome", event.target.value)}><option value="">{locale === "da" ? "Alle resultater" : "All outcomes"}</option><option value="success">success</option><option value="denied">denied</option><option value="failed">failed</option><option value="partial">partial</option></select>
        <Input aria-label={t("audit.entityType")} value={filters.entityType} onChange={event => setFilter("entityType", event.target.value)} placeholder={t("audit.entityType")} />
        <Button type="button" variant="ghost" onClick={() => setFilters({ query: "", from: "", to: "", orgId: "", actorUserId: "", role: "", action: "", entityType: "", source: "", targetMemberUuid: "", purposeCode: "", systemComponent: "", outcome: "" })}>{locale === "da" ? "Nulstil filtre" : "Reset filters"}</Button>
      </section>

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="hidden grid-cols-[10rem_1fr_9rem_1fr_2fr] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase text-muted-foreground md:grid"><span>{t("audit.time")}</span><span>{t("audit.actor")}</span><span>{t("audit.action")}</span><span>{t("audit.entity")}</span><span>{t("audit.change")}</span></div>
        {!loading && items.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{t("audit.empty")}</p>}
        {items.map(event => (
          <button key={event.id} type="button" onClick={() => setSelected(event)} className="grid w-full gap-1 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[10rem_1fr_9rem_1fr_2fr] md:items-center md:gap-3">
            <time className="text-xs text-muted-foreground md:text-sm">{dateFormat.format(new Date(event.occurredAt))}</time>
            <span className="truncate text-sm font-medium">{event.actorDisplayName || event.actorEmail || (event.actorType === "user" ? t("audit.unknownActor") : t("audit.system"))}</span>
            <Badge variant="outline" className="w-fit">{actionLabels[event.action] ?? event.action}</Badge>
            <span className="truncate text-sm">{event.entityLabel || event.entityType}</span>
            <span className="truncate text-sm text-muted-foreground">{eventSummary(event, actionLabels, locale)}</span>
          </button>
        ))}
      </div>
      {loading && <div className="flex justify-center p-4"><Loader2 className="size-5 animate-spin" aria-label={t("audit.loading")} /></div>}
      {!loading && data?.nextCursor && <div className="text-center"><Button variant="outline" onClick={() => void load(data.nextCursor!, true)}>{t("audit.loadMore")}</Button></div>}

      <Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{selected?.entityLabel || selected?.entityType}</DialogTitle><DialogDescription>{selected ? `${actionLabels[selected.action] ?? selected.action} · ${dateFormat.format(new Date(selected.occurredAt))}` : ""}</DialogDescription></DialogHeader>
          {selected && <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-muted-foreground">{t("audit.actor")}</dt><dd>{selected.actorDisplayName || selected.actorEmail || t("audit.system")}</dd><dt className="text-muted-foreground">{t("audit.role")}</dt><dd>{selected.actorRole || "—"}</dd><dt className="text-muted-foreground">{t("audit.source")}</dt><dd>{selected.source}</dd><dt className="text-muted-foreground">Medlem</dt><dd className="break-all font-mono text-xs">{selected.targetMemberUuid || "—"}</dd><dt className="text-muted-foreground">Formål</dt><dd>{selected.purposeCode || "—"}</dd><dt className="text-muted-foreground">Komponent</dt><dd>{selected.systemComponent || "—"}</dd><dt className="text-muted-foreground">Datakategorier</dt><dd>{selected.dataCategories.join(", ") || "—"}</dd><dt className="text-muted-foreground">Integritet</dt><dd><Badge variant={selected.integrityValid ? "outline" : "destructive"}>#{selected.sequenceNo} · {selected.integrityValid ? "Kædet" : "Fejl"}</Badge></dd><dt className="text-muted-foreground">{t("audit.organisation")}</dt><dd>{selected.organisations.map(org => org.name).join(", ") || "—"}</dd><dt className="text-muted-foreground">{t("audit.correlation")}</dt><dd className="break-all font-mono text-xs">{selected.correlationId || "—"}</dd></dl>
            <div><h3 className="mb-2 font-medium">{t("audit.changedFields")}</h3>{selected.changes.length === 0 ? <p className="text-muted-foreground">{t("audit.noFieldValues")}</p> : <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b"><th className="p-2">{t("audit.field")}</th><th className="p-2">{t("audit.before")}</th><th className="p-2">{t("audit.after")}</th></tr></thead><tbody>{selected.changes.map(change => <tr key={change.field} className="border-b last:border-0"><td className="p-2 font-medium">{({ work: locale === "da" ? "Værk" : "Work", season: locale === "da" ? "Sæson" : "Season", episodes: locale === "da" ? "Afsnit" : "Episodes" } as Record<string, string>)[change.field] ?? change.field}</td><td className="max-w-48 break-words p-2 text-muted-foreground">{change.redacted ? t("audit.redacted") : String(change.old ?? "—")}</td><td className="max-w-48 break-words p-2">{change.redacted ? t("audit.redacted") : String(change.new ?? "—")}</td></tr>)}</tbody></table></div>}</div>
            {auditEntityHref(selected) && <Button asChild variant="outline"><Link href={auditEntityHref(selected)!}>{t("audit.openEntity")}</Link></Button>}
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
