"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Search, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import {
  fetchContractOwnerVerificationDetail,
  reviewContractOwnerVerification,
  searchEligibleContractOwners,
} from "@/app/actions/contract-owner-verifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { contractOwnerStatusLabel } from "@/lib/contract-owner-verification-ui";
import type {
  ContractOwnerSummary,
  ContractOwnerVerificationDetail,
} from "@/lib/contract-owner-verification-types";
import type { ContractEvidenceActivation } from "@/app/admin/kontrakter/ContractAiDataEditor";
import { ContractSourceBadge } from "@/components/contracts/contract-source-badge";
import type { ContractFieldSource } from "@/lib/contract-workbench";

type Props = {
  contractId: string;
  canManage: boolean;
  inOwnershipQueue: boolean;
  hasNext: boolean;
  onEvidenceActivate: (evidence: ContractEvidenceActivation) => void;
  onCompleted: (goNext: boolean) => Promise<void>;
  commandTrigger?: number;
};

function confidenceLabel(value: number | null | undefined) {
  if (value == null) return "Ikke beregnet";
  if (value >= 0.9) return `Høj · ${Math.round(value * 100)} %`;
  if (value >= 0.7) return `Mellem · ${Math.round(value * 100)} %`;
  return `Lav · ${Math.round(value * 100)} %`;
}

function InfoRow({ label, children, source, onSourceClick }: { label: string; children: React.ReactNode; source?: ContractFieldSource; onSourceClick?: () => void }) {
  return <div className="grid min-h-[30px] grid-cols-[130px_minmax(0,1fr)_130px] items-center gap-2 border-b border-border/40 px-2.5 py-0.5 hover:bg-muted/40 transition-colors last:border-b-0">
    <dt className="truncate text-[11px] font-medium text-muted-foreground">{label}</dt>
    <dd className="min-w-0 text-[11px] font-medium text-foreground">{children}</dd>
    <div className="flex items-center justify-end gap-1 shrink-0">
      {source && (
        onSourceClick ? (
          <button type="button" onClick={onSourceClick} title="Se kilde i PDF">
            <ContractSourceBadge source={source} />
          </button>
        ) : (
          <ContractSourceBadge source={source} />
        )
      )}
    </div>
  </div>;
}

