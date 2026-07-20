"use client"

import { useEffect, useState, useMemo } from "react"
import {
    Shield, Mail, Plus, Pencil, Loader2, Clock, MoreHorizontal,
    KeyRound, Link, UserX, UserCheck, Search, Users, Scale, UserCog,
    Check,
} from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// ── Typer ─────────────────────────────────────────────────

type User = {
    id: string
    rh_id: string | null
    email: string | null
    full_name: string
    roles: string[]
    org_roles: string[]
    is_rettighedshaver: boolean
    onboarding_completed: boolean | null
    gender: string | null
    phone: string | null
    title: string | null
    banned: boolean
    last_sign_in: string | null
    created_at: string
}

type Rettighedshaver = {
    id: string
    full_name: string
    email: string | null
}

type UsersResponse = {
    users?: User[]
    staff?: Array<Partial<User> & { roles?: string[] }>
    portal?: Array<Partial<User>>
    error?: string
    callerRole?: string
    callerUserId?: string
}

// ── Rolle-konfiguration ───────────────────────────────────

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
    superadmin:       { label: "Superadmin",      color: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300" },
    admin:            { label: "Admin",            color: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300" },
    "org-admin":      { label: "Org-admin",        color: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300" },
    jurist:           { label: "Jurist",           color: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
    viewer:           { label: "Læser",            color: "bg-muted text-muted-foreground" },
    rettighedshaver:  { label: "Rettighedshaver",  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
}

const BASE_STAFF_ROLES: Array<keyof typeof ROLE_CONFIG> = ["admin", "org-admin", "jurist", "viewer"]

const GENDER_LABELS: Record<string, string> = {
    female: "Kvinde",
    male: "Mand",
    non_binary: "Nonbinær",
    other: "Andet",
    prefer_not_to_say: "Ønsker ikke at oplyse",
}

function errorMessage(error: unknown, fallback = "Fejl") {
    return error instanceof Error ? error.message : fallback
}

// ── Hjælpekomponenter ─────────────────────────────────────

function RoleChips({ roles }: { roles: string[] }) {
    return (
        <div className="flex flex-wrap gap-1">
            {roles.map(r => {
                const cfg = ROLE_CONFIG[r] ?? ROLE_CONFIG.viewer
                return (
                    <span key={r} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                        <Shield className="h-3 w-3" />{cfg.label}
                    </span>
                )
            })}
        </div>
    )
}

function StatusBadge({ lastSignIn, banned }: { lastSignIn: string | null; banned: boolean }) {
    if (banned) return (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">
            <UserX className="h-3 w-3" />Deaktiveret
        </span>
    )
    if (!lastSignIn) return (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
            <Clock className="h-3 w-3" />Invitation afventer
        </span>
    )
    return (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <UserCheck className="h-3 w-3" />Aktiv
        </span>
    )
}

function RoleToggle({ role, selected, onToggle }: { role: string; selected: boolean; onToggle: () => void }) {
    const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.viewer
    return (
        <button
            type="button"
            onClick={onToggle}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors border ${
                selected
                    ? "border-primary/30 bg-primary/5 text-foreground font-medium"
                    : "border-transparent hover:bg-muted text-muted-foreground"
            }`}
        >
            <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                selected ? "bg-primary border-primary" : "border-input"
            }`}>
                {selected && <Check className="h-3 w-3 text-primary-foreground" />}
            </span>
            {cfg.label}
        </button>
    )
}

// ── Tabs ──────────────────────────────────────────────────

type Tab = "alle" | "admins" | "jurister" | "rettighedshavere"

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "alle",              label: "Alle",              icon: Users     },
    { key: "admins",            label: "Admins",            icon: UserCog   },
    { key: "jurister",          label: "Jurister",          icon: Scale     },
    { key: "rettighedshavere",  label: "Rettighedshavere",  icon: UserCheck },
]

// ── Hovedkomponent ────────────────────────────────────────

export default function AdminBrugerePage() {
    const [users, setUsers] = useState<User[]>([])
    const [callerRole, setCallerRole] = useState("")
    const [loading, setLoading] = useState(true)
    const [tab, setTab] = useState<Tab>("alle")
    const [search, setSearch] = useState("")

    // Invite dialog
    const [inviteOpen, setInviteOpen] = useState(false)
    const [inviteEmail, setInviteEmail] = useState("")
    const [inviteName, setInviteName] = useState("")
    const [invitePhone, setInvitePhone] = useState("")
    const [inviteTitle, setInviteTitle] = useState("")
    const [inviteRoles, setInviteRoles] = useState<string[]>(["jurist"])
    const [inviteIsPortal, setInviteIsPortal] = useState(false)
    const [inviteRhSearch, setInviteRhSearch] = useState("")
    const [inviteRhResults, setInviteRhResults] = useState<Rettighedshaver[]>([])
    const [inviteRhSelected, setInviteRhSelected] = useState<Rettighedshaver | null>(null)
    const [inviteLoading, setInviteLoading] = useState(false)
    const [inviteLink, setInviteLink] = useState<string | null>(null)

    // Rediger roller dialog
    const [editUser, setEditUser] = useState<User | null>(null)
    const [editRoles, setEditRoles] = useState<string[]>([])
    const [editLoading, setEditLoading] = useState(false)

    // Nulstil password
    const [resetUser, setResetUser] = useState<User | null>(null)
    const [resetLink, setResetLink] = useState<string | null>(null)
    const [resetLoading, setResetLoading] = useState(false)

    // Deaktiver / genaktiver
    const [toggleUser, setToggleUser] = useState<User | null>(null)
    const [toggleLoading, setToggleLoading] = useState(false)

    useEffect(() => { load() }, [])

    async function load() {
        setLoading(true)
        const res = await fetch("/api/admin/users")
        const json = await res.json() as UsersResponse
        if (res.ok) {
            setCallerRole(json.callerRole ?? "")
            // Brug merged users hvis tilgængeligt, ellers bagudkompatibel sammensætning
            if (json.users) {
                setUsers(json.users)
            } else {
                const staff = (json.staff ?? []).map(u => ({ ...u, org_roles: u.roles ?? [], is_rettighedshaver: false, rh_id: null, onboarding_completed: null, gender: null }) as User)
                const portal = (json.portal ?? []).map(u => ({ ...u, org_roles: [], is_rettighedshaver: true, roles: ["rettighedshaver"] }) as User)
                setUsers([...staff, ...portal])
            }
        } else {
            toast.error(json.error ?? "Kunne ikke hente brugere")
        }
        setLoading(false)
    }

    const filtered = useMemo<User[]>(() => {
        const s = search.toLowerCase()
        const match = (u: User) =>
            !s || u.full_name.toLowerCase().includes(s) || (u.email ?? "").toLowerCase().includes(s)
        switch (tab) {
            case "admins":           return users.filter(u => u.org_roles.some(r => ["admin", "org-admin", "superadmin"].includes(r)) && match(u))
            case "jurister":         return users.filter(u => u.org_roles.includes("jurist") && match(u))
            case "rettighedshavere": return users.filter(u => u.is_rettighedshaver && match(u))
            default:                 return users.filter(match)
        }
    }, [users, tab, search])

    const counts = useMemo(() => ({
        alle:             users.length,
        admins:           users.filter(u => u.org_roles.some(r => ["admin", "org-admin", "superadmin"].includes(r))).length,
        jurister:         users.filter(u => u.org_roles.includes("jurist")).length,
        rettighedshavere: users.filter(u => u.is_rettighedshaver).length,
    }), [users])
    const staffRoles = callerRole === "superadmin"
        ? (["superadmin", ...BASE_STAFF_ROLES] as Array<keyof typeof ROLE_CONFIG>)
        : BASE_STAFF_ROLES

    function toggleStaffRole(roles: string[], role: string) {
        if (role === "superadmin") {
            const confirmed = window.confirm(roles.includes(role)
                ? "Vil du fjerne superadmin-adgangen fra denne bruger?"
                : "Superadmin giver adgang til alle organisationens funktioner og brugerroller. Vil du fortsætte?")
            if (!confirmed) return roles
        }
        return toggleRole(roles, role)
    }

    useEffect(() => {
        if (!inviteIsPortal || inviteRhSearch.length < 2) {
            setInviteRhResults([])
            return
        }
        const tid = setTimeout(async () => {
            const res = await fetch(`/api/admin/rettighedshavere-search?q=${encodeURIComponent(inviteRhSearch)}`)
            if (res.ok) setInviteRhResults(await res.json())
        }, 300)
        return () => clearTimeout(tid)
    }, [inviteRhSearch, inviteIsPortal])

    function toggleRole(roles: string[], role: string): string[] {
        return roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role]
    }

    async function handleInvite() {
        if (!inviteEmail.trim()) return
        if (inviteIsPortal && !inviteRhSelected) {
            toast.error("Vælg en rettighedshaver at tilknytte portalbrugeren til")
            return
        }
        if (!inviteIsPortal && inviteRoles.length === 0) {
            toast.error("Vælg mindst én rolle")
            return
        }
        setInviteLoading(true)
        try {
            const res = await fetch("/api/admin/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "invite",
                    email: inviteEmail.trim(),
                    name: inviteName.trim() || inviteEmail.trim(),
                    rhId: inviteIsPortal ? inviteRhSelected!.id : "__staff__",
                    roles: inviteIsPortal ? [] : inviteRoles,
                    role: inviteIsPortal ? "member" : inviteRoles[0],
                    phone: invitePhone.trim() || undefined,
                    title: inviteTitle.trim() || undefined,
                }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            setInviteLink(json.invite_url)
            await load()
        } catch (e: unknown) {
            toast.error(errorMessage(e, "Fejl ved invitation"))
        } finally {
            setInviteLoading(false)
        }
    }

    async function handleEditRoles() {
        if (!editUser || editRoles.length === 0) return
        setEditLoading(true)
        try {
            const res = await fetch("/api/admin/users", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "set-roles", userId: editUser.id, roles: editRoles }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            toast.success("Roller opdateret")
            await load()
            setEditUser(null)
        } catch (e: unknown) {
            toast.error(errorMessage(e))
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
        } catch (e: unknown) {
            toast.error(errorMessage(e))
        } finally {
            setResetLoading(false)
        }
    }

    async function handleToggle() {
        if (!toggleUser) return
        setToggleLoading(true)
        try {
            const res = await fetch("/api/admin/users", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: toggleUser.banned ? "activate" : "deactivate",
                    userId: toggleUser.id,
                }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            toast.success(toggleUser.banned ? "Konto genaktiveret" : "Konto deaktiveret")
            await load()
            setToggleUser(null)
        } catch (e: unknown) {
            toast.error(errorMessage(e))
        } finally {
            setToggleLoading(false)
        }
    }

    function openInvite(forPortal = false) {
        setInviteEmail("")
        setInviteName("")
        setInvitePhone("")
        setInviteTitle("")
        setInviteRoles(["jurist"])
        setInviteIsPortal(forPortal)
        setInviteRhSearch("")
        setInviteRhResults([])
        setInviteRhSelected(null)
        setInviteLink(null)
        setInviteOpen(true)
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Brugere"
                subtitle="Administrer stab, jurister og rettighedshavere"
                actions={
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                        <Button size="sm" variant="outline" onClick={() => openInvite(true)}>
                            <Plus className="h-4 w-4 mr-1" />Ny rettighedshaver
                        </Button>
                        <Button size="sm" onClick={() => openInvite(false)}>
                            <Plus className="h-4 w-4 mr-1" />Inviter stab
                        </Button>
                    </div>
                }
            />

            {/* Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto border-b">
                {TABS.map(t => {
                    const Icon = t.icon
                    const active = tab === t.key
                    return (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                                active
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Icon className="h-3.5 w-3.5" />
                            {t.label}
                            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {counts[t.key]}
                            </span>
                        </button>
                    )
                })}
            </div>

            {/* Søg */}
            <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                    placeholder="Søg navn eller e-mail…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                />
            </div>

            {/* Tabel */}
            <MobileCardList>
                {loading ? (
                    <MobileDataCard>
                        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />Henter...
                        </div>
                    </MobileDataCard>
                ) : filtered.length === 0 ? (
                    <MobileDataCard>
                        <p className="py-6 text-center text-sm text-muted-foreground">Ingen brugere fundet</p>
                    </MobileDataCard>
                ) : filtered.map(u => (
                    <MobileDataCard key={u.id} className={u.banned ? "opacity-60" : ""}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate font-medium">{u.full_name}</p>
                                <p className="mt-1 truncate text-sm text-muted-foreground">{u.email ?? "Ingen email"}</p>
                            </div>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {u.org_roles.length > 0 && (callerRole === "superadmin" || !u.org_roles.includes("superadmin")) && (
                                        <DropdownMenuItem onClick={() => {
                                            setEditUser(u)
                                            setEditRoles(u.org_roles.slice())
                                        }}>
                                            <Pencil className="h-3.5 w-3.5 mr-2" />Skift rolle(r)
                                        </DropdownMenuItem>
                                    )}
                                    {u.email && (
                                        <DropdownMenuItem onClick={() => { setResetUser(u); setResetLink(null) }}>
                                            <KeyRound className="h-3.5 w-3.5 mr-2" />Nulstil password
                                        </DropdownMenuItem>
                                    )}
                                    {callerRole === "superadmin" && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() => setToggleUser(u)}
                                                className={u.banned ? "text-emerald-600" : "text-destructive"}
                                            >
                                                {u.banned
                                                    ? <><UserCheck className="h-3.5 w-3.5 mr-2" />Genaktiver konto</>
                                                    : <><UserX className="h-3.5 w-3.5 mr-2" />Deaktiver konto</>
                                                }
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <MobileMetaRow label="Telefon">{u.phone ?? "—"}</MobileMetaRow>
                            <MobileMetaRow label="Titel">{u.title ?? "—"}</MobileMetaRow>
                            <MobileMetaRow label="Status"><StatusBadge lastSignIn={u.last_sign_in} banned={u.banned} /></MobileMetaRow>
                            <MobileMetaRow label="Sidst logget ind">
                                {u.last_sign_in
                                    ? new Date(u.last_sign_in).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
                                    : "—"}
                            </MobileMetaRow>
                        </div>
                        <div className="mt-3">
                            <RoleChips roles={u.roles} />
                        </div>
                    </MobileDataCard>
                ))}
            </MobileCardList>

            <ResponsiveTableFrame className="rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Navn</TableHead>
                            <TableHead>E-mail</TableHead>
                            <TableHead>Telefon</TableHead>
                            <TableHead>Køn</TableHead>
                            <TableHead>Titel</TableHead>
                            <TableHead>Rolle(r)</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Sidst logget ind</TableHead>
                            <TableHead className="w-12" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />Henter...
                                </TableCell>
                            </TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                                    Ingen brugere fundet
                                </TableCell>
                            </TableRow>
                        ) : filtered.map(u => (
                            <TableRow key={u.id} className={u.banned ? "opacity-50" : ""}>
                                <TableCell className="font-medium">{u.full_name}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{u.phone ?? "—"}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{u.gender ? GENDER_LABELS[u.gender] ?? u.gender : "—"}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{u.title ?? "—"}</TableCell>
                                <TableCell><RoleChips roles={u.roles} /></TableCell>
                                <TableCell>
                                    <StatusBadge lastSignIn={u.last_sign_in} banned={u.banned} />
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                    {u.last_sign_in
                                        ? new Date(u.last_sign_in).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
                                        : "—"}
                                </TableCell>
                                <TableCell>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-7 w-7">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            {u.org_roles.length > 0 && (callerRole === "superadmin" || !u.org_roles.includes("superadmin")) && (
                                                <DropdownMenuItem onClick={() => {
                                                    setEditUser(u)
                                                    setEditRoles(u.org_roles.slice())
                                                }}>
                                                    <Pencil className="h-3.5 w-3.5 mr-2" />Skift rolle(r)
                                                </DropdownMenuItem>
                                            )}
                                            {u.email && (
                                                <DropdownMenuItem onClick={() => { setResetUser(u); setResetLink(null) }}>
                                                    <KeyRound className="h-3.5 w-3.5 mr-2" />Nulstil password
                                                </DropdownMenuItem>
                                            )}
                                            {callerRole === "superadmin" && (
                                                <>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() => setToggleUser(u)}
                                                        className={u.banned ? "text-emerald-600" : "text-destructive"}
                                                    >
                                                        {u.banned
                                                            ? <><UserCheck className="h-3.5 w-3.5 mr-2" />Genaktiver konto</>
                                                            : <><UserX className="h-3.5 w-3.5 mr-2" />Deaktiver konto</>
                                                        }
                                                    </DropdownMenuItem>
                                                </>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ResponsiveTableFrame>

            {/* ── Invite dialog ── */}
            <Dialog open={inviteOpen} onOpenChange={o => { if (!o) setInviteOpen(false) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{inviteIsPortal ? "Opret portalbruger" : "Inviter stab"}</DialogTitle>
                        <DialogDescription>
                            {inviteIsPortal
                                ? "Giver et eksisterende rettighedshaver-medlem adgang til portalen."
                                : "Opret en DFKS-stab bruger med admin-portal-adgang."}
                        </DialogDescription>
                    </DialogHeader>

                    {inviteLink ? (
                        <div className="space-y-3 py-2">
                            <p className="text-sm text-emerald-600 font-medium flex items-center gap-1.5">
                                <Link className="h-4 w-4" />Invitationslink genereret
                            </p>
                            <div className="flex gap-2">
                                <Input value={inviteLink} readOnly className="font-mono text-xs" />
                                <Button variant="outline" size="sm" onClick={() => {
                                    navigator.clipboard.writeText(inviteLink)
                                    toast.success("Kopieret!")
                                }}>Kopiér</Button>
                            </div>
                            <p className="text-xs text-muted-foreground">Linket er gyldigt i 24 timer.</p>
                        </div>
                    ) : (
                        <div className="space-y-4 py-2">
                            <div className="space-y-1.5">
                                <Label>Navn</Label>
                                <Input
                                    value={inviteName}
                                    onChange={e => setInviteName(e.target.value)}
                                    placeholder="Fornavn Efternavn"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>E-mail *</Label>
                                <Input
                                    type="email"
                                    value={inviteEmail}
                                    onChange={e => setInviteEmail(e.target.value)}
                                    placeholder="navn@dfks.dk"
                                />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label>Telefon</Label>
                                    <Input
                                        type="tel"
                                        value={invitePhone}
                                        onChange={e => setInvitePhone(e.target.value)}
                                        placeholder="+45 12 34 56 78"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Titel / funktion</Label>
                                    <Input
                                        value={inviteTitle}
                                        onChange={e => setInviteTitle(e.target.value)}
                                        placeholder="f.eks. Jurist"
                                    />
                                </div>
                            </div>

                            {inviteIsPortal ? (
                                <div className="space-y-1.5">
                                    <Label>Tilknyt rettighedshaver *</Label>
                                    {inviteRhSelected ? (
                                        <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                                            <span className="font-medium">{inviteRhSelected.full_name}</span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 text-xs text-muted-foreground"
                                                onClick={() => setInviteRhSelected(null)}
                                            >Fjern</Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            <Input
                                                placeholder="Søg efter navn…"
                                                value={inviteRhSearch}
                                                onChange={e => setInviteRhSearch(e.target.value)}
                                            />
                                            {inviteRhResults.length > 0 && (
                                                <div className="rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                                                    {inviteRhResults.map(rh => (
                                                        <button
                                                            key={rh.id}
                                                            className="w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                                                            onClick={() => {
                                                                setInviteRhSelected(rh)
                                                                if (!inviteEmail && rh.email) setInviteEmail(rh.email)
                                                                if (!inviteName) setInviteName(rh.full_name)
                                                                setInviteRhSearch("")
                                                                setInviteRhResults([])
                                                            }}
                                                        >
                                                            <span className="font-medium">{rh.full_name}</span>
                                                            {rh.email && (
                                                                <span className="ml-2 text-muted-foreground">{rh.email}</span>
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    <Label>Rolle(r) *</Label>
                                    <div className="space-y-0.5">
                                        {staffRoles.map(r => (
                                            <RoleToggle
                                                key={r}
                                                role={r}
                                                selected={inviteRoles.includes(r)}
                                                onToggle={() => setInviteRoles(prev => toggleStaffRole(prev, r))}
                                            />
                                        ))}
                                    </div>
                                    {inviteRoles.length === 1 && (
                                        <p className="text-xs text-muted-foreground pt-0.5">
                                            {inviteRoles[0] === "admin" && "Fuld adgang til alle admin-funktioner"}
                                            {inviteRoles[0] === "org-admin" && "Administrerer brugere og indstillinger for org"}
                                            {inviteRoles[0] === "jurist" && "Kan behandle og besvare kontraktgennemgange"}
                                            {inviteRoles[0] === "viewer" && "Læseadgang — kan ikke redigere"}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setInviteOpen(false)}>
                            {inviteLink ? "Luk" : "Annuller"}
                        </Button>
                        {!inviteLink && (
                            <Button
                                onClick={handleInvite}
                                disabled={
                                    inviteLoading ||
                                    !inviteEmail.trim() ||
                                    (!inviteIsPortal && inviteRoles.length === 0) ||
                                    (inviteIsPortal && !inviteRhSelected)
                                }
                            >
                                {inviteLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                <Mail className="h-4 w-4 mr-2" />Generér invitationslink
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Rediger roller dialog ── */}
            <Dialog open={!!editUser} onOpenChange={o => { if (!o) setEditUser(null) }}>
                <DialogContent className="max-w-xs">
                    <DialogHeader>
                        <DialogTitle>Rediger roller</DialogTitle>
                        <DialogDescription>{editUser?.full_name}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-0.5 py-2">
                        {staffRoles.map(r => (
                            <RoleToggle
                                key={r}
                                role={r}
                                selected={editRoles.includes(r)}
                                onToggle={() => setEditRoles(prev => toggleStaffRole(prev, r))}
                            />
                        ))}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditUser(null)}>Annuller</Button>
                        <Button onClick={handleEditRoles} disabled={editLoading || editRoles.length === 0}>
                            {editLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Gem roller
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Nulstil password dialog ── */}
            <Dialog open={!!resetUser} onOpenChange={o => { if (!o) { setResetUser(null); setResetLink(null) } }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Nulstil password</DialogTitle>
                        <DialogDescription>{resetUser?.full_name} ({resetUser?.email})</DialogDescription>
                    </DialogHeader>
                    {resetLink ? (
                        <div className="space-y-3 py-2">
                            <p className="text-sm text-emerald-600 font-medium flex items-center gap-1.5">
                                <Link className="h-4 w-4" />Reset-link genereret
                            </p>
                            <div className="flex gap-2">
                                <Input value={resetLink} readOnly className="font-mono text-xs" />
                                <Button variant="outline" size="sm" onClick={() => {
                                    navigator.clipboard.writeText(resetLink)
                                    toast.success("Kopieret!")
                                }}>Kopiér</Button>
                            </div>
                            <p className="text-xs text-muted-foreground">Linket er gyldigt i 24 timer.</p>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground py-2">
                            Generér et reset-link som du kan sende til brugeren.
                        </p>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setResetUser(null); setResetLink(null) }}>
                            {resetLink ? "Luk" : "Annuller"}
                        </Button>
                        {!resetLink && (
                            <Button onClick={handleReset} disabled={resetLoading}>
                                {resetLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                <KeyRound className="h-4 w-4 mr-2" />Generér reset-link
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Deaktiver / genaktiver bekræftelse ── */}
            <Dialog open={!!toggleUser} onOpenChange={o => { if (!o) setToggleUser(null) }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>
                            {toggleUser?.banned ? "Genaktiver konto?" : "Deaktiver konto?"}
                        </DialogTitle>
                        <DialogDescription>
                            {toggleUser?.banned
                                ? `${toggleUser.full_name} vil igen kunne logge ind på portalen.`
                                : `${toggleUser?.full_name} vil ikke længere kunne logge ind. Data bevares og kontoen kan genaktiveres.`}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setToggleUser(null)}>Annuller</Button>
                        <Button
                            onClick={handleToggle}
                            disabled={toggleLoading}
                            variant={toggleUser?.banned ? "default" : "destructive"}
                        >
                            {toggleLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {toggleUser?.banned ? "Genaktiver" : "Deaktiver"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
