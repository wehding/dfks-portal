"use client"

import { useState, useMemo } from "react"
import {
    Plus,
    Search,
    CheckCircle2,
    AlertCircle,
    ExternalLink,
    Filter,
} from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { mockCredits } from "@/lib/mock-data"
import type { CreditEntry } from "@/lib/types"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

const categoryLabels: Record<string, string> = {
    feature: "Spillefilm",
    short: "Kortfilm",
    tvSeries: "TV-Serie",
    documentary: "Dokumentar",
    docSeries: "Dokumentarserie",
    tvEntertainment: "TV-underholdning",
    reality: "Reality",
    sport: "Sport",
}

export default function AdminKrediteringerPage() {
    const { t } = useI18n()
    const [credits, setCredits] = useState<CreditEntry[]>(mockCredits)
    const [search, setSearch] = useState("")
    const [filterVerified, setFilterVerified] = useState<"all" | "verified" | "unverified">("all")

    const filtered = useMemo(() => {
        let result = credits
        if (search.trim()) {
            const q = search.toLowerCase()
            result = result.filter(
                (c) =>
                    c.workTitle.toLowerCase().includes(q) ||
                    c.memberName.toLowerCase().includes(q) ||
                    c.producerName.toLowerCase().includes(q)
            )
        }
        if (filterVerified === "verified") result = result.filter((c) => c.verified)
        if (filterVerified === "unverified") result = result.filter((c) => !c.verified)
        return result
    }, [credits, search, filterVerified])

    const verifiedCount = credits.filter((c) => c.verified).length
    const unverifiedCount = credits.filter((c) => !c.verified).length

    const handleVerify = (id: string) => {
        setCredits((prev) =>
            prev.map((c) => (c.id === id ? { ...c, verified: true } : c))
        )
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.credits.title")}
                subtitle={t("admin.credits.subtitle")}
                actions={
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button size="sm" className="gap-1.5">
                                <Plus className="h-4 w-4" />
                                {t("admin.credits.addCredit")}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>{t("admin.credits.addCredit")}</DialogTitle>
                                <DialogDescription>
                                    Tilføj en ny kreditering til registeret
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 pt-2">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.credits.work")}</Label>
                                        <Input placeholder="Værktitel..." />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.credits.premiere")}
                                        </Label>
                                        <Input type="number" placeholder="2025" />
                                    </div>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.credits.member")}</Label>
                                        <Input placeholder="Medlemsnavn..." />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.credits.role")}</Label>
                                        <Input placeholder="Klipper..." />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.credits.producer")}</Label>
                                    <Input placeholder="Producentselskab..." />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.credits.imdb")} URL</Label>
                                    <Input placeholder="https://www.imdb.com/title/..." />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button>{t("admin.credits.addCredit")}</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                }
            />

            {/* Summary badges */}
            <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline" className="gap-1.5 text-sm py-1 px-3">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    {verifiedCount} {t("admin.credits.verified").toLowerCase()}
                </Badge>
                <Badge variant="outline" className="gap-1.5 text-sm py-1 px-3">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                    {unverifiedCount} {t("admin.credits.unverified").toLowerCase()}
                </Badge>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder={t("common.search")}
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <Select
                    value={filterVerified}
                    onValueChange={(v) => setFilterVerified(v as "all" | "verified" | "unverified")}
                >
                    <SelectTrigger className="w-[180px]">
                        <Filter className="mr-2 h-3.5 w-3.5" />
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle krediteringer</SelectItem>
                        <SelectItem value="verified">
                            ✓ {t("admin.credits.verified")}
                        </SelectItem>
                        <SelectItem value="unverified">
                            ○ {t("admin.credits.unverified")}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Credits Table */}
            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("admin.credits.work")}</TableHead>
                            <TableHead>Kategori</TableHead>
                            <TableHead>{t("admin.credits.premiere")}</TableHead>
                            <TableHead>{t("admin.credits.member")}</TableHead>
                            <TableHead>{t("admin.credits.role")}</TableHead>
                            <TableHead>{t("admin.credits.producer")}</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-[100px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                    {t("common.noResults")}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filtered.map((credit) => (
                                <TableRow key={credit.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            {credit.workTitle}
                                            {credit.imdbUrl && (
                                                <a
                                                    href={credit.imdbUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-muted-foreground hover:text-foreground"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <ExternalLink className="h-3 w-3" />
                                                </a>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className="text-xs font-normal">
                                            {categoryLabels[credit.category] || credit.category}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="tabular-nums">
                                        {credit.premiereYear}
                                    </TableCell>
                                    <TableCell>{credit.memberName}</TableCell>
                                    <TableCell>{credit.creditedRoles.join(", ")}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {credit.producerName}
                                    </TableCell>
                                    <TableCell>
                                        {credit.verified ? (
                                            <Badge
                                                variant="outline"
                                                className="gap-1 text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30"
                                            >
                                                <CheckCircle2 className="h-3 w-3" />
                                                {t("admin.credits.verified")}
                                            </Badge>
                                        ) : (
                                            <Badge
                                                variant="outline"
                                                className="gap-1 text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30"
                                            >
                                                <AlertCircle className="h-3 w-3" />
                                                {t("admin.credits.unverified")}
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {!credit.verified && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1 text-xs"
                                                onClick={() => handleVerify(credit.id)}
                                            >
                                                <CheckCircle2 className="h-3 w-3" />
                                                {t("admin.credits.verify")}
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Notes section for unverified */}
            {filtered.some((c) => !c.verified && c.notes) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 p-4">
                    <h4 className="text-sm font-medium mb-2 text-amber-800 dark:text-amber-200">
                        Noter til uverificerede krediteringer
                    </h4>
                    <ul className="space-y-1">
                        {filtered
                            .filter((c) => !c.verified && c.notes)
                            .map((c) => (
                                <li key={c.id} className="text-sm text-amber-700 dark:text-amber-300">
                                    <span className="font-medium">{c.workTitle}</span>
                                    {" — "}
                                    {c.notes}
                                </li>
                            ))}
                    </ul>
                </div>
            )}
        </div>
    )
}
