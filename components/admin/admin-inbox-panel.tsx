"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { createAdminInboxMessage, fetchAdminInbox, fetchAdminInboxRecipients, markInboxThreadRead, sendInboxReply } from "@/app/actions/member-inbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Recipient = { id: string; full_name: string; email: string | null };
type Message = { id: string; author_role: string; body: string; created_at: string };
type Thread = { id: string; subject: string; updated_at: string; rettighedshavere: { full_name: string } | null; member_messages: Message[] };

/**
 * Medlemsbeskeder for admin — ny besked (enkelt eller fælles) + tråde med svar.
 * Vises som sektion på admin-Overblik.
 */
export function AdminInboxPanel() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    const [inbox, recipientResult] = await Promise.all([fetchAdminInbox(), fetchAdminInboxRecipients()]);
    if (!inbox.success) toast.error(inbox.error); else setThreads((inbox.threads ?? []) as Thread[]);
    if (!recipientResult.success) toast.error(recipientResult.error); else setRecipients((recipientResult.recipients ?? []) as Recipient[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selectedThread) void markInboxThreadRead(selectedThread); }, [selectedThread]);
  const active = useMemo(() => threads.find(thread => thread.id === selectedThread) ?? null, [threads, selectedThread]);

  const requestSend = () => {
    if (!selectedRecipients.length || !subject.trim() || !body.trim()) return toast.error("Vælg modtagere og udfyld beskeden.");
    setConfirmOpen(true);
  };

  const confirmSend = async () => {
    setBusy(true);
    const result = await createAdminInboxMessage({ rightsHolderIds: selectedRecipients, subject, body });
    setBusy(false);
    setConfirmOpen(false);
    if (!result.success) return toast.error(result.error);
    toast.success(`${result.count} beskedtråde oprettet${result.skippedWithoutPortalUser ? ` · ${result.skippedWithoutPortalUser} uden portalbruger blev sprunget over` : ""}`);
    setSelectedRecipients([]); setSubject(""); setBody(""); await load();
  };

  const sendReply = async () => {
    if (!active || !reply.trim()) return;
    setBusy(true); const result = await sendInboxReply(active.id, reply); setBusy(false);
    if (!result.success) return toast.error(result.error);
    setReply(""); await load();
  };

  return <div className="grid gap-6 xl:grid-cols-2">
    <Card><CardHeader><CardTitle>Ny besked</CardTitle></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between"><span className="text-sm font-medium">Modtagere ({selectedRecipients.length})</span><Button type="button" variant="ghost" size="sm" onClick={() => setSelectedRecipients(selectedRecipients.length === recipients.length ? [] : recipients.map(r => r.id))}>{selectedRecipients.length === recipients.length ? "Fravælg alle" : "Vælg alle"}</Button></div><div className="max-h-52 space-y-1 overflow-auto rounded-md border p-2">{recipients.map(recipient => <label key={recipient.id} className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-muted"><input type="checkbox" checked={selectedRecipients.includes(recipient.id)} onChange={() => setSelectedRecipients(current => current.includes(recipient.id) ? current.filter(id => id !== recipient.id) : [...current, recipient.id])} /><span className="text-sm">{recipient.full_name}</span></label>)}</div><div><label htmlFor="message-subject" className="text-sm font-medium">Emne</label><Input id="message-subject" value={subject} onChange={event => setSubject(event.target.value)} maxLength={200} /></div><div><label htmlFor="message-body" className="text-sm font-medium">Besked</label><Textarea id="message-body" value={body} onChange={event => setBody(event.target.value)} maxLength={10000} rows={6} /></div><Button type="button" disabled={busy || !selectedRecipients.length} onClick={requestSend}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send</Button></CardContent></Card>
    <Card><CardHeader><CardTitle>Tråde</CardTitle></CardHeader><CardContent className="space-y-4"><div className="max-h-52 space-y-2 overflow-auto">{threads.length ? threads.map(thread => {
      const categoryLabel = (thread as any).category_label ?? "Generelt";
      const contextTitle = (thread as any).context_title ?? thread.subject;
      const badgeClass =
        categoryLabel === "Kontrakt" ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
        : categoryLabel === "Værk" ? "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
        : categoryLabel === "Visning" ? "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300"
        : "bg-muted text-muted-foreground";

      return (
        <button type="button" key={thread.id} onClick={() => setSelectedThread(thread.id)} className={`w-full rounded-md border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring ${selectedThread === thread.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}>
              {categoryLabel}
            </span>
            <span className="text-xs font-semibold text-foreground truncate">{thread.rettighedshavere?.full_name ?? "Medlem"}</span>
          </div>
          <span className="block text-xs font-medium text-muted-foreground truncate">{contextTitle}</span>
        </button>
      );
    }) : <p className="text-sm text-muted-foreground">Ingen tråde endnu.</p>}</div>{active && <div className="space-y-3 border-t pt-4"><div className="flex items-center gap-2"><span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted">{(active as any).category_label ?? "Generelt"}</span><h3 className="font-semibold text-sm">{(active as any).context_title ?? active.subject}</h3></div><div className="max-h-72 space-y-2 overflow-auto">{[...active.member_messages].sort((a,b) => a.created_at.localeCompare(b.created_at)).map(message => <div key={message.id} className={`rounded-md p-2 text-sm ${message.author_role === "admin" ? "bg-primary/10" : "bg-muted"}`}><p className="whitespace-pre-wrap">{message.body}</p><span className="text-xs text-muted-foreground">{message.author_role === "admin" ? "DFKS" : "Medlem"} · {new Date(message.created_at).toLocaleString("da-DK")}</span></div>)}</div><Textarea aria-label="Svar på besked" value={reply} onChange={event => setReply(event.target.value)} /><Button type="button" onClick={sendReply} disabled={busy || !reply.trim()}>Send svar</Button></div>}</CardContent></Card>

    <Dialog open={confirmOpen} onOpenChange={open => { if (!busy) setConfirmOpen(open); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send besked</DialogTitle>
          <DialogDescription>
            Send beskeden til {selectedRecipients.length === 1 ? "1 modtager" : `${selectedRecipients.length} modtagere`}?
            Hver modtager får sin egen private tråd.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>Annuller</Button>
          <Button onClick={confirmSend} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
