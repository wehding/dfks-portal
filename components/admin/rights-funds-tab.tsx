"use client"

import { useState, useEffect } from "react"
import { Plus, Pencil, PowerOff, Power } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import { createRightsFund, getRightsFunds, updateRightsFund } from "@/app/actions/rights-funds"
import type { RightsFund } from "@/app/actions/rights-funds"

const EXPLOITATION_LABELS: Record<string, string> = {
    primary: "Primær",
    secondary: "Sekundær",
}

const METHOD_LABELS: Record<string, string> = {
    pool_weighted: "Pulje / point / vægte",
    individual_work: "Individuelt beløb pr. værk",
    royalty_percentage: "Royalty-procent",
}

type FundForm = {
    code: string
    name: string
    rights_category: string
    exploitation_type: "primary" | "secondary"
    calculation_method: "pool_weighted" | "individual_work" | "royalty_percentage"
    currency: string
    notes: string
}

const EMPTY_FORM: FundForm = {
    code: "",
    name: "",
    rights_category: "",
    exploitation_type: "secondary",
    calculation_method: "pool_weighted",
    currency: "DKK",
    notes: "",
}

export function RightsFundsTab() {
    const [funds, setFunds] = useState<RightsFund[]>([])
    const [loading, setLoading] = useState(true)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editing, setEditing] = useState<RightsFund | null>(null)
    const [form, setForm] = useState<FundForm>(EMPTY_FORM)
    const [saving, setSaving] = useState(false)

    const load = async () => {
        const res = await getRightsFunds()
        if (res.success) setFunds(res.funds)
        else toast.error("Kunne ikke hente rettighedskasser")
        setLoading(false)
    }

    useEffect(() => { load() }, [])

    const openCreate = () => {
        setEditing(null)
        setForm(EMPTY_FORM)
        setDialogOpen(true)
    }

    const openEdit = (fund: RightsFund) => {
        setEditing(fund)
        setForm({
            code: fund.code,
            name: fund.name,
            rights_category: fund.rights_category,
            exploitation_type: fund.exploitation_type,
            calculation_method: fund.calculation_method,
            currency: fund.currency,
            notes: fund.notes ?? "",
        })
        setDialogOpen(true)
    }

    const handleSave = async () => {
        if (!form.code.trim() || !form.name.trim() || !form.rights_category.trim()) {
            toast.error("Kode, navn og rettighedskategori er påkrævet")
            return
        }
        setSaving(true)
        try {
            if (editing) {
                const res = await updateRightsFund(editing.id, {
                    name: form.name,
                    rights_category: form.rights_category,
                    notes: form.notes || null,
                })
                if (!res.success) {
                    toast.error(`Kunne ikke gemme: ${res.error ?? "Ukendt fejl"}`)
                    return
                }
                toast.success("Rettighedskasse opdateret")
            } else {
                const res = await createRightsFund({
                    code: form.code.toLowerCase().replace(/\s+/g, "_"),
                    name: form.name,
                    rights_category: form.rights_category,
                    exploitation_type: form.exploitation_type,
                    calculation_method: form.calculation_method,
                    currency: form.currency,
                    allowed_roles: [],
                    allowed_groups: [],
                    notes: form.notes || undefined,
                })
                if (!res.success) {
                    toast.error(`Kunne ikke gemme: ${res.error ?? "Ukendt fejl"}`)
                    return
                }
                toast.success("Rettighedskasse oprettet")
            }
            setDialogOpen(false)
            load()
        } catch (err) {
            toast.error(`Kunne ikke gemme: ${err instanceof Error ? err.message : "Ukendt fejl"}`)
        } finally {
            setSaving(false)
        }
    }

    const toggleActive = async (fund: RightsFund) => {
        const res = await updateRightsFund(fund.id, { active: !fund.active })
        if (res.success) {
            toast.success(fund.active ? "Kasse deaktiveret" : "Kasse aktiveret")
            load()
        } else {
            toast.error("Kunne ikke opdatere status")
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    Rettighedskasser definerer hvilke typer rettigheder organisationen administrerer —
                    Copydan, SVOD, royalty osv. Hver kasse har sin egen fordelingspolitik.
                </p>
                <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-1" />
                    Opret kasse
                </Button>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground py-4">Henter kasser…</p>
            ) : funds.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                    Ingen rettighedskasser oprettet endnu.
                </p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Kode</TableHead>
                            <TableHead>Navn</TableHead>
                            <TableHead>Kategori</TableHead>
                            <TableHead>Udnyttelse</TableHead>
                            <TableHead>Beregningsmetode</TableHead>
                            <TableHead>Valuta</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {funds.map(fund => (
                            <TableRow key={fund.id} className={fund.active ? "" : "opacity-50"}>
                                <TableCell className="font-mono text-xs">{fund.code}</TableCell>
                                <TableCell className="font-medium">{fund.name}</TableCell>
                                <TableCell>{fund.rights_category}</TableCell>
                                <TableCell>{EXPLOITATION_LABELS[fund.exploitation_type] ?? fund.exploitation_type}</TableCell>
                                <TableCell>{METHOD_LABELS[fund.calculation_method] ?? fund.calculation_method}</TableCell>
                                <TableCell>{fund.currency}</TableCell>
                                <TableCell>
                                    <Badge variant={fund.active ? "default" : "outline"}>
                                        {fund.active ? "Aktiv" : "Inaktiv"}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right space-x-1">
                                    <Button variant="ghost" size="sm" onClick={() => openEdit(fund)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => toggleActive(fund)}>
                                        {fund.active
                                            ? <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />
                                            : <Power className="h-3.5 w-3.5" />
                                        }
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {editing ? "Rediger rettighedskasse" : "Opret rettighedskasse"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {!editing && (
                            <div className="space-y-1">
                                <Label>Kode <span className="text-muted-foreground text-xs">(kan ikke ændres)</span></Label>
                                <Input
                                    placeholder="fx copydan_verdenstv"
                                    value={form.code}
                                    onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Bruges i kode og eksport. Kun bogstaver, tal og underscore.
                                </p>
                            </div>
                        )}
                        <div className="space-y-1">
                            <Label>Navn</Label>
                            <Input
                                placeholder="fx Copydan Verdens TV"
                                value={form.name}
                                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Rettighedskategori</Label>
                            <Input
                                placeholder="fx secondary_broadcasting"
                                value={form.rights_category}
                                onChange={e => setForm(f => ({ ...f, rights_category: e.target.value }))}
                            />
                        </div>
                        {!editing && (
                            <>
                                <div className="space-y-1">
                                    <Label>Udnyttelsestype</Label>
                                    <Select
                                        value={form.exploitation_type}
                                        onValueChange={v => setForm(f => ({ ...f, exploitation_type: v as typeof f.exploitation_type }))}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="secondary">Sekundær</SelectItem>
                                            <SelectItem value="primary">Primær</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Beregningsmetode</Label>
                                    <Select
                                        value={form.calculation_method}
                                        onValueChange={v => setForm(f => ({ ...f, calculation_method: v as typeof f.calculation_method }))}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="pool_weighted">Pulje / point / vægte</SelectItem>
                                            <SelectItem value="individual_work">Individuelt beløb pr. værk</SelectItem>
                                            <SelectItem value="royalty_percentage">Royalty-procent</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Valuta</Label>
                                    <Input
                                        placeholder="DKK"
                                        maxLength={3}
                                        value={form.currency}
                                        onChange={e => setForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))}
                                    />
                                </div>
                            </>
                        )}
                        <div className="space-y-1">
                            <Label>Noter <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input
                                value={form.notes}
                                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuller</Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? "Gemmer…" : "Gem"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
