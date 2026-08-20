"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Gavel, Loader2, Play, RefreshCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Decision = {
  id: string; decision_type: "retention_change" | "staff_unmasking";
  status: "proposed" | "approved" | "rejected" | "effected"; reason: string;
  legal_basis: string; retention_years: number | null; subject_access_request_id: string | null;
  proposed_by: string; approved_by: string | null; proposed_at: string; decided_at: string | null;
};
type SarOption = { id: string; target_member_label: string | null; status: string };

const STATUS = { proposed: "Indstillet", approved: "Godkendt", rejected: "Afvist", effected: "Effektueret" } as const;

async function readError(response: Response, fallback: string) {
  return (await response.json().catch(() => null))?.error ?? fallback;
}

export function AuditGovernancePanel({ callerRole }: { callerRole: string }) {
  const [items, setItems] = useState<Decision[]>([]);
  const [requests, setRequests] = useState<SarOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [type, setType] = useState<Decision["decision_type"]>("retention_change");
  const [retentionYears, setRetentionYears] = useState(7);
  const [sarId, setSarId] = useState("");
  const [reason, setReason] = useState("");
  const [legalBasis, setLegalBasis] = useState("GDPR Art. 5(2), 24 og 32");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/audit-log/governance", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "Governance kunne ikke hentes."));
      const data = await response.json(); setItems(data.items ?? []); setRequests(data.requests ?? []);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Governance kunne ikke hentes."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const propose = async () => {
    setBusy("propose");
    try {
      const response = await fetch("/api/admin/audit-log/governance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        decisionType: type, reason, legalBasis,
        retentionYears: type === "retention_change" ? retentionYears : null,
        subjectAccessRequestId: type === "staff_unmasking" ? sarId : null,
      }) });
      if (!response.ok) throw new Error(await readError(response, "Indstillingen kunne ikke oprettes."));
      setReason(""); setSarId(""); toast.success("Indstillingen er sendt til en anden superadmin."); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Indstillingen kunne ikke oprettes."); }
    finally { setBusy(""); }
  };

  const decide = async (id: string, action: "approve" | "reject" | "effect") => {
    setBusy(`${id}:${action}`);
    try {
      const response = await fetch("/api/admin/audit-log/governance", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisionId: id, action }) });
      if (!response.ok) throw new Error(await readError(response, "Beslutningen kunne ikke opdateres."));
      toast.success(action === "effect" ? "Beslutningen er effektueret." : action === "approve" ? "Indstillingen er godkendt." : "Indstillingen er afvist."); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Beslutningen kunne ikke opdateres."); }
    finally { setBusy(""); }
  };

  return <div className="space-y-4">
    {callerRole === "jurist" && <Card><CardHeader><CardTitle className="flex items-center gap-2"><Gavel className="size-5" />Ny fireøjneindstilling</CardTitle><CardDescription>Du indstiller. En anden bruger med superadminrolle skal godkende, før ændringen kan effektueres.</CardDescription></CardHeader><CardContent className="space-y-4">
      <Label className="space-y-1">Beslutningstype<select className="h-10 w-full rounded-md border bg-background px-3" value={type} onChange={event => setType(event.target.value as Decision["decision_type"])}><option value="retention_change">Ændring af retention</option><option value="staff_unmasking">Afmaskering i konkret Art. 15-rapport</option></select></Label>
      {type === "retention_change" ? <Label className="space-y-1">Retention i hele år<Input type="number" min={1} max={30} value={retentionYears} onChange={event => setRetentionYears(Number(event.target.value))} /></Label> : <Label className="space-y-1">Indsigtsanmodning<select className="h-10 w-full rounded-md border bg-background px-3" value={sarId} onChange={event => setSarId(event.target.value)}><option value="">Vælg anmodning…</option>{requests.map(item => <option key={item.id} value={item.id}>{item.target_member_label || item.id} · {item.status}</option>)}</select></Label>}
      <Label className="space-y-1">Begrundelse<Textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Beskriv nødvendighed, proportionalitet og omfang…" /></Label>
      <Label className="space-y-1">Retsgrundlag<Input value={legalBasis} onChange={event => setLegalBasis(event.target.value)} /></Label>
      <Button disabled={busy === "propose" || reason.trim().length < 20 || legalBasis.trim().length < 3 || (type === "staff_unmasking" && !sarId)} onClick={() => void propose()}>{busy === "propose" && <Loader2 className="animate-spin" />}Send indstilling</Button>
    </CardContent></Card>}
    <Card><CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Beslutningsspor</CardTitle><CardDescription>Uforanderlige indstillinger, godkendelser og effektueringer.</CardDescription></div><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCcw className={loading ? "animate-spin" : ""} />Opdatér</Button></CardHeader><CardContent className="p-0">
      {loading && <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>}
      {!loading && items.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Ingen governancebeslutninger endnu.</p>}
      {items.map(item => <article key={item.id} className="space-y-3 border-t p-4 first:border-t-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{item.decision_type === "retention_change" ? `Retention: ${item.retention_years} år` : "Afmaskering af medarbejderidentitet"}</p><Badge variant="outline">{STATUS[item.status]}</Badge></div><p className="text-sm">{item.reason}</p><p className="text-xs text-muted-foreground">Retsgrundlag: {item.legal_basis} · Indstillet {new Date(item.proposed_at).toLocaleString("da-DK")}</p>{callerRole === "superadmin" && <div className="flex flex-wrap gap-2">{item.status === "proposed" && <><Button size="sm" onClick={() => void decide(item.id, "approve")} disabled={Boolean(busy)}>{busy === `${item.id}:approve` ? <Loader2 className="animate-spin" /> : <Check />}Godkend</Button><Button size="sm" variant="destructive" onClick={() => void decide(item.id, "reject")} disabled={Boolean(busy)}><X />Afvis</Button></>}{item.status === "approved" && <Button size="sm" onClick={() => void decide(item.id, "effect")} disabled={Boolean(busy)}>{busy === `${item.id}:effect` ? <Loader2 className="animate-spin" /> : <Play />}Effektuér</Button>}</div>}</article>)}
    </CardContent></Card>
  </div>;
}
