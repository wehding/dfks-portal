"use client"

import { useState, useMemo } from "react"
import {
    Users2,
    UserPlus,
    Mail,
    Phone,
    Shield,
    Search,
    MoreHorizontal,
    FileText,
    Pencil,
    Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import { mockUsers as initialUsers, mockContracts } from "@/lib/mock-data"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { User } from "@/lib/types"

export default function AdminBrugerePage() {
    const { t } = useI18n()
    const [users, setUsers] = useState<User[]>(initialUsers)
    const [searchQuery, setSearchQuery] = useState("")
    const [statusFilter, setStatusFilter] = useState<string>("all")
    const [roleFilter, setRoleFilter] = useState<string>("all")

    // Dialog state
    const [showCreateDialog, setShowCreateDialog] = useState(false)
    const [editingUser, setEditingUser] = useState<User | null>(null)
    const [deleteId, setDeleteId] = useState<string | null>(null)

    // Form state
    const [formName, setFormName] = useState("")
    const [formEmail, setFormEmail] = useState("")
    const [formPhone, setFormPhone] = useState("")
    const [formCpr, setFormCpr] = useState("")
    const [formRole, setFormRole] = useState<"member" | "admin">("member")

    // Summary stats (derived from local state)
    const totalMembers = users.length
    const activeMembers = users.filter((u) => u.status === "active").length
    const newThisYear = users.filter(
        (u) => new Date(u.memberSince).getFullYear() === new Date().getFullYear()
    ).length

    const contractCountByUser = useMemo(() => {
        const map: Record<string, number> = {}
        mockContracts.forEach((c) => {
            map[c.userId] = (map[c.userId] || 0) + 1
        })
        return map
    }, [])

    const filteredUsers = useMemo(() => {
        let list = users
        if (statusFilter !== "all") list = list.filter((u) => u.status === statusFilter)
        if (roleFilter !== "all") list = list.filter((u) => u.role === roleFilter)
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            list = list.filter(
                (u) =>
                    u.name.toLowerCase().includes(q) ||
                    u.email.toLowerCase().includes(q) ||
                    u.phone?.includes(q)
            )
        }
        return list
    }, [users, statusFilter, roleFilter, searchQuery])

    // ── Handlers ──────────────────────────────────────────────

    const resetForm = () => {
        setFormName("")
        setFormEmail("")
        setFormPhone("")
        setFormCpr("")
        setFormRole("member")
    }

    const openCreate = () => {
        resetForm()
        setEditingUser(null)
        setShowCreateDialog(true)
    }

    const openEdit = (user: User) => {
        setFormName(user.name)
        setFormEmail(user.email)
        setFormPhone(user.phone || "")
        setFormCpr(user.cprNumber || "")
        setFormRole(user.role)
        setEditingUser(user)
        setShowCreateDialog(true)
    }

    const handleSave = () => {
        if (!formName.trim() || !formEmail.trim()) {
            toast.error("Udfyld mindst navn og e-mail")
            return
        }

        if (editingUser) {
            // Update
            setUsers((prev) =>
                prev.map((u) =>
                    u.id === editingUser.id
                        ? {
                            ...u,
                            name: formName.trim(),
                            email: formEmail.trim(),
                            phone: formPhone.trim() || undefined,
                            cprNumber: formCpr.trim() || undefined,
                            role: formRole,
                        }
                        : u
                )
            )
            toast.success(`${formName} er opdateret`)
        } else {
            // Create
            const newUser: User = {
                id: `u${Date.now()}`,
                name: formName.trim(),
                email: formEmail.trim(),
                phone: formPhone.trim() || undefined,
                cprNumber: formCpr.trim() || undefined,
                role: formRole,
                status: "active",
                memberSince: new Date().toISOString().split("T")[0],
            }
            setUsers((prev) => [newUser, ...prev])
            toast.success(`${formName} er oprettet`)
        }

        setShowCreateDialog(false)
        resetForm()
        setEditingUser(null)
    }

    const handleDelete = () => {
        if (!deleteId) return
        const user = users.find((u) => u.id === deleteId)
        setUsers((prev) => prev.filter((u) => u.id !== deleteId))
        setDeleteId(null)
        if (user) toast.success(`${user.name} er slettet`)
    }

    const toggleStatus = (id: string) => {
        setUsers((prev) =>
            prev.map((u) => {
                if (u.id !== id) return u
                const next = u.status === "active" ? "inactive" : "active"
                toast.info(`${u.name} er nu ${next === "active" ? "aktiv" : "inaktiv"}`)
                return { ...u, status: next }
            })
        )
    }

    // ── Badge helpers ─────────────────────────────────────────

    const statusBadge = (status: string) => {
        switch (status) {
            case "active":
                return (
                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/15">
                        {t("admin.users.active")}
                    </Badge>
                )
            case "inactive":
                return (
                    <Badge className="bg-red-500/10 text-red-600 border-red-500/20 hover:bg-red-500/15">
                        {t("admin.users.inactive")}
                    </Badge>
                )
            case "pending":
                return (
                    <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/15">
                        {t("admin.users.pending")}
                    </Badge>
                )
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    const roleBadge = (role: string) => {
        switch (role) {
            case "admin":
                return (
                    <Badge className="bg-violet-500/10 text-violet-600 border-violet-500/20 hover:bg-violet-500/15 gap-1">
                        <Shield className="h-3 w-3" />
                        {t("admin.users.admin")}
                    </Badge>
                )
            case "member":
                return (
                    <Badge variant="secondary" className="font-normal">
                        {t("admin.users.member")}
                    </Badge>
                )
            default:
                return <Badge variant="outline">{role}</Badge>
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.users.title")}
                subtitle={t("admin.users.subtitle")}
                actions={
                    <Button size="sm" className="gap-1.5" onClick={openCreate}>
                        <UserPlus className="h-4 w-4" />
                        {t("admin.users.addUser")}
                    </Button>
                }
            />

            {/* Summary Cards */}
            <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                                <Users2 className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">{t("admin.users.totalMembers")}</p>
                                <p className="text-xl font-bold tabular-nums">{totalMembers}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                                <Users2 className="h-5 w-5 text-emerald-500" />
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">{t("admin.users.activeMembers")}</p>
                                <p className="text-xl font-bold tabular-nums text-emerald-600">{activeMembers}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                                <UserPlus className="h-5 w-5 text-blue-500" />
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">{t("admin.users.newThisYear")}</p>
                                <p className="text-xl font-bold tabular-nums">{newThisYear}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t("common.search")}
                        className="w-[260px] pl-8"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[150px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle status</SelectItem>
                        <SelectItem value="active">{t("admin.users.active")}</SelectItem>
                        <SelectItem value="inactive">{t("admin.users.inactive")}</SelectItem>
                        <SelectItem value="pending">{t("admin.users.pending")}</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-[150px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle roller</SelectItem>
                        <SelectItem value="member">{t("admin.users.member")}</SelectItem>
                        <SelectItem value="admin">{t("admin.users.admin")}</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Table */}
            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("admin.users.name")}</TableHead>
                            <TableHead>{t("admin.users.email")}</TableHead>
                            <TableHead>{t("admin.users.phone")}</TableHead>
                            <TableHead>{t("admin.users.cpr")}</TableHead>
                            <TableHead>{t("admin.users.role")}</TableHead>
                            <TableHead>{t("admin.users.memberSince")}</TableHead>
                            <TableHead className="text-right">{t("admin.users.contracts")}</TableHead>
                            <TableHead>{t("admin.users.status")}</TableHead>
                            <TableHead className="w-[50px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredUsers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                                    {t("common.noResults")}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredUsers.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-2.5">
                                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                                                {user.name.split(" ").map((n) => n[0]).join("")}
                                            </div>
                                            <span className="font-medium">{user.name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1.5 text-sm">
                                            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                            {user.email}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1.5 text-sm tabular-nums">
                                            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                            {user.phone || "—"}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-sm tabular-nums font-mono text-muted-foreground">
                                            {user.cprNumber || "—"}
                                        </span>
                                    </TableCell>
                                    <TableCell>{roleBadge(user.role)}</TableCell>
                                    <TableCell className="tabular-nums text-sm">
                                        {new Date(user.memberSince).toLocaleDateString("da-DK")}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        <div className="flex items-center justify-end gap-1.5">
                                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                            {contractCountByUser[user.id] || 0}
                                        </div>
                                    </TableCell>
                                    <TableCell>{statusBadge(user.status)}</TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem
                                                    className="gap-2"
                                                    onClick={() => openEdit(user)}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                    {t("common.edit")}
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    className="gap-2"
                                                    onClick={() => toggleStatus(user.id)}
                                                >
                                                    <Shield className="h-3.5 w-3.5" />
                                                    {user.status === "active" ? "Deaktiver" : "Aktiver"}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    className="gap-2 text-destructive"
                                                    onClick={() => setDeleteId(user.id)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                    {t("common.delete")}
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Create / Edit Dialog */}
            <Dialog
                open={showCreateDialog}
                onOpenChange={(o) => {
                    if (!o) { setShowCreateDialog(false); setEditingUser(null); resetForm() }
                }}
            >
                <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserPlus className="h-5 w-5" />
                            {editingUser ? `Rediger — ${editingUser.name}` : t("admin.users.addUser")}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="user-name">{t("admin.users.name")} *</Label>
                            <Input
                                id="user-name"
                                placeholder="Jens Jensen"
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="user-email">{t("admin.users.email")} *</Label>
                            <Input
                                id="user-email"
                                type="email"
                                placeholder="jens@mail.dk"
                                value={formEmail}
                                onChange={(e) => setFormEmail(e.target.value)}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="user-phone">{t("admin.users.phone")}</Label>
                                <Input
                                    id="user-phone"
                                    type="tel"
                                    placeholder="+45 12 34 56 78"
                                    value={formPhone}
                                    onChange={(e) => setFormPhone(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="user-cpr">{t("admin.users.cpr")}</Label>
                                <Input
                                    id="user-cpr"
                                    placeholder="DDMMYY-XXXX"
                                    className="font-mono"
                                    value={formCpr}
                                    onChange={(e) => setFormCpr(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>{t("admin.users.role")}</Label>
                            <Select value={formRole} onValueChange={(v) => setFormRole(v as "member" | "admin")}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="member">{t("admin.users.member")}</SelectItem>
                                    <SelectItem value="admin">{t("admin.users.admin")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowCreateDialog(false); resetForm(); setEditingUser(null) }}>
                            {t("common.cancel")}
                        </Button>
                        <Button onClick={handleSave}>
                            {editingUser ? t("common.save") : t("admin.users.addUser")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null) }}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>{t("common.delete")}</DialogTitle>
                        <DialogDescription>{t("common.deleteConfirm")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>
                            {t("common.cancel")}
                        </Button>
                        <Button variant="destructive" onClick={handleDelete}>
                            {t("common.delete")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
