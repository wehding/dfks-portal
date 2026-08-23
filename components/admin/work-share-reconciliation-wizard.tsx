"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  countAdminShareTasks,
  createRightsHolderFromShareParticipant,
  excludeShareParticipant,
  fetchAdminShareCases,
  matchShareParticipant,
  proposeAdminShareCompromise,
  refreshAdminShareCaseCredits,
  remindShareParticipant,
  resolveAdminShareCase,
} from "@/app/actions/work-share-cases";
import { fetchAdminCollaborationDisputes, resolveCollaborationDispute } from "@/app/actions/work-collaboration-reviews";
import { fetchAdminRightsHolders } from "@/app/actions/work-management";
import { RightsHolderAutocomplete } from "@/components/admin/rights-holder-autocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Holder = { full_name: string; email: string | null; user_id: string | null; invite_sent_at: string | null };
type Participant = { id: string; rights_holder_id: string | null; proposed_name: string | null; role: string; relationship_status: string; proposed_percent: number | null; admin_seed_percent: number | null; final_percent: number | null; source_tags: string[]; source_details: { roles?: string[] } | null; excluded_at: string | null; last_reminder_sent_at: string | null; rettighedshavere: Holder | null };
type ShareCase = { id: string; work_id: string; season_number: number | null; episode_number: number | null; status: string; reserve_percent: number; works: { title: string } | null; work_share_participants: Participant[] };
type CollaborationDispute = { id: string; works: { title: string; season_number: number | null; episode_number: number | null } | null; rettighedshavere: { full_name: string } | null };
const SOURCE_LABELS: Record<string, string> = { local: "Portal", member: "Indtastet", dfi: "DFI", tmdb: "TMDb" };

