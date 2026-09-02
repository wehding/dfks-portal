"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  approveContractOwnerBackfillRun,
  createContractOwnerBackfillRun,
  fetchContractOwnerBackfillRun,
  processContractOwnerBackfillRun,
  setContractOwnerBackfillItemSelected,
} from "@/app/actions/contract-owner-backfill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ContractOwnerBackfillRun } from "@/lib/contract-owner-backfill-types";

const DISPOSITION_LABELS = {
  same_owner: "Bekræfter nuværende ejer",
  fill_missing_owner: "Tilføjer manglende ejer",
  replace_owner: "Retter ejer",
  unresolved: "Kræver manuel kontrol",
} as const;

function statusLabel(status: ContractOwnerBackfillRun["status"]) {
  return ({
    previewing: "Forbereder",
    preview_ready: "Klar til godkendelse",
    approved: "Godkendt",
    applying: "Anvender rettelser",
    completed: "Gennemført",
    completed_with_exceptions: "Gennemført med undtagelser",
    cancelled: "Annulleret",
  } as const)[status];
}

export function ContractOwnerBackfillPanel() {
  const [run, setRun] = useState<ContractOwnerBackfillRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchContractOwnerBackfillRun();
    if (result.success) setRun(result.run);
    else toast.error(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchContractOwnerBackfillRun().then(result => {
      if (cancelled) return;
      if (result.success) setRun(result.run);
      else toast.error(result.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const visibleItems = useMemo(() => run?.items.filter(item => (
    item.disposition !== "same_owner" || item.status === "stale" || item.status === "failed"
  )) ?? [], [run]);
  const progressTotal = run?.counts.selected ?? 0;
  const progressDone = (run?.counts.applied ?? 0) + (run?.counts.stale ?? 0) + (run?.counts.failed ?? 0);

  const createPreview = async () => {
    setCreating(true);
    const result = await createContractOwnerBackfillRun();
    if (result.success) { setRun(result.run); toast.success("Forhåndsvisningen er klar"); }
    else toast.error(result.error);
    setCreating(false);
  };

  const toggleItem = async (contractId: string, selected: boolean) => {
    if (!run) return;
    setChangingId(contractId);
    const result = await setContractOwnerBackfillItemSelected({
      runId: run.id, contractId, selected, expectedRevision: run.revision,
    });
    if (result.success) setRun(result.run);
    else { toast.error(result.error); await load(); }
    setChangingId(null);
  };

  const continueProcessing = useCallback(async (startingRun: ContractOwnerBackfillRun) => {
    setProcessing(true);
    let current = startingRun;
    while (["approved", "applying"].includes(current.status)) {
      const result = await processContractOwnerBackfillRun(current.id);
      if (!result.success) { toast.error(result.error); break; }
      current = result.run;
      setRun(current);
    }
    if (current.status === "completed") toast.success("Alle valgte ejere er behandlet");
    if (current.status === "completed_with_exceptions") toast.warning("Kørslen er færdig, men enkelte kontrakter kræver manuel kontrol");
    setProcessing(false);
  }, []);

  const approve = async () => {
    if (!run?.manifestSha256) return;
    setConfirmOpen(false);
    setApproving(true);
    const result = await approveContractOwnerBackfillRun({
      runId: run.id, expectedManifestSha256: run.manifestSha256, expectedRevision: run.revision,
    });
    if (!result.success) { toast.error(result.error); setApproving(false); await load(); return; }
    setRun(result.run);
    setApproving(false);
    await continueProcessing(result.run);
  };

  if (loading) return <section className="rounded-lg border p-4"><p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter kontrolleret engangskørsel…</p></section>;

  return <section className="space-y-4 rounded-lg border border-amber-300 bg-amber-50/40 p-4 dark:border-amber-900 dark:bg-amber-950/10">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /><h2 className="font-semibold">Kontrolleret engangskørsel af kontraktejere</h2>{run ? <Badge variant="outline">{statusLabel(run.status)}</Badge> : null}</div>
        <p className="max-w-3xl text-sm text-muted-foreground">Systemet matcher de historisk AI-aflæste navne med aktive rettighedshavere. Intet ændres, før du godkender det præcise, hash-låste resultat. Usikre match bliver stående til manuel kontrol.</p>
      </div>
      {!run ? <Button type="button" onClick={() => void createPreview()} disabled={creating}>{creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}{creating ? "Matcher ejere…" : "Lav forhåndsvisning"}</Button> : null}
    </div>

    {run ? <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {[
          ["AI-navne", run.counts.total], ["Bekræftes", run.counts.sameOwner], ["Manglende ejer", run.counts.fillMissingOwner],
          ["Ejerskifte", run.counts.replaceOwner], ["Uafklaret", run.counts.unresolved],
          ["Valideringer genåbnes", run.counts.validatedContractsReopened], ["Afsnitsvalg påvirkes", run.counts.episodeConfirmationsAtRisk],
        ].map(([label, value]) => <div key={String(label)} className="rounded-md border bg-background p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p></div>)}
      </div>

      {["approved", "applying"].includes(run.status) || processing ? <div className="rounded-md border bg-background p-3" aria-live="polite"><p className="font-medium">{progressDone} af {progressTotal} behandlet</p><p className="text-sm text-muted-foreground">Kørslen arbejder i små, genoptagelige portioner. Ændrede kontrakter overskrives ikke.</p></div> : null}

      {visibleItems.length ? <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-md border bg-background p-2">
        {visibleItems.map(item => <label key={item.id} className="flex items-start gap-3 rounded-md border p-3">
          <input className="mt-1 h-5 w-5" type="checkbox" checked={item.selected} disabled={run.status !== "preview_ready" || item.disposition === "unresolved" || changingId === item.contractId} onChange={event => void toggleItem(item.contractId, event.target.checked)} />
          <span className="min-w-0 flex-1"><span className="block font-medium">{item.workingTitle ?? "Kontrakt uden titel"}</span><span className="block text-sm text-muted-foreground">{item.currentOwner?.name ?? "Ingen ejer"} → {item.proposedOwner?.name ?? "Intet sikkert match"}</span><span className="mt-1 flex flex-wrap gap-1"><Badge variant="outline">{DISPOSITION_LABELS[item.disposition]}</Badge>{item.score !== null ? <Badge variant="outline">Sikkerhed {item.score}</Badge> : null}{["stale", "failed"].includes(item.status) ? <Badge variant="destructive">Kræver manuel kontrol</Badge> : null}</span></span>
        </label>)}
      </div> : null}

      {run.status === "preview_ready" ? <div className="flex flex-col gap-2 rounded-md border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{run.counts.selected} sikre forslag er valgt</p><p className="text-sm text-muted-foreground">Godkendelsen kan ikke redigeres bagefter. Ejerskiftede, validerede kontrakter bliver kladder igen.</p></div><Button disabled={run.counts.selected < 1 || approving} onClick={() => setConfirmOpen(true)}>{approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Godkend og anvend én gang</Button></div> : null}
      {["approved", "applying"].includes(run.status) && !processing ? <Button onClick={() => void continueProcessing(run)}><Play className="mr-2 h-4 w-4" />Genoptag sikker kørsel</Button> : null}
      {run.status === "completed_with_exceptions" ? <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{run.counts.stale + run.counts.failed} kontrakter blev ikke ændret, fordi datagrundlaget ændrede sig eller anvendelsen fejlede. De forbliver i den almindelige ejerskabskontrol.</p></div> : null}
      {run.status === "completed" ? <div className="flex gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/20"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><p>Engangskørslen er gennemført. {run.counts.applied} kontrakter er behandlet.</p></div> : null}
    </> : null}

    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent><DialogHeader><DialogTitle>Godkend automatisk behandling af {run?.counts.selected ?? 0} kontrakter?</DialogTitle><DialogDescription>Dette er den samlede godkendelse. Kontrakter med en anden sikker ejer bliver flyttet automatisk, validering genåbnes, og gamle afsnitsbekræftelser ugyldiggøres. Usikre resultater ændres ikke.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmOpen(false)}>Annuller</Button><Button onClick={() => void approve()}>Godkend og start</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
