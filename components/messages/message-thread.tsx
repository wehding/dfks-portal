"use client"

import type { ReactNode } from "react"
import { Loader2, MessageSquare, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { useI18n } from "@/lib/i18n"

export type MessageThreadRole = "member" | "admin"

export type MessageThreadMessage = {
  id: string
  authorRole: MessageThreadRole
  message: string
  createdAt: string
  memberReadAt?: string | null
  adminReadAt?: string | null
}

type MessageThreadProps = {
  title?: string
  messages: MessageThreadMessage[]
  viewerRole: MessageThreadRole
  memberLabel?: string
  adminLabel?: string
  emptyText?: string
  nextActionLabel?: string | null
  nextActionTone?: "neutral" | "attention" | "done"
  composerValue?: string
  composerPlaceholder?: string
  composerDisabled?: boolean
  composerLoading?: boolean
  sendLabel?: string
  onComposerChange?: (value: string) => void
  onSend?: () => void
  footer?: ReactNode
  onDeleteMessage?: (messageId: string) => Promise<void> | void
  onClearThread?: () => Promise<void> | void
}

function roleLabel(role: MessageThreadRole, memberLabel: string, adminLabel: string) {
  return role === "admin" ? adminLabel : memberLabel
}

function unreadForViewer(message: MessageThreadMessage, viewerRole: MessageThreadRole) {
  if (viewerRole === "admin") return message.authorRole === "member" && !message.adminReadAt
  return message.authorRole === "admin" && !message.memberReadAt
}

function nextActionClass(tone: MessageThreadProps["nextActionTone"]) {
  if (tone === "done") return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100"
  if (tone === "attention") return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
  return "border-border bg-muted/40 text-foreground"
}

export function MessageStatusBadge({
  count,
  label,
  tone = "neutral",
}: {
  count?: number
  label: string
  tone?: "neutral" | "attention" | "done"
}) {
  const { t } = useI18n()
  const messageText = count === 1 ? t("messages.oneMessage") : t("messages.multipleMessages")
  return (
    <Badge
      variant={tone === "attention" ? "default" : "secondary"}
      className={tone === "attention" ? "bg-blue-600 text-white hover:bg-blue-600" : ""}
    >
      {count && count > 0 ? `${count} ${messageText}` : label}
    </Badge>
  )
}

export function MessageThread({
  title = "Beskeder",
  messages,
  viewerRole,
  memberLabel = "Medlem",
  adminLabel = "DFKS",
  emptyText = "Ingen beskeder endnu.",
  nextActionLabel,
  nextActionTone = "neutral",
  composerValue,
  composerPlaceholder = "Skriv en besked...",
  composerDisabled,
  composerLoading,
  sendLabel = "Send",
  onComposerChange,
  onSend,
  footer,
  onDeleteMessage,
  onClearThread,
}: MessageThreadProps) {
  const { t } = useI18n()
  const resolvedTitle = title === "Beskeder" ? t("messages.title") : title
  const resolvedMemberLabel = memberLabel === "Medlem" ? t("messages.member") : memberLabel
  const resolvedEmptyText = emptyText === "Ingen beskeder endnu." ? t("messages.empty") : emptyText
  const resolvedComposerPlaceholder = composerPlaceholder === "Skriv en besked..." ? t("messages.placeholder") : composerPlaceholder
  const resolvedSendLabel = sendLabel === "Send" ? t("messages.send") : sendLabel
  const sorted = [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const unreadCount = sorted.filter(message => unreadForViewer(message, viewerRole)).length
  const canCompose = Boolean(onComposerChange && onSend)

  return (
    <section className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">{resolvedTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && <MessageStatusBadge count={unreadCount} label={t("messages.unread")} tone="attention" />}
          {nextActionLabel && <MessageStatusBadge label={nextActionLabel} tone={nextActionTone} />}
          {viewerRole === "admin" && onClearThread && messages.length > 0 && (
            <button type="button" className="text-xs text-destructive hover:underline" onClick={() => { if (window.confirm(t("messages.clearThreadConfirm"))) void onClearThread(); }}>{t("messages.clearThread")}</button>
          )}
        </div>
      </div>

      {nextActionLabel && (
        <div className={`mx-3 mt-3 rounded-md border px-3 py-2 text-sm ${nextActionClass(nextActionTone)}`}>
          {nextActionLabel}
        </div>
      )}

      <div className="max-h-72 space-y-2 overflow-y-auto p-3">
        {sorted.length === 0 ? (
          <p className="rounded-md bg-muted/40 px-3 py-3 text-sm text-muted-foreground">{resolvedEmptyText}</p>
        ) : (
          sorted.map(message => {
            const own = message.authorRole === viewerRole
            const unread = unreadForViewer(message, viewerRole)
            return (
              <article
                key={message.id}
                className={`max-w-[92%] rounded-lg border px-3 py-2 text-sm ${
                  own ? "ml-auto bg-primary text-primary-foreground" : "bg-muted/50"
                } ${unread ? "border-blue-500 shadow-sm" : "border-transparent"}`}
              >
                <div className={`mb-1 flex flex-wrap items-center gap-2 text-xs ${own ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                  <span className="font-medium">{own ? t("messages.you") : roleLabel(message.authorRole, resolvedMemberLabel, adminLabel)}</span>
                  <span>{new Date(message.createdAt).toLocaleString("da-DK")}</span>
                  {unread && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] text-white">{t("common.new")}</span>}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <p className="whitespace-pre-wrap leading-relaxed">{message.message}</p>
                  {viewerRole === "admin" && onDeleteMessage && (
                    <button type="button" className={`shrink-0 text-xs hover:underline ${own ? "text-primary-foreground/80" : "text-destructive"}`} onClick={() => { if (window.confirm(t("messages.deleteMessageConfirm"))) void onDeleteMessage(message.id); }}>{t("common.delete")}</button>
                  )}
                </div>
              </article>
            )
          })
        )}
      </div>

      {(canCompose || footer) && (
        <div className="space-y-2 border-t p-3">
          {canCompose && (
            <>
              <Textarea
                value={composerValue ?? ""}
                onChange={event => onComposerChange?.(event.target.value)}
                placeholder={resolvedComposerPlaceholder}
                className="min-h-20"
              />
              <Button type="button" onClick={onSend} disabled={composerDisabled || composerLoading || !(composerValue ?? "").trim()} className="w-full sm:w-auto">
                {composerLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {resolvedSendLabel}
              </Button>
            </>
          )}
          {footer}
        </div>
      )}
    </section>
  )
}
