"use client"

import { useEffect, useState, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { PageHeader } from "@/components/page-header"
import { MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Search, ChevronRight, Building2, FileText, Users2,
    ExternalLink, Loader2, X,
} from "lucide-react"

type Employer = {
    id: string
    name: string
    parent_id: string | null
    dfi_company_id: number | null
    parent_name: string | null
    contract_count: number
    latest_contract: string | null
    klippere: string[]
    contracts: ContractRow[]
}

type ContractRow = {
    id: string
    working_title: string | null
    type: string
    overenskomst: string | null
    status: string
    contract_date: string | null
    created_at: string
    rights_holder_name: string | null
}

type ContractQueryRow = {
    id: string
    working_title: string | null
    type: string
    overenskomst: string | null
    status: string
    contract_date: string | null
    created_at: string
    employer_id: string | null
    rettighedshavere?: { full_name: string | null } | { full_name: string | null }[] | null
}

const STATUS_CFG: Record<string, { label: string; class: string }> = {
    kladde:    { label: "Kladde",     class: "bg-amber-100 text-amber-700 dark:bg-amber-950/40" },
    valideret: { label: "Valideret",  class: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40" },
    arkiveret: { label: "Arkiveret",  class: "bg-muted text-muted-foreground" },
}

const OVERENSKOMST_LABELS: Record<string, string> = {
    "de4-fiktion":   "De4 fiktion",
    "faf":           "FAF fiktion",
    "faf-dokumentar":"FAF dok.",
    "ingen":         "Ingen",
}

export default function ProducenterPage() {
    const [employers, setEmployers] = useState<Employer[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    useEffect(() => { setSearch(new URLSearchParams(window.location.search).get("search") ?? "") }, [])
    const [expanded, setExpanded] = useState<string | null>(null)

    useEffect(() => {
        const load = async () => {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { setLoading(false); return }
            const { data: roleRow } = await supabase
                .from("user_org_roles")
                .select("org_id")
                .eq("user_id", user.id)
                .limit(1)
                .maybeSingle()
            const orgId = roleRow?.org_id
            if (!orgId) { setLoading(false); return }

            // Hent alle producenter med kontrakter
            const { data: emps } = await supabase
                .from("employers")
                .select("id, name, parent_id, dfi_company_id")
                .order("name")

            if (!emps?.length) { setLoading(false); return }

            // Hent alle kontrakter for denne org med producent + klipper info
            const { data: contracts } = await supabase
                .from("contracts")
                .select(`
                    id, working_title, type, overenskomst, status,
                    contract_date, created_at, employer_id,
                    rettighedshavere(full_name)
                `)
                .eq("org_id", orgId)
                .order("created_at", { ascending: false })

            // Byg et map: employer_id → contracts
            const contractMap: Record<string, ContractRow[]> = {}
            for (const c of (contracts ?? []) as ContractQueryRow[]) {
                const eid = c.employer_id
                if (!eid) continue
                if (!contractMap[eid]) contractMap[eid] = []
                contractMap[eid].push({
                    id: c.id,
                    working_title: c.working_title,
                    type: c.type,
                    overenskomst: c.overenskomst,
                    status: c.status,
                    contract_date: c.contract_date,
                    created_at: c.created_at,
                    rights_holder_name: Array.isArray(c.rettighedshavere)
                        ? c.rettighedshavere[0]?.full_name ?? null
                        : c.rettighedshavere?.full_name ?? null,
                })
            }

            // Byg parent-name map
            const parentMap: Record<string, string> = {}
            for (const e of emps) parentMap[e.id] = e.name

            // Saml employer-objekter
            const mapped: Employer[] = emps.map(e => {
                const cs = contractMap[e.id] ?? []
                const klippere = [...new Set(cs.map(c => c.rights_holder_name).filter(Boolean) as string[])]
                const latest = cs.length > 0 ? cs[0].contract_date ?? cs[0].created_at : null
                return {
                    ...e,
                    parent_name: e.parent_id ? (parentMap[e.parent_id] ?? null) : null,
                    contract_count: cs.length,
                    latest_contract: latest,
                    klippere,
                    contracts: cs,
                }
            })

            // Sorter: flest kontrakter øverst, derefter navn
            mapped.sort((a, b) => b.contract_count - a.contract_count || a.name.localeCompare(b.name, "da"))
            setEmployers(mapped)
            setLoading(false)
        }
        load()
    }, [])

    const visible = useMemo(() => {
        if (!search.trim()) return employers
        const q = search.toLowerCase()
        return employers.filter(e =>
            e.name.toLowerCase().includes(q) ||
            e.parent_name?.toLowerCase().includes(q) ||
            e.klippere.some(k => k.toLowerCase().includes(q))
        )
    }, [employers, search])

    const withContracts = employers.filter(e => e.contract_count > 0).length
    const totalContracts = employers.reduce((sum, e) => sum + e.contract_count, 0)

    return (
        <div className="space-y-6">
            <PageHeader
                title="Producenter"
                subtitle="Produktionsselskaber med kontrakter i systemet"
            />

            {/* Stats */}
            {!loading && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {[
                        { label: "Producenter i alt",        value: employers.length },
                        { label: "Med kontrakter",           value: withContracts },
                        { label: "Kontrakter total",         value: totalContracts },
                    ].map(s => (
                        <div key={s.label} className="rounded-lg border px-4 py-3 space-y-0.5">
                            <p className="text-xs text-muted-foreground">{s.label}</p>
                            <p className="text-2xl font-bold tabular-nums">{s.value}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Søg */}
            <div className="relative w-full sm:max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Søg producent, moderselskab, klipper..."
                    className="pl-8"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                {search && (
                    <button className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}>
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* Tabel */}
            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <>
                <MobileCardList>
                    {visible.length === 0 ? (
                        <MobileDataCard>
                            <p className="py-6 text-center text-sm text-muted-foreground">Ingen producenter fundet</p>
                        </MobileDataCard>
                    ) : visible.map(emp => (
                        <MobileDataCard key={emp.id}>
                            <button
                                type="button"
                                className="flex w-full items-start justify-between gap-3 text-left"
                                onClick={() => setExpanded(expanded === emp.id ? null : emp.id)}
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        <p className="truncate font-medium">{emp.name}</p>
                                    </div>
                                    <p className="mt-1 truncate text-sm text-muted-foreground">{emp.parent_name ?? "Intet moderselskab"}</p>
                                </div>
                                <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded === emp.id ? "rotate-90" : ""}`} />
                            </button>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <MobileMetaRow label="Kontrakter">{emp.contract_count}</MobileMetaRow>
                                <MobileMetaRow label="Seneste">
                                    {emp.latest_contract ? new Date(emp.latest_contract).toLocaleDateString("da-DK") : "—"}
                                </MobileMetaRow>
                            </div>
                            {emp.klippere.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1">
                                    {emp.klippere.slice(0, 4).map(k => (
                                        <Badge key={k} variant="secondary" className="text-[10px] font-normal">
                                            {k}
                                        </Badge>
                                    ))}
                                    {emp.klippere.length > 4 && <span className="text-xs text-muted-foreground">+{emp.klippere.length - 4}</span>}
                                </div>
                            )}
                            {expanded === emp.id && (
                                <div className="mt-4 space-y-2 border-t pt-3">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kontrakthistorik</p>
                                    {emp.contracts.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">Ingen kontrakter registreret</p>
                                    ) : emp.contracts.map(c => {
                                        const s = STATUS_CFG[c.status] ?? STATUS_CFG.kladde
                                        return (
                                            <div key={c.id} className="rounded-md border bg-muted/20 p-3">
                                                <p className="font-medium">{c.working_title ?? "—"}</p>
                                                <p className="mt-1 text-sm text-muted-foreground">{c.rights_holder_name ?? "—"} · {c.type === "a-løn" ? "A-løn" : "Leverandør"}</p>
                                                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                                    <span>{c.contract_date ? new Date(c.contract_date).toLocaleDateString("da-DK") : new Date(c.created_at).toLocaleDateString("da-DK")}</span>
                                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${s.class}`}>{s.label}</span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </MobileDataCard>
                    ))}
                </MobileCardList>

                <ResponsiveTableFrame>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-8" />
                                <TableHead>Producent</TableHead>
                                <TableHead>Moderselskab</TableHead>
                                <TableHead>Klippere</TableHead>
                                <TableHead>Kontrakter</TableHead>
                                <TableHead>Seneste</TableHead>
                                <TableHead className="w-8" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visible.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                                        Ingen producenter fundet
                                    </TableCell>
                                </TableRow>
                            ) : visible.map(emp => (
                                <>
                                    <TableRow
                                        key={emp.id}
                                        className="cursor-pointer hover:bg-muted/40"
                                        onClick={() => setExpanded(expanded === emp.id ? null : emp.id)}
                                    >
                                        <TableCell>
                                            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded === emp.id ? "rotate-90" : ""}`} />
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                <span className="font-medium">{emp.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {emp.parent_name ?? "—"}
                                        </TableCell>
                                        <TableCell>
                                            {emp.klippere.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {emp.klippere.slice(0, 2).map(k => (
                                                        <Badge key={k} variant="secondary" className="text-[10px] font-normal px-1.5 py-0">
                                                            {k}
                                                        </Badge>
                                                    ))}
                                                    {emp.klippere.length > 2 && (
                                                        <span className="text-xs text-muted-foreground">+{emp.klippere.length - 2}</span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-sm text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1.5">
                                                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                                <span className="tabular-nums font-medium">{emp.contract_count}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground tabular-nums">
                                            {emp.latest_contract
                                                ? new Date(emp.latest_contract).toLocaleDateString("da-DK")
                                                : "—"}
                                        </TableCell>
                                        <TableCell>
                                            {emp.dfi_company_id && (
                                                <a
                                                    href={`https://www.dfi.dk/viden-om-film/filmografier/produktionsselskab/${emp.dfi_company_id}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    onClick={e => e.stopPropagation()}
                                                    title="Se i DFI"
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                                                </a>
                                            )}
                                        </TableCell>
                                    </TableRow>

                                    {/* Expanded: kontrakthistorik */}
                                    {expanded === emp.id && (
                                        <TableRow key={`${emp.id}-expanded`}>
                                            <TableCell colSpan={7} className="p-0 bg-muted/20">
                                                {emp.contracts.length === 0 ? (
                                                    <p className="px-8 py-4 text-sm text-muted-foreground">Ingen kontrakter registreret</p>
                                                ) : (
                                                    <div className="px-8 py-3 space-y-1">
                                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Kontrakthistorik</p>
                                                        <div className="rounded-md border bg-background overflow-hidden">
                                                            <Table>
                                                                <TableHeader>
                                                                    <TableRow className="bg-muted/30">
                                                                        <TableHead className="text-xs">Produktion</TableHead>
                                                                        <TableHead className="text-xs">Klipper</TableHead>
                                                                        <TableHead className="text-xs">Type</TableHead>
                                                                        <TableHead className="text-xs">Overenskomst</TableHead>
                                                                        <TableHead className="text-xs">Dato</TableHead>
                                                                        <TableHead className="text-xs">Status</TableHead>
                                                                    </TableRow>
                                                                </TableHeader>
                                                                <TableBody>
                                                                    {emp.contracts.map(c => {
                                                                        const s = STATUS_CFG[c.status] ?? STATUS_CFG.kladde
                                                                        return (
                                                                            <TableRow key={c.id}>
                                                                                <TableCell className="text-sm font-medium">
                                                                                    {c.working_title ?? <span className="text-muted-foreground">—</span>}
                                                                                </TableCell>
                                                                                <TableCell className="text-sm text-muted-foreground">
                                                                                    {c.rights_holder_name ?? "—"}
                                                                                </TableCell>
                                                                                <TableCell className="text-sm text-muted-foreground">
                                                                                    {c.type === "a-løn" ? "A-løn" : "Leverandør"}
                                                                                </TableCell>
                                                                                <TableCell className="text-sm text-muted-foreground">
                                                                                    {c.overenskomst ? (OVERENSKOMST_LABELS[c.overenskomst] ?? c.overenskomst) : "—"}
                                                                                </TableCell>
                                                                                <TableCell className="text-sm text-muted-foreground tabular-nums">
                                                                                    {c.contract_date
                                                                                        ? new Date(c.contract_date).toLocaleDateString("da-DK")
                                                                                        : new Date(c.created_at).toLocaleDateString("da-DK")}
                                                                                </TableCell>
                                                                                <TableCell>
                                                                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${s.class}`}>
                                                                                        {s.label}
                                                                                    </span>
                                                                                </TableCell>
                                                                            </TableRow>
                                                                        )
                                                                    })}
                                                                </TableBody>
                                                            </Table>
                                                        </div>
                                                        <Separator className="mt-2" />
                                                        <div className="flex items-center gap-4 py-1 text-xs text-muted-foreground">
                                                            <span className="flex items-center gap-1"><Users2 className="h-3 w-3" />{emp.klippere.length} klipper{emp.klippere.length !== 1 ? "e" : ""}</span>
                                                            <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{emp.contracts.length} kontrakt{emp.contracts.length !== 1 ? "er" : ""}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </>
                            ))}
                        </TableBody>
                    </Table>
                </ResponsiveTableFrame>
                </>
            )}
        </div>
    )
}
