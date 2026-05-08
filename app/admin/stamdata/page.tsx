"use client"

import { useState } from "react"
import { Plus, Pencil, Trash2, Check, X } from "lucide-react"
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
}: {
    type: "roles" | "categories" | "platforms"
    addLabel: string
}) {
    const { t } = useI18n()
    const { items, addItem, deleteItem, toggleActive, renameItem } = useMasterData(type)

    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [newName, setNewName] = useState("")
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editingName, setEditingName] = useState("")
    const [deleteId, setDeleteId] = useState<string | null>(null)

    const handleAdd = () => {
        if (newName.trim()) {
            addItem(newName.trim())
            setNewName("")
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
                            <TableHead>{t("admin.masterData.name")}</TableHead>
                            <TableHead className="w-[80px]">{t("admin.masterData.active")}</TableHead>
                            <TableHead className="w-[100px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => (
                            <TableRow key={item.id}>
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

export default function AdminStamdataPage() {
    const { t } = useI18n()
    const [adminFeePercent, setAdminFeePercent] = useState(() => {
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem("streaming_admin_fee")
            return stored ? Number(stored) : 15
        }
        return 15
    })

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.masterData.title")}
                subtitle={t("admin.masterData.subtitle")}
            />

            <Tabs defaultValue="roles">
                <TabsList>
                    <TabsTrigger value="roles">
                        {t("admin.masterData.roles")}
                    </TabsTrigger>
                    <TabsTrigger value="categories">
                        {t("admin.masterData.categories")}
                    </TabsTrigger>
                    <TabsTrigger value="platforms">
                        Platforme
                    </TabsTrigger>
                    <TabsTrigger value="settings">
                        Indstillinger
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="roles" className="mt-4">
                    <MasterDataTable type="roles" addLabel={t("admin.masterData.addRole")} />
                </TabsContent>

                <TabsContent value="categories" className="mt-4">
                    <MasterDataTable type="categories" addLabel={t("admin.masterData.addCategory")} />
                </TabsContent>

                <TabsContent value="platforms" className="mt-4">
                    <MasterDataTable type="platforms" addLabel="Tilføj platform" />
                </TabsContent>

                <TabsContent value="settings" className="mt-4">
                    <div className="max-w-md space-y-6">
                        <div className="rounded-lg border p-6 space-y-4">
                            <div>
                                <h3 className="text-sm font-medium">Administrationsbidrag — Streaming</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Aktuel procentsats der bruges ved registrering af nye streaming-udbetalinger.
                                    Gælder kun fremadrettet — eksisterende udbetalinger bevarer deres sats.
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                <Input
                                    type="number"
                                    value={adminFeePercent}
                                    onChange={(e) => setAdminFeePercent(Number(e.target.value))}
                                    className="w-24"
                                    step="0.5"
                                    min="0"
                                    max="100"
                                />
                                <span className="text-sm text-muted-foreground font-medium">%</span>
                            </div>

                            {/* Historik */}
                            <div className="space-y-1.5">
                                <p className="text-xs font-medium text-muted-foreground">Historik</p>
                                <div className="rounded-md border divide-y text-xs">
                                    {[
                                        { percent: 15, from: "2024-01-01", by: "Admin" },
                                        { percent: 10, from: "2022-01-01", by: "Admin" },
                                    ].map((h, i) => (
                                        <div key={i} className="flex items-center justify-between px-3 py-2">
                                            <span className="font-medium">{h.percent}%</span>
                                            <span className="text-muted-foreground">fra {h.from}</span>
                                            <span className="text-muted-foreground">{h.by}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <Button size="sm" onClick={() => {
                                // TODO: gem i database + tilføj til historik
                                localStorage.setItem("streaming_admin_fee", String(adminFeePercent))
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
