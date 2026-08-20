"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, DatabaseZap, Loader2, RefreshCcw, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SiemData = {
  settings: { siem_enabled: boolean; siem_adapter: string; siem_destination_label: string | null; kms_key_id: string | null } | null;
  lastReceipt: { delivered_at: string; event_count: number; adapter: string; key_id: string } | null;
  counts: { pending: number; processing: number; delivered: number; failed: number; deadLetter: number };
  integrity: { checked: number; invalid: number; ok: boolean };
};

const QUEUE_CARDS = [
  ["pending", "Afventer", "Klar til næste levering"],
  ["processing", "Behandles", "Aktuelt låst af workeren"],
  ["delivered", "Leveret", "Kvitteret af SIEM"],
  ["failed", "Fejlet", "Forsøges automatisk igen"],
  ["deadLetter", "Kræver handling", "Automatiske forsøg er stoppet"],
] as const;

async function readError(response: Response, fallback: string) {
  return (await response.json().catch(() => null))?.error ?? fallback;
}

async function fetchSiemData(): Promise<SiemData> {
  const response = await fetch("/api/admin/audit-log/siem", { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response, "SIEM-status kunne ikke hentes."));
  return response.json();
}

export function AuditSiemPanel() {
  const [data, setData] = useState<SiemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      setData(await fetchSiemData());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "SIEM-status kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchSiemData().then(result => {
      if (active) { setData(result); setError(""); }
    }).catch(loadError => {
      if (active) setError(loadError instanceof Error ? loadError.message : "SIEM-status kunne ikke hentes.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const replay = async () => {
    setReplaying(true);
    setError("");
    try {
      const response = await fetch("/api/admin/audit-log/siem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allFailed: true }),
      });
      if (!response.ok) throw new Error(await readError(response, "Genleveringen kunne ikke startes."));
      const result = await response.json();
      toast.success(`${result.replayed ?? 0} hændelser er sat i kø til genlevering.`);
      await load();
    } catch (replayError) {
      const message = replayError instanceof Error ? replayError.message : "Genleveringen kunne ikke startes.";
      setError(message);
      toast.error(message);
    } finally {
      setReplaying(false);
    }
  };

  if (loading && !data) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" aria-label="Henter SIEM-status" /></div>;

  return (
    <div className="space-y-4">
      {error && <div role="alert" className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void load(true)}>Prøv igen</Button></div>}
      {data && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {QUEUE_CARDS.map(([key, label, description]) => <Card key={key} className={key === "deadLetter" && data.counts[key] > 0 ? "border-destructive/60" : ""}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-3xl">{data.counts[key]}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">{description}</p></CardContent></Card>)}
        </div>

        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />Integritet og levering</CardTitle><CardDescription>De seneste hændelser kontrolleres kryptografisk, før status vises.</CardDescription></div>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(true)}><RefreshCcw className={loading ? "animate-spin" : ""} />Opdatér</Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {data.integrity.checked === 0 ? <Badge variant="secondary"><AlertTriangle />Ingen hændelser at kontrollere</Badge> : data.integrity.ok ? <Badge variant="outline"><CheckCircle2 />Kæden er verificeret ({data.integrity.checked})</Badge> : <Badge variant="destructive"><AlertTriangle />{data.integrity.invalid} integritetsfejl</Badge>}
              <Badge variant={data.settings?.siem_enabled ? "default" : "secondary"}>{data.settings?.siem_enabled ? "SIEM aktiv" : "SIEM deaktiveret"}</Badge>
              {data.settings?.siem_adapter && <Badge variant="outline">Adapter: {data.settings.siem_adapter}</Badge>}
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-md border p-3"><p className="font-medium">Destination</p><p className="text-muted-foreground">{data.settings?.siem_destination_label || "Ikke konfigureret"}</p></div>
              <div className="rounded-md border p-3"><p className="font-medium">Seneste kvittering</p><p className="text-muted-foreground">{data.lastReceipt ? `${new Date(data.lastReceipt.delivered_at).toLocaleString("da-DK")} · ${data.lastReceipt.event_count} hændelser` : "Ingen levering er kvitteret endnu"}</p></div>
            </div>
            {(data.counts.failed > 0 || data.counts.deadLetter > 0) && <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">Nogle leverancer kræver opmærksomhed</p><p className="text-sm text-muted-foreground">Genlevering flytter fejlede hændelser tilbage til køen. Handlingen logges.</p></div><Button disabled={replaying} onClick={() => void replay()}>{replaying ? <Loader2 className="animate-spin" /> : <RotateCcw />}Genlevér fejl</Button></div>}
          </CardContent>
        </Card>

        {!data.settings?.siem_enabled && <Card className="border-dashed"><CardContent className="flex items-start gap-3 p-4"><DatabaseZap className="mt-0.5 size-5 text-muted-foreground" /><div><p className="font-medium">SIEM-levering er ikke aktiveret</p><p className="text-sm text-muted-foreground">Hændelser fortsætter med at blive logget uforanderligt og står i kø, indtil integrationen aktiveres under Indstillinger.</p></div></CardContent></Card>}
      </>}
    </div>
  );
}
