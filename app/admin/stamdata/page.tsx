"use client"

import { useState, useRef, useCallback } from "react"
import { Plus, Pencil, Trash2, Check, X, GripVertical, Link2, Unlink2 } from "lucide-react"
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

export default function AdminStamdataPage() {
    const { t } = useI18n()
    const [fees, setFees] = useState<AdminFees>(loadFees)

    const setFee = useCallback((key: keyof Omit<AdminFees, "linked">, value: number) => {
        setFees(prev => prev.linked
            ? { ...prev, irf: value, succesbetaling: value, royalties: value, copydan: value }
            : { ...prev, [key]: value }
        )
    }, [])

    const toggleLinked = useCallback(() => {
        setFees(prev => {
            if (!prev.linked) {
                // Låse: sæt alle til IRF-satsen
                return { ...prev, linked: true, succesbetaling: prev.irf, royalties: prev.irf, copydan: prev.irf }
            }
            return { ...prev, linked: false }
        })
    }, [])

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
                    <TabsTrigger value="productionTypes">Produktionstyper</TabsTrigger>
                    <TabsTrigger value="licensePeriods">Licensperioder</TabsTrigger>
                    <TabsTrigger value="settings">Indstillinger</TabsTrigger>
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
                        addLabel="Tilføj produktionstype"
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
                        <div className="rounded-lg border p-6 space-y-5">
                            <div>
                                <h3 className="text-sm font-medium">Administrationsbidrag</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Procentsatser der bruges ved registrering af nye udbetalinger.
                                    Gælder kun fremadrettet — eksisterende udbetalinger bevarer deres sats.
                                </p>
                            </div>

                            {/* Linked toggle */}
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

                            {/* Fee inputs */}
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

                            <Button size="sm" onClick={() => {
                                localStorage.setItem("streaming_admin_fees", JSON.stringify(fees))
                            }}>
                                {t("common.save")}
                            </Button>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    )
}
