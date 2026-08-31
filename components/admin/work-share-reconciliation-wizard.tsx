"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  createRightsHolderFromShareParticipant,
  excludeShareParticipant,
  fetchAdminShareCases,
  matchShareParticipant,
  proposeAdminShareCompromise,
  refreshAdminShareCaseCredits,
  remindShareParticipant,
  resolveAdminShareCase,
} from "@/app/actions/work-share-cases";
import { resolveCollaborationDispute } from "@/app/actions/work-collaboration-reviews";
import { RightsHolderAutocomplete } from "@/components/admin/rights-holder-autocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { workShareParticipantSourceText } from "@/lib/work-share-admin";

type Holder = { full_name: string; email: string | null; user_id: string | null; invite_sent_at: string | null };
type Participant = { id: string; rights_holder_id: string | null; proposed_name: string | null; role: string; relationship_status: string; proposed_percent: number | null; admin_seed_percent: number | null; final_percent: number | null; source_tags: string[]; source_details: { roles?: string[] } | null; invited_by_rights_holder_id: string | null; excluded_at: string | null; last_reminder_sent_at: string | null; rettighedshavere: Holder | null; reported_by: { full_name: string } | null };
type CreditSourceState = { source: "dfi" | "tmdb"; status: "missing" | "fresh" | "stale" | "refreshing" | "error"; lastSuccessAt: string | null; lastAttemptAt: string | null; errorCode: string | null };
type ShareCase = { id: string; work_id: string; season_number: number | null; episode_number: number | null; status: string; reserve_percent: number; works: { title: string } | null; work_share_participants: Participant[]; credit_source_states: CreditSourceState[] };
type CollaborationDispute = { id: string; works: { title: string; season_number: number | null; episode_number: number | null } | null; rettighedshavere: { full_name: string } | null };

