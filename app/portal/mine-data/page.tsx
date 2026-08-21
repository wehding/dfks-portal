"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileClock, Loader2, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PortalPageHeader } from "@/components/portal/portal-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SarItem = {
  id: string;
  status: "draft" | "review" | "approved" | "rejected" | "generated" | "delivered" | "expired";
  date_from: string | null;
  date_to: string | null;
  data_categories: string[];
  mask_staff_names: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

const STATUS_LABELS: Record<SarItem["status"], string> = {
  draft: "Kladde", review: "Til gennemgang", approved: "Godkendt", rejected: "Afvist",
  generated: "Klar til download", delivered: "Udleveret", expired: "Udløbet",
};

async function responseError(response: Response, fallback: string) {
  return (await response.json().catch(() => null))?.error ?? fallback;
}

export default function MineDataPage() {
  const [items, setItems] = useState<SarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/portal/audit-log/sar", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, "Anmodningerne kunne ikke hentes."));
      setItems((await response.json()).items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Anmodningerne kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const hasActive = useMemo(() => items.some(item =>
    !["rejected", "expired"].includes(item.status)
    && (!item.expires_at || new Date(item.expires_at).getTime() > Date.now())), [items]);

  const createRequest = async () => {
    setBusy("create");
    try {
      const response = await fetch("/api/portal/audit-log/sar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00Z`).toISOString() : null,
          dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : null,
          dataCategories: [],
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Anmodningen kunne ikke oprettes."));
      setOpen(false); setDateFrom(""); setDateTo("");
      toast.success("Din indsigtsanmodning er sendt til gennemgang.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Anmodningen kunne ikke oprettes.");
    } finally { setBusy(""); }
  };

  const download = async (item: SarItem, format: "pdf" | "json" | "csv") => {
    setBusy(`${item.id}:${format}`);
    try {
      const response = await fetch(`/api/portal/audit-log/sar/${item.id}/export?format=${format}`, { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, "Rapporten kunne ikke hentes."));
      const result = await response.json() as { url?: string };
      if (!result.url) throw new Error("Downloadlinket blev ikke oprettet.");
      const target = new URL(result.url, window.location.origin);
      if (target.protocol !== "https:" && target.hostname !== "localhost") throw new Error("Downloadlinket bruger en ugyldig protokol.");
      window.location.assign(target.href);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rapporten kunne ikke hentes.");
    } finally { setBusy(""); }
  };

  return <div className="space-y-6">
    <PortalPageHeader
      title="Mine data og opslag"
      subtitle="Se og hent dine godkendte GDPR-indsigtsrapporter"
      actions={<Button disabled={hasActive} onClick={() => setOpen(true)}><Plus />Ny anmodning</Button>}
    />
    <Card className="border-blue-500/30 bg-blue-500/5">
      <CardContent className="flex gap-3 p-4 text-sm">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-blue-600" />
        <div><p className="font-medium">Medarbejderes identitet er beskyttet</p><p className="text-muted-foreground">Rapporter til medlemmer viser tidspunkt, formål, rolle og behandling. Medarbejdernavne, interne id&apos;er og IP-adresser er maskeret.</p></div>
      </CardContent>
    </Card>
    {loading ? <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div> : items.length === 0 ?
      <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Du har endnu ingen indsigtsanmodninger.</CardContent></Card> :
      <div className="grid gap-4">
        {items.map(item => {
          const downloadable = ["generated", "delivered"].includes(item.status) && item.mask_staff_names
            && Boolean(item.expires_at && new Date(item.expires_at).getTime() > Date.now());
          return <Card key={item.id}>
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><CardTitle className="flex items-center gap-2 text-base"><FileClock className="size-4" />Indsigtsanmodning</CardTitle><CardDescription>Oprettet {new Date(item.created_at).toLocaleString("da-DK")}</CardDescription></div>
              <Badge variant="outline">{STATUS_LABELS[item.status]}</Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>Periode: {item.date_from ? new Date(item.date_from).toLocaleDateString("da-DK") : "første registrering"} – {item.date_to ? new Date(item.date_to).toLocaleDateString("da-DK") : "i dag"}</p>
              <p className="text-muted-foreground">Datakategorier: {item.data_categories.length ? item.data_categories.join(", ") : "alle relevante kategorier"}</p>
              {item.expires_at && <p className="text-muted-foreground">Rapportfilen udløber {new Date(item.expires_at).toLocaleString("da-DK")}.</p>}
              {downloadable && <div className="flex flex-wrap gap-2">{(["pdf", "json", "csv"] as const).map(format => <Button key={format} variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void download(item, format)}>{busy === `${item.id}:${format}` ? <Loader2 className="animate-spin" /> : <Download />}{format.toUpperCase()}</Button>)}</div>}
            </CardContent>
          </Card>;
        })}
      </div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Ny indsigtsanmodning</DialogTitle><DialogDescription>Tom periode medtager alle registrerede tidspunkter. Når rapporten er godkendt og genereret, er filerne tilgængelige i 24 timer.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Label className="space-y-1">Fra dato<Input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></Label><Label className="space-y-1">Til dato<Input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} /></Label><Button className="sm:col-span-2" disabled={busy === "create" || Boolean(dateFrom && dateTo && dateTo < dateFrom)} onClick={() => void createRequest()}>{busy === "create" && <Loader2 className="animate-spin" />}Send anmodning</Button></div></DialogContent></Dialog>
  </div>;
}
