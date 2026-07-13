"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Building2, Plus, Pencil, PowerOff, Power, FileText, Play, Archive } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

interface Org {
    id: string
    name: string
    cvr: string
    contact_name: string
    contact_email: string
    plan: "basis" | "pro" | "enterprise"
    max_users: number
    module_contracts: boolean
    module_streaming: boolean
    module_archive: boolean
    active: boolean
    user_count: number
}

const PLAN_DEFAULTS = {
    basis:      { max_users: 5,  module_contracts: true,  module_streaming: false, module_archive: false },
    pro:        { max_users: 20, module_contracts: true,  module_streaming: true,  module_archive: false },
    enterprise: { max_users: -1, module_contracts: true,  module_streaming: true,  module_archive: true  },
}

const PLAN_LABELS = { basis: "Basis", pro: "Pro", enterprise: "Enterprise" }
const PLAN_COLORS: Record<string, string> = {
    basis:      "bg-slate-100 text-slate-700",
    pro:        "bg-blue-100 text-blue-700",
    enterprise: "bg-violet-100 text-violet-700",
}

type FormState = {
    name: string
    cvr: string
    contact_name: string
    contact_email: string
    plan: "basis" | "pro" | "enterprise"
    max_users: number
    module_contracts: boolean
    module_streaming: boolean
    module_archive: boolean
}

const emptyForm = (): FormState => ({
    name: "", cvr: "", contact_name: "", contact_email: "",
    plan: "basis",
    ...PLAN_DEFAULTS.basis,
})

