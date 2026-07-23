"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { fetchMemberInbox, markInboxThreadRead, sendInboxReply } from "@/app/actions/member-inbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";

type Message = { id: string; author_role: string; body: string; created_at: string };
type Thread = { id: string; subject: string; updated_at: string; member_messages: Message[]; member_message_participants: Array<{ last_read_at: string | null }> };

/**
 * Beskeder fra admin og fællesbeskeder — vises som sektion på Overblik.
 * Understøtter deep-link via ?thread=<id> (bruges af mails og gamle links).
 */
export function MemberInboxPanel() {
  const { t } = useI18n();
  return <Suspense fallback={<p className="text-sm text-muted-foreground">{t("inbox.loading")}</p>}><MemberInboxContent /></Suspense>;
}

function MemberInboxContent() {
  const { t, locale } = useI18n();
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

  if (loading) return <p className="text-sm text-muted-foreground">{t("inbox.loading")}</p>;

  if (threads.length === 0) {
    return <Card><CardContent className="flex items-center gap-3 py-6 text-muted-foreground"><MessageSquare className="h-5 w-5" /><p className="text-sm">{t("inbox.empty")}</p></CardContent></Card>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <nav aria-label={t("inbox.threads")} className="space-y-2">
        {threads.map(thread => {
          const categoryLabel = (thread as any).category_label ?? "Generelt";
          const categoryText = categoryLabel === "Kontrakt" ? t("inbox.category.contract") : categoryLabel === "Værk" ? t("inbox.category.work") : categoryLabel === "Visning" ? t("inbox.category.screening") : t("inbox.category.general");
          const contextTitle = (thread as any).context_title ?? thread.subject;
          const badgeClass =
            categoryLabel === "Kontrakt" ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
            : categoryLabel === "Værk" ? "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
            : categoryLabel === "Visning" ? "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300"
            : "bg-muted text-muted-foreground";

          return (
            <button
              type="button"
              key={thread.id}
              onClick={() => setSelectedId(thread.id)}
              className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selectedId === thread.id ? "border-primary bg-primary/5" : "bg-card hover:bg-muted"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}>
                  {categoryText}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(thread.updated_at).toLocaleDateString(locale === "da" ? "da-DK" : "en-GB")}
                </span>
              </div>
              <span className="block font-medium text-xs text-foreground truncate">{contextTitle}</span>
            </button>
          );
        })}
      </nav>
      {selected && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                ((selected as any).category_label) === "Kontrakt" ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                : ((selected as any).category_label) === "Værk" ? "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                : ((selected as any).category_label) === "Visning" ? "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300"
                : "bg-muted text-muted-foreground"
              }`}>
                {((selected as any).category_label) === "Kontrakt" ? t("inbox.category.contract") : ((selected as any).category_label) === "Værk" ? t("inbox.category.work") : ((selected as any).category_label) === "Visning" ? t("inbox.category.screening") : t("inbox.category.general")}
              </span>
              <CardTitle className="text-base font-semibold">{(selected as any).context_title ?? selected.subject}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              {[...selected.member_messages].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(message => (
                <div
                  key={message.id}
                  className={`max-w-[85%] rounded-lg p-3 ${
                    message.author_role === "member" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                  <p className="mt-1 text-[11px] opacity-70">
                    {message.author_role === "member" ? t("inbox.you") : "DFKS"} · {new Date(message.created_at).toLocaleString(locale === "da" ? "da-DK" : "en-GB")}
                  </p>
                </div>
              ))}
            </div>
            <div className="space-y-2 pt-2 border-t">
              <label htmlFor="member-reply" className="text-xs font-medium text-muted-foreground">{t("inbox.writeReply")}</label>
              <Textarea id="member-reply" value={reply} onChange={event => setReply(event.target.value)} maxLength={10000} className="min-h-[80px]" />
              <Button type="button" size="sm" onClick={submitReply} disabled={sending || !reply.trim()}>
                {sending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
                {t("inbox.sendReply")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
