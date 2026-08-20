"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, DatabaseZap, FileLock2, Loader2, RefreshCcw, Settings2, ShieldCheck } from "lucide-react";
import { AuditLogClient } from "@/components/admin/audit-log-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type MemberOption = { id: string; name: string };
type SarItem = {
  id: string;
  target_member_uuid: string;
  target_member_label: string;
  status: "draft" | "review" | "approved" | "rejected" | "generated" | "delivered" | "expired";
  mask_staff_names: boolean;
  data_categories: string[];
  date_from: string | null;
  date_to: string | null;
  created_at: string;
  balancing_reason: string | null;
};

const statusLabels: Record<SarItem["status"], string> = {
  draft: "Kladde", review: "Til gennemgang", approved: "Godkendt", rejected: "Afvist",
  generated: "Genereret", delivered: "Udleveret", expired: "Udløbet",
};

function SarPanel({ callerRole }: { callerRole: string }) {
  const [items, setItems] = useState<SarItem[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [memberId, setMemberId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categories, setCategories] = useState("contract_data, salary_data");
  const [review, setReview] = useState<SarItem | null>(null);
  const [unmask, setUnmask] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/audit-log/sar", { cache: "no-store" });
    if (!response.ok) { setError("Indsigtsanmodningerne kunne ikke hentes."); setLoading(false); return; }
    const result = await response.json();
    setItems(result.items ?? []);
    setMembers(result.members ?? []);
    setError("");
    setLoading(false);
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/audit-log/sar", { cache: "no-store" })
      .then(async response => ({ ok: response.ok, result: response.ok ? await response.json() : null }))
      .then(({ ok, result }) => {
        if (!active) return;
        if (!ok) setError("Indsigtsanmodningerne kunne ikke hentes.");
        else {
          setItems(result.items ?? []);
          setMembers(result.members ?? []);
          setError("");
        }
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const createRequest = async () => {
    if (!memberId) return;
    const response = await fetch("/api/admin/audit-log/sar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetMemberUuid: memberId,
        dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00Z`).toISOString() : null,
        dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : null,
        dataCategories: categories.split(",").map(value => value.trim()).filter(Boolean),
      }),
    });
    if (!response.ok) { setError((await response.json().catch(() => null))?.error ?? "Anmodningen kunne ikke oprettes."); return; }
    setMemberId(""); setDateFrom(""); setDateTo("");
    await load();
  };

  const updateRequest = async (item: SarItem, action: "approve" | "reject" | "mark_delivered") => {
    const response = await fetch(`/api/admin/audit-log/sar/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, maskStaffNames: action === "approve" ? !unmask : undefined, balancingReason: unmask ? reason : undefined }),
    });
    if (!response.ok) { setError((await response.json().catch(() => null))?.error ?? "Anmodningen kunne ikke opdateres."); return; }
    setReview(null); setUnmask(false); setReason("");
    await load();
  };

  return <div className="space-y-4">
    <Card>
      <CardHeader><CardTitle>Ny indsigtsanmodning</CardTitle><CardDescription>Medarbejderidentitet maskeres som standard i alle rapporter.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1 lg:col-span-2"><span className="text-sm font-medium">Medlem</span><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={memberId} onChange={event => setMemberId(event.target.value)}><option value="">Vælg medlem…</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <Label className="space-y-1">Fra<Input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></Label>
        <Label className="space-y-1">Til<Input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} /></Label>
        <div className="flex items-end"><Button className="w-full" disabled={!memberId} onClick={() => void createRequest()}><FileLock2 />Opret</Button></div>
        <Label className="space-y-1 md:col-span-2 lg:col-span-5">Datakategorier, kommasepareret<Input value={categories} onChange={event => setCategories(event.target.value)} /></Label>
      </CardContent>
    </Card>
    {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <div className="overflow-hidden rounded-lg border bg-card">
      {loading && <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>}
      {!loading && items.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Ingen indsigtsanmodninger endnu.</p>}
      {items.map(item => <div key={item.id} className="flex flex-col gap-3 border-b p-4 last:border-0 md:flex-row md:items-center md:justify-between">
        <div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{item.target_member_label}</p><Badge variant="outline">{statusLabels[item.status]}</Badge>{item.mask_staff_names && <Badge variant="secondary">Navne maskeret</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">Oprettet {new Date(item.created_at).toLocaleString("da-DK")} · {item.data_categories.join(", ") || "Alle datakategorier"}</p></div>
        <div className="flex flex-wrap gap-2">
          {item.status === "review" && <Button size="sm" onClick={() => setReview(item)}>Gennemgå</Button>}
          {["approved", "generated", "delivered"].includes(item.status) && <><Button asChild size="sm" variant="outline"><a href={`/api/admin/audit-log/sar/${item.id}/export?format=pdf`}>PDF</a></Button><Button asChild size="sm" variant="outline"><a href={`/api/admin/audit-log/sar/${item.id}/export?format=json`}>JSON</a></Button><Button asChild size="sm" variant="outline"><a href={`/api/admin/audit-log/sar/${item.id}/export?format=csv`}>CSV</a></Button></>}
          {item.status === "generated" && <Button size="sm" variant="secondary" onClick={() => void updateRequest(item, "mark_delivered")}>Markér udleveret</Button>}
        </div>
      </div>)}
    </div>
    <Dialog open={Boolean(review)} onOpenChange={open => !open && setReview(null)}><DialogContent><DialogHeader><DialogTitle>Gennemgå indsigtsanmodning</DialogTitle><DialogDescription>Rapporten viser behandlingstidspunkt, formål og rolle. Direkte medarbejderidentitet kræver en konkret afvejning.</DialogDescription></DialogHeader>{review && <div className="space-y-4"><div className="flex items-center justify-between rounded-md border p-3"><div><p className="font-medium">Maskér medarbejdernavne</p><p className="text-xs text-muted-foreground">Anbefalet og valgt som standard</p></div><Switch checked={!unmask} disabled={callerRole !== "superadmin"} onCheckedChange={checked => setUnmask(!checked)} /></div>{unmask && <Label className="space-y-2">Dokumenteret nødvendighed og afvejning<Textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Mindst 20 tegn…" /></Label>}<div className="flex justify-end gap-2"><Button variant="destructive" onClick={() => void updateRequest(review, "reject")}>Afvis</Button><Button disabled={unmask && reason.trim().length < 20} onClick={() => void updateRequest(review, "approve")}>Godkend</Button></div></div>}</DialogContent></Dialog>
  </div>;
}

type SiemData = { settings: { siem_enabled: boolean; siem_adapter: string; siem_destination_label: string | null; kms_key_id: string | null } | null; lastReceipt: { delivered_at: string; event_count: number; adapter: string; key_id: string } | null; counts: Record<string, number>; integrity: { checked: number; invalid: number; ok: boolean } };

function SiemPanel({ callerRole }: { callerRole: string }) {
  const [data, setData] = useState<SiemData | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { const response = await fetch("/api/admin/audit-log/siem", { cache: "no-store" }); setData(response.ok ? await response.json() : null); setLoading(false); }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/audit-log/siem", { cache: "no-store" })
      .then(async response => response.ok ? await response.json() : null)
      .then(result => {
        if (!active) return;
        setData(result);
        setLoading(false);
      });
    return () => { active = false; };
  }, []);
  const replay = async () => { await fetch("/api/admin/audit-log/siem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allFailed: true }) }); await load(); };
  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
  if (!data) return <p className="text-sm text-destructive">SIEM-status kunne ikke hentes.</p>;
  return <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(data.counts).map(([status, count]) => <Card key={status}><CardHeader className="pb-2"><CardDescription>{status}</CardDescription><CardTitle className="text-3xl">{count}</CardTitle></CardHeader></Card>)}</div><Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />Integritet</CardTitle><CardDescription>Seneste {data.integrity.checked} hændelser er kontrolleret mod hashkæden.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-3"><Badge variant={data.integrity.ok ? "outline" : "destructive"}>{data.integrity.ok ? "Kæden er intakt" : `${data.integrity.invalid} fejl`}</Badge><Badge variant={data.settings?.siem_enabled ? "default" : "secondary"}>{data.settings?.siem_enabled ? "SIEM aktiv" : "SIEM deaktiveret"}</Badge>{data.lastReceipt && <span className="text-sm text-muted-foreground">Seneste levering: {new Date(data.lastReceipt.delivered_at).toLocaleString("da-DK")} ({data.lastReceipt.event_count} events)</span>}<Button className="ml-auto" variant="outline" onClick={() => void load()}><RefreshCcw />Opdatér</Button>{callerRole === "superadmin" && (data.counts.failed > 0 || data.counts.deadLetter > 0) && <Button onClick={() => void replay()}>Genlevér fejl</Button>}</CardContent></Card></div>;
}

type SettingsData = { retention_years: number; siem_enabled: boolean; siem_adapter: "generic" | "splunk" | "sentinel" | "elastic"; siem_destination_label: string | null; kms_key_id: string | null };

function SettingsPanel() {
  const [form, setForm] = useState<SettingsData | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { void fetch("/api/admin/audit-log/settings", { cache: "no-store" }).then(async response => { if (response.ok) setForm((await response.json()).item); }); }, []);
  if (!form) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
  const save = async () => { const response = await fetch("/api/admin/audit-log/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ retentionYears: form.retention_years, siemEnabled: form.siem_enabled, siemAdapter: form.siem_adapter, siemDestinationLabel: form.siem_destination_label || null, kmsKeyId: form.kms_key_id || null }) }); setMessage(response.ok ? "Indstillingerne er gemt." : (await response.json().catch(() => null))?.error ?? "Kunne ikke gemme."); };
  return <Card><CardHeader><CardTitle>Audit- og SIEM-indstillinger</CardTitle><CardDescription>Hemmeligheder og private nøgler vises og lagres ikke her.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><Label className="space-y-2">Retention i år<Input type="number" min={1} max={30} value={form.retention_years} onChange={event => setForm({ ...form, retention_years: Number(event.target.value) })} /></Label><Label className="space-y-2">Adapter<select className="h-10 w-full rounded-md border bg-background px-3" value={form.siem_adapter} onChange={event => setForm({ ...form, siem_adapter: event.target.value as SettingsData["siem_adapter"] })}><option value="generic">Generisk HTTPS</option><option value="splunk">Splunk HEC</option><option value="sentinel">Microsoft Sentinel</option><option value="elastic">Elastic</option></select></Label><Label className="space-y-2">Destinationsnavn<Input value={form.siem_destination_label ?? ""} onChange={event => setForm({ ...form, siem_destination_label: event.target.value })} placeholder="Produktion SIEM" /></Label><Label className="space-y-2">Google Cloud KMS-nøgleversion<Input value={form.kms_key_id ?? ""} onChange={event => setForm({ ...form, kms_key_id: event.target.value })} placeholder="projects/…/cryptoKeyVersions/1" /></Label><div className="flex items-center justify-between rounded-md border p-3 md:col-span-2"><div><p className="font-medium">Aktivér SIEM-levering</p><p className="text-xs text-muted-foreground">Workerens endpoint og token konfigureres i Cloud Run.</p></div><Switch checked={form.siem_enabled} onCheckedChange={checked => setForm({ ...form, siem_enabled: checked })} /></div><div className="flex items-center gap-3 md:col-span-2"><Button onClick={() => void save()}><Settings2 />Gem indstillinger</Button>{message && <p className="text-sm text-muted-foreground">{message}</p>}</div></CardContent></Card>;
}

export function AuditControlCenter({ callerRole }: { callerRole: string }) {
  const juristOnly = callerRole === "jurist";
  return <main className="space-y-6 p-4 sm:p-6"><div><h1 className="text-2xl font-semibold">Logning og indsigt</h1><p className="text-sm text-muted-foreground">Uforanderligt revisionsspor, C‑579/21-indblik og kryptografisk SIEM-levering.</p></div><Tabs defaultValue={juristOnly ? "sar" : "events"}><TabsList variant="line"><TabsTrigger value="events" disabled={juristOnly}><Activity />Hændelser</TabsTrigger><TabsTrigger value="sar"><FileLock2 />Indsigtsanmodninger</TabsTrigger><TabsTrigger value="siem" disabled={juristOnly}><DatabaseZap />SIEM-status</TabsTrigger>{callerRole === "superadmin" && <TabsTrigger value="settings"><Settings2 />Indstillinger</TabsTrigger>}</TabsList><TabsContent value="events" className="mt-4">{!juristOnly && <AuditLogClient embedded />}</TabsContent><TabsContent value="sar" className="mt-4"><SarPanel callerRole={callerRole} /></TabsContent><TabsContent value="siem" className="mt-4">{!juristOnly && <SiemPanel callerRole={callerRole} />}</TabsContent>{callerRole === "superadmin" && <TabsContent value="settings" className="mt-4"><SettingsPanel /></TabsContent>}</Tabs></main>;
}