export function OrganisationerAdmin() {
    const [orgs, setOrgs] = useState<Org[]>([])
    const [search, setSearch] = useState("")
    const [loading, setLoading] = useState(true)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editOrg, setEditOrg] = useState<Org | null>(null)
    const [form, setForm] = useState<FormState>(emptyForm())
    const [cvrLoading, setCvrLoading] = useState(false)
    const [saving, setSaving] = useState(false)

    async function fetchOrgs() {
        setLoading(true)
        const res = await fetch("/api/superadmin/organisations")
        if (res.ok) setOrgs(await res.json())
        setLoading(false)
    }

    useEffect(() => { fetchOrgs() }, [])

    function openCreate() {
        setEditOrg(null)
        setForm(emptyForm())
        setDialogOpen(true)
    }

    function openEdit(org: Org) {
        setEditOrg(org)
        setForm({
            name: org.name,
            cvr: org.cvr,
            contact_name: org.contact_name,
            contact_email: org.contact_email,
            plan: org.plan,
            max_users: org.max_users,
            module_contracts: org.module_contracts,
            module_streaming: org.module_streaming,
            module_archive: org.module_archive,
        })
        setDialogOpen(true)
    }

    function setPlan(plan: "basis" | "pro" | "enterprise") {
        setForm(f => ({ ...f, plan, ...PLAN_DEFAULTS[plan] }))
    }

    async function lookupCvr() {
        if (!/^\d{8}$/.test(form.cvr)) { toast.error("Indtast et 8-cifret CVR-nummer"); return }
        setCvrLoading(true)
        const res = await fetch(`/api/cvr?cvr=${form.cvr}`)
        if (res.ok) {
            const data = await res.json()
            if (data.navn) setForm(f => ({ ...f, name: data.navn }))
            else toast.warning("Navn ikke fundet i CVR-register")
        } else {
            const err = await res.json()
            toast.error(err.error ?? "CVR-opslag fejlede")
        }
        setCvrLoading(false)
    }

    async function handleSave() {
        if (!form.name || !form.cvr || !form.contact_name || !form.contact_email) {
            toast.error("Udfyld alle påkrævede felter")
            return
        }
        setSaving(true)
        const url = editOrg
            ? `/api/superadmin/organisations/${editOrg.id}`
            : "/api/superadmin/organisations"
        const method = editOrg ? "PATCH" : "POST"
        const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
        })
        if (res.ok) {
            toast.success(editOrg ? "Organisation opdateret" : "Organisation oprettet")
            setDialogOpen(false)
            fetchOrgs()
        } else {
            const err = await res.json()
            toast.error(err.error ?? "Noget gik galt")
        }
        setSaving(false)
    }

    async function toggleActive(org: Org) {
        const res = await fetch(`/api/superadmin/organisations/${org.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: !org.active }),
        })
        if (res.ok) {
            toast.success(org.active ? "Organisation deaktiveret" : "Organisation aktiveret")
            fetchOrgs()
        } else {
            toast.error("Kunne ikke ændre status")
        }
    }

    const filtered = orgs.filter(o =>
        o.name.toLowerCase().includes(search.toLowerCase()) ||
        o.cvr.includes(search)
    )

    return (
        <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-4 lg:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Organisationer</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Opret og administrer kunder og deres abonnement</p>
                </div>
                <Button onClick={openCreate} className="w-full sm:w-auto">
                    <Plus className="h-4 w-4 mr-2" />
                    Opret org
                </Button>
            </div>

            <div>
                <Input
                    placeholder="Søg efter navn eller CVR…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full sm:max-w-sm"
                />
            </div>

            {loading ? (
                <p className="text-muted-foreground text-sm">Henter organisationer…</p>
            ) : (
                <>
                <div className="space-y-3 md:hidden">
                    {filtered.map(org => (
                        <div key={org.id} className={`rounded-lg border bg-card p-4 shadow-sm ${org.active ? "" : "opacity-60"}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 className="truncate font-semibold">{org.name}</h2>
                                    <p className="text-sm text-muted-foreground">CVR {org.cvr}</p>
                                </div>
                                <Badge variant={org.active ? "default" : "secondary"} className="shrink-0">
                                    {org.active ? "Aktiv" : "Deaktiveret"}
                                </Badge>
                            </div>
                            <div className="mt-4 grid gap-3 text-sm">
                                <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kontakt</p>
                                    <p className="mt-0.5">{org.contact_name}</p>
                                    <p className="break-all text-muted-foreground">{org.contact_email}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan</p>
                                        <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_COLORS[org.plan]}`}>
                                            {PLAN_LABELS[org.plan]}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Brugere</p>
                                        <p className="mt-1">{org.user_count} / {org.max_users === -1 ? "∞" : org.max_users}</p>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Moduler</p>
                                    <div className="mt-1 flex gap-2">
                                        {org.module_contracts && <FileText className="h-4 w-4 text-blue-500" />}
                                        {org.module_streaming && <Play className="h-4 w-4 text-green-500" />}
                                        {org.module_archive && <Archive className="h-4 w-4 text-violet-500" />}
                                    </div>
                                </div>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-2">
                                <Button size="sm" variant="outline" onClick={() => openEdit(org)}>
                                    <Pencil className="h-3.5 w-3.5 mr-1" />
                                    Rediger
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className={org.active ? "text-destructive hover:text-destructive" : "text-green-600 hover:text-green-600"}
                                    onClick={() => toggleActive(org)}
                                >
                                    {org.active
                                        ? <><PowerOff className="h-3.5 w-3.5 mr-1" />Deaktiver</>
                                        : <><Power className="h-3.5 w-3.5 mr-1" />Aktivér</>
                                    }
                                </Button>
                            </div>
                        </div>
                    ))}
                    {filtered.length === 0 && (
                        <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
                            Ingen organisationer fundet
                        </div>
                    )}
                </div>

                <div className="hidden rounded-lg border overflow-hidden md:block">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 border-b">
                            <tr>
                                <th className="text-left px-4 py-3 font-medium">Navn</th>
                                <th className="text-left px-4 py-3 font-medium">CVR</th>
                                <th className="text-left px-4 py-3 font-medium">Kontakt</th>
                                <th className="text-left px-4 py-3 font-medium">Plan</th>
                                <th className="text-left px-4 py-3 font-medium">Moduler</th>
                                <th className="text-left px-4 py-3 font-medium">Brugere</th>
                                <th className="text-left px-4 py-3 font-medium">Status</th>
                                <th className="text-right px-4 py-3 font-medium">Handling</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {filtered.map(org => (
                                <tr key={org.id} className={org.active ? "" : "opacity-50"}>
                                    <td className="px-4 py-3 font-medium">{org.name}</td>
                                    <td className="px-4 py-3 text-muted-foreground">{org.cvr}</td>
                                    <td className="px-4 py-3">
                                        <div>{org.contact_name}</div>
                                        <div className="text-muted-foreground text-xs">{org.contact_email}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_COLORS[org.plan]}`}>
                                            {PLAN_LABELS[org.plan]}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex gap-1">
                                            {org.module_contracts && <FileText className="h-4 w-4 text-blue-500" />}
                                            {org.module_streaming && <Play className="h-4 w-4 text-green-500" />}
                                            {org.module_archive && <Archive className="h-4 w-4 text-violet-500" />}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        {org.user_count} / {org.max_users === -1 ? "∞" : org.max_users}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge variant={org.active ? "default" : "secondary"}>
                                            {org.active ? "Aktiv" : "Deaktiveret"}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button size="sm" variant="ghost" onClick={() => openEdit(org)}>
                                                <Pencil className="h-3.5 w-3.5 mr-1" />
                                                Rediger
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className={org.active ? "text-destructive hover:text-destructive" : "text-green-600 hover:text-green-600"}
                                                onClick={() => toggleActive(org)}
                                            >
                                                {org.active
                                                    ? <><PowerOff className="h-3.5 w-3.5 mr-1" />Deaktiver</>
                                                    : <><Power className="h-3.5 w-3.5 mr-1" />Aktivér</>
                                                }
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                                        Ingen organisationer fundet
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                </>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editOrg ? "Rediger organisation" : "Opret organisation"}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label>Organisationsnavn *</Label>
                            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                        </div>

                        <div className="space-y-1.5">
                            <Label>CVR-nummer *</Label>
                            <div className="flex gap-2">
                                <Input
                                    value={form.cvr}
                                    onChange={e => setForm(f => ({ ...f, cvr: e.target.value }))}
                                    maxLength={8}
                                    placeholder="8 cifre"
                                />
                                <Button type="button" variant="outline" onClick={lookupCvr} disabled={cvrLoading}>
                                    {cvrLoading ? "Henter…" : "Hent navn →"}
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Kontaktperson *</Label>
                            <Input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
                        </div>

                        <div className="space-y-1.5">
                            <Label>E-mail *</Label>
                            <Input type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} />
                        </div>

                        <div className="border-t pt-4 space-y-3">
                            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Abonnement</p>

                            <div className="space-y-1.5">
                                <Label>Plan *</Label>
                                <div className="space-y-2">
                                    {(["basis", "pro", "enterprise"] as const).map(p => (
                                        <label key={p} className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="radio"
                                                checked={form.plan === p}
                                                onChange={() => setPlan(p)}
                                                className="accent-primary"
                                            />
                                            <span className="font-medium">{PLAN_LABELS[p]}</span>
                                            <span className="text-muted-foreground text-sm">
                                                {p === "enterprise" ? "Ubegrænset brugere" : `${PLAN_DEFAULTS[p].max_users} brugere`}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label>Moduler</Label>
                                <div className="space-y-2">
                                    {([
                                        ["module_contracts", "Kontraktgennemgang"],
                                        ["module_streaming", "Streaming-rettigheder"],
                                        ["module_archive",   "Arkiv"],
                                    ] as const).map(([key, label]) => (
                                        <label key={key} className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={form[key]}
                                                onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                                                className="accent-primary"
                                            />
                                            <span className="text-sm">{label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label>Max brugere</Label>
                                <Input
                                    type="number"
                                    value={form.max_users}
                                    onChange={e => setForm(f => ({ ...f, max_users: parseInt(e.target.value) || 0 }))}
                                    className="w-32"
                                />
                                <p className="text-xs text-muted-foreground">-1 = ubegrænset</p>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuller</Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? "Gemmer…" : editOrg ? "Gem ændringer" : "Opret"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
