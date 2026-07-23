"use client"

import { useEffect, useState, useMemo } from "react"
import {
    Shield, Mail, Plus, Pencil, Loader2, Clock, MoreHorizontal,
    KeyRound, Link, UserX, UserCheck, Search, Users, Scale, UserCog,
    Check, CircleAlert, Trash2,
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
import { useI18n } from "@/lib/i18n"

// ── Typer ─────────────────────────────────────────────────

type User = {
    id: string
    rh_id: string | null
    email: string | null
    full_name: string
    roles: string[]
    org_roles: string[]
    organisations: Array<{ id: string; name: string }>
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
    unassigned?: UnassignedRecord[]
}

type UnassignedRecord = {
    id: string
    kind: "auth_user" | "rights_holder"
    full_name: string
    email: string | null
    reason: string
    created_at: string
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

type Tab = "alle" | "admins" | "jurister" | "rettighedshavere" | "unassigned"

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "alle",              label: "Alle",              icon: Users     },
    { key: "admins",            label: "Admins",            icon: UserCog   },
    { key: "jurister",          label: "Jurister",          icon: Scale     },
    { key: "rettighedshavere",  label: "Rettighedshavere",  icon: UserCheck },
    { key: "unassigned",        label: "Uden tilknytning",  icon: CircleAlert },
]

// ── Hovedkomponent ────────────────────────────────────────