export function WorkShareReconciliationWizard({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [cases, setCases] = useState<ShareCase[]>([]);
  const [disputes, setDisputes] = useState<CollaborationDispute[]>([]);
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reserve, setReserve] = useState("0");
  const [createDraft, setCreateDraft] = useState<Record<string, { name: string; email: string; phone: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const caseResult = await fetchAdminShareCases();
      const next = caseResult.cases as unknown as ShareCase[];
      const nextDisputes = caseResult.disputes as unknown as CollaborationDispute[];
      setCases(next);
      setDisputes(nextDisputes);
      setIndex(current => Math.min(current, Math.max(0, next.length - 1)));
      onCountChange?.(caseResult.count);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Opgaverne kunne ikke hentes.";
      setLoadError(text);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  const active = cases[index] ?? null;
  const participants = useMemo(() => active?.work_share_participants.filter(row => !row.excluded_at) ?? [], [active]);
  const unresolved = participants.filter(row => !row.rights_holder_id);
  const missingResponses = participants.filter(row => row.rights_holder_id && ["pending", "pending_match"].includes(row.relationship_status));
  const allocatedTotal = useMemo(() => participants.reduce((sum, participant) => {
    const value = Number((drafts[participant.id] ?? "").replace(",", "."));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0), [drafts, participants]);
  const reserveValue = Number(reserve.replace(",", "."));
  const combinedTotal = allocatedTotal + (Number.isFinite(reserveValue) ? reserveValue : 0);

  useEffect(() => {
    if (!active) return;
    setDrafts(Object.fromEntries(active.work_share_participants.filter(row => !row.excluded_at).map(row => [row.id, String(row.final_percent ?? row.proposed_percent ?? row.admin_seed_percent ?? "")])));
    setReserve(String(active.reserve_percent ?? 0));
    setBusy(`credits:${active.id}`);
    void refreshAdminShareCaseCredits(active.id).then(result => {
      const refreshed = result.case as unknown as ShareCase;
      setCases(current => current.map(row => row.id === refreshed.id ? refreshed : row));
    }).catch(error => setMessage(error instanceof Error ? error.message : "Kilderne kunne ikke opdateres.")).finally(() => setBusy(null));
    // Kun et nyt sags-id må starte et kildeopslag; opdatering af den samme sag
    // erstatter objektet i listen og må ikke starte opslaget igen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  async function refreshSources(force: boolean) {
    if (!active) return;
    setBusy(`credits:${active.id}`);
    setMessage(null);
    try {
      const result = await refreshAdminShareCaseCredits(active.id, force);
      const refreshed = result.case as unknown as ShareCase;
      setCases(current => current.map(row => row.id === refreshed.id ? refreshed : row));
      if (force) setMessage("Kilderne er opdateret.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kilderne kunne ikke opdateres.");
    } finally {
      setBusy(null);
    }
  }

  async function run(key: string, operation: () => Promise<unknown>, success: string) {
    setBusy(key); setMessage(null);
    try { await operation(); setMessage(success); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Handlingen kunne ikke gennemføres."); }
    finally { setBusy(null); }
  }

  async function invite(participant: Participant) {
    if (!active || !participant.rights_holder_id || !participant.rettighedshavere?.email) return;
    setBusy(`invite:${participant.id}`);
    setMessage(null);
    try {
      const previewResponse = await fetch("/api/admin/user", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview_invite", rhId: participant.rights_holder_id, workId: active.work_id }) });
      const preview = await previewResponse.json();
      if (!previewResponse.ok) { setMessage(preview.error ?? "Invitationen kunne ikke forhåndsvises."); return; }
      const previewText = `${preview.membership === "member" ? "Medlem" : "Ikke-medlem"}: ${preview.name}\n${preview.email}\n\n${preview.subject}\n\n${preview.bodyText}`;
      if (!window.confirm(`${previewText}\n\nSend denne invitation?`)) return;
    } catch {
      setMessage("Invitationen kunne ikke forhåndsvises.");
      return;
    } finally {
      setBusy(null);
    }
    await run(`invite:${participant.id}`, async () => {
      const response = await fetch("/api/admin/user", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "invite", rhId: participant.rights_holder_id, workId: active.work_id, includeWorks: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Invitationen kunne ikke sendes.");
      if (!result.email_sent) throw new Error("Mailen kunne ikke sendes. Invitationslinket er oprettet og kan deles manuelt fra Rettighedshavere.");
    }, "Invitationen er sendt.");
  }

  async function createParticipant(participant: Participant, draft: { name: string; email: string; phone: string }, withInvitation: boolean) {
    if (!active) return;
    if (withInvitation && !draft.email.trim()) {
      setMessage("Angiv en e-mailadresse for at oprette med invitation.");
      return;
    }
    if (withInvitation && !window.confirm(`Opret ${draft.name || "rettighedshaveren"} og send invitation til ${draft.email}?`)) return;
    setBusy(`create:${participant.id}`);
    setMessage(null);
    try {
      const created = await createRightsHolderFromShareParticipant({ participantId: participant.id, ...draft });
      if (withInvitation) {
        const response = await fetch("/api/admin/user", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "invite", rhId: created.rightsHolderId, workId: active.work_id, includeWorks: true }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Invitationen kunne ikke sendes.");
        if (!result.email_sent) throw new Error("Rettighedshaveren er oprettet, men mailen kunne ikke sendes. Invitationslinket kan deles manuelt fra Rettighedshavere.");
      }
      setMessage(withInvitation ? "Rettighedshaveren er oprettet, og invitationen er sendt." : "Rettighedshaveren er oprettet uden invitation.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rettighedshaveren kunne ikke oprettes.");
      await load().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !active && !disputes.length) return <p className="rounded-md border p-4 text-sm text-muted-foreground">Henter arbejdsandele…</p>;
  if (loadError && !active && !disputes.length) return <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4"><p className="text-sm font-medium text-destructive">Arbejdsandelene kunne ikke hentes.</p><p className="text-sm text-muted-foreground">{loadError}</p><Button size="sm" variant="outline" onClick={() => void load().catch(() => undefined)}>Prøv igen</Button></div>;
  if (!active && !disputes.length) return <p className="rounded-md border p-4 text-sm text-muted-foreground">Der er ingen arbejdsandele, der venter på afstemning.</p>;

  return <div className="space-y-4">
    {message && <p role="status" className="rounded-md border bg-muted/30 p-3 text-sm">{message}</p>}
    {disputes.length > 0 && <details className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:bg-amber-500/10" open={!active}>
      <summary className="cursor-pointer font-medium">{disputes.length} indsigelse(r) om klippet alene</summary>
      <div className="mt-3 space-y-3">{disputes.map(dispute => <div key={dispute.id} className="rounded-md border bg-background p-3">
        <p className="font-medium">{dispute.works?.title ?? "Ukendt værk"}{dispute.works?.season_number ? ` · sæson ${dispute.works.season_number}` : ""}{dispute.works?.episode_number ? ` · afsnit ${dispute.works.episode_number}` : ""}</p>
        <p className="mt-1 text-sm text-muted-foreground">{dispute.rettighedshavere?.full_name ?? "Et medlem"} oplyser, at arbejdet blev udført alene, selv om andre klippere er registreret.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy === `dispute:${dispute.id}`} onClick={() => void run(`dispute:${dispute.id}`, () => resolveCollaborationDispute({ reviewId: dispute.id, decision: "accept_solo" }), "Indsigelsen er accepteret som klippet alene.")}>Acceptér klippet alene</Button>
          <Button size="sm" variant="outline" disabled={busy === `dispute:${dispute.id}`} onClick={() => void run(`dispute:${dispute.id}`, () => resolveCollaborationDispute({ reviewId: dispute.id, decision: "reopen" }), "Medlemmets opgave er genåbnet.")}>Bed medlemmet gennemgå igen</Button>
        </div>
      </div>)}</div>
    </details>}
    {!active ? null : <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 className="text-lg font-semibold">{active.works?.title ?? "Ukendt værk"}{active.season_number ? ` · sæson ${active.season_number}` : ""}</h3>
      <div className="flex items-center gap-2" aria-label="Navigér mellem værker"><Button size="icon-xs" variant="outline" aria-label="Forrige værk" title="Forrige værk" disabled={index === 0} onClick={() => setIndex(value => value - 1)}><ChevronLeft /></Button><span className="min-w-12 text-center text-xs text-muted-foreground">{index + 1} af {cases.length}</span><Button size="icon-xs" variant="outline" aria-label="Spring til næste værk" title="Spring over" disabled={index >= cases.length - 1} onClick={() => setIndex(value => value + 1)}><ChevronRight /></Button></div>
    </div>
    <p className="text-sm text-muted-foreground">Bekræft personerne og angiv deres arbejdsandel.</p>

    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="share-participants-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="share-participants-heading" className="font-semibold">1. Klippere og arbejdsandele</h4>
        <div className="flex items-end gap-2"><Label className="space-y-1 text-xs">Reserve (%)<Input className="h-8 w-24" inputMode="decimal" value={reserve} onChange={event => setReserve(event.target.value)} /></Label><Button size="sm" variant="outline" onClick={() => void run(`proposal:${active.id}`, async () => { const result = await proposeAdminShareCompromise(active.id, Number(reserve.replace(",", ".")), participants.map(participant => { const value = drafts[participant.id]?.trim(); return { participantId: participant.id, percent: value ? Number(value.replace(",", ".")) : null }; })); setDrafts(current => ({ ...current, ...Object.fromEntries(result.participants.map(row => [row.participantId, String(row.finalPercent)])) })); }, "Kompromisforslaget er beregnet.")}>Beregn forslag</Button></div>
      </div>
      {participants.map(participant => {
        const holder = participant.rettighedshavere;
        const create = createDraft[participant.id] ?? { name: participant.proposed_name ?? "", email: "", phone: "" };
        return <div key={participant.id} className="space-y-2 rounded-md border p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_124px] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_148px]">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2">{participant.rights_holder_id ? <Link href={`/admin/rettighedshavere?edit=${encodeURIComponent(participant.rights_holder_id)}`} className="truncate font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{holder?.full_name ?? participant.proposed_name ?? "Ukendt"}</Link> : <p className="truncate font-medium">{participant.proposed_name ?? "Ukendt"}</p>}<Badge variant={participant.rights_holder_id ? "secondary" : "outline"}>{participant.rights_holder_id ? holder?.invite_sent_at ? "Inviteret" : "Ikke inviteret" : "Ikke i systemet"}</Badge></div><p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{workShareParticipantSourceText({ sourceTags: participant.source_tags, reportedByName: participant.reported_by?.full_name })}</p><p className="mt-1 text-xs text-muted-foreground">{[...new Set(participant.source_details?.roles?.length ? participant.source_details.roles : [participant.role])].join(" · ")}</p></div>
            <Label className="min-w-0 space-y-1 text-xs">%<Input aria-label="Arbejdsandel i procent" className="h-9 w-full" inputMode="decimal" value={drafts[participant.id] ?? ""} onChange={event => setDrafts(current => ({ ...current, [participant.id]: event.target.value }))} /><span className="block max-w-full whitespace-normal break-words text-[10px] font-normal leading-tight text-muted-foreground">Indsendt: {participant.proposed_percent ?? "mangler"} %</span></Label>
          </div>
          {!participant.rights_holder_id && <>
            <RightsHolderAutocomplete options={[]} searchEndpoint="/api/admin/rettighedshavere-search?scope=all" onChange={rightsHolderId => rightsHolderId && void run(`match:${participant.id}`, () => matchShareParticipant({ participantId: participant.id, rightsHolderId }), "Personen er forbundet.")} placeholder="Forbind med eksisterende rettighedshaver" />
            <details><summary className="cursor-pointer text-sm font-medium">Opret ny rettighedshaver</summary><div className="mt-2 grid gap-2 sm:grid-cols-3"><Input aria-label="Navn" value={create.name} onChange={event => setCreateDraft(current => ({ ...current, [participant.id]: { ...create, name: event.target.value } }))} /><Input aria-label="E-mail" type="email" placeholder="E-mail (valgfri)" value={create.email} onChange={event => setCreateDraft(current => ({ ...current, [participant.id]: { ...create, email: event.target.value } }))} /><Input aria-label="Telefon" placeholder="Telefon (valgfri)" value={create.phone} onChange={event => setCreateDraft(current => ({ ...current, [participant.id]: { ...create, phone: event.target.value } }))} /></div><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" disabled={busy === `create:${participant.id}`} onClick={() => void createParticipant(participant, create, false)}>Opret uden at invitere</Button><Button size="sm" variant="outline" disabled={busy === `create:${participant.id}` || !create.email.trim()} onClick={() => void createParticipant(participant, create, true)}>Opret med invitation</Button></div></details>
            <Button size="sm" variant="ghost" onClick={() => void run(`exclude:${participant.id}`, () => excludeShareParticipant(participant.id), "Krediteringen er markeret som ikke relevant.")}>Markér som ikke relevant</Button>
          </>}
          {participant.rights_holder_id && <div className="grid grid-cols-2 gap-1.5">
            {!holder?.invite_sent_at && holder?.email && <Button size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal px-2 py-1 text-xs leading-tight" disabled={busy === `invite:${participant.id}`} onClick={() => void invite(participant)}>Inviter rettighedshaver</Button>}
            {participant.proposed_percent == null && <Button size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal px-2 py-1 text-xs leading-tight" disabled={Boolean(participant.last_reminder_sent_at && Date.now() - new Date(participant.last_reminder_sent_at).getTime() < 3 * 86400000)} onClick={() => void run(`remind:${participant.id}`, () => remindShareParticipant(participant.id), "Påmindelsen er sendt.")}>Send påmindelse</Button>}
          </div>}
        </div>;
      })}
      {unresolved.length > 0 && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-500/10">Forbind, opret eller fravælg de resterende personer, før fordelingen kan godkendes.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><p className="text-xs text-muted-foreground">{busy === `credits:${active.id}` ? "Opdaterer kilder…" : active.credit_source_states?.some(state => state.status === "error") ? "En kilde kunne ikke opdateres. Gemte krediteringer vises fortsat." : active.credit_source_states?.every(state => state.status === "fresh") ? "Gemte kilder · opdateret inden for 7 dage" : "Gemte kilder vises, mens manglende data opdateres."}</p><Button size="xs" variant="outline" disabled={busy === `credits:${active.id}`} onClick={() => void refreshSources(true)}>Opdatér kilder</Button></div>
    </section>

    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="share-review-heading">
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 id="share-review-heading" className="font-semibold">2. Kontrollér og godkend</h4><div className="flex gap-4 text-sm"><span>Fordelt <strong>{allocatedTotal.toLocaleString("da-DK", { maximumFractionDigits: 1 })} %</strong></span><span>Reserve <strong>{Number.isFinite(reserveValue) ? reserveValue.toLocaleString("da-DK", { maximumFractionDigits: 1 }) : "—"} %</strong></span><span>I alt <strong className={Math.abs(combinedTotal - 100) < 0.001 ? "text-emerald-700" : "text-amber-700"}>{combinedTotal.toLocaleString("da-DK", { maximumFractionDigits: 1 })} %</strong></span></div></div>
      {missingResponses.length > 0 && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-500/10">{missingResponses.length} deltager(e) har ikke svaret. Afslutning kræver ekstra bekræftelse.</p>}
      <div className="flex justify-end"><Button disabled={unresolved.length > 0} onClick={() => { const allowMissingResponses = missingResponses.length > 0 ? window.confirm("Der mangler svar. Vil du alligevel godkende den administrative fordeling?") : false; if (missingResponses.length && !allowMissingResponses) return; void run(`resolve:${active.id}`, () => resolveAdminShareCase({ caseId: active.id, reservePercent: Number(reserve.replace(",", ".")), participants: participants.map(row => ({ participantId: row.id, finalPercent: drafts[row.id] ? Number(drafts[row.id].replace(",", ".")) : null })), allowMissingResponses }), "Fordelingen er godkendt og gemt."); }}>Godkend fordeling</Button></div>
    </section>
    </>}
  </div>;
}
