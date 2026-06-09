"use client"

import { useEffect, useState } from "react"
import { Shield, Mail, Plus, Pencil, Loader2, Clock } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal, KeyRound, Link } from "lucide-react"

type StaffUser = {
    id: string
    email: string | null
    full_name: string
    role: string
    last_sign_in: string | null
    created_at: string
}

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
    superadmin: { label: "Superadmin",  color: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300" },
    admin:      { label: "Admin",       color: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"         },
    "org-admin":{ label: "Org-admin",   color: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"             },
    jurist:     { label: "Jurist",      color: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"     },
    viewer:     { label: "Læser",       color: "bg-muted text-muted-foreground"                                            },
}

const ROLES = ["superadmin", "admin", "org-admin", "jurist", "viewer"]

export default function AdminBrugerePage() {
    const [users, setUsers] = useState<StaffUser[]>([])
    const [loading, setLoading] = useState(true)

    // Invite dialog
    const [inviteOpen, setInviteOpen] = useState(false)
    const [inviteEmail, setInviteEmail] = useState("")
    const [inviteName, setInviteName] = useState("")
    const [inviteRole, setInviteRole] = useState("admin")
    const [inviteLoading, setInviteLoading] = useState(false)
    const [inviteLink, setInviteLink] = useState<string | null>(null)

    // Edit role dialog
    const [editUser, setEditUser] = useState<StaffUser | null>(null)
    const [editRole, setEditRole] = useState("")
    const [editLoading, setEditLoading] = useState(false)

    // Reset password
    const [resetUser, setResetUser] = useState<StaffUser | null>(null)
    const [resetLink, setResetLink] = useState<string | null>(null)
    const [resetLoading, setResetLoading] = useState(false)

    useEffect(() => { loadUsers() }, [])

    async function loadUsers() {
        setLoading(true)
        const res = await fetch("/api/admin/users")
        const json = await res.json()
        if (res.ok) setUsers(json.users ?? [])
        else toast.error(json.error ?? "Kunne ikke hente brugere")
        setLoading(false)
    }

    async function handleInvite() {
        if (!inviteEmail.trim()) return
        setInviteLoading(true)
        try {
            const res = await fetch("/api/admin/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "invite",
                    email: inviteEmail.trim(),
                    name: inviteName.trim() || inviteEmail,
                    rhId: "__staff__",  // Staff-brugere har ikke rettighedshaver-record
                    role: inviteRole,
                }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            // Sæt rolle via PATCH
            await fetch("/api/admin/users", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: json.user_id, role: inviteRole }),
            })
            setInviteLink(json.invite_url)
        } catch (e: any) {
            toast.error(e.message ?? "Fejl ved invitation")
        } finally {
            setInviteLoading(false)
        }
    }

    async function handleEditRole() {
        if (!editUser) return
        setEditLoading(true)
        try {
            const res = await fetch("/api/admin/users", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: editUser.id, role: editRole }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            toast.success("Rolle opdateret")
            setUsers(prev => prev.map(u => u.id === editUser.id ? { ...u, role: editRole } : u))
            setEditUser(null)
        } catch (e: any) {
            toast.error(e.message ?? "Fejl")
        } finally {
            setEditLoading(false)
        }
    }

    async function handleReset() {
        if (!resetUser?.email) return
        setResetLoading(true)
        try {
            const res = await fetch("/api/admin/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reset", userId: resetUser.id, email: resetUser.email }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            setResetLink(json.reset_url)
        } catch (e: any) {
            toast.error(e.message ?? "Fejl")
        } finally {
            setResetLoading(false)
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Brugere"
                subtitle="DFKS-stab med adgang til admin-portalen — admins, jurister og læsere"
                actions={
                    <Button size="sm" onClick={() => { setInviteEmail(""); setInviteName(""); setInviteRole("admin"); setInviteLink(null); setInviteOpen(true) }}>
                        <Plus className="h-4 w-4 mr-1" />Inviter ny bruger
                    </Button>
                }
            />

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Navn</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Rolle</TableHead>
                            <TableHead>Sidst logget ind</TableHead>
                            <TableHead className="w-12" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                                <Loader2 className="inline h-4 w-4 animate-spin mr-2" />Henter...
                            </TableCell></TableRow>
                        ) : users.length === 0 ? (
                            <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                                Ingen staff-brugere endnu
                            </TableCell></TableRow>
                        ) : users.map(u => {
                            const rc = ROLE_CONFIG[u.role] ?? ROLE_CONFIG.viewer
                            return (
                                <TableRow key={u.id}>
                                    <TableCell className="font-medium">{u.full_name}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${rc.color}`}>
                                            <Shield className="h-3 w-3" />{rc.label}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {u.last_sign_in
                                            ? new Date(u.last_sign_in).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
                                            : <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Aldrig</span>}
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => { setEditUser(u); setEditRole(u.role) }}>
                                                    <Pencil className="h-3.5 w-3.5 mr-2" />Skift rolle
                                                </DropdownMenuItem>
                                                {u.email && (
                                                    <DropdownMenuItem onClick={() => { setResetUser(u); setResetLink(null) }}>
                                                        <KeyRound className="h-3.5 w-3.5 mr-2" />Nulstil password
                                                    </DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* Invite dialog */}
            <Dialog open={inviteOpen} onOpenChange={o => { if (!o) setInviteOpen(false) }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Inviter ny bruger</DialogTitle>
                        <DialogDescription>Opret en DFKS-stab bruger med portal-adgang.</DialogDescription>
                    </DialogHeader>
                    {inviteLink ? (
                        <div className="space-y-3 py-2">
                            <p className="text-sm text-emerald-600 font-medium flex items-center gap-1.5"><Link className="h-4 w-4" />Invitationslink genereret</p>
                            <div className="flex gap-2">
                                <Input value={inviteLink} readOnly className="font-mono text-xs" />
                                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(inviteLink); toast.success("Kopieret!") }}>Kopiér</Button>
                            </div>
                            <p className="text-xs text-muted-foreground">Linket er gyldigt i 24 timer.</p>
                        </div>
                    ) : (
                        <div className="space-y-3 py-2">
                            <div className="space-y-1"><Label>Navn</Label><Input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Fornavn Efternavn" /></div>
                            <div className="space-y-1"><Label>Email *</Label><Input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="navn@dfks.dk" /></div>
                            <div className="space-y-1">
                                <Label>Rolle</Label>
                                <Select value={inviteRole} onValueChange={setInviteRole}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ROLES.filter(r => r !== "superadmin").map(r => (
                                            <SelectItem key={r} value={r}>{ROLE_CONFIG[r]?.label ?? r}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setInviteOpen(false)}>{inviteLink ? "Luk" : "Annuller"}</Button>
                        {!inviteLink && (
                            <Button onClick={handleInvite} disabled={inviteLoading || !inviteEmail.trim()}>
                                {inviteLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                <Mail className="h-4 w-4 mr-2" />Generér invitationslink
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit role dialog */}
            <Dialog open={!!editUser} onOpenChange={o => { if (!o) setEditUser(null) }}>
                <DialogContent className="max-w-xs">
                    <DialogHeader>
                        <DialogTitle>Skift rolle</DialogTitle>
                        <DialogDescription>{editUser?.full_name}</DialogDescription>
                    </DialogHeader>
                    <div className="py-2">
                        <Select value={editRole} onValueChange={setEditRole}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {ROLES.map(r => (
                                    <SelectItem key={r} value={r}>{ROLE_CONFIG[r]?.label ?? r}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditUser(null)}>Annuller</Button>
                        <Button onClick={handleEditRole} disabled={editLoading}>
                            {editLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Gem rolle
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reset password dialog */}
            <Dialog open={!!resetUser} onOpenChange={o => { if (!o) { setResetUser(null); setResetLink(null) } }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Nulstil password</DialogTitle>
                        <DialogDescription>{resetUser?.full_name} ({resetUser?.email})</DialogDescription>
                    </DialogHeader>
                    {resetLink ? (
                        <div className="space-y-3 py-2">
                            <p className="text-sm text-emerald-600 font-medium flex items-center gap-1.5"><Link className="h-4 w-4" />Reset-link genereret</p>
                            <div className="flex gap-2">
                                <Input value={resetLink} readOnly className="font-mono text-xs" />
                                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(resetLink); toast.success("Kopieret!") }}>Kopiér</Button>
                            </div>
                            <p className="text-xs text-muted-foreground">Linket er gyldigt i 24 timer.</p>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground py-2">Generér et reset-link som du kan sende til brugeren.</p>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setResetUser(null); setResetLink(null) }}>{resetLink ? "Luk" : "Annuller"}</Button>
                        {!resetLink && (
                            <Button onClick={handleReset} disabled={resetLoading}>
                                {resetLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                <KeyRound className="h-4 w-4 mr-2" />Generér reset-link
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