export default function AdminBrugerePage() {
    const { t } = useI18n()
    const [users, setUsers] = useState<User[]>([])
    const [callerRole, setCallerRole] = useState("")
    const [unassigned, setUnassigned] = useState<UnassignedRecord[]>([])
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
    const [deletingUnassignedId, setDeletingUnassignedId] = useState<string | null>(null)

    // Bruger detalje/rediger modal
    const [detailUser, setDetailUser] = useState<User | null>(null)
    const [detailName, setDetailName] = useState("")
    const [detailPhone, setDetailPhone] = useState("")
    const [detailTitle, setDetailTitle] = useState("")
    const [detailGender, setDetailGender] = useState("")
    const [detailRoles, setDetailRoles] = useState<string[]>([])
    const [detailIsRightsHolder, setDetailIsRightsHolder] = useState(false)
    const [detailDirectPassword, setDetailDirectPassword] = useState("")
    const [detailResetLink, setDetailResetLink] = useState<string | null>(null)
    const [detailSaving, setDetailSaving] = useState(false)

    function openDetailModal(user: User) {
        setDetailUser(user)
        setDetailName(user.full_name || "")
        setDetailPhone(user.phone || "")
        setDetailTitle(user.title || "")
        setDetailGender(user.gender || "")
        setDetailRoles(user.org_roles.length > 0 ? user.org_roles.slice() : (user.roles.includes("rettighedshaver") ? [] : ["viewer"]))
        setDetailIsRightsHolder(user.is_rettighedshaver)
        setDetailDirectPassword("")
        setDetailResetLink(null)
    }

    async function handleSaveUserDetail() {
        if (!detailUser) return
        setDetailSaving(true)
        try {
            const profileRes = await fetch("/api/admin/users", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "update-profile",
                    userId: detailUser.id,
                    fullName: detailName.trim(),
                    phone: detailPhone.trim(),
                    title: detailTitle.trim(),
                    gender: detailGender,
                }),
            })
            if (!profileRes.ok) {
                const j = await profileRes.json()
                throw new Error(j.error ?? "Fejl ved opdatering af profil")
            }

            {
                const roleRes = await fetch("/api/admin/users", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "set-roles",
                        userId: detailUser.id,
                        roles: detailRoles,
                    }),
                })
                if (!roleRes.ok) {
                    const j = await roleRes.json()
                    throw new Error(j.error ?? "Fejl ved opdatering af roller")
                }
            }

            if (detailIsRightsHolder !== detailUser.is_rettighedshaver) {
                const rightsHolderRes = await fetch("/api/admin/users", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "set-rights-holder-status",
                        userId: detailUser.id,
                        enabled: detailIsRightsHolder,
                        fullName: detailName.trim(),
                        email: detailUser.email,
                    }),
                })
                if (!rightsHolderRes.ok) {
                    const json = await rightsHolderRes.json()
                    throw new Error(json.error ?? "Rettighedshaverstatus kunne ikke opdateres")
                }
            }

            if (detailDirectPassword.trim()) {
                if (detailDirectPassword.length < 8) {
                    throw new Error("Password skal være på mindst 8 tegn")
                }
                const pwRes = await fetch("/api/admin/users", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "set-password",
                        userId: detailUser.id,
                        password: detailDirectPassword.trim(),
                    }),
                })
                if (!pwRes.ok) {
                    const j = await pwRes.json()
                    throw new Error(j.error ?? "Fejl ved indstilling af password")
                }
            }

            toast.success("Brugeroplysninger gemt")
            setDetailUser(null)
            await load()
        } catch (err: unknown) {
            toast.error(errorMessage(err))
        } finally {
            setDetailSaving(false)
        }
    }

    async function handleGenerateDetailResetLink() {
        if (!detailUser?.email) return
        setResetLoading(true)
        try {
            const res = await fetch("/api/admin/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "generate-reset-link", email: detailUser.email }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            setDetailResetLink(json.reset_url)
            toast.success("Reset-link genereret")
        } catch (err: unknown) {
            toast.error(errorMessage(err, "Fejl ved generering af reset-link"))
        } finally {
            setResetLoading(false)
        }
    }

    async function handleToggleDetailBan() {
        if (!detailUser) return
        const action = detailUser.banned ? "activate" : "deactivate"
        setToggleLoading(true)
        try {
            const res = await fetch("/api/admin/users", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, userId: detailUser.id }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            toast.success(detailUser.banned ? "Konto genaktiveret" : "Konto deaktiveret")
            setDetailUser(null)
            await load()
        } catch (err: unknown) {
            toast.error(errorMessage(err))
        } finally {
            setToggleLoading(false)
        }
    }

    useEffect(() => { load() }, [])

    async function load() {
        setLoading(true)
        const res = await fetch("/api/admin/users")
        const json = await res.json() as UsersResponse
        if (res.ok) {
            setCallerRole(json.callerRole ?? "")
            setUnassigned(json.unassigned ?? [])
            // Brug merged users hvis tilgængeligt, ellers bagudkompatibel sammensætning
            if (json.users) {
                setUsers(json.users)
            } else {
                const staff = (json.staff ?? []).map(u => ({ ...u, organisations: u.organisations ?? [], org_roles: u.roles ?? [], is_rettighedshaver: false, rh_id: null, onboarding_completed: null, gender: null }) as User)
                const portal = (json.portal ?? []).map(u => ({ ...u, organisations: u.organisations ?? [], org_roles: [], is_rettighedshaver: true, roles: ["rettighedshaver"] }) as User)
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
            case "unassigned":       return []
            default:                 return users.filter(match)
        }
    }, [users, tab, search])

    const counts = useMemo(() => ({
        alle:             users.length,
        admins:           users.filter(u => u.org_roles.some(r => ["admin", "org-admin", "superadmin"].includes(r))).length,
        jurister:         users.filter(u => u.org_roles.includes("jurist")).length,
        rettighedshavere: users.filter(u => u.is_rettighedshaver).length,
        unassigned:       unassigned.length,
    }), [unassigned.length, users])
    const filteredUnassigned = useMemo(() => {
        const query = search.toLowerCase().trim()
        if (!query) return unassigned
        return unassigned.filter(record =>
            record.full_name.toLowerCase().includes(query) ||
            (record.email ?? "").toLowerCase().includes(query) ||
            record.reason.toLowerCase().includes(query)
        )
    }, [search, unassigned])
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
            if (json.email_sent) {
                toast.success(`Invitation sendt til ${inviteEmail.trim()}`)
            } else {
                toast.warning(`Brugeren og linket blev oprettet, men mailen kunne ikke sendes (${json.email_error ?? "ukendt fejl"}). Kopiér linket manuelt.`)
            }
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

    async function handleDeleteUnassigned(record: UnassignedRecord) {
        if (!window.confirm(`Slet ${record.full_name} permanent? Posten er ikke knyttet til en organisation, og handlingen kan ikke fortrydes.`)) return
        setDeletingUnassignedId(record.id)
        try {
            const res = await fetch("/api/admin/users", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "delete-unassigned", recordId: record.id, kind: record.kind }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            toast.success(json.deletedUser ? "Rettighedshaver og loginbruger slettet permanent" : "Posten er slettet permanent")
            if (json.warning) toast.warning(json.warning)
            await load()
        } catch (error: unknown) {
            toast.error(errorMessage(error, "Posten kunne ikke slettes"))
        } finally {
            setDeletingUnassignedId(null)
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
                        <Button size="sm" onClick={() => openInvite(false)}>
                            <Plus className="h-4 w-4 mr-1" />Inviter stab
                        </Button>
                    </div>
                }
            />

            {/* Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto border-b">
                {TABS.filter(t => t.key !== "unassigned" || callerRole === "superadmin").map(t => {
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
                    placeholder={tab === "unassigned" ? "Søg i poster uden tilknytning…" : "Søg navn eller e-mail…"}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                />
            </div>

            {/* Tabel */}
            {tab === "unassigned" && (
                <>
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
                        Disse poster mangler en relation, som de normale lister kræver. Listen er kun synlig for superadmins.
                    </div>
                    <MobileCardList>
                        {filteredUnassigned.length === 0 ? (
                            <MobileDataCard>
                                <p className="py-6 text-center text-sm text-muted-foreground">Ingen poster uden tilknytning</p>
                            </MobileDataCard>
                        ) : filteredUnassigned.map(record => (
                            <MobileDataCard key={record.id}>
                                <p className="font-medium">{record.full_name}</p>
                                <p className="mt-1 text-sm text-muted-foreground">{record.email ?? "Ingen e-mail"}</p>
                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <MobileMetaRow label="Type">{record.kind === "auth_user" ? "Loginbruger" : "Rettighedshaver"}</MobileMetaRow>
                                    <MobileMetaRow label="Oprettet">{new Date(record.created_at).toLocaleDateString("da-DK")}</MobileMetaRow>
                                </div>
                                <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{record.reason}</p>
                                <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    className="mt-4 w-full"
                                    disabled={deletingUnassignedId === record.id}
                                    onClick={() => void handleDeleteUnassigned(record)}
                                >
                                    {deletingUnassignedId === record.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                    Slet permanent
                                </Button>
                            </MobileDataCard>
                        ))}
                    </MobileCardList>
                    <ResponsiveTableFrame className="rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Navn</TableHead>
                                    <TableHead>E-mail</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Årsag</TableHead>
                                    <TableHead>Oprettet</TableHead>
                                    <TableHead className="w-12" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredUnassigned.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Ingen poster uden tilknytning</TableCell>
                                    </TableRow>
                                ) : filteredUnassigned.map(record => (
                                    <TableRow key={record.id}>
                                        <TableCell className="font-medium">{record.full_name}</TableCell>
                                        <TableCell className="text-muted-foreground">{record.email ?? "—"}</TableCell>
                                        <TableCell>{record.kind === "auth_user" ? "Loginbruger" : "Rettighedshaver"}</TableCell>
                                        <TableCell className="text-amber-700 dark:text-amber-300">{record.reason}</TableCell>
                                        <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(record.created_at).toLocaleDateString("da-DK")}</TableCell>
                                        <TableCell>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive"
                                                aria-label={`Slet ${record.full_name} permanent`}
                                                disabled={deletingUnassignedId === record.id}
                                                onClick={() => void handleDeleteUnassigned(record)}
                                            >
                                                {deletingUnassignedId === record.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ResponsiveTableFrame>
                </>
            )}

            {tab !== "unassigned" && (
                <>
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
                    <MobileDataCard key={u.id} className={`cursor-pointer hover:bg-muted/30 transition-colors ${u.banned ? "opacity-60" : ""}`} onClick={() => openDetailModal(u)}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate font-medium flex items-center gap-2">
                                    {u.full_name}
                                    <Pencil className="h-3 w-3 text-muted-foreground" />
                                </p>
                                <p className="mt-1 truncate text-sm text-muted-foreground">{u.email ?? "Ingen email"}</p>
                            </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <MobileMetaRow label="Telefon">{u.phone ?? "—"}</MobileMetaRow>
                            <MobileMetaRow label="Titel">{u.title ?? "—"}</MobileMetaRow>
                            <MobileMetaRow label="Status"><StatusBadge lastSignIn={u.last_sign_in} banned={u.banned} /></MobileMetaRow>
                            {callerRole === "superadmin" && (
                                <MobileMetaRow label="Organisation">{u.organisations.map(org => org.name).join(", ") || "Ingen organisation"}</MobileMetaRow>
                            )}
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
                            {callerRole === "superadmin" && <TableHead>Organisation</TableHead>}
                            <TableHead>Status</TableHead>
                            <TableHead>Sidst logget ind</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={callerRole === "superadmin" ? 9 : 8} className="py-10 text-center text-muted-foreground">
                                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />Henter...
                                </TableCell>
                            </TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={callerRole === "superadmin" ? 9 : 8} className="py-10 text-center text-muted-foreground">
                                    Ingen brugere fundet
                                </TableCell>
                            </TableRow>
                        ) : filtered.map(u => (
                            <TableRow
                                key={u.id}
                                className={`cursor-pointer hover:bg-muted/50 transition-colors ${u.banned ? "opacity-50" : ""}`}
                                onClick={() => openDetailModal(u)}
                            >
                                <TableCell className="font-medium flex items-center gap-1.5">
                                    {u.full_name}
                                    <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{u.phone ?? "—"}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{u.gender ? GENDER_LABELS[u.gender] ?? u.gender : "—"}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{u.title ?? "—"}</TableCell>
                                <TableCell><RoleChips roles={u.roles} /></TableCell>
                                {callerRole === "superadmin" && (
                                    <TableCell className="text-sm text-muted-foreground">
                                        {u.organisations.map(org => org.name).join(", ") || "Ingen organisation"}
                                    </TableCell>
                                )}
                                <TableCell>
                                    <StatusBadge lastSignIn={u.last_sign_in} banned={u.banned} />
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                    {u.last_sign_in
                                        ? new Date(u.last_sign_in).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
                                        : "—"}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ResponsiveTableFrame>
                </>
            )}

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
                                                onToggle={() => setInviteRoles(toggleStaffRole(inviteRoles, r))}
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
                                onToggle={() => setEditRoles(toggleStaffRole(editRoles, r))}
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

            {/* ── Samlet Brugerredigering & Detaljer Dialog ── */}
            <Dialog open={!!detailUser} onOpenChange={o => { if (!o) setDetailUser(null) }}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserCog className="h-5 w-5" /> Rediger bruger oplysninger
                        </DialogTitle>
                        <DialogDescription>
                            {detailUser?.email ? `${detailUser.full_name} (${detailUser.email})` : detailUser?.full_name}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5 py-2">
                        {/* Stamdata */}
                        <div className="space-y-3">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stamdata</h4>
                            <div className="space-y-1.5">
                                <Label>Navn</Label>
                                <Input value={detailName} onChange={e => setDetailName(e.target.value)} placeholder="Fornavn Efternavn" />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label>Telefon</Label>
                                    <Input value={detailPhone} onChange={e => setDetailPhone(e.target.value)} placeholder="Tlf. nummer" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Titel / Stilling</Label>
                                    <Input value={detailTitle} onChange={e => setDetailTitle(e.target.value)} placeholder="Fx Administrator" />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Køn</Label>
                                <select
                                    value={detailGender}
                                    onChange={e => setDetailGender(e.target.value)}
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                >
                                    <option value="">– Vælg køn –</option>
                                    <option value="female">Kvinde</option>
                                    <option value="male">Mand</option>
                                    <option value="non_binary">Nonbinær</option>
                                    <option value="other">Andet</option>
                                    <option value="prefer_not_to_say">Ønsker ikke at oplyse</option>
                                </select>
                            </div>
                        </div>

                        {/* Roller */}
                        <div className="space-y-3 border-t pt-4">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Brugerroller</h4>
                            <div className="space-y-0.5">
                                {staffRoles.map(r => (
                                    <RoleToggle
                                        key={r}
                                        role={r}
                                        selected={detailRoles.includes(r)}
                                        onToggle={() => setDetailRoles(toggleStaffRole(detailRoles, r))}
                                    />
                                ))}
                            </div>
                            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={detailIsRightsHolder} onChange={event => setDetailIsRightsHolder(event.target.checked)} />
                                <span><span className="block text-sm font-medium">{t("admin.users.rightsHolder")}</span><span className="block text-xs text-muted-foreground">{t("admin.users.rightsHolderHelp")}</span></span>
                            </label>
                        </div>

                        {/* Adgangskode & Nulstilling */}
                        <div className="space-y-3 border-t pt-4">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Adgangskode & Nulstilling</h4>
                            <div className="space-y-2">
                                {detailResetLink ? (
                                    <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs dark:bg-emerald-950/40">
                                        <p className="font-medium text-emerald-800 dark:text-emerald-300">Nulstillings-link genereret:</p>
                                        <div className="mt-1 flex gap-2">
                                            <Input value={detailResetLink} readOnly className="h-7 text-xs font-mono" />
                                            <Button size="sm" variant="outline" className="h-7" onClick={() => {
                                                navigator.clipboard.writeText(detailResetLink);
                                                toast.success("Kopieret!");
                                            }}>Kopiér</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-full text-xs gap-1.5"
                                        disabled={resetLoading}
                                        onClick={handleGenerateDetailResetLink}
                                    >
                                        {resetLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                                        Send / generér nulstillings-link
                                    </Button>
                                )}

                                <div className="pt-2 space-y-1.5">
                                    <Label className="text-xs">Eller sæt ny adgangskode direkte</Label>
                                    <Input
                                        type="password"
                                        value={detailDirectPassword}
                                        onChange={e => setDetailDirectPassword(e.target.value)}
                                        placeholder="Skriv ny adgangskode (mindst 8 tegn)"
                                        className="text-xs"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Konto status / Deaktiver */}
                        <div className="border-t pt-4 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-medium">Konto status</p>
                                <p className="text-[11px] text-muted-foreground">
                                    {detailUser?.banned ? "Kontoen er deaktiveret." : "Kontoen er aktiv."}
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant={detailUser?.banned ? "outline" : "destructive"}
                                size="sm"
                                disabled={toggleLoading}
                                onClick={handleToggleDetailBan}
                            >
                                {toggleLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                                {detailUser?.banned ? "Genaktiver konto" : "Deaktiver konto"}
                            </Button>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDetailUser(null)}>Annuller</Button>
                        <Button onClick={handleSaveUserDetail} disabled={detailSaving}>
                            {detailSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Gem ændringer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
