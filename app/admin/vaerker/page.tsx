"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Film, Loader2, Search, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fetchAdminWorksForReview, reviewWorkDataCorrection } from "@/app/actions/work-management";

type CommentRow = {
  id: string;
  author_role: "member" | "admin";
  message: string;
  created_at: string;
};

type ChangeRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  source: string;
  old_data: Record<string, unknown>;
  proposed_data: Record<string, unknown>;
  created_at: string;
  rettighedshavere?: { full_name?: string | null } | null;
  work_change_request_comments?: CommentRow[];
};

type WorkRow = {
  id: string;
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  episode_count: number | null;
  genre: string | null;
  status: string;
  dfi_id: string | null;
  tmdb_id: string | number | null;
  description: string | null;
  poster_url: string | null;
  work_change_requests?: ChangeRequest[];
};

const STATUS_LABELS: Record<string, string> = {
  til_godkendelse: "Til godkendelse",
  godkendt: "Godkendt",
  aktiv: "Aktiv",
  afsluttet: "Afsluttet",
  arkiveret: "Arkiveret",
};

const STATUS_CLASS: Record<string, string> = {
  til_godkendelse: "border-amber-300 bg-amber-50 text-amber-700",
  godkendt: "border-green-300 bg-green-50 text-green-700",
  aktiv: "border-blue-300 bg-blue-50 text-blue-700",
  afsluttet: "border-slate-300 bg-slate-50 text-slate-700",
  arkiveret: "border-gray-300 bg-gray-50 text-gray-700",
};

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export default function VaerksadministrationPage() {
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [reviewing, setReviewing] = useState<{ work: WorkRow; request: ChangeRequest } | null>(null);
  const [adminComment, setAdminComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchAdminWorksForReview();
      if (res.success) setWorks(res.works as WorkRow[]);
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke hente værker."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = works;
    if (filterStatus !== "all") list = list.filter(work => work.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(work =>
        work.title?.toLowerCase().includes(q) ||
        work.type?.toLowerCase().includes(q) ||
        String(work.year ?? "").includes(q) ||
        work.dfi_id?.toLowerCase().includes(q) ||
        String(work.tmdb_id ?? "").includes(q)
      );
    }
    return list;
  }, [works, filterStatus, search]);

  const pendingRequests = useMemo(
    () => works.flatMap(work => (work.work_change_requests ?? [])
      .filter(request => request.status === "pending")
      .map(request => ({ work, request }))),
    [works]
  );

  const handleReview = async (decision: "approved" | "rejected") => {
    if (!reviewing) return;
    setSaving(true);
    try {
      await reviewWorkDataCorrection({ requestId: reviewing.request.id, decision, comment: adminComment });
      setNotice(decision === "approved" ? "Rettelsen er godkendt." : "Rettelsen er afvist.");
      setReviewing(null);
      setAdminComment("");
      await load();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke behandle rettelsen."));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Henter værker...</div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Værksadministration" subtitle={`${filtered.length} af ${works.length} værker`} />

      {notice && (
        <div className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-muted-foreground">Luk</button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Søg titel, DFI-id, TMDB-id, type..." className="w-[320px] pl-8" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle status</SelectItem>
            <SelectItem value="til_godkendelse">Til godkendelse</SelectItem>
            <SelectItem value="godkendt">Godkendt</SelectItem>
            <SelectItem value="aktiv">Aktiv</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {pendingRequests.length > 0 && (
        <div className="rounded-lg border p-4">
          <h2 className="text-base font-semibold">Ændringsanmodninger</h2>
          <div className="mt-3 grid gap-2">
            {pendingRequests.map(({ work, request }) => (
              <button key={request.id} onClick={() => { setReviewing({ work, request }); setAdminComment(""); }} className="rounded-md border px-3 py-2 text-left text-sm hover:bg-muted">
                <span className="font-medium">{work.title}</span>
                <span className="ml-2 text-muted-foreground">{request.source} · {request.rettighedshavere?.full_name ?? "ukendt bruger"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Værk</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>År</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Ingen værker matcher søgningen</TableCell></TableRow>
            ) : filtered.map(work => (
              <TableRow key={work.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Film className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{work.title}</p>
                      <p className="text-xs text-muted-foreground">{work.description ? work.description.slice(0, 90) : "Ingen beskrivelse"}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{work.type}</TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">{work.year ?? "-"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>DFI: {work.dfi_id ?? "-"} · TMDB: {work.tmdb_id ?? "-"}</div>
                  <div>Varighed: {work.duration_minutes ?? "-"} · Afsnit: {work.episode_count ?? "-"} · Genre: {work.genre ?? "-"}</div>
                  <div>Poster: {work.poster_url ? "ja" : "nej"}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_CLASS[work.status] ?? ""}>
                    {work.status === "til_godkendelse" ? <Clock className="mr-1 h-3 w-3" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                    {STATUS_LABELS[work.status] ?? work.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!reviewing} onOpenChange={open => { if (!open) setReviewing(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Behandl ændringsanmodning</DialogTitle></DialogHeader>
          {reviewing && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 text-sm">
                <div><span className="font-medium">Værk:</span> {reviewing.work.title}</div>
                <div><span className="font-medium">Kilde:</span> {reviewing.request.source}</div>
                <div className="mt-2">
                  <span className="font-medium">Foreslåede data:</span>
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(reviewing.request.proposed_data, null, 2)}</pre>
                </div>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">Kommentartråd</p>
                <div className="mt-2 space-y-2">
                  {(reviewing.request.work_change_request_comments ?? []).map(comment => (
                    <div key={comment.id} className="rounded bg-muted px-3 py-2 text-sm">
                      <div className="text-xs text-muted-foreground">{comment.author_role === "admin" ? "Admin" : "Bruger"} · {new Date(comment.created_at).toLocaleString("da-DK")}</div>
                      <div>{comment.message}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Svar til bruger</Label>
                <Textarea value={adminComment} onChange={e => setAdminComment(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => handleReview("rejected")} disabled={saving}><XCircle className="mr-2 h-4 w-4" />Afvis</Button>
            <Button onClick={() => handleReview("approved")} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Godkend</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
