"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Eye } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import { getContractImportStates } from "@/app/actions/contract-imports"

type KøRow = {
    id: string
    displayTitle: string
    displayMember: string
    displayEmployer: string | null
    contract_date: string | null
    created_at: string
    status: string
    validation_id: string | null
    import_status: string | null
}

// Kontrakt-status (kladde/valideret/arkiveret)
const contractStatusLabel: Record<string, string> = {
    kladde: "Afventer",
    valideret: "Godkendt",
    arkiveret: "Afvist",
}
const contractStatusClass: Record<string, string> = {
    kladde: "border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
    valideret: "border-emerald-400 text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
    arkiveret: "border-red-400 text-red-700 bg-red-50 dark:bg-red-950 dark:text-red-300",
}

// Import-matching-status
const importLabel: Record<string, string> = {
    ready_for_review: "Klar",
    missing_owner: "Mangler ejer",
    missing_work: "Mangler værk",
    awaiting_episode_confirmation: "Afventer afsnit",
    possible_duplicate: "Mulig dublet",
    duplicate: "Dublet",
}
const importClass: Record<string, string> = {
    ready_for_review: "border-emerald-400 text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
    missing_owner: "border-orange-400 text-orange-700 bg-orange-50 dark:bg-orange-950 dark:text-orange-300",
    missing_work: "border-orange-400 text-orange-700 bg-orange-50 dark:bg-orange-950 dark:text-orange-300",
    awaiting_episode_confirmation: "border-blue-400 text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300",
    possible_duplicate: "border-purple-400 text-purple-700 bg-purple-50 dark:bg-purple-950 dark:text-purple-300",
    duplicate: "border-red-400 text-red-700 bg-red-50 dark:bg-red-950 dark:text-red-300",
}

// Sorteringsrækkefølge: klar øverst, derefter de øvrige
const importSortOrder: Record<string, number> = {
    ready_for_review: 0,
    missing_owner: 1,
    missing_work: 2,
    awaiting_episode_confirmation: 3,
    possible_duplicate: 4,
    duplicate: 5,
}

function effectiveImportStatus(row: KøRow): string {
    // Ingen import-række = oprettet uden om importflow → behandl som klar
    return row.import_status ?? "ready_for_review"
}

export function ValideringskøTab({ onAfventerCount }: { onAfventerCount?: (n: number) => void } = {}) {
    const router = useRouter()
    const [rows, setRows] = useState<KøRow[]>([])
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<"afventer" | "gennemgaede">("afventer")
    const [importFilter, setImportFilter] = useState<string>("all")

    const load = useCallback(async () => {
        setLoading(true)
        const supabase = createClient()

        const contextRes = await fetch("/api/admin/context", { cache: "no-store" })
        const context = contextRes.ok ? await contextRes.json() as { orgId?: string } : null
        const orgId = context?.orgId
        if (!orgId) { setLoading(false); return }

        const { data, error } = await supabase
            .from("contracts")
            .select("id, working_title, pdf_url, contract_date, created_at, status, rettighedshavere(id, full_name), employers(id, name), contract_validations(id)")
            .eq("org_id", orgId)
            .order("created_at", { ascending: false })

        if (error || !data) { setLoading(false); return }

        // Hent import-status for alle kontrakter
        const importResult = await getContractImportStates(data.map((c: any) => c.id))
        const importStates = importResult.success ? importResult.states : {}

        const mapped: KøRow[] = data.map((c: any) => ({
            id: c.id,
            displayTitle: c.working_title || c.pdf_url?.split("/").pop() || "Uden titel",
            displayMember: c.rettighedshavere?.full_name ?? "—",
            displayEmployer: c.employers?.name ?? null,
            contract_date: c.contract_date,
            created_at: c.created_at,
            status: c.status,
            validation_id: c.contract_validations?.[0]?.id ?? null,
            import_status: importStates[c.id] ?? null,
        }))
        setRows(mapped)
        setLoading(false)
    }, [onAfventerCount])

    useEffect(() => { void load() }, [load])

    const afventer = rows.filter(r => r.status === "kladde")
    const gennemgaede = rows.filter(r => r.status !== "kladde")

    useEffect(() => { onAfventerCount?.(afventer.length) }, [afventer.length, onAfventerCount])

    // Filtrer og sortér afventer-listen
    const filteredAfventer = afventer
        .filter(r => importFilter === "all" || effectiveImportStatus(r) === importFilter)
        .sort((a, b) => (importSortOrder[effectiveImportStatus(a)] ?? 9) - (importSortOrder[effectiveImportStatus(b)] ?? 9))

    const visible = activeTab === "afventer" ? filteredAfventer : gennemgaede

    if (loading) return (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Henter valideringskø…
        </div>
    )

    return (
        <div className="space-y-4">
            <div className="flex items-end justify-between gap-4 border-b pb-0">
                <div className="flex gap-0">
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

                {activeTab === "afventer" && (
                    <div className="pb-1">
                        <Select value={importFilter} onValueChange={setImportFilter}>
                            <SelectTrigger className="h-8 w-[180px] text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Alle statuser</SelectItem>
                                <SelectItem value="ready_for_review">Klar til gennemgang</SelectItem>
                                <SelectItem value="missing_owner">Mangler ejer</SelectItem>
                                <SelectItem value="missing_work">Mangler værk</SelectItem>
                                <SelectItem value="awaiting_episode_confirmation">Afventer afsnit</SelectItem>
                                <SelectItem value="possible_duplicate">Mulig dublet</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </div>

            {visible.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                    {activeTab === "afventer" ? "Ingen kontrakter matcher det valgte filter." : "Ingen gennemgåede kontrakter endnu."}
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
                                {activeTab === "afventer" && (
                                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">AI-status</th>
                                )}
                                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {visible.map(r => {
                                const imp = effectiveImportStatus(r)
                                return (
                                    <tr
                                        key={r.id}
                                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                                        onClick={() => router.push(`/admin/validering?id=${r.id}`)}
                                    >
                                        <td className="px-4 py-3 font-medium">{r.displayTitle}</td>
                                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{r.displayEmployer ?? "—"}</td>
                                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{r.displayMember}</td>
                                        <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                                            {r.contract_date
                                                ? new Date(r.contract_date).toLocaleDateString("da-DK")
                                                : new Date(r.created_at).toLocaleDateString("da-DK")}
                                        </td>
                                        {activeTab === "afventer" && (
                                            <td className="px-4 py-3">
                                                <Badge variant="outline" className={importClass[imp] ?? ""}>
                                                    {importLabel[imp] ?? imp}
                                                </Badge>
                                            </td>
                                        )}
                                        <td className="px-4 py-3">
                                            <Badge variant="outline" className={contractStatusClass[r.status] ?? ""}>
                                                {contractStatusLabel[r.status] ?? r.status}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="gap-1"
                                                onClick={e => { e.stopPropagation(); router.push(`/admin/validering?id=${r.id}`) }}
                                            >
                                                <Eye className="h-3.5 w-3.5" />
                                                Valider
                                            </Button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
