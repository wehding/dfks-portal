"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { markInboxThreadRead } from "@/app/actions/member-inbox"

type BeskedRad = {
    workId: string
    requestId: string
    title: string
    year: number | null
    memberName: string | null
    latestMessage: string | null
    unreadCount: number
    latestAt: string | null
}

export function VaerkerBeskederTab({ onCountLoaded }: { onCountLoaded?: (n: number) => void } = {}) {
    const router = useRouter()
    const [rows, setRows] = useState<BeskedRad[]>([])
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        const supabase = createClient()

        const contextRes = await fetch("/api/admin/context", { cache: "no-store" })
        const context = contextRes.ok ? await contextRes.json() as { orgId?: string } : null
        const orgId = context?.orgId
        if (!orgId) { setLoading(false); return }

        const { data, error } = await supabase
            .from("works")
            .select(`
                id, title, year,
                work_assignments(rettighedshavere(full_name)),
                work_change_requests(
                    id,
                    work_change_request_comments(
                        id, author_role, message, created_at, admin_read_at
                    )
                )
            `)
            .eq("org_id", orgId)
            .order("title")

        if (error || !data) { setLoading(false); return }

        const mapped: BeskedRad[] = data
            .map((w: any) => {
                const requests = (w.work_change_requests ?? []).map((request: any) => ({
                    ...request,
                    unread: (request.work_change_request_comments ?? []).filter(
                        (comment: any) => comment.author_role === "member" && !comment.admin_read_at
                    ),
                }))
                const activeRequest = requests
                    .filter((request: any) => request.unread.length > 0)
                    .sort((left: any, right: any) => String(right.unread.at(-1)?.created_at ?? "").localeCompare(String(left.unread.at(-1)?.created_at ?? "")))[0]
                const unread = activeRequest?.unread ?? []
                if (unread.length === 0) return null

                const sorted = [...unread].sort(
                    (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                )
                const memberName = w.work_assignments?.[0]?.rettighedshavere?.full_name ?? null

                return {
                    workId: w.id,
                    requestId: activeRequest.id,
                    title: w.title,
                    year: w.year,
                    memberName,
                    latestMessage: sorted[0]?.message?.split("\n")[0] ?? null,
                    unreadCount: unread.length,
                    latestAt: sorted[0]?.created_at ?? null,
                } satisfies BeskedRad
            })
            .filter(Boolean) as BeskedRad[]

        // Nyeste besked øverst
        mapped.sort((a, b) =>
            new Date(b.latestAt ?? 0).getTime() - new Date(a.latestAt ?? 0).getTime()
        )

        setRows(mapped)
        onCountLoaded?.(mapped.length)
        setLoading(false)
    }, [onCountLoaded])

    useEffect(() => { void load() }, [load])

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
                    {rows.map(r => (
                        <tr
                            key={r.workId}
                            className="hover:bg-muted/30 cursor-pointer transition-colors"
                            onClick={async () => {
                                await markInboxThreadRead(`work-${r.requestId}`)
                                setRows(current => current.filter(row => row.requestId !== r.requestId))
                                onCountLoaded?.(Math.max(0, rows.length - 1))
                                router.push(`/admin/vaerker?id=${r.workId}&request=${r.requestId}`)
                            }}
                        >
                            <td className="px-4 py-3">
                                <div className="font-medium">{r.title}</div>
                                {r.year && <div className="text-xs text-muted-foreground">{r.year}</div>}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                                {r.memberName ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell max-w-xs truncate">
                                {r.latestMessage ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                                {r.latestAt
                                    ? new Date(r.latestAt).toLocaleDateString("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                                    : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={async e => {
                                        e.stopPropagation()
                                        await markInboxThreadRead(`work-${r.requestId}`)
                                        setRows(current => current.filter(row => row.requestId !== r.requestId))
                                        onCountLoaded?.(Math.max(0, rows.length - 1))
                                        router.push(`/admin/vaerker?id=${r.workId}&request=${r.requestId}`)
                                    }}
                                >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                    {r.unreadCount > 1 ? `${r.unreadCount} beskeder` : "Se besked"}
                                </Button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
