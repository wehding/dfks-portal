"use client"

import { useState, useRef, useEffect } from "react"
import { Plus, Pencil, Trash2, Check, X, GripVertical, Link2, Unlink2, Filter, Save, Loader2 } from "lucide-react"
import type { FilterRule, VaerkType, VaerkVaegt, AftalelicensVaegtExtra } from "@/lib/streaming-types"
import { AI_PROVIDERS, AI_CONFIG_DEFAULTS, loadAiConfig, saveAiConfig, getProviderDef, type AiUseCase, type AiConfig, type AiProvider } from "@/lib/ai-providers"
import { useI18n } from "@/lib/i18n"
import { useMasterData } from "@/lib/hooks"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"

function MasterDataTable({
    type,
    addLabel,
    reorderable = false,
    metaLabel,
    metaPlaceholder,
}: {
    type: "roles" | "categories" | "platforms" | "productionTypes" | "licensePeriods"
    addLabel: string
    reorderable?: boolean
    metaLabel?: string
    metaPlaceholder?: string
}) {
    const { t } = useI18n()
    const { items, addItem, deleteItem, toggleActive, renameItem, reorderItems } = useMasterData(type)

    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [newName, setNewName] = useState("")
    const [newMeta, setNewMeta] = useState("")
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editingName, setEditingName] = useState("")
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const dragIndex = useRef<number | null>(null)
    const dragOverIndex = useRef<number | null>(null)

    const handleAdd = () => {
        if (newName.trim()) {
            const item = { id: `${type}_${Date.now()}`, name: newName.trim(), active: true, meta: newMeta.trim() || undefined }
            addItem(item.name)
            setNewName("")
            setNewMeta("")
            setAddDialogOpen(false)
        }
    }

    const startRename = (id: string, currentName: string) => {
        setEditingId(id)
        setEditingName(currentName)
    }

    const commitRename = () => {
        if (editingId && editingName.trim()) {
            renameItem(editingId, editingName.trim())
        }
        setEditingId(null)
        setEditingName("")
    }

    const cancelRename = () => {
        setEditingId(null)
        setEditingName("")
    }

    const handleDelete = () => {
        if (deleteId) {
            deleteItem(deleteId)
            setDeleteId(null)
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setAddDialogOpen(true)}
                >
                    <Plus className="h-3.5 w-3.5" />
                    {addLabel}
                </Button>
            </div>

            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {reorderable && <TableHead className="w-8" />}
                            <TableHead>{t("admin.masterData.name")}</TableHead>
                            {metaLabel && <TableHead className="w-[140px]">{metaLabel}</TableHead>}
                            <TableHead className="w-[80px]">{t("admin.masterData.active")}</TableHead>
                            <TableHead className="w-[100px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item, index) => (
                            <TableRow
                                key={item.id}
                                draggable={reorderable}
                                onDragStart={() => { dragIndex.current = index }}
                                onDragOver={(e) => { e.preventDefault(); dragOverIndex.current = index }}
                                onDrop={() => {
                                    if (dragIndex.current !== null && dragOverIndex.current !== null && dragIndex.current !== dragOverIndex.current) {
                                        reorderItems(dragIndex.current, dragOverIndex.current)
                                    }
                                    dragIndex.current = null
                                    dragOverIndex.current = null
                                }}
                                className={reorderable ? "cursor-default" : ""}
                            >
                                {reorderable && (
                                    <TableCell className="w-8 pr-0">
                                        <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab" />
                                    </TableCell>
                                )}
                                <TableCell>
                                    {editingId === item.id ? (
                                        <div className="flex items-center gap-2">
                                            <Input
                                                value={editingName}
                                                onChange={(e) => setEditingName(e.target.value)}
                                                className="h-8 text-sm"
                                                autoFocus
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") commitRename()
                                                    if (e.key === "Escape") cancelRename()
                                                }}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 shrink-0"
                                                onClick={commitRename}
                                            >
                                                <Check className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 shrink-0"
                                                onClick={cancelRename}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    ) : (
                                        <span className={!item.active ? "text-muted-foreground" : ""}>
                                            {item.name}
                                        </span>
                                    )}
                                </TableCell>
                                {metaLabel && (
                                    <TableCell className="text-sm text-muted-foreground">
                                        {item.meta ? `${item.meta} år` : "—"}
                                    </TableCell>
                                )}
                                <TableCell>
                                    <Switch
                                        checked={item.active}
                                        onCheckedChange={() => toggleActive(item.id)}
                                    />
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => startRename(item.id, item.name)}
                                            disabled={editingId === item.id}
                                        >
                                            <Pencil className="h-3 w-3" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            onClick={() => setDeleteId(item.id)}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Add Dialog */}
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{addLabel}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">{t("admin.masterData.name")}</Label>
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Navn..."
                                autoFocus
                                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                            />
                        </div>
                        {metaLabel && (
                            <div className="space-y-1.5">
                                <Label className="text-xs">{metaLabel}</Label>
                                <Input
                                    value={newMeta}
                                    onChange={(e) => setNewMeta(e.target.value)}
                                    placeholder={metaPlaceholder ?? ""}
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                            {t("common.cancel")}
                        </Button>
                        <Button onClick={handleAdd} disabled={!newName.trim()}>
                            {addLabel}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("common.delete")}</DialogTitle>
                        <DialogDescription>{t("common.deleteConfirm")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>
                            {t("common.cancel")}
                        </Button>
                        <Button variant="destructive" onClick={handleDelete}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("common.delete")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ── Admin fee types ───────────────────────────────────────────

interface AdminFees {
    linked: boolean
    irf: number
    succesbetaling: number
    royalties: number
    copydan: number
}

const DEFAULT_FEES: AdminFees = { linked: true, irf: 15, succesbetaling: 15, royalties: 10, copydan: 8 }

function loadFees(): AdminFees {
    if (typeof window === "undefined") return DEFAULT_FEES
    try {
        const stored = localStorage.getItem("streaming_admin_fees")
        return stored ? { ...DEFAULT_FEES, ...JSON.parse(stored) } : DEFAULT_FEES
    } catch { return DEFAULT_FEES }
}

const FEE_LABELS: { key: keyof Omit<AdminFees, "linked">; label: string }[] = [
    { key: "irf",           label: "IRF" },
    { key: "succesbetaling", label: "Succesbetaling" },
    { key: "royalties",     label: "Royalties" },
    { key: "copydan",       label: "Copydan" },
]

// ── Filtreringsregler ─────────────────────────────────────────

const DEFAULT_FILTER_RULES: FilterRule[] = [
    { id: "fr1", name: "Sport", type: "title_keyword", value: "sport", active: true, createdAt: "2024-01-01" },
    { id: "fr2", name: "Nyheder", type: "title_keyword", value: "nyhed", active: true, createdAt: "2024-01-01" },
    { id: "fr3", name: "TV Avisen", type: "title_keyword", value: "tv avisen", active: true, createdAt: "2024-01-01" },
    { id: "fr4", name: "Sporten", type: "title_keyword", value: "sporten", active: true, createdAt: "2024-01-01" },
    { id: "fr5", name: "Vejret", type: "title_keyword", value: "vejret", active: true, createdAt: "2024-01-01" },
]

function loadFilterRules(): FilterRule[] {
    if (typeof window === "undefined") return DEFAULT_FILTER_RULES
    try {
        const stored = localStorage.getItem("dfks_filter_rules")
        return stored ? JSON.parse(stored) : DEFAULT_FILTER_RULES
    } catch { return DEFAULT_FILTER_RULES }
}

const RULE_TYPE_LABELS: Record<FilterRule["type"], string> = {
    title_keyword: "Nøgleord i titel",
    title_regex: "Regex-mønster",
    channel: "Kanalnavn",
}

function FilterRulesTab() {
    const [rules, setRules] = useState<FilterRule[]>(() => {
        if (typeof window === "undefined") return DEFAULT_FILTER_RULES
        try {
            const stored = localStorage.getItem("dfks_filter_rules")
            return stored ? JSON.parse(stored) : DEFAULT_FILTER_RULES
        } catch { return DEFAULT_FILTER_RULES }
    })
    const [addOpen, setAddOpen] = useState(false)
    const [newName, setNewName] = useState("")
    const [newType, setNewType] = useState<FilterRule["type"]>("title_keyword")
    const [newValue, setNewValue] = useState("")
    const [deleteId, setDeleteId] = useState<string | null>(null)

    useEffect(() => {
        localStorage.setItem("dfks_filter_rules", JSON.stringify(rules))
    }, [rules])

    const handleAdd = () => {
        if (!newName.trim() || !newValue.trim()) return
        const rule: FilterRule = {
            id: `fr_${Date.now()}`,
            name: newName.trim(),
            type: newType,
            value: newValue.trim(),
            active: true,
            createdAt: new Date().toISOString(),
        }
        setRules(prev => [...prev, rule])
        setNewName("")
        setNewValue("")
        setNewType("title_keyword")
        setAddOpen(false)
        toast.success("Regel tilføjet")
    }

    const toggleActive = (id: string) => {
        setRules(prev => prev.map(r => r.id === id ? { ...r, active: !r.active } : r))
    }

    const handleDelete = () => {
        if (!deleteId) return
        setRules(prev => prev.filter(r => r.id !== deleteId))
        setDeleteId(null)
        toast.success("Regel slettet")
    }

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-muted-foreground">
                        Regler der automatisk filtrerer titler fra ved import. Inaktive regler evalueres ikke.
                    </p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Tilføj regel
                </Button>
            </div>

            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Navn</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Værdi</TableHead>
                            <TableHead className="w-[80px]">Aktiv</TableHead>
                            <TableHead className="w-[60px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rules.map(rule => (
                            <TableRow key={rule.id}>
                                <TableCell className={!rule.active ? "text-muted-foreground" : ""}>{rule.name}</TableCell>
                                <TableCell>
                                    <Badge variant="outline" className="text-xs font-normal">
                                        {RULE_TYPE_LABELS[rule.type]}
                                    </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">{rule.value}</TableCell>
                                <TableCell>
                                    <Switch checked={rule.active} onCheckedChange={() => toggleActive(rule.id)} />
                                </TableCell>
                                <TableCell>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => setDeleteId(rule.id)}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {rules.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                                    Ingen filtreringsregler endnu
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Add dialog */}
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Tilføj filtreringsregel</DialogTitle>
                        <DialogDescription>Titler der matcher reglen fjernes automatisk ved import.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Navn</Label>
                            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Beskrivende navn, f.eks. Fjern sport" autoFocus />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Type</Label>
                            <Select value={newType} onValueChange={v => setNewType(v as FilterRule["type"])}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="title_keyword">Nøgleord i titel</SelectItem>
                                    <SelectItem value="title_regex">Regex-mønster</SelectItem>
                                    <SelectItem value="channel">Kanalnavn</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Værdi</Label>
                            <Input
                                value={newValue}
                                onChange={e => setNewValue(e.target.value)}
                                placeholder={newType === "title_keyword" ? "f.eks. sport" : newType === "title_regex" ? "f.eks. ^Sporten" : "f.eks. DR1"}
                                onKeyDown={e => e.key === "Enter" && handleAdd()}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddOpen(false)}>Annuller</Button>
                        <Button onClick={handleAdd} disabled={!newName.trim() || !newValue.trim()}>Tilføj regel</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete confirmation */}
            <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Slet regel</DialogTitle>
                        <DialogDescription>Er du sikker på, at du vil slette denne regel?</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>Annuller</Button>
                        <Button variant="destructive" onClick={handleDelete}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Slet
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ── Vægte ─────────────────────────────────────────────────────

