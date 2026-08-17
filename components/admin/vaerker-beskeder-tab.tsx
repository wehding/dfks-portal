"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, MessageSquare } from "lucide-react"
import { toast } from "sonner"
import { fetchAdminWorkInbox } from "@/app/actions/member-inbox"
import { Button } from "@/components/ui/button"
import type { AdminMessageThread } from "@/lib/admin-message-threads"

export function VaerkerBeskederTab({ onCountLoaded }: { onCountLoaded?: (n: number) => void } = {}) {
    const router = useRouter()
    const [rows, setRows] = useState<AdminMessageThread[]>([])
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        const result = await fetchAdminWorkInbox()
        if (!result.success) {
            toast.error(result.error ?? "Værksbeskederne kunne ikke hentes")
            setRows([])
            onCountLoaded?.(0)
            setLoading(false)
            return
        }
        const threads = result.threads ?? []
        setRows(threads)
        onCountLoaded?.(threads.reduce((sum, thread) => sum + thread.unreadCount, 0))
        setLoading(false)
    }, [onCountLoaded])

    useEffect(() => {
        let cancelled = false
        queueMicrotask(() => { if (!cancelled) void load() })
        return () => { cancelled = true }
    }, [load])
    useEffect(() => {
        const reload = () => void load()
        window.addEventListener("works-updated", reload)
        return () => window.removeEventListener("works-updated", reload)
    }, [load])

    if (loading) return (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Henter beskeder…
        </div>
    )

    if (rows.length === 0) return (
        <p className="py-12 text-center text-sm text-muted-foreground">
            Ingen ulæste beskeder fra medlemmer.
        </p>
    )

    return (
        <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
                <thead className="bg-muted/40">
                    <tr className="border-b">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Værk</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">Medlem</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">Seneste besked</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">Tidspunkt</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground"></th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {rows.map(thread => {
                        const latestMessage = [...thread.member_messages].reverse().find(message => message.author_role === "member")
                        return (
                        <tr
                            key={thread.requestId ?? thread.id}
                            className="hover:bg-muted/30 cursor-pointer transition-colors"
                            onClick={() => thread.action_href && router.push(thread.action_href)}
                        >
                            <td className="px-4 py-3">
                                <div className="font-medium">{thread.context_title.replace(/^Værk:\s*/, "")}</div>
                                {thread.requiresReply && <div className="text-xs text-amber-700">Afventer svar</div>}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                                {thread.rettighedshavere?.full_name ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell max-w-xs truncate">
                                {latestMessage?.body.split("\n")[0] ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                                {new Date(thread.updated_at).toLocaleDateString("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td className="px-4 py-3 text-right">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={e => { e.stopPropagation(); if (thread.action_href) router.push(thread.action_href) }}
                                >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                    {thread.unreadCount > 1 ? `${thread.unreadCount} beskeder` : "Se besked"}
                                </Button>
                            </td>
                        </tr>
                    )})}
                </tbody>
            </table>
        </div>
    )
}
