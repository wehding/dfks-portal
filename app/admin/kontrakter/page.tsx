"use client"

import { useState } from "react"
import { Search, Trash2, Eye } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { useContracts } from "@/lib/hooks"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    pending: "outline",
    review: "secondary",
    approved: "default",
    rejected: "destructive",
}

const statusLabels: Record<string, string> = {
    pending: "admin.contracts.pending",
    review: "admin.contracts.review",
    approved: "admin.contracts.approved",
    rejected: "admin.contracts.rejected",
}

export default function AdminKontrakterPage() {
    const { t } = useI18n()
    const { contracts, deleteContract } = useContracts()
    const [search, setSearch] = useState("")
    const [deleteId, setDeleteId] = useState<string | null>(null)

    const filtered = contracts.filter(
        (c) =>
            c.title.toLowerCase().includes(search.toLowerCase()) ||
            c.userName?.toLowerCase().includes(search.toLowerCase())
    )

    const handleDelete = () => {
        if (deleteId) {
            deleteContract(deleteId)
            setDeleteId(null)
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.contracts.title")}
                subtitle={t("admin.contracts.subtitle")}
            />

            <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("common.search")}
                    className="pl-9"
                />
            </div>

            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("works.workTitle")}</TableHead>
                            <TableHead>{t("admin.contracts.member")}</TableHead>
                            <TableHead>{t("upload.category")}</TableHead>
                            <TableHead>{t("admin.contracts.uploaded")}</TableHead>
                            <TableHead>{t("admin.contracts.status")}</TableHead>
                            <TableHead className="w-[80px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                                    {t("common.noResults")}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filtered.map((c) => (
                                <TableRow key={c.id}>
                                    <TableCell className="font-medium">{c.title}</TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {c.userName}
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-sm">
                                            {t(`cat.${c.category}` as any)}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground tabular-nums">
                                        {c.uploadedAt}
                                    </TableCell>
                                    <TableCell>
                                        <Badge
                                            variant={statusVariant[c.status]}
                                            className="font-normal"
                                        >
                                            {t(statusLabels[c.status] as any)}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            onClick={() => setDeleteId(c.id)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Delete confirmation */}
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