const DEFAULT_VAEGTE: VaerkVaegt[] = [
    { type: "spillefilm",      label: "Spillefilm",          weight: 200 },
    { type: "tv_serie_lang",   label: "Lang seriefiktion",   weight: 100 },
    { type: "tv_serie_kort",   label: "Kort seriefiktion",   weight: 50  },
    { type: "kortfilm",        label: "Novellefilm",         weight: 150 },
    { type: "dokumentarserie", label: "Tung seriedok.",      weight: 100 },
    { type: "dokuDrama",       label: "DokuDrama",           weight: 200 },
    { type: "kort_dokumentar", label: "Kort dokumentar",     weight: 100 },
]

const DEFAULT_VAEGT_EXTRA: AftalelicensVaegtExtra = {
    dokLangPoints:    200,
    dokMellemPoints:  150,
    dokKortPoints:    100,
    dokLangMin:       61,
    dokMellemMin:     21,
    dokSerieLangMin:  38,
    dokSerieKortPoints: 50,
    supplerendeKlipFaktor: 0.3,
    genudsendelseFaktor: 0.5,
    genudsendelseMaaneder: 1,
}

function loadVaegte(): VaerkVaegt[] {
    if (typeof window === "undefined") return DEFAULT_VAEGTE
    try {
        const stored = localStorage.getItem("dfks_vaerkvaegte")
        return stored ? JSON.parse(stored) : DEFAULT_VAEGTE
    } catch { return DEFAULT_VAEGTE }
}

