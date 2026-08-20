"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileLock2, Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type MemberOption = { id: string; name: string; orgId: string; orgName: string };
type SarStatus = "draft" | "review" | "approved" | "rejected" | "generated" | "delivered" | "expired";
type SarItem = {
  id: string;
  org_id: string;
  org_label: string;
  target_member_uuid: string;
  target_member_label: string;
  status: SarStatus;
  mask_staff_names: boolean;
  data_categories: string[];
  date_from: string | null;
  date_to: string | null;
  created_at: string;
  expires_at: string | null;
  balancing_reason: string | null;
};

type SarResponse = { items: SarItem[]; members: MemberOption[]; callerRole: string };

const STATUS_LABELS: Record<SarStatus, string> = {
  draft: "Kladde",
  review: "Til gennemgang",
  approved: "Godkendt",
  rejected: "Afvist",
  generated: "Klar til udlevering",
  delivered: "Udleveret",
  expired: "Udløbet",
};

const CATEGORY_OPTIONS = [
  ["contract_data", "Kontraktdata"],
  ["salary_data", "Lønoplysninger"],
  ["contact_data", "Kontaktoplysninger"],
  ["identity_data", "Identitetsoplysninger"],
  ["message_data", "Beskeder"],
  ["ai_analysis", "AI-behandling"],
  ["union_membership_data", "Fagforeningsdata"],
] as const;

async function readError(response: Response, fallback: string) {
  return (await response.json().catch(() => null))?.error ?? fallback;
}

async function fetchSarData(): Promise<SarResponse> {
  const response = await fetch("/api/admin/audit-log/sar", { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response, "Indsigtsanmodningerne kunne ikke hentes."));
  return response.json();
}

function periodLabel(item: SarItem) {
  if (!item.date_from && !item.date_to) return "Alle registrerede tidspunkter";
  const format = (value: string | null) => value ? new Date(value).toLocaleDateString("da-DK") : "første registrering";
  return `${format(item.date_from)} – ${item.date_to ? format(item.date_to) : "i dag"}`;
}

