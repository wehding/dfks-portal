"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { fetchMemberInbox, markInboxThreadRead, sendInboxReply } from "@/app/actions/member-inbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Message = { id: string; author_role: string; body: string; created_at: string };
type Thread = { id: string; subject: string; updated_at: string; member_messages: Message[]; member_message_participants: Array<{ last_read_at: string | null }> };

export default function MemberInboxPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Henter beskeder…</div>}><MemberInboxContent /></Suspense>;
}

function MemberInboxContent() {
  const params = useSearchParams();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchMemberInbox();
    if (!result.success) toast.error(result.error);
    const next = (result.threads ?? []) as Thread[];
    setThreads(next);
    const requested = params.get("thread");
    setSelectedId(current => requested && next.some(thread => thread.id === requested) ? requested : current ?? next[0]?.id ?? null);
    setLoading(false);
  }, [params]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (selectedId) void markInboxThreadRead(selectedId);
  }, [selectedId]);

  const selected = useMemo(() => threads.find(thread => thread.id === selectedId) ?? null, [threads, selectedId]);
  const submitReply = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    const result = await sendInboxReply(selected.id, reply);
    setSending(false);
    if (!result.success) return toast.error(result.error);
    setReply("");
    await load();
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Henter beskeder…</div>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div><h1 className="text-2xl font-bold">Beskeder</h1><p className="text-muted-foreground">Direkte beskeder mellem dig og DFKS.</p></div>
      {threads.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground"><MessageSquare className="h-8 w-8" /><p>Du har ingen beskeder endnu.</p></CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <nav aria-label="Beskedtråde" className="space-y-2">
            {threads.map(thread => <button type="button" key={thread.id} onClick={() => setSelectedId(thread.id)} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === thread.id ? "border-primary bg-primary/5" : "bg-card hover:bg-muted"}`}><span className="block font-medium">{thread.subject}</span><span className="text-xs text-muted-foreground">{new Date(thread.updated_at).toLocaleString("da-DK")}</span></button>)}
          </nav>
          {selected && <Card><CardHeader><CardTitle>{selected.subject}</CardTitle></CardHeader><CardContent className="space-y-5"><div className="space-y-3">{[...selected.member_messages].sort((a,b) => a.created_at.localeCompare(b.created_at)).map(message => <div key={message.id} className={`max-w-[85%] rounded-lg p-3 ${message.author_role === "member" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}><p className="whitespace-pre-wrap text-sm">{message.body}</p><p className="mt-1 text-[11px] opacity-70">{message.author_role === "member" ? "Dig" : "DFKS"} · {new Date(message.created_at).toLocaleString("da-DK")}</p></div>)}</div><div className="space-y-2"><label htmlFor="member-reply" className="text-sm font-medium">Svar</label><Textarea id="member-reply" value={reply} onChange={event => setReply(event.target.value)} maxLength={10000} /><Button type="button" onClick={submitReply} disabled={sending || !reply.trim()}>{sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send svar</Button></div></CardContent></Card>}
        </div>
      )}
    </div>
  );
}
