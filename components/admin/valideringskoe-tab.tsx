"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Eye } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

type KøRow = {
    id: string
    displayTitle: string
    displayMember: string
    displayEmployer: string | null
    contract_date: string | null
    created_at: string
    status: string
    validation_id: string | null
}

const statusLabel: Record<string, string> = {
    kladde: "Afventer",
    valideret: "Godkendt",
    arkiveret: "Afvist",
}
const statusClass: Record<string, string> = {
    kladde: "border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
    valideret: "border-emerald-400 text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
    arkiveret: "border-red-400 text-red-700 bg-red-50 dark:bg-red-950 dark:text-red-300",
}

export function ValideringskøTab({ onAfventerCount }: { onAfventerCount?: (n: number) => void } = {}) {
    const router = useRouter()
    const [rows, setRows] = useState<KøRow[]>([])
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<"afventer" | "gennemgaede">("afventer")

    useEffect(() => {
        let cancelled = false
        void (async () => {
            const supabase = createClient()
            const contextRes = await fetch("/api/admin/context", { cache: "no-store" })
            const context = contextRes.ok ? await contextRes.json() as { orgId?: string } : null
            const orgId = context?.orgId
            if (!orgId) { if (!cancelled) setLoading(false); return }

            const { data, error } = await supabase
                .from("contracts")
                .select("id, working_title, pdf_url, contract_date, created_at, status, rettighedshavere(id, full_name), employers(id, name), contract_validations(id)")
                .eq("org_id", orgId)
                .order("created_at", { ascending: false })
            if (cancelled) return
            if (error || !data) { setLoading(false); return }
            setRows(data.map((c: any) => ({
                id: c.id,
                displayTitle: c.working_title || c.pdf_url?.split("/").pop() || "Uden titel",
                displayMember: c.rettighedshavere?.full_name ?? "—",
                displayEmployer: c.employers?.name ?? null,
                contract_date: c.contract_date,
                created_at: c.created_at,
                status: c.status,
                validation_id: c.contract_validations?.[0]?.id ?? null,
            })))
            setLoading(false)
        })()
        return () => { cancelled = true }
    }, [])

    const afventer = rows.filter(r => r.status === "kladde")
    const gennemgaede = rows.filter(r => r.status !== "kladde")

    useEffect(() => { onAfventerCount?.(afventer.length) }, [afventer.length, onAfventerCount])
    const visible = activeTab === "afventer" ? afventer : gennemgaede

    if (loading) return (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Henter valideringskø…
        </div>
    )

    return (
        <div className="space-y-4">
            <div className="flex gap-2 border-b pb-0">
                <button
                    type="button"
                    onClick={() => setActiveTab("afventer")}
                    className={[
                        "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                        activeTab === "afventer"
                            ? "border-foreground text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                >
                    Afventer gennemgang
                    {afventer.length > 0 && (
                        <span className="ml-2 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 px-2 py-0.5 text-xs font-semibold">
                            {afventer.length}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("gennemgaede")}
                    className={[
                        "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                        activeTab === "gennemgaede"
                            ? "border-foreground text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                >
                    Gennemgåede
                </button>
            </div>

            {visible.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                    {activeTab === "afventer" ? "Ingen kontrakter afventer validering." : "Ingen gennemgåede kontrakter endnu."}
                </p>
            ) : (
                <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                            <tr className="border-b">
                                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Titel</th>
                                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">Produktionsselskab</th>
                                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">Rettighedshaver</th>
                                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">Dato</th>
                                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {visible.map(r => (
                                <tr
                                    key={r.id}
                                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                                    onClick={() => router.push(`/admin/kontrakter?contract=${encodeURIComponent(r.id)}`)}
                                >
                                    <td className="px-4 py-3 font-medium">{r.displayTitle}</td>
                                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{r.displayEmployer ?? "—"}</td>
                                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{r.displayMember}</td>
                                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                                        {r.contract_date
                                            ? new Date(r.contract_date).toLocaleDateString("da-DK")
                                            : new Date(r.created_at).toLocaleDateString("da-DK")}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge variant="outline" className={statusClass[r.status] ?? ""}>
                                            {statusLabel[r.status] ?? r.status}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="gap-1"
                                            onClick={e => { e.stopPropagation(); router.push(`/admin/kontrakter?contract=${encodeURIComponent(r.id)}`) }}
                                        >
                                            <Eye className="h-3.5 w-3.5" />
                                            Valider
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