export function AuditSarPanel({ callerRole }: { callerRole: string }) {
  const [items, setItems] = useState<SarItem[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [memberKey, setMemberKey] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [review, setReview] = useState<SarItem | null>(null);
  const [unmask, setUnmask] = useState(false);
  const [reason, setReason] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const applyData = useCallback((result: SarResponse) => {
    setItems(result.items ?? []);
    setMembers(result.members ?? []);
    setError("");
  }, []);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      applyData(await fetchSarData());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Indsigtsanmodningerne kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, [applyData]);

  useEffect(() => {
    let active = true;
    void fetchSarData().then(result => {
      if (active) applyData(result);
    }).catch(loadError => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Indsigtsanmodningerne kunne ikke hentes.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [applyData]);

  const selectedMember = useMemo(() => members.find(member => `${member.id}:${member.orgId}` === memberKey) ?? null, [memberKey, members]);
  const visibleItems = useMemo(() => statusFilter ? items.filter(item => item.status === statusFilter) : items, [items, statusFilter]);
  const invalidPeriod = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  const toggleCategory = (category: string) => {
    setCategories(current => current.includes(category) ? current.filter(value => value !== category) : [...current, category]);
  };

  const createRequest = async () => {
    if (!selectedMember || invalidPeriod) return;
    setBusyKey("create");
    setError("");
    try {
      const response = await fetch("/api/admin/audit-log/sar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetMemberUuid: selectedMember.id,
          orgId: selectedMember.orgId,
          dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00Z`).toISOString() : null,
          dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : null,
          dataCategories: categories,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "Anmodningen kunne ikke oprettes."));
      setMemberKey("");
      setDateFrom("");
      setDateTo("");
      setCategories([]);
      toast.success("Indsigtsanmodningen er oprettet og klar til gennemgang.");
      await load();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Anmodningen kunne ikke oprettes.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey("");
    }
  };

  const updateRequest = async (item: SarItem, action: "approve" | "reject" | "mark_delivered") => {
    setBusyKey(`${item.id}:${action}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/audit-log/sar/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          maskStaffNames: action === "approve" ? !unmask : undefined,
          balancingReason: action === "approve" && unmask ? reason : undefined,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "Anmodningen kunne ikke opdateres."));
      setReview(null);
      setUnmask(false);
      setReason("");
      toast.success(action === "approve" ? "Anmodningen er godkendt." : action === "reject" ? "Anmodningen er afvist." : "Rapporten er markeret som udleveret.");
      await load();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Anmodningen kunne ikke opdateres.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey("");
    }
  };

  const downloadReport = async (item: SarItem, format: "pdf" | "json" | "csv") => {
    setBusyKey(`${item.id}:${format}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/audit-log/sar/${item.id}/export?format=${format}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "Rapporten kunne ikke genereres."));
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `dfks-indsigt-${item.id}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      toast.success(`${format.toUpperCase()}-rapporten er genereret.`);
      await load();
    } catch (downloadError) {
      const message = downloadError instanceof Error ? downloadError.message : "Rapporten kunne ikke genereres.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileLock2 className="size-5" />Ny indsigtsanmodning</CardTitle>
          <CardDescription>Vælg medlem og periode. Medarbejderidentitet maskeres altid som udgangspunkt.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Label className="space-y-1 md:col-span-2">
              Medlem og organisation
              <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={memberKey} onChange={event => setMemberKey(event.target.value)}>
                <option value="">Vælg medlem…</option>
                {members.map(member => <option key={`${member.id}:${member.orgId}`} value={`${member.id}:${member.orgId}`}>{member.name}{callerRole === "superadmin" ? ` · ${member.orgName}` : ""}</option>)}
              </select>
            </Label>
            <Label className="space-y-1">Fra dato<Input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></Label>
            <Label className="space-y-1">Til dato<Input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} /></Label>
          </div>
          {invalidPeriod && <p role="alert" className="text-sm text-destructive">Slutdatoen skal være den samme som eller senere end startdatoen.</p>}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Datakategorier</legend>
            <p className="text-xs text-muted-foreground">Ingen markering betyder, at alle kategorier indgår.</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map(([value, label]) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"><input type="checkbox" checked={categories.includes(value)} onChange={() => toggleCategory(value)} />{label}</label>)}
            </div>
          </fieldset>
          <div className="flex justify-end"><Button disabled={!selectedMember || invalidPeriod || Boolean(busyKey)} onClick={() => void createRequest()}>{busyKey === "create" ? <Loader2 className="animate-spin" /> : <FileLock2 />}Opret anmodning</Button></div>
        </CardContent>
      </Card>

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><CardTitle>Indsigtsanmodninger</CardTitle><CardDescription>Gennemgå, generér og registrér udlevering af medlemsrapporter.</CardDescription></div>
          <div className="flex gap-2">
            <select aria-label="Filtrér efter status" className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              <option value="">Alle statusser</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(true)}><RefreshCcw className={loading ? "animate-spin" : ""} />Opdatér</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && <div className="flex justify-center p-8"><Loader2 className="animate-spin" aria-label="Henter indsigtsanmodninger" /></div>}
          {!loading && visibleItems.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{statusFilter ? "Ingen anmodninger har den valgte status." : "Ingen indsigtsanmodninger endnu."}</p>}
          {visibleItems.map(item => (
            <article key={item.id} className="flex flex-col gap-4 border-t p-4 first:border-t-0 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{item.target_member_label}</p>
                  <Badge variant="outline">{STATUS_LABELS[item.status]}</Badge>
                  {item.mask_staff_names && <Badge variant="secondary"><ShieldCheck />Navne maskeret</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{item.org_label} · {periodLabel(item)}</p>
                <p className="text-xs text-muted-foreground">Oprettet {new Date(item.created_at).toLocaleString("da-DK")} · {item.data_categories.length ? item.data_categories.map(value => CATEGORY_OPTIONS.find(option => option[0] === value)?.[1] ?? value).join(", ") : "Alle datakategorier"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.status === "review" && <Button size="sm" onClick={() => { setReview(item); setUnmask(false); setReason(""); }}>Gennemgå</Button>}
                {(["approved", "generated", "delivered"] as SarStatus[]).includes(item.status) && (["pdf", "json", "csv"] as const).map(format => (
                  <Button key={format} size="sm" variant="outline" disabled={Boolean(busyKey)} onClick={() => void downloadReport(item, format)}>{busyKey === `${item.id}:${format}` ? <Loader2 className="animate-spin" /> : <Download />}{format.toUpperCase()}</Button>
                ))}
                {item.status === "generated" && <Button size="sm" variant="secondary" disabled={Boolean(busyKey)} onClick={() => void updateRequest(item, "mark_delivered")}>{busyKey === `${item.id}:mark_delivered` && <Loader2 className="animate-spin" />}Markér udleveret</Button>}
              </div>
            </article>
          ))}
        </CardContent>
      </Card>

      <Dialog open={Boolean(review)} onOpenChange={open => !open && setReview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gennemgå indsigtsanmodning</DialogTitle>
            <DialogDescription>Kontrollér perioden og maskeringen, før rapporten kan genereres.</DialogDescription>
          </DialogHeader>
          {review && <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm"><p className="font-medium">{review.target_member_label}</p><p className="text-muted-foreground">{review.org_label} · {periodLabel(review)}</p></div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div><p className="font-medium">Maskér medarbejdernavne</p><p className="text-xs text-muted-foreground">Standardvalget beskytter personalets identitet.</p></div>
              <Switch aria-label="Maskér medarbejdernavne" checked={!unmask} disabled={callerRole !== "superadmin"} onCheckedChange={checked => setUnmask(!checked)} />
            </div>
            {unmask && <Label className="space-y-2">Dokumenteret nødvendighed og afvejning<Textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Beskriv hvorfor direkte medarbejderidentitet er nødvendig…" /><span className="text-xs text-muted-foreground">Mindst 20 tegn. Beslutningen logges.</span></Label>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="destructive" disabled={Boolean(busyKey)} onClick={() => void updateRequest(review, "reject")}>Afvis</Button>
              <Button disabled={(unmask && reason.trim().length < 20) || Boolean(busyKey)} onClick={() => void updateRequest(review, "approve")}>{busyKey === `${review.id}:approve` && <Loader2 className="animate-spin" />}Godkend</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