function loadVaegtExtra(): AftalelicensVaegtExtra {
    if (typeof window === "undefined") return DEFAULT_VAEGT_EXTRA
    try {
        const stored = localStorage.getItem("dfks_vaegt_extra")
        return stored ? { ...DEFAULT_VAEGT_EXTRA, ...JSON.parse(stored) } : DEFAULT_VAEGT_EXTRA
    } catch { return DEFAULT_VAEGT_EXTRA }
}

function loadHensaettelserPct(): number {
    if (typeof window === "undefined") return 10
    try {
        const v = localStorage.getItem("dfks_hensaettelser_pct")
        return v !== null ? Number(v) : 10
    } catch { return 10 }
}

function loadSocialPct(): number {
    if (typeof window === "undefined") return 0
    try {
        const v = localStorage.getItem("dfks_sociale_pct")
        return v !== null ? Number(v) : 0
    } catch { return 0 }
}

function VaegteTab() {
    const [vaegte, setVaegte] = useState<VaerkVaegt[]>(loadVaegte)
    const [extra, setExtra] = useState<AftalelicensVaegtExtra>(loadVaegtExtra)
    const [fees, setFees] = useState<AdminFees>(loadFees)
    const [hensaettelserPct, setHensaettelserPct] = useState(10)
    const [socialPct, setSocialPct] = useState(0)

    // Hydrate from localStorage (avoids SSR mismatch)
    useEffect(() => {
        setHensaettelserPct(loadHensaettelserPct())
        setSocialPct(loadSocialPct())
    }, [])

    const setWeight = (type: VaerkType, value: number) => {
        setVaegte(prev => prev.map(v => v.type === type ? { ...v, weight: value } : v))
    }

    const setExtraField = (key: keyof AftalelicensVaegtExtra, value: number) => {
        setExtra(prev => ({ ...prev, [key]: value }))
    }

    const setFee = (key: keyof Omit<AdminFees, "linked">, value: number) => {
        setFees(prev => prev.linked
            ? { ...prev, irf: value, succesbetaling: value, royalties: value, copydan: value }
            : { ...prev, [key]: value }
        )
    }

    const toggleLinked = () => {
        setFees(prev => prev.linked
            ? { ...prev, linked: false }
            : { ...prev, linked: true, succesbetaling: prev.irf, royalties: prev.irf, copydan: prev.irf }
        )
    }

    const handleSave = () => {
        localStorage.setItem("dfks_vaerkvaegte", JSON.stringify(vaegte))
        localStorage.setItem("dfks_vaegt_extra", JSON.stringify(extra))
        localStorage.setItem("streaming_admin_fees", JSON.stringify(fees))
        localStorage.setItem("dfks_hensaettelser_pct", String(hensaettelserPct))
        localStorage.setItem("dfks_sociale_pct", String(socialPct))
        toast.success("Vægte og hensættelser gemt")
    }

    return (
        <div className="space-y-6 max-w-2xl">
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-xs text-blue-800 dark:text-blue-300">
                <Save className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <p className="font-medium">Base-point × minutter</p>
                    <p>Point = base-point(type) × varighed i minutter. For dokumentarfilm bestemmer varigheden også base-point-niveauet (tier). Points summeres og bruges til at beregne andele af klumpen.</p>
                </div>
            </div>

            {/* Seriefiktion + spillefilm + novellefilm */}
            <div className="rounded-lg border">
                <div className="px-4 py-3 border-b">
                    <h3 className="text-sm font-medium">Fiktion og novellefilm</h3>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Værktype</TableHead>
                            <TableHead className="text-xs text-muted-foreground font-normal">Eksempler</TableHead>
                            <TableHead className="w-[110px]">Point pr. værk</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {vaegte.filter(v => ["spillefilm","tv_serie_lang","tv_serie_kort","kortfilm"].includes(v.type)).map(v => (
                            <TableRow key={v.type}>
                                <TableCell className="text-sm font-medium">{v.label}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                    {v.type === "spillefilm"    && "Alle spillefilm"}
                                    {v.type === "tv_serie_lang" && "Borgen, Herrens Veje, Badehotellet"}
                                    {v.type === "tv_serie_kort" && "Klovn, Huset på Christianshavn, julekalender"}
                                    {v.type === "kortfilm"      && "Skyggebokser, Fruer og friller"}
                                </TableCell>
                                <TableCell>
                                    <Input
                                        type="number"
                                        value={v.weight}
                                        onChange={e => setWeight(v.type, Number(e.target.value))}
                                        className="h-8 w-24 text-sm"
                                        step="10"
                                        min="0"
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Dokumentarfilm tiers */}
            <div className="rounded-lg border">
                <div className="px-4 py-3 border-b">
                    <h3 className="text-sm font-medium">Dokumentarfilm</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Pointniveau afhænger af varighed. Angiv grænseværdier i minutter.</p>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[100px]">Niveau</TableHead>
                            <TableHead className="text-xs text-muted-foreground font-normal w-[130px]">Varighed</TableHead>
                            <TableHead className="text-xs text-muted-foreground font-normal">Eksempler</TableHead>
                            <TableHead className="w-[110px] text-right">Point pr. min.</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow>
                            <TableCell className="text-sm font-medium">Lang</TableCell>
                            <TableCell>
                                <div className="flex items-center gap-1 text-xs">
                                    <span className="text-muted-foreground">≥</span>
                                    <Input
                                        type="number"
                                        value={extra.dokLangMin}
                                        onChange={e => setExtraField("dokLangMin", Number(e.target.value))}
                                        className="h-7 w-16 text-xs"
                                        min="1"
                                    />
                                    <span className="text-muted-foreground">min.</span>
                                </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">Kampen om Grønland, Gasolin</TableCell>
                            <TableCell className="text-right">
                                <Input type="number" value={extra.dokLangPoints} onChange={e => setExtraField("dokLangPoints", Number(e.target.value))} className="h-8 w-20 text-sm ml-auto" step="10" min="0" />
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell className="text-sm font-medium">Mellemlang</TableCell>
                            <TableCell>
                                <div className="flex items-center gap-1 text-xs">
                                    <Input
                                        type="number"
                                        value={extra.dokMellemMin}
                                        onChange={e => setExtraField("dokMellemMin", Number(e.target.value))}
                                        className="h-7 w-16 text-xs"
                                        min="1"
                                    />
                                    <span className="text-muted-foreground">–{extra.dokLangMin} min.</span>
                                </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">De skygger vi arver, Vi lader billedet stå</TableCell>
                            <TableCell className="text-right">
                                <Input type="number" value={extra.dokMellemPoints} onChange={e => setExtraField("dokMellemPoints", Number(e.target.value))} className="h-8 w-20 text-sm ml-auto" step="10" min="0" />
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell className="text-sm font-medium">Kort</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                                &lt; {extra.dokMellemMin} min.
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">Historien om Danmark, Vilde Vidunderlige Danmark</TableCell>
                            <TableCell className="text-right">
                                <Input type="number" value={extra.dokKortPoints} onChange={e => setExtraField("dokKortPoints", Number(e.target.value))} className="h-8 w-20 text-sm ml-auto" step="10" min="0" />
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>

            {/* Dokumentarserie + DokuDrama + øvrige */}
            <div className="rounded-lg border">
                <div className="px-4 py-3 border-b">
                    <h3 className="text-sm font-medium">Øvrige typer</h3>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Værktype</TableHead>
                            <TableHead className="text-xs text-muted-foreground font-normal">Varighed</TableHead>
                            <TableHead className="w-[110px]">Point pr. min.</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {/* Dokumentarserie: to tiers */}
                        <TableRow>
                            <TableCell className="text-sm font-medium">Tung seriedok.</TableCell>
                            <TableCell>
                                <div className="flex items-center gap-1 text-xs">
                                    <span className="text-muted-foreground">≥</span>
                                    <Input
                                        type="number"
                                        value={extra.dokSerieLangMin}
                                        onChange={e => setExtraField("dokSerieLangMin", Number(e.target.value))}
                                        className="h-7 w-16 text-xs"
                                        min="1"
                                    />
                                    <span className="text-muted-foreground">min.</span>
                                </div>
                            </TableCell>
                            <TableCell>
                                <Input
                                    type="number"
                                    value={vaegte.find(v => v.type === "dokumentarserie")?.weight ?? 100}
                                    onChange={e => setWeight("dokumentarserie", Number(e.target.value))}
                                    className="h-8 w-24 text-sm"
                                    step="10"
                                    min="0"
                                />
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell className="text-sm text-muted-foreground pl-5">Kort seriedok.</TableCell>
                            <TableCell className="text-xs text-muted-foreground">&lt; {extra.dokSerieLangMin} min.</TableCell>
                            <TableCell>
                                <Input
                                    type="number"
                                    value={extra.dokSerieKortPoints}
                                    onChange={e => setExtraField("dokSerieKortPoints", Number(e.target.value))}
                                    className="h-8 w-24 text-sm"
                                    step="10"
                                    min="0"
                                />
                            </TableCell>
                        </TableRow>
                        {/* DokuDrama + kort_dokumentar */}
                        {vaegte.filter(v => ["dokuDrama","kort_dokumentar"].includes(v.type)).map(v => (
                            <TableRow key={v.type}>
                                <TableCell className="text-sm">{v.label}</TableCell>
                                <TableCell />
                                <TableCell>
                                    <Input
                                        type="number"
                                        value={v.weight}
                                        onChange={e => setWeight(v.type, Number(e.target.value))}
                                        className="h-8 w-24 text-sm"
                                        step="10"
                                        min="0"
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Genudsendelser */}
            <div className="rounded-lg border">
                <div className="px-4 py-3 border-b">
                    <h3 className="text-sm font-medium">Genudsendelser</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        En udsendelse tæller som genudsendelse hvis samme titel sendes igen inden for det definerede tidsvindue.
                    </p>
                </div>
                <div className="px-4 py-4 space-y-4">
                    <div className="flex items-center gap-3">
                        <Label className="text-sm w-48">Tidsvindue (måneder)</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                value={extra.genudsendelseMaaneder}
                                onChange={e => setExtraField("genudsendelseMaaneder", Number(e.target.value))}
                                className="h-8 w-20 text-sm"
                                step="1"
                                min="1"
                            />
                            <span className="text-sm text-muted-foreground">måned(er)</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Label className="text-sm w-48">Point-faktor (genudsendelse)</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                value={extra.genudsendelseFaktor}
                                onChange={e => setExtraField("genudsendelseFaktor", Number(e.target.value))}
                                className="h-8 w-20 text-sm"
                                step="0.05"
                                min="0"
                                max="1"
                            />
                            <span className="text-sm text-muted-foreground">
                                ({(extra.genudsendelseFaktor * 100).toFixed(0)}% af normale point)
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Administrationsbidrag */}
            <div className="rounded-lg border">
                <div className="px-4 py-3 border-b">
                    <h3 className="text-sm font-medium">Administrationsbidrag</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Procentsatser der bruges ved registrering af nye udbetalinger.
                        Gælder kun fremadrettet — eksisterende udbetalinger bevarer deres sats.
                    </p>
                </div>
                <div className="px-4 py-4 space-y-4">
                    <button
                        type="button"
                        onClick={toggleLinked}
                        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        {fees.linked
                            ? <Link2 className="h-3.5 w-3.5 text-primary" />
                            : <Unlink2 className="h-3.5 w-3.5" />
                        }
                        {fees.linked ? "Samme sats for alle typer — klik for at adskille" : "Individuelle satser — klik for at låse sammen"}
                    </button>
                    <div className="space-y-3">
                        {fees.linked ? (
                            <div className="flex items-center gap-3">
                                <Label className="w-32 text-sm shrink-0">Alle typer</Label>
                                <Input
                                    type="number"
                                    value={fees.irf}
                                    onChange={e => setFee("irf", Number(e.target.value))}
                                    className="w-20"
                                    step="0.5"
                                    min="0"
                                    max="100"
                                />
                                <span className="text-sm text-muted-foreground">%</span>
                            </div>
                        ) : (
                            FEE_LABELS.map(({ key, label }) => (
                                <div key={key} className="flex items-center gap-3">
                                    <Label className="w-32 text-sm shrink-0">{label}</Label>
                                    <Input
                                        type="number"
                                        value={fees[key]}
                                        onChange={e => setFee(key, Number(e.target.value))}
                                        className="w-20"
                                        step="0.5"
                                        min="0"
                                        max="100"
                                    />
                                    <span className="text-sm text-muted-foreground">%</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Hensættelser og sociale formål */}
            <div className="rounded-lg border">
                <div className="px-4 py-3 border-b">
                    <h3 className="text-sm font-medium">Hensættelser og sociale formål</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Standardprocenter der bruges i beregningsmodulet. Begge trækkes fra beløbet efter administrationsbidrag.
                    </p>
                </div>
                <div className="px-4 py-4 space-y-3">
                    <div className="flex items-center gap-3">
                        <Label className="w-36 text-sm shrink-0">Hensættelser</Label>
                        <Input
                            type="number"
                            value={hensaettelserPct}
                            onChange={e => setHensaettelserPct(Number(e.target.value))}
                            className="w-20"
                            step="0.5"
                            min="0"
                            max="100"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <Label className="w-36 text-sm shrink-0">Til sociale formål</Label>
                        <Input
                            type="number"
                            value={socialPct}
                            onChange={e => setSocialPct(Number(e.target.value))}
                            className="w-20"
                            step="0.5"
                            min="0"
                            max="100"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                    </div>
                </div>
            </div>

            <Button onClick={handleSave} className="gap-2">
                <Save className="h-4 w-4" />
                Gem vægte og hensættelser
            </Button>
        </div>
    )
}

// ── AI-udbyder indstillinger ──────────────────────────────────

function AiProviderPicker({ useCase, title, description }: { useCase: AiUseCase; title: string; description: string }) {
    const [config, setConfig] = useState<AiConfig>(AI_CONFIG_DEFAULTS[useCase])

    useEffect(() => {
        setConfig(loadAiConfig(useCase))
    }, [useCase])

    const handleProviderChange = (provider: AiProvider) => {
        const firstModel = getProviderDef(provider).models[0].id
        const newConfig = { provider, model: firstModel }
        setConfig(newConfig)
        saveAiConfig(useCase, newConfig)
        toast.success("AI-udbyder gemt")
    }

    const handleModelChange = (model: string) => {
        const newConfig = { ...config, model }
        setConfig(newConfig)
        saveAiConfig(useCase, newConfig)
        toast.success("AI-model gemt")
    }

    const currentProvider = getProviderDef(config.provider)

    return (
        <div className="rounded-lg border p-5 space-y-4">
            <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Udbyder</Label>
                    <Select value={config.provider} onValueChange={v => handleProviderChange(v as AiProvider)}>
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {AI_PROVIDERS.map(p => (
                                <SelectItem key={p.id} value={p.id} className="text-xs">{p.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Model</Label>
                    <Select value={config.model} onValueChange={handleModelChange}>
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {currentProvider.models.map(m => (
                                <SelectItem key={m.id} value={m.id} className="text-xs">{m.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <p className="text-xs text-muted-foreground">
                {currentProvider.models.find(m => m.id === config.model)?.description}
            </p>
        </div>
    )
}

type KeyStatus = { configured: boolean; source: "env" | "stored" | "missing"; masked?: string }
type AllKeyStatus = Record<"anthropic" | "openai" | "google", KeyStatus>

const PROVIDER_LABELS: Record<string, string> = {
    anthropic: "Anthropic (Claude)",
    openai:    "OpenAI (GPT)",
    google:    "Google (Gemini)",
}

function AiKeySettings() {
    const [status, setStatus] = useState<AllKeyStatus | null>(null)
    const [editing, setEditing] = useState<Record<string, string>>({})
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        fetch("/api/admin/ai-keys")
            .then(r => r.json())
            .then(setStatus)
            .catch(() => null)
    }, [])

    const handleSave = async () => {
        setSaving(true)
        try {
            await fetch("/api/admin/ai-keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editing),
            })
            // Genindlæs status
            const updated = await fetch("/api/admin/ai-keys").then(r => r.json())
            setStatus(updated)
            setEditing({})
            toast.success("API-nøgler gemt")
        } catch {
            toast.error("Kunne ikke gemme nøgler")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="rounded-lg border p-5 space-y-4">
            <div>
                <h3 className="text-sm font-medium">API-nøgler</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Nøgler sat via miljøvariabler (.env) har altid prioritet og kan ikke overskrives herfra.
                    Nøgler gemt her gemmes i <code className="text-[10px] bg-muted px-1 rounded">config/ai-keys.json</code> på serveren.
                </p>
            </div>
            <div className="space-y-3">
                {(["anthropic", "openai", "google"] as const).map(provider => {
                    const s = status?.[provider]
                    return (
                        <div key={provider} className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs">{PROVIDER_LABELS[provider]}</Label>
                                {s && (
                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                        s.source === "env"     ? "bg-blue-50 text-blue-700"    :
                                        s.source === "stored"  ? "bg-green-50 text-green-700"  :
                                        "bg-muted text-muted-foreground"
                                    }`}>
                                        {s.source === "env" ? "Fra .env" : s.source === "stored" ? "Gemt" : "Ikke sat"}
                                    </span>
                                )}
                            </div>
                            {s?.source === "env" ? (
                                <div className="h-8 flex items-center rounded-md border bg-muted/50 px-3 text-xs font-mono text-muted-foreground cursor-not-allowed">
                                    {s.masked}
                                </div>
                            ) : (
                                <Input
                                    type="password"
                                    className="h-8 text-xs font-mono"
                                    placeholder={s?.masked ? `Nuværende: ${s.masked}` : "Indsæt API-nøgle…"}
                                    value={editing[provider] ?? ""}
                                    onChange={e => setEditing(prev => ({ ...prev, [provider]: e.target.value }))}
                                    autoComplete="off"
                                />
                            )}
                        </div>
                    )
                })}
            </div>
            {Object.keys(editing).some(k => editing[k]) && (
                <Button size="sm" onClick={handleSave} disabled={saving} className="w-full">
                    {saving ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Gemmer…</> : <><Save className="h-3 w-3 mr-1.5" /> Gem nøgler</>}
                </Button>
            )}
        </div>
    )
}

function AiModelSettings() {
    return (
        <div className="space-y-4">
            <AiKeySettings />
            <AiProviderPicker
                useCase="soeg"
                title="AI-søgning (sorteringsmodul)"
                description="Bruges ved flag-dialog til at vurdere enkelttitler. Præcision er vigtig."
            />
            <AiProviderPicker
                useCase="grovsorter"
                title="Grovsortering (batch)"
                description="Bruges til at klassificere hundredvis af titler ad gangen. Hastighed og pris er vigtig."
            />
            <AiProviderPicker
                useCase="kontrakt"
                title="Kontraktanalyse & validering"
                description="Bruges til gennemgang og screening af kontrakter. Præcision er vigtig. Bemærk: PDF-filer kræver Anthropic."
            />
        </div>
    )
}

// ── Eksportkolonner ───────────────────────────────────────────

interface ExportColumn {
    id: string
    label: string
    required?: boolean
    enabled: boolean
}

const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = [
    { id: "navn",           label: "Navn",            required: true, enabled: true },
    { id: "cpr",            label: "CPR-nummer",       enabled: true },
    { id: "beloeb",         label: "Beløb",            required: true, enabled: true },
    { id: "vaerkstitel",    label: "Værkstitel",       enabled: true },
    { id: "episode",        label: "Episode",          enabled: false },
    { id: "udsendelsesdato",label: "Udsendelsesdato",  enabled: false },
    { id: "kilde",          label: "Kilde",            enabled: true },
    { id: "betalingstype",  label: "Betalingstype",    enabled: true },
    { id: "batch",          label: "Batch",            enabled: false },
]

const EXPORT_COL_KEY = "dfks_export_columns"

function ExportKolonnerTab() {
    const [cols, setCols] = useState<ExportColumn[]>(() => {
        if (typeof window === "undefined") return DEFAULT_EXPORT_COLUMNS
        try {
            const stored = JSON.parse(localStorage.getItem(EXPORT_COL_KEY) ?? "null")
            if (Array.isArray(stored)) return stored
        } catch {}
        return DEFAULT_EXPORT_COLUMNS
    })
    const [saved, setSaved] = useState(false)

    function toggle(id: string) {
        setCols(prev => prev.map(c => c.id === id && !c.required ? { ...c, enabled: !c.enabled } : c))
        setSaved(false)
    }

    function handleSave() {
        localStorage.setItem(EXPORT_COL_KEY, JSON.stringify(cols))
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    return (
        <div className="max-w-lg space-y-4">
            <p className="text-sm text-muted-foreground">
                Vælg hvilke kolonner der medtages i CSV- og Excel-eksport af udbetalingsbatches.
                Påkrævede kolonner kan ikke deaktiveres.
            </p>
            <div className="rounded-md border divide-y">
                {cols.map(col => (
                    <div key={col.id} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{col.label}</span>
                            {col.required && (
                                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Påkrævet</span>
                            )}
                        </div>
                        <Switch
                            checked={col.enabled}
                            disabled={col.required}
                            onCheckedChange={() => toggle(col.id)}
                        />
                    </div>
                ))}
            </div>
            <Button size="sm" onClick={handleSave}>
                {saved ? <><Check className="h-3 w-3 mr-1.5" /> Gemt</> : <><Save className="h-3 w-3 mr-1.5" /> Gem kolonner</>}
            </Button>
        </div>
    )
}

export default function AdminStamdataPage() {
    const { t } = useI18n()

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.masterData.title")}
                subtitle={t("admin.masterData.subtitle")}
            />

            <Tabs defaultValue="roles">
                <TabsList>
                    <TabsTrigger value="roles">{t("admin.masterData.roles")}</TabsTrigger>
                    <TabsTrigger value="categories">{t("admin.masterData.categories")}</TabsTrigger>
                    <TabsTrigger value="platforms">Platforme</TabsTrigger>
                    <TabsTrigger value="productionTypes">Værkstyper</TabsTrigger>
                    <TabsTrigger value="licensePeriods">Licensperioder</TabsTrigger>
                    <TabsTrigger value="settings">AI indstillinger</TabsTrigger>
                    <TabsTrigger value="filtreringsregler">Filtreringsregler</TabsTrigger>
                    <TabsTrigger value="vaegt">Vægte og hensættelser</TabsTrigger>
                    <TabsTrigger value="eksport">Eksportkolonner</TabsTrigger>
                </TabsList>

                <TabsContent value="roles" className="mt-4">
                    <MasterDataTable type="roles" addLabel={t("admin.masterData.addRole")} reorderable />
                </TabsContent>

                <TabsContent value="categories" className="mt-4">
                    <MasterDataTable type="categories" addLabel={t("admin.masterData.addCategory")} reorderable />
                </TabsContent>

                <TabsContent value="platforms" className="mt-4">
                    <MasterDataTable type="platforms" addLabel="Tilføj platform" reorderable />
                </TabsContent>

                <TabsContent value="productionTypes" className="mt-4">
                    <MasterDataTable
                        type="productionTypes"
                        addLabel="Tilføj værkstype"
                        reorderable
                        metaLabel="Standard licens"
                        metaPlaceholder="Fx 50"
                    />
                </TabsContent>

                <TabsContent value="licensePeriods" className="mt-4">
                    <MasterDataTable
                        type="licensePeriods"
                        addLabel="Tilføj licensperiode"
                        reorderable
                    />
                </TabsContent>

                <TabsContent value="settings" className="mt-4">
                    <div className="max-w-md space-y-6">
                        <AiModelSettings />
                    </div>
                </TabsContent>

                <TabsContent value="filtreringsregler" className="mt-4">
                    <FilterRulesTab />
                </TabsContent>

                <TabsContent value="vaegt" className="mt-4">
                    <VaegteTab />
                </TabsContent>

                <TabsContent value="eksport" className="mt-4">
                    <ExportKolonnerTab />
                </TabsContent>
            </Tabs>
        </div>
    )
}
