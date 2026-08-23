"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAdminRightsHolders } from "@/app/actions/work-management";
import { fetchAdminShareCases, matchShareParticipant, resolveAdminShareCase } from "@/app/actions/work-share-cases";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RightsHolderAutocomplete } from "@/components/admin/rights-holder-autocomplete";
import { fetchAdminCollaborationDisputes, resolveCollaborationDispute } from "@/app/actions/work-collaboration-reviews";

type ShareParticipant = {
  id: string;
  rights_holder_id: string | null;
  proposed_name: string | null;
  role: string;
  relationship_status: string;
  proposed_percent: number | null;
  admin_seed_percent: number | null;
  final_percent: number | null;
  rettighedshavere: { full_name: string } | null;
};

type ShareCase = {
  id: string;
  season_number: number | null;
  episode_number: number | null;
  status: string;
  reserve_percent: number;
  works: { title: string } | null;
  work_share_participants: ShareParticipant[];
};

type CollaborationDispute = {
  id: string;
  work_id: string;
  dispute_note: string | null;
  reviewed_at: string | null;
  works: { title: string; season_number: number | null; episode_number: number | null } | null;
  rettighedshavere: { full_name: string } | null;
};

function displayPercent(value: number | null) {
  return value == null ? "" : String(value);
}

export function WorkShareCasePanel({ onCountChange }: { onCountChange?: (count: number) => void } = {}) {
  const [cases, setCases] = useState<ShareCase[]>([]);
  const [disputes, setDisputes] = useState<CollaborationDispute[]>([]);
  const [holders, setHolders] = useState<Array<{ id: string; full_name: string }>>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [reserves, setReserves] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [caseResult, holderResult, disputeResult] = await Promise.all([fetchAdminShareCases(), fetchAdminRightsHolders(), fetchAdminCollaborationDisputes()]);
    const nextCases = caseResult.cases as unknown as ShareCase[];
    const nextDisputes = disputeResult.disputes as unknown as CollaborationDispute[];
    setCases(nextCases);
    setHolders(holderResult.rightsHolders);
    setDisputes(nextDisputes);
    onCountChange?.(nextCases.length + nextDisputes.length);
    setDrafts(Object.fromEntries(nextCases.map(shareCase => [shareCase.id, Object.fromEntries(shareCase.work_share_participants.map(row => [row.id, displayPercent(row.final_percent ?? row.proposed_percent ?? row.admin_seed_percent)]))])));
    setReserves(Object.fromEntries(nextCases.map(shareCase => [shareCase.id, displayPercent(shareCase.reserve_percent)])));
  }, [onCountChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch(error => setMessage(error instanceof Error ? error.message : "Fordelingssagerne kunne ikke hentes."));
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [load]);
  if (!cases.length && !disputes.length) {
    return <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Der er ingen arbejdsandele, der venter på afstemning.</p>;
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold">Afstem arbejdsandele</h2>
        <p className="mt-1 text-sm text-muted-foreground">Medlemmernes procenter er foreløbige og private. Gennemgå svarene, match eventuelle fritekstnavne, angiv endelige andele og en reserve. Sagen kan kun afsluttes, når summen er 100 %.</p>
      </div>
      {message && <p className="rounded-md border p-3 text-sm">{message}</p>}
      {disputes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Indsigelser: medlemmet har oplyst “Ingen medklipper”</h3>
          {disputes.map(dispute => (
            <div key={dispute.id} className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
              <p className="font-medium">{dispute.works?.title ?? "Ukendt værk"}{dispute.works?.season_number ? ` · sæson ${dispute.works.season_number}` : ""}{dispute.works?.episode_number ? ` · afsnit ${dispute.works.episode_number}` : ""}</p>
              <p className="mt-1 text-sm">{dispute.rettighedshavere?.full_name ?? "Et medlem"} oplyser, at værket eller afsnittet blev klippet alene, selv om andre klippere er registreret.</p>
              <p className="mt-1 text-xs opacity-80">Ret først eventuelle forkerte tilknytninger i Værksarkiv. Acceptér derefter indsigelsen, eller bed medlemmet gennemgå medklipperne igen.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" disabled={busy === dispute.id} onClick={() => {
                  setBusy(dispute.id);
                  void resolveCollaborationDispute({ reviewId: dispute.id, decision: "accept_solo" }).then(() => { setMessage("Indsigelsen er accepteret som klippet alene."); return load(); }).catch(error => setMessage(error instanceof Error ? error.message : "Indsigelsen kunne ikke afsluttes.")).finally(() => setBusy(null));
                }}>Acceptér klippet alene</Button>
                <Button size="sm" variant="outline" disabled={busy === dispute.id} onClick={() => {
                  setBusy(dispute.id);
                  void resolveCollaborationDispute({ reviewId: dispute.id, decision: "reopen" }).then(() => { setMessage("Medlemmets opgave er genåbnet."); return load(); }).catch(error => setMessage(error instanceof Error ? error.message : "Opgaven kunne ikke genåbnes.")).finally(() => setBusy(null));
                }}>Bed medlemmet gennemgå igen</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {cases.map(shareCase => (
        <div key={shareCase.id} className="space-y-3 rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{shareCase.works?.title ?? "Ukendt værk"}{shareCase.season_number ? ` · sæson ${shareCase.season_number}` : ""}{shareCase.episode_number ? ` · afsnit ${shareCase.episode_number}` : ""}</p>
            <span className="text-xs text-muted-foreground">{shareCase.status}</span>
          </div>
          {shareCase.work_share_participants.map(participant => (
            <div key={participant.id} className="grid gap-2 rounded border p-3 md:grid-cols-[minmax(180px,1fr)_150px_170px] md:items-end">
              <div>
                <p className="text-sm font-medium">{participant.rettighedshavere?.full_name ?? participant.proposed_name ?? "Ikke matchet"}</p>
                <p className="text-xs text-muted-foreground">{participant.role} · {participant.relationship_status} · medlemssvar: {participant.proposed_percent ?? "mangler"} %</p>
                {!participant.rights_holder_id && (
                  <div className="mt-2">
                    <RightsHolderAutocomplete options={holders} onChange={rightsHolderId => {
                      if (!rightsHolderId) return;
                      setBusy(participant.id);
                      void matchShareParticipant({ participantId: participant.id, rightsHolderId }).then(load).catch(error => setMessage(error instanceof Error ? error.message : "Match kunne ikke gemmes.")).finally(() => setBusy(null));
                    }} placeholder={`Match ${participant.proposed_name ?? "medklipper"}`} />
                  </div>
                )}
              </div>
              <label className="space-y-1 text-xs text-muted-foreground">Endelig andel (%)
                <Input inputMode="decimal" value={drafts[shareCase.id]?.[participant.id] ?? ""} onChange={event => setDrafts(current => ({ ...current, [shareCase.id]: { ...current[shareCase.id], [participant.id]: event.target.value } }))} />
              </label>
              <span className="text-xs text-muted-foreground">Udgangspunkt: {participant.admin_seed_percent ?? "—"} %</span>
            </div>
          ))}
          <div className="flex flex-wrap items-end justify-end gap-3">
            <label className="w-40 space-y-1 text-xs text-muted-foreground">Reserve (%)
              <Input inputMode="decimal" value={reserves[shareCase.id] ?? "0"} onChange={event => setReserves(current => ({ ...current, [shareCase.id]: event.target.value }))} />
            </label>
            <Button disabled={busy === shareCase.id} onClick={() => {
              setBusy(shareCase.id);
              void resolveAdminShareCase({
                caseId: shareCase.id,
                reservePercent: Number((reserves[shareCase.id] ?? "0").replace(",", ".")),
                participants: shareCase.work_share_participants.map(row => ({ participantId: row.id, finalPercent: drafts[shareCase.id]?.[row.id] === "" ? null : Number(drafts[shareCase.id]?.[row.id]?.replace(",", ".")) })),
              }).then(() => { setMessage("Fordelingen er afsluttet og offentliggjort."); return load(); }).catch(error => setMessage(error instanceof Error ? error.message : "Fordelingen kunne ikke afsluttes.")).finally(() => setBusy(null));
            }}>Afslut og offentliggør</Button>
          </div>
        </div>
      ))}
    </section>
  );
}