export function WorkShareReconciliationWizard({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [cases, setCases] = useState<ShareCase[]>([]);
  const [holders, setHolders] = useState<Array<{ id: string; full_name: string }>>([]);
  const [disputes, setDisputes] = useState<CollaborationDispute[]>([]);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
      const [caseResult, holderResult, disputeResult, countResult] = await Promise.all([
        fetchAdminShareCases(),
        fetchAdminRightsHolders(),
        fetchAdminCollaborationDisputes(),
        countAdminShareTasks(),
      ]);
      const next = caseResult.cases as unknown as ShareCase[];
      const nextDisputes = disputeResult.disputes as unknown as CollaborationDispute[];
      setCases(next);
      setHolders(holderResult.rightsHolders);
      setDisputes(nextDisputes);
      setIndex(current => Math.min(current, Math.max(0, next.length - 1)));
      onCountChange?.(countResult.count);
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

  useEffect(() => {
    if (!active) return;
    setDrafts(Object.fromEntries(active.work_share_participants.filter(row => !row.excluded_at).map(row => [row.id, String(row.final_percent ?? row.proposed_percent ?? row.admin_seed_percent ?? "")])));
    setReserve(String(active.reserve_percent ?? 0));
    setStep(1);
    setBusy(`credits:${active.id}`);
    void refreshAdminShareCaseCredits(active.id).then(load).catch(error => setMessage(error instanceof Error ? error.message : "Kilderne kunne ikke opdateres.")).finally(() => setBusy(null));
    // The refresh itself reloads the same case; depending on `load` would
    // restart the external lookup after every response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

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
      <div><p className="text-xs text-muted-foreground">{index + 1} af {cases.length}</p><h3 className="text-lg font-semibold">{active.works?.title ?? "Ukendt værk"}{active.season_number ? ` · sæson ${active.season_number}` : ""}</h3></div>
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={index === 0} onClick={() => setIndex(value => value - 1)}>Forrige</Button><Button size="sm" variant="outline" disabled={index >= cases.length - 1} onClick={() => setIndex(value => value + 1)}>Spring over</Button></div>
    </div>
    <div className="grid grid-cols-3 gap-2 text-center text-xs">{["Bekræft klippere", "Afstem procentandele", "Kontrollér og godkend"].map((label, itemIndex) => <button key={label} type="button" onClick={() => setStep((itemIndex + 1) as 1 | 2 | 3)} className={`rounded-md border p-2 ${step === itemIndex + 1 ? "border-primary bg-primary/5 font-semibold" : "text-muted-foreground"}`}>{itemIndex + 1}. {label}</button>)}</div>

    {step === 1 && <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Portalens oplysninger samles med krediteringer fra DFI og TMDb. Kilderne er vejledende og fastsætter aldrig procentandele.</p>
      {busy === `credits:${active.id}` && <p className="text-sm">Henter krediteringer…</p>}
      {participants.map(participant => {
        const holder = participant.rettighedshavere;
        const create = createDraft[participant.id] ?? { name: participant.proposed_name ?? "", email: "", phone: "" };
        return <div key={participant.id} className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{holder?.full_name ?? participant.proposed_name ?? "Ukendt"}</p><p className="text-xs text-muted-foreground">{[...new Set(participant.source_details?.roles?.length ? participant.source_details.roles : [participant.role])].join(" · ")}</p><div className="mt-1 flex gap-1">{[...new Set(participant.source_tags ?? [])].map(source => <Badge key={source} variant="outline">{SOURCE_LABELS[source] ?? source}</Badge>)}</div></div><Badge variant={participant.rights_holder_id ? "secondary" : "outline"}>{participant.rights_holder_id ? holder?.invite_sent_at ? "Inviteret" : "Ikke inviteret" : "Ikke i systemet"}</Badge></div>
          {!participant.rights_holder_id && <>
            <RightsHolderAutocomplete options={holders} onChange={rightsHolderId => rightsHolderId && void run(`match:${participant.id}`, () => matchShareParticipant({ participantId: participant.id, rightsHolderId }), "Personen er forbundet.")} placeholder="Forbind med eksisterende rettighedshaver" />
            <details><summary className="cursor-pointer text-sm font-medium">Opret ny rettighedshaver</summary><div className="mt-2 grid gap-2 sm:grid-cols-3"><Input aria-label="Navn" value={create.name} onChange={event => setCreateDraft(current => ({ ...current, [participant.id]: { ...create, name: event.target.value } }))} /><Input aria-label="E-mail" type="email" placeholder="E-mail (valgfri)" value={create.email} onChange={event => setCreateDraft(current => ({ ...current, [participant.id]: { ...create, email: event.target.value } }))} /><Input aria-label="Telefon" placeholder="Telefon (valgfri)" value={create.phone} onChange={event => setCreateDraft(current => ({ ...current, [participant.id]: { ...create, phone: event.target.value } }))} /></div><Button className="mt-2" size="sm" onClick={() => void run(`create:${participant.id}`, () => createRightsHolderFromShareParticipant({ participantId: participant.id, ...create }), "Rettighedshaveren er oprettet uden invitation.")}>Opret uden at invitere</Button></details>
            <Button size="sm" variant="ghost" onClick={() => void run(`exclude:${participant.id}`, () => excludeShareParticipant(participant.id), "Krediteringen er markeret som ikke relevant.")}>Markér som ikke relevant</Button>
          </>}
          {participant.rights_holder_id && <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="ghost"><Link href={`/admin/rettighedshavere?edit=${encodeURIComponent(participant.rights_holder_id)}`}>Åbn rettighedshaver</Link></Button>
            {!holder?.invite_sent_at && holder?.email && <Button size="sm" variant="outline" disabled={busy === `invite:${participant.id}`} onClick={() => void invite(participant)}>Inviter rettighedshaver</Button>}
          </div>}
        </div>;
      })}
      <div className="flex justify-end"><Button disabled={unresolved.length > 0} onClick={() => setStep(2)}>Fortsæt til procentandele</Button></div>
    </div>}

    {step === 2 && <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3"><Label className="space-y-1">Reserve (%)<Input className="w-32" inputMode="decimal" value={reserve} onChange={event => setReserve(event.target.value)} /></Label><Button variant="outline" onClick={() => void run(`proposal:${active.id}`, async () => { const result = await proposeAdminShareCompromise(active.id, Number(reserve.replace(",", "."))); setDrafts(current => ({ ...current, ...Object.fromEntries(result.participants.map(row => [row.participantId, String(row.finalPercent)])) })); }, "Kompromisforslaget er beregnet.")}>Beregn kompromis</Button></div>
      {participants.map(participant => <div key={participant.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"><div><p className="font-medium">{participant.rettighedshavere?.full_name ?? participant.proposed_name}</p><p className="text-xs text-muted-foreground">Indsendt: {participant.proposed_percent ?? "mangler"} %</p></div><Label className="space-y-1">Endelig andel (%)<Input inputMode="decimal" value={drafts[participant.id] ?? ""} onChange={event => setDrafts(current => ({ ...current, [participant.id]: event.target.value }))} /></Label>{participant.rights_holder_id && participant.proposed_percent == null && <Button size="sm" variant="outline" disabled={Boolean(participant.last_reminder_sent_at && Date.now() - new Date(participant.last_reminder_sent_at).getTime() < 3 * 86400000)} onClick={() => void run(`remind:${participant.id}`, () => remindShareParticipant(participant.id), "Påmindelsen er sendt.")}>Send påmindelse</Button>}</div>)}
      <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(1)}>Tilbage</Button><Button onClick={() => setStep(3)}>Kontrollér</Button></div>
    </div>}

    {step === 3 && <div className="space-y-3"><p className="text-sm">Kontrollér, at alle personer er afklaret, og at andele plus reserve er 100 %.</p><ul className="space-y-1 text-sm">{participants.map(row => <li key={row.id} className="flex justify-between"><span>{row.rettighedshavere?.full_name ?? row.proposed_name}</span><strong>{drafts[row.id] || "—"} %</strong></li>)}<li className="flex justify-between border-t pt-1"><span>Reserve</span><strong>{reserve} %</strong></li></ul>{missingResponses.length > 0 && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-500/10">{missingResponses.length} deltager(e) har ikke svaret. Afslutning kræver ekstra bekræftelse.</p>}<div className="flex justify-between"><Button variant="outline" onClick={() => setStep(2)}>Tilbage</Button><Button onClick={() => { const allowMissingResponses = missingResponses.length > 0 ? window.confirm("Der mangler svar. Vil du alligevel godkende den administrative fordeling?") : false; if (missingResponses.length && !allowMissingResponses) return; void run(`resolve:${active.id}`, () => resolveAdminShareCase({ caseId: active.id, reservePercent: Number(reserve.replace(",", ".")), participants: participants.map(row => ({ participantId: row.id, finalPercent: drafts[row.id] ? Number(drafts[row.id].replace(",", ".")) : null })), allowMissingResponses }), "Fordelingen er godkendt og gemt."); }}>Godkend fordeling</Button></div></div>}
    </>}
  </div>;
}
