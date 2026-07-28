"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ExternalLink, Loader2, RefreshCw, Search, X } from "lucide-react";
import {
  approveWorkIdentityCandidate,
  rejectWorkIdentityCandidates,
  scanWorkIdentities,
  setManualWorkImdbId,
  type WorkIdentityQueueItem,
} from "@/app/actions/work-identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

export function ImdbControlClient({ initialItems }: { initialItems: WorkIdentityQueueItem[] }) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [manualIds, setManualIds] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const filtered = useMemo(() => items.filter(item => item.title.toLocaleLowerCase(locale === "da" ? "da-DK" : "en-GB").includes(query.trim().toLocaleLowerCase())), [items, locale, query]);

  const reload = () => window.location.reload();
  const scan = (ids: string[]) => startTransition(async () => {
    setMessage("");
    const result = await scanWorkIdentities(ids);
    if (!result.success) setMessage(result.error ?? t("imdbControl.error"));
    else {
      setMessage(t("imdbControl.scanComplete"));
      window.setTimeout(reload, 250);
    }
  });
  const approve = (workId: string, imdbId: string) => startTransition(async () => {
    const result = await approveWorkIdentityCandidate(workId, imdbId);
    if (!result.success) setMessage(result.error ?? t("imdbControl.error"));
    else setItems(current => current.filter(item => item.id !== workId));
  });
  const reject = (workId: string) => startTransition(async () => {
    await rejectWorkIdentityCandidates(workId);
    setItems(current => current.map(item => item.id === workId ? { ...item, status: "not_found", candidates: [] } : item));
  });
  const saveManual = (workId: string) => startTransition(async () => {
    const result = await setManualWorkImdbId(workId, manualIds[workId] ?? "");
    if (!result.success) setMessage(result.error ?? t("imdbControl.error"));
    else setItems(current => current.filter(item => item.id !== workId));
  });

  return <main className="space-y-5 p-1 sm:p-2">
    <header className="space-y-1"><h1 className="text-2xl font-semibold">{t("imdbControl.title")}</h1><p className="text-sm text-muted-foreground">{t("imdbControl.subtitle")}</p></header>
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
      <label className="relative flex-1"><span className="sr-only">{t("imdbControl.search")}</span><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input value={query} onChange={event => setQuery(event.target.value)} className="pl-9" placeholder={t("imdbControl.search")}/></label>
      <Button variant="outline" disabled={isPending || selected.size === 0} onClick={() => scan([...selected])}>{isPending ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}{t("imdbControl.scanSelected")}</Button>
      <Button disabled={isPending || filtered.length === 0} onClick={() => scan(filtered.slice(0, 100).map(item => item.id))}>{t("imdbControl.scanAll")}</Button>
    </section>
    {message && <p role="status" className="rounded-md border bg-muted p-3 text-sm">{message}</p>}
    <div className="overflow-hidden rounded-lg border bg-card">
      {filtered.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{t("imdbControl.empty")}</p>}
      {filtered.map(item => <article key={item.id} className="space-y-3 border-b p-4 last:border-0">
        <div className="flex items-start gap-3">
          <input type="checkbox" checked={selected.has(item.id)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} aria-label={`${t("imdbControl.select")} ${item.title}`} className="mt-1 size-4"/>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">{item.title}</h2><Badge variant={item.status === "review_required" ? "default" : "outline"}>{t(`imdbControl.status.${item.status}` as Parameters<typeof t>[0])}</Badge>{item.inheritedIdentity && <Badge variant="destructive">{t("imdbControl.inherited")}</Badge>}</div><p className="text-xs text-muted-foreground">{item.year ?? "—"} · {item.type ?? "—"}{item.seasonNumber ? ` · S${item.seasonNumber}E${item.episodeNumber ?? "—"}` : ""}</p></div>
          <Button asChild size="icon" variant="ghost"><Link href={`/admin/vaerker?edit=${encodeURIComponent(item.id)}`} aria-label={t("imdbControl.openWork")}><ExternalLink className="size-4"/></Link></Button>
        </div>
        {item.candidates.length > 0 && <div className="space-y-2 pl-7">{item.candidates.map(candidate => <div key={candidate.imdbId} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-medium">{candidate.title} <span className="font-normal text-muted-foreground">({candidate.year ?? "—"})</span></p><p className="text-xs text-muted-foreground">{candidate.imdbId} · {candidate.confidence}% · {candidate.sources.join(", ")}</p></div><div className="flex gap-2"><Button size="sm" onClick={() => approve(item.id, candidate.imdbId)} disabled={isPending}><Check className="size-4"/>{t("imdbControl.approve")}</Button><Button size="sm" variant="outline" onClick={() => reject(item.id)} disabled={isPending}><X className="size-4"/>{t("imdbControl.reject")}</Button></div></div>)}</div>}
        <div className="flex flex-col gap-2 pl-7 sm:flex-row">
          <Input value={manualIds[item.id] ?? ""} onChange={event => setManualIds(current => ({ ...current, [item.id]: event.target.value }))} placeholder="tt1234567" aria-label={`${t("imdbControl.manualId")} ${item.title}`} className="sm:max-w-48"/>
          <Button variant="outline" disabled={isPending || !(manualIds[item.id] ?? "").trim()} onClick={() => saveManual(item.id)}>{t("imdbControl.saveManual")}</Button>
        </div>
      </article>)}
    </div>
  </main>;
}
