"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Loader2, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MessageThread } from "@/components/messages/message-thread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addScreeningClaimComment, createScreeningClaim, fetchMemberScreeningClaims, fetchMemberScreeningOptions, markScreeningClaimCommentsRead } from "@/app/actions/screenings";
import { WORK_TYPES } from "@/lib/work-types";

type Claim = Record<string, any>;
type Option = { id: string; title?: string; name?: string };

export default function MineVisningerPage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [works, setWorks] = useState<Option[]>([]);
  const [broadcasters, setBroadcasters] = useState<Option[]>([]);
  const [selected, setSelected] = useState<Claim | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ workId: "", broadcasterId: "", date: "", season: "", episode: "", comment: "" });
  const [reply, setReply] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [matchFilter, setMatchFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [workQuery, setWorkQuery] = useState("");
  const [sort, setSort] = useState<{ key: "title" | "date" | "channel" | "status"; direction: 1 | -1 }>({ key: "date", direction: -1 });

  const load = async () => {
    setLoading(true);
    const [claimResult, options] = await Promise.all([fetchMemberScreeningClaims(), fetchMemberScreeningOptions()]);
    if (claimResult.success) setClaims(claimResult.claims ?? []);
    if (options.success) { setWorks(options.works as Option[]); setBroadcasters(options.broadcasters as Option[]); }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const selectedWork = useMemo(() => works.find(work => work.id === draft.workId), [draft.workId, works]);
  const selectedBroadcaster = useMemo(() => broadcasters.find(item => item.id === draft.broadcasterId), [draft.broadcasterId, broadcasters]);
  const filteredWorks = useMemo(() => works.filter(work => (work.title ?? "").toLowerCase().includes(workQuery.toLowerCase())).slice(0, 8), [works, workQuery]);
  const filteredClaims = useMemo(() => claims.filter(claim => {
    const matchesQuery = `${claim.title} ${claim.channel}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (typeFilter === "all" || claim.works?.type === typeFilter) &&
      (statusFilter === "all" || claim.status === statusFilter) &&
      (matchFilter === "all" || claim.source_match_status === matchFilter);
  }).sort((a, b) => {
    const values = { title: [a.title, b.title], date: [a.screening_date, b.screening_date], channel: [a.channel, b.channel], status: [a.status, b.status] }[sort.key];
    return String(values[0] ?? "").localeCompare(String(values[1] ?? ""), "da") * sort.direction;
  }), [claims, typeFilter, statusFilter, matchFilter, query, sort]);
  const toggleSort = (key: typeof sort.key) => setSort(current => ({ key, direction: current.key === key ? (current.direction === 1 ? -1 : 1) : 1 }));

  const submit = async () => {
    if (!selectedWork || !selectedBroadcaster || !draft.date) return;
    setSaving(true);
    const result = await createScreeningClaim({
      workId: selectedWork.id,
      broadcasterId: selectedBroadcaster.id,
      title: selectedWork.title ?? "Ukendt værk",
      channel: selectedBroadcaster.name ?? "Ukendt kanal",
      screeningDate: draft.date,
      season: draft.season ? Number(draft.season) : null,
      episode: draft.episode ? Number(draft.episode) : null,
      initialComment: draft.comment,
    });
    setSaving(false);
    if (result.success) { setCreateOpen(false); setDraft({ workId: "", broadcasterId: "", date: "", season: "", episode: "", comment: "" }); await load(); }
  };

  const openClaim = async (claim: Claim) => {
    setSelected(claim);
    await markScreeningClaimCommentsRead(claim.id, "member");
    setClaims(prev => prev.map(item => item.id === claim.id ? { ...item, screening_claim_comments: (item.screening_claim_comments ?? []).map((comment: Claim) => comment.author_role === "admin" ? { ...comment, member_read_at: new Date().toISOString() } : comment) } : item));
  };

  return <div className="space-y-6">
    <PageHeader hideTitleOnMobile title="Mine visninger" subtitle="Indberet manuelle visninger og følg dialogen med DFKS" actions={<Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Indberet visning</Button>} />
    <div className="flex flex-wrap gap-2"><div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Søg i visninger" value={query} onChange={event => setQuery(event.target.value)} /></div><select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="all">Type</option>{WORK_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="all">Status</option><option value="pending">Kladde</option><option value="approved">Godkendt</option><option value="rejected">Afvist</option></select><select value={matchFilter} onChange={event => setMatchFilter(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="all">Kildematch</option><option value="found">Fundet</option><option value="not_found">Ikke fundet</option></select></div>
    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : filteredClaims.length === 0 ? <p className="rounded-lg border p-6 text-sm text-muted-foreground">Ingen manuelle indberetninger endnu.</p> : <div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow>{[["title","Værk"],["channel","Kanal"],["date","Dato"],["status","Status"]].map(([key,label]) => <TableHead key={key}><button className="flex items-center gap-1" onClick={() => toggleSort(key as typeof sort.key)}>{label}<ArrowUpDown className="h-3 w-3" /></button></TableHead>)}<TableHead>Sæson/afsnit</TableHead><TableHead>Kildematch</TableHead></TableRow></TableHeader><TableBody>{filteredClaims.map(claim => <TableRow key={claim.id} className="cursor-pointer" onClick={() => openClaim(claim)}><TableCell className="font-medium">{claim.title}</TableCell><TableCell>{claim.channel}</TableCell><TableCell>{new Date(claim.screening_date).toLocaleDateString("da-DK")}</TableCell><TableCell><Badge variant={claim.status === "rejected" ? "destructive" : claim.status === "approved" ? "default" : "secondary"}>{claim.status === "pending" ? "Kladde" : claim.status === "approved" ? "Godkendt" : "Afvist"}</Badge></TableCell><TableCell>{claim.season ? `S${claim.season}` : "–"}{claim.episode ? ` · Afsnit ${claim.episode}` : ""}</TableCell><TableCell><Badge variant={claim.source_match_status === "found" ? "default" : "outline"}>{claim.source_match_status === "found" ? "Fundet i visningsliste" : "Ikke fundet i visningsliste"}</Badge></TableCell></TableRow>)}</TableBody></Table></div>}

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>Indberet visning manuelt</DialogTitle></DialogHeader><div className="space-y-3">
      <div className="relative"><Label>Værk</Label><Input className="mt-1" placeholder="Søg blandt dine værker" value={workQuery} onChange={e => { setWorkQuery(e.target.value); setDraft({ ...draft, workId: "" }); }} />{workQuery && !draft.workId && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">{filteredWorks.map(work => <button type="button" key={work.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setDraft({ ...draft, workId: work.id }); setWorkQuery(work.title ?? ""); }}>{work.title}</button>)}</div>}</div>
      <div><Label>Broadcaster</Label><select className="mt-1 w-full rounded-md border bg-background p-2" value={draft.broadcasterId} onChange={e => setDraft({ ...draft, broadcasterId: e.target.value })}><option value="">Vælg broadcaster</option>{broadcasters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div><Label>Dato</Label><Input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3"><div><Label>Sæson</Label><Input inputMode="numeric" value={draft.season} onChange={e => setDraft({ ...draft, season: e.target.value })} /></div><div><Label>Afsnit</Label><Input inputMode="numeric" value={draft.episode} onChange={e => setDraft({ ...draft, episode: e.target.value })} /></div></div>
      <div><Label>Besked til admin (valgfri)</Label><Textarea value={draft.comment} onChange={e => setDraft({ ...draft, comment: e.target.value })} /></div>
      <Button className="w-full" onClick={submit} disabled={saving || !draft.workId || !draft.broadcasterId || !draft.date}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send indberetning</Button>
    </div></DialogContent></Dialog>

    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{selected?.title}</DialogTitle></DialogHeader>{selected && <MessageThread title="Beskeder med DFKS" messages={(selected.screening_claim_comments ?? []).map((comment: Claim) => ({ id: comment.id, authorRole: comment.author_role, message: comment.message, createdAt: comment.created_at, memberReadAt: comment.member_read_at, adminReadAt: comment.admin_read_at }))} viewerRole="member" memberLabel="Dig" adminLabel="DFKS" composerValue={reply} onComposerChange={setReply} onSend={async () => { if (!reply.trim()) return; await addScreeningClaimComment({ claimId: selected.id, message: reply, authorRole: "member" }); setReply(""); await load(); }} />}</DialogContent></Dialog>
  </div>;
}
