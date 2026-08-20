"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Loader2, RefreshCcw, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type SettingsData = {
  retention_years: number;
  mask_staff_names_default: boolean;
  siem_enabled: boolean;
  siem_adapter: "generic" | "splunk" | "sentinel" | "elastic";
  siem_destination_label: string | null;
  kms_key_id: string | null;
  updated_at: string;
};

async function readError(response: Response, fallback: string) {
  return (await response.json().catch(() => null))?.error ?? fallback;
}

async function fetchSettings(): Promise<SettingsData> {
  const response = await fetch("/api/admin/audit-log/settings", { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response, "Indstillingerne kunne ikke hentes."));
  return (await response.json()).item;
}

export function AuditSettingsPanel() {
  const [form, setForm] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setForm(await fetchSettings());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Indstillingerne kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void fetchSettings().then(result => {
      if (active) { setForm(result); setError(""); }
    }).catch(loadError => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Indstillingerne kunne ikke hentes.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const validationError = useMemo(() => {
    if (!form) return "";
    if (!Number.isInteger(form.retention_years) || form.retention_years < 1 || form.retention_years > 30) return "Retention skal være mellem 1 og 30 hele år.";
    if (form.siem_enabled && !form.siem_destination_label?.trim()) return "Angiv et forståeligt navn til SIEM-destinationen.";
    if (form.siem_enabled && !form.kms_key_id?.trim()) return "Angiv referencen til Google Cloud KMS-nøgleversionen.";
    return "";
  }, [form]);

  const save = async () => {
    if (!form || validationError) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/audit-log/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          retentionYears: form.retention_years,
          siemEnabled: form.siem_enabled,
          siemAdapter: form.siem_adapter,
          siemDestinationLabel: form.siem_destination_label?.trim() || null,
          kmsKeyId: form.kms_key_id?.trim() || null,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "Indstillingerne kunne ikke gemmes."));
      setForm((await response.json()).item);
      toast.success("Audit- og SIEM-indstillingerne er gemt.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Indstillingerne kunne ikke gemmes.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !form) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" aria-label="Henter auditindstillinger" /></div>;

  if (!form) return <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"><span>{error || "Indstillingerne kunne ikke hentes."}</span><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCcw />Prøv igen</Button></div>;

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="size-5" />Audit- og SIEM-indstillinger</CardTitle><CardDescription>Ændringer logges. Private nøgler og adgangstokens lagres ikke i portalen.</CardDescription></CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <Label className="space-y-2">Retention i hele år<Input type="number" min={1} max={30} step={1} value={form.retention_years} onChange={event => setForm({ ...form, retention_years: Number(event.target.value) })} /><span className="text-xs font-normal text-muted-foreground">Den fastlagte standard er syv år. Ændringer bør godkendes af DPO eller juridisk ansvarlig.</span></Label>
          <Label className="space-y-2">SIEM-adapter<select className="h-10 w-full rounded-md border bg-background px-3" value={form.siem_adapter} onChange={event => setForm({ ...form, siem_adapter: event.target.value as SettingsData["siem_adapter"] })}><option value="generic">Generisk HTTPS</option><option value="splunk">Splunk HEC</option><option value="sentinel">Microsoft Sentinel</option><option value="elastic">Elastic</option></select><span className="text-xs font-normal text-muted-foreground">Destinationens endpoint og token konfigureres separat i Cloud Run.</span></Label>
          <Label className="space-y-2">Navn på destination<Input value={form.siem_destination_label ?? ""} onChange={event => setForm({ ...form, siem_destination_label: event.target.value })} placeholder="Eksempel: Produktion SIEM" /></Label>
          <Label className="space-y-2">Google Cloud KMS-nøgleversion<Input value={form.kms_key_id ?? ""} onChange={event => setForm({ ...form, kms_key_id: event.target.value })} placeholder="projects/…/cryptoKeyVersions/1" /><span className="flex items-center gap-1 text-xs font-normal text-muted-foreground"><KeyRound className="size-3" />Kun en nøglereference—aldrig den private nøgle.</span></Label>
          <div className="flex items-center justify-between rounded-md border p-3 md:col-span-2"><div><p className="font-medium">Aktivér SIEM-levering</p><p className="text-xs text-muted-foreground">Auditloggen fortsætter uændret, når integrationen er deaktiveret; leverancerne bliver stående i kø.</p></div><Switch aria-label="Aktivér SIEM-levering" checked={form.siem_enabled} onCheckedChange={checked => setForm({ ...form, siem_enabled: checked })} /></div>
          <div className="rounded-md border bg-muted/30 p-3 text-sm md:col-span-2"><p className="font-medium">Fast maskeringsregel</p><p className="text-muted-foreground">Medarbejdernavne maskeres som standard i medlemsudtræk. Denne regel kan ikke slås fra her.</p></div>
          {validationError && <p role="alert" className="text-sm text-destructive md:col-span-2">{validationError}</p>}
          <div className="flex items-center gap-3 md:col-span-2"><Button disabled={Boolean(validationError) || saving} onClick={() => void save()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Gem indstillinger</Button><Button variant="ghost" disabled={loading || saving} onClick={() => void load()}><RefreshCcw className={loading ? "animate-spin" : ""} />Nulstil ændringer</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}
