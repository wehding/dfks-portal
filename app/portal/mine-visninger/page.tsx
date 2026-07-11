"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MessageThread } from "@/components/messages/message-thread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const filteredClaims = useMemo(
    () => claims.filter(claim => typeFilter === "all" || claim.works?.type === typeFilter),
    [claims, typeFilter]
  );

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
    <PageHeader title="Mine visninger" subtitle="Indberet manuelle visninger og følg dialogen med DFKS" actions={<Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Indberet visning</Button>} />
    <div><select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"><option value="all">Type</option>{WORK_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : filteredClaims.length === 0 ? <p className="rounded-lg border p-6 text-sm text-muted-foreground">Ingen manuelle indberetninger endnu.</p> : <div className="grid gap-3">
      {filteredClaims.map(claim => <button key={claim.id} onClick={() => openClaim(claim)} className="flex items-center justify-between rounded-lg border p-4 text-left hover:bg-muted">
        <span><span className="font-medium">{claim.title}</span><span className="mt-1 block text-xs text-muted-foreground">{claim.channel} · {new Date(claim.screening_date).toLocaleDateString("da-DK")}</span></span>
        <Badge variant={claim.status === "rejected" ? "destructive" : claim.status === "approved" ? "default" : "secondary"}>{claim.status === "pending" ? "Afventer" : claim.status === "approved" ? "Godkendt" : "Afvist"}</Badge>
      </button>)}
    </div>}

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>Indberet visning manuelt</DialogTitle></DialogHeader><div className="space-y-3">
      <div><Label>Værk</Label><select className="mt-1 w-full rounded-md border bg-background p-2" value={draft.workId} onChange={e => setDraft({ ...draft, workId: e.target.value })}><option value="">Vælg værk</option>{works.map(work => <option key={work.id} value={work.id}>{work.title}</option>)}</select></div>
      <div><Label>Broadcaster</Label><select className="mt-1 w-full rounded-md border bg-background p-2" value={draft.broadcasterId} onChange={e => setDraft({ ...draft, broadcasterId: e.target.value })}><option value="">Vælg broadcaster</option>{broadcasters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div><Label>Dato</Label><Input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3"><div><Label>Sæson</Label><Input inputMode="numeric" value={draft.season} onChange={e => setDraft({ ...draft, season: e.target.value })} /></div><div><Label>Afsnit</Label><Input inputMode="numeric" value={draft.episode} onChange={e => setDraft({ ...draft, episode: e.target.value })} /></div></div>
      <div><Label>Første besked (valgfri)</Label><Textarea value={draft.comment} onChange={e => setDraft({ ...draft, comment: e.target.value })} /></div>
      <Button className="w-full" onClick={submit} disabled={saving || !draft.workId || !draft.broadcasterId || !draft.date}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send indberetning</Button>
    </div></DialogContent></Dialog>

    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{selected?.title}</DialogTitle></DialogHeader>{selected && <MessageThread title="Beskeder med DFKS" messages={(selected.screening_claim_comments ?? []).map((comment: Claim) => ({ id: comment.id, authorRole: comment.author_role, message: comment.message, createdAt: comment.created_at, memberReadAt: comment.member_read_at, adminReadAt: comment.admin_read_at }))} viewerRole="member" memberLabel="Dig" adminLabel="DFKS" composerValue={reply} onComposerChange={setReply} onSend={async () => { if (!reply.trim()) return; await addScreeningClaimComment({ claimId: selected.id, message: reply, authorRole: "member" }); setReply(""); await load(); }} />}</DialogContent></Dialog>
  </div>;
}