export function ContractOwnershipEditor({
  contractId,
  canManage,
  inOwnershipQueue,
  hasNext,
  onEvidenceActivate,
  onCompleted,
  commandTrigger = 0,
}: Props) {
  const [detail, setDetail] = useState<ContractOwnerVerificationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ContractOwnerSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState<ContractOwnerSummary | null>(null);

  async function reload() {
    setLoading(true);
    const result = await fetchContractOwnerVerificationDetail(contractId);
    if (result.success) {
      setDetail(result.data);
      const evidence = result.data.documentEvidence?.spatialEvidence;
      const quote = result.data.aiEvidence?.sourceQuote
        ?? result.data.aiEvidence?.extractedRightsHolderName
        ?? result.data.proposedRightsHolder?.name
        ?? result.data.assignedRightsHolder?.name
        ?? "";
      const focusText = result.data.aiEvidence?.extractedRightsHolderName ?? quote;
      onEvidenceActivate({
        fieldKey: "ownership",
        label: "Navn aflæst fra kontrakten",
        sourceKey: "rightsHolderName",
        quote,
        focusText,
        page: evidence?.page ?? 1,
        bbox: evidence?.bbox ?? null,
        coordinateSource: evidence?.coordinateSource ?? null,
        confidence: evidence?.confidence ?? null,
      });
    } else {
      toast.error(result.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    void reload();
    // Reload only when the editor changes contract. Evidence activation is an event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  const proposedOwner = detail?.proposedRightsHolder ?? null;
  const assignedOwner = detail?.assignedRightsHolder ?? null;
  // A historical assignment can await verification without a separate AI
  // proposal. In that case staff confirms the already assigned owner.
  const oneClickOwner = proposedOwner ?? assignedOwner;
  const confidence = detail?.documentEvidence?.spatialEvidence?.confidence
    ?? detail?.documentEvidence?.spatialAccuracy
    ?? null;
  const extractedName = detail?.aiEvidence?.extractedRightsHolderName ?? null;
  const sourceQuote = detail?.aiEvidence?.sourceQuote ?? null;
  const canConfirm = Boolean(canManage && detail && oneClickOwner && !["confirmed", "corrected", "not_applicable", "blocked"].includes(detail.verification.status));

  const sourceActivation = useMemo<ContractEvidenceActivation>(() => {
    const quote = sourceQuote ?? extractedName ?? proposedOwner?.name ?? assignedOwner?.name ?? "";
    return {
      fieldKey: "ownership",
      label: "Navn aflæst fra kontrakten",
      sourceKey: "rightsHolderName",
      quote,
      focusText: extractedName ?? quote,
      page: detail?.documentEvidence?.spatialEvidence?.page ?? 1,
      bbox: detail?.documentEvidence?.spatialEvidence?.bbox ?? null,
      coordinateSource: detail?.documentEvidence?.spatialEvidence?.coordinateSource ?? null,
      confidence: detail?.documentEvidence?.spatialEvidence?.confidence ?? null,
    };
  }, [detail?.documentEvidence?.spatialEvidence, extractedName, sourceQuote, proposedOwner?.name, assignedOwner?.name]);

  async function applyOwner(owner: ContractOwnerSummary, goNext: boolean) {
    if (!detail || saving) return;
    const decision = owner.id === assignedOwner?.id ? "confirm" : "reassign";
    setSaving(true);
    const result = await reviewContractOwnerVerification({
      contractId,
      expectedRightsHolderId: assignedOwner?.id ?? null,
      expectedRevision: detail.verification.revision,
      decision,
      newRightsHolderId: decision === "reassign" ? owner.id : null,
      reasonCode: decision === "reassign" ? "admin_verified_correction" : "admin_verified_existing_owner",
    });
    if (!result.success) {
      toast.error(result.error);
      setSaving(false);
      return;
    }
    toast.success(decision === "reassign" ? `Ejeren er rettet til ${owner.name}` : "Ejeren er bekræftet");
    await onCompleted(goNext);
    if (!goNext) await reload();
    setSaving(false);
  }

  async function search() {
    if (query.trim().length < 2) return;
    setSearching(true);
    const result = await searchEligibleContractOwners(query);
    if (result.success) setCandidates(result.candidates);
    else toast.error(result.error);
    setSearching(false);
  }

  useEffect(() => {
    if (!commandTrigger || !oneClickOwner || !canConfirm || saving) {
      if (commandTrigger && !oneClickOwner) document.getElementById("ownership-search")?.focus();
      return;
    }
    void applyOwner(oneClickOwner, inOwnershipQueue && hasNext);
    // commandTrigger is the deliberate user action; other values are current guards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandTrigger]);

  if (!canManage) return <div className="m-3 rounded-md border p-4 text-sm text-muted-foreground">Du har ikke adgang til at se eller ændre kontraktejerskab.</div>;
  if (loading) return <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter ejerskabsdata…</div>;
  if (!detail) return <div className="m-3 rounded-md border p-4 text-sm text-muted-foreground">Der findes endnu ingen ejerskabsdata for kontrakten.</div>;

  return <section className="p-3" aria-labelledby="ownership-heading">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><h2 id="ownership-heading" className="font-semibold">Ejerskab</h2><p className="text-xs text-muted-foreground">Kontrollér navnet i kontrakten og godkend eller ret ejeren.</p></div>
      <Badge variant="outline">{contractOwnerStatusLabel(detail.verification.status)}</Badge>
    </div>
    <dl className="rounded border divide-y divide-border/40">
      <InfoRow label="Registreret ejer" source={assignedOwner ? "member" : "unknown"}>
        {assignedOwner?.name ?? "Mangler ejer"}
      </InfoRow>
    </dl>

    <details className="mt-2 rounded border bg-muted/10">
      <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">Vis ejerskabsgrundlag</summary>
      <dl className="border-t border-border/40 divide-y divide-border/40">
        <InfoRow label="Aflæst i PDF" source="contract" onSourceClick={() => onEvidenceActivate(sourceActivation)}>
          <button type="button" className="text-left font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => onEvidenceActivate(sourceActivation)}>{extractedName ?? "Ikke aflæst"}</button>
          {sourceQuote ? <p className="line-clamp-1 text-[10px] text-muted-foreground">{sourceQuote}</p> : null}
        </InfoRow>
        <InfoRow label="Foreslået ejer" source="work_archive">{proposedOwner?.name ?? "Intet særskilt forslag"}</InfoRow>
        <InfoRow label="Sikkerhed" source="contract">{confidenceLabel(confidence)}</InfoRow>
        <InfoRow label="Matchbegrundelse" source="stored">{detail.verification.reasonCode ?? "Ingen begrundelse registreret"}</InfoRow>
        <InfoRow label="Datakilde" source="contract">{detail.aiEvidence ? `${detail.aiEvidence.provider ?? "AI"}${detail.aiEvidence.model ? ` · ${detail.aiEvidence.model}` : ""}` : "Ingen AI-kilde"}</InfoRow>
        <InfoRow label="Manuel kontrol" source="stored">{["pending", "conflict", "correction_proposed", "blocked"].includes(detail.verification.status) ? "Ja" : "Nej"}</InfoRow>
      </dl>
    </details>

    <div className="mt-5 rounded-md border p-3">
      <label htmlFor="ownership-search" className="text-sm font-medium">Søg efter korrekt ejer</label>
      <div className="mt-2 flex gap-2"><Input id="ownership-search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Søg navn…" /><Button variant="outline" disabled={searching || query.trim().length < 2} onClick={() => void search()}>{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Søg</Button></div>
      {candidates.length ? <div className="mt-2 divide-y rounded-md border">{candidates.map(candidate => <div key={candidate.id} className="flex items-center justify-between gap-2 p-2"><button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => setSelectedOwner(candidate)}>{candidate.name}{candidate.secondaryLabel ? <span className="ml-1 text-xs text-muted-foreground">· {candidate.secondaryLabel}</span> : null}</button>{selectedOwner?.id === candidate.id ? <div className="flex gap-1"><Button size="sm" onClick={() => void applyOwner(candidate, inOwnershipQueue && hasNext)}>Vælg ejer{inOwnershipQueue && hasNext ? " og næste" : ""}</Button></div> : null}</div>)}</div> : null}
    </div>

    <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
      <Button variant="outline" onClick={() => document.getElementById("ownership-search")?.focus()}>Ret ejer</Button>
      {canConfirm && oneClickOwner ? <Button disabled={saving} onClick={() => void applyOwner(oneClickOwner, inOwnershipQueue && hasNext)}>
        {inOwnershipQueue && hasNext ? <UserRoundCheck className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {inOwnershipQueue && hasNext ? "Godkend ejerskab og gå til næste" : "Godkend ejerskab"}
      </Button> : null}
    </div>
  </section>;
}
