"use client"

import { useEffect, useState, useTransition } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { Bell, CheckCircle, XCircle, Clock, AlertTriangle, Send, Plus, RefreshCw } from "lucide-react"
import {
    getRightsNotifications,
    getAdminTasks,
    getNotificationStats,
    updateNotificationStatus,
    updateAdminTaskStatus,
    createManualNotification,
    type RightsNotification,
    type AdminTask,
    type NotificationChannel,
} from "@/app/actions/rights-notifications"

// ── Labels ───────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
    allocation_created: "Tildeling oprettet",
    allocation_withheld: "Tildeling tilbageholdt",
    claim_deadline_approaching: "Kravsfrist nærmer sig",
    claim_deadline_passed: "Kravsfrist overskredet",
    settlement_approved: "Afregning godkendt",
    payout_completed: "Udbetaling gennemført",
    search_publication_published: "Efterlysning offentliggjort",
    manual: "Manuel",
}

const CHANNEL_LABELS: Record<string, string> = {
    email: "E-mail",
    portal: "Portal",
    sms: "SMS",
}

const TASK_TYPE_LABELS: Record<string, string> = {
    pending_notifications: "Afventende notifikationer",
    failed_notifications: "Fejlede notifikationer",
    unclaimed_allocations: "Ukrævede tildelinger",
    expiring_claims: "Udløbende krav",
    unresolved_withheld: "Uafklarede tilbageholdte",
}

// ── Sub-komponenter ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
        pending: { label: "Afventer", variant: "secondary" },
        sent: { label: "Sendt", variant: "default" },
        failed: { label: "Fejl", variant: "destructive" },
        cancelled: { label: "Annulleret", variant: "outline" },
    }
    const { label, variant } = map[status] ?? { label: status, variant: "outline" }
    return <Badge variant={variant}>{label}</Badge>
}

function TaskPriorityBadge({ priority }: { priority: string }) {
    const map: Record<string, string> = {
        low: "bg-blue-100 text-blue-800",
        normal: "bg-gray-100 text-gray-800",
        high: "bg-amber-100 text-amber-800",
        urgent: "bg-red-100 text-red-800",
    }
    const labels: Record<string, string> = {
        low: "Lav", normal: "Normal", high: "Høj", urgent: "Kritisk",
    }
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[priority] ?? map.normal}`}>
            {labels[priority] ?? priority}
        </span>
    )
}

function TaskStatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
        open: { label: "Åben", variant: "secondary" },
        in_progress: { label: "I gang", variant: "default" },
        resolved: { label: "Løst", variant: "outline" },
        dismissed: { label: "Afvist", variant: "outline" },
    }
    const { label, variant } = map[status] ?? { label: status, variant: "outline" }
    return <Badge variant={variant}>{label}</Badge>
}

// ── Manuel notifikation dialog ────────────────────────────────────────────────

function ManualNotificationDialog({
    open,
    onClose,
    onCreated,
}: {
    open: boolean
    onClose: () => void
    onCreated: () => void
}) {
    const [rhId, setRhId] = useState("")
    const [channel, setChannel] = useState<NotificationChannel>("email")
    const [body, setBody] = useState("")
    const [pending, startTransition] = useTransition()

    function handleSubmit() {
        if (!rhId.trim() || !body.trim()) {
            toast.error("Udfyld rettighedshaver-ID og besked")
            return
        }
        startTransition(async () => {
            const res = await createManualNotification({
                rights_holder_id: rhId.trim(),
                channel,
                body_preview: body.trim(),
            })
            if (res.success) {
                toast.success("Notifikation oprettet")
                onCreated()
                onClose()
            } else {
                toast.error("Fejl: " + res.error)
            }
        })
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Manuel notifikation</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div>
                        <Label htmlFor="rh-id">Rettighedshaver-ID (UUID)</Label>
                        <input
                            id="rh-id"
                            className="mt-1 w-full rounded border px-3 py-2 text-sm"
                            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                            value={rhId}
                            onChange={e => setRhId(e.target.value)}
                        />
                    </div>
                    <div>
                        <Label>Kanal</Label>
                        <Select value={channel} onValueChange={v => setChannel(v as NotificationChannel)}>
                            <SelectTrigger className="mt-1">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="email">E-mail</SelectItem>
                                <SelectItem value="portal">Portal</SelectItem>
                                <SelectItem value="sms">SMS</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="body">Beskedindhold</Label>
                        <Textarea
                            id="body"
                            className="mt-1"
                            rows={4}
                            placeholder="Skriv beskedens indhold her..."
                            value={body}
                            onChange={e => setBody(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSubmit} disabled={pending}>
                        {pending ? "Opretter…" : "Opret notifikation"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Notifikations-tabel ───────────────────────────────────────────────────────

function NotificationsTable({
    notifications,
    onRefresh,
}: {
    notifications: RightsNotification[]
    onRefresh: () => void
}) {
    const [pending, startTransition] = useTransition()

    function handleAction(id: string, action: "sent" | "cancelled") {
        startTransition(async () => {
            const res = await updateNotificationStatus(id, action)
            if (res.success) {
                toast.success(action === "sent" ? "Markeret som sendt" : "Notifikation annulleret")
                onRefresh()
            } else {
                toast.error("Fejl: " + res.error)
            }
        })
    }

    if (notifications.length === 0) {
        return (
            <div className="py-12 text-center text-sm text-muted-foreground">
                Ingen notifikationer
            </div>
        )
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Rettighedshaver</th>
                        <th className="pb-2 pr-4 font-medium">Hændelse</th>
                        <th className="pb-2 pr-4 font-medium">Kanal</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 pr-4 font-medium">Besked</th>
                        <th className="pb-2 pr-4 font-medium">Planlagt</th>
                        <th className="pb-2 font-medium" />
                    </tr>
                </thead>
                <tbody>
                    {notifications.map(n => (
                        <tr key={n.id} className="border-b last:border-0">
                            <td className="py-2 pr-4">
                                <div className="font-medium">{n.rights_holder_name ?? "—"}</div>
                                {n.member_number && (
                                    <div className="text-xs text-muted-foreground">#{n.member_number}</div>
                                )}
                            </td>
                            <td className="py-2 pr-4 text-xs">{EVENT_LABELS[n.event_type] ?? n.event_type}</td>
                            <td className="py-2 pr-4 text-xs">{CHANNEL_LABELS[n.channel] ?? n.channel}</td>
                            <td className="py-2 pr-4"><StatusBadge status={n.status} /></td>
                            <td className="max-w-[200px] py-2 pr-4">
                                <p className="truncate text-xs text-muted-foreground">{n.body_preview ?? "—"}</p>
                            </td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">
                                {new Date(n.scheduled_at).toLocaleDateString("da-DK")}
                            </td>
                            <td className="py-2">
                                {n.status === "pending" && (
                                    <div className="flex gap-1">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 px-2 text-xs"
                                            disabled={pending}
                                            onClick={() => handleAction(n.id, "sent")}
                                        >
                                            <Send className="mr-1 h-3 w-3" />
                                            Sendt
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                            disabled={pending}
                                            onClick={() => handleAction(n.id, "cancelled")}
                                        >
                                            <XCircle className="mr-1 h-3 w-3" />
                                            Annullér
                                        </Button>
                                    </div>
                                )}
                                {n.status === "failed" && (
                                    <div className="flex items-center gap-1 text-xs text-destructive">
                                        <AlertTriangle className="h-3 w-3" />
                                        {n.failed_reason ?? "Ukendt fejl"}
                                    </div>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

// ── Admin-opgavekø-tabel ──────────────────────────────────────────────────────

function AdminTasksTable({
    tasks,
    onRefresh,
}: {
    tasks: AdminTask[]
    onRefresh: () => void
}) {
    const [pending, startTransition] = useTransition()

    function handleTaskAction(id: string, action: "in_progress" | "resolved" | "dismissed") {
        startTransition(async () => {
            const res = await updateAdminTaskStatus(id, action)
            if (res.success) {
                const labels: Record<string, string> = {
                    in_progress: "Markeret som i gang",
                    resolved: "Markeret som løst",
                    dismissed: "Afvist",
                }
                toast.success(labels[action])
                onRefresh()
            } else {
                toast.error("Fejl: " + res.error)
            }
        })
    }

    if (tasks.length === 0) {
        return (
            <div className="py-12 text-center text-sm text-muted-foreground">
                Ingen åbne opgaver
            </div>
        )
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Prioritet</th>
                        <th className="pb-2 pr-4 font-medium">Opgavetype</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 pr-4 font-medium">Beskrivelse</th>
                        <th className="pb-2 pr-4 font-medium">Oprettet</th>
                        <th className="pb-2 font-medium" />
                    </tr>
                </thead>
                <tbody>
                    {tasks.map(t => (
                        <tr key={t.id} className="border-b last:border-0">
                            <td className="py-2 pr-4">
                                <TaskPriorityBadge priority={t.priority} />
                            </td>
                            <td className="py-2 pr-4 text-xs font-medium">
                                {TASK_TYPE_LABELS[t.task_type] ?? t.task_type}
                            </td>
                            <td className="py-2 pr-4">
                                <TaskStatusBadge status={t.status} />
                            </td>
                            <td className="max-w-[260px] py-2 pr-4">
                                <p className="text-xs text-muted-foreground">{t.description ?? "—"}</p>
                            </td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">
                                {new Date(t.created_at).toLocaleDateString("da-DK")}
                            </td>
                            <td className="py-2">
                                {(t.status === "open" || t.status === "in_progress") && (
                                    <div className="flex gap-1">
                                        {t.status === "open" && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 px-2 text-xs"
                                                disabled={pending}
                                                onClick={() => handleTaskAction(t.id, "in_progress")}
                                            >
                                                <Clock className="mr-1 h-3 w-3" />
                                                Sæt i gang
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 px-2 text-xs"
                                            disabled={pending}
                                            onClick={() => handleTaskAction(t.id, "resolved")}
                                        >
                                            <CheckCircle className="mr-1 h-3 w-3" />
                                            Løst
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 px-2 text-xs text-muted-foreground"
                                            disabled={pending}
                                            onClick={() => handleTaskAction(t.id, "dismissed")}
                                        >
                                            <XCircle className="mr-1 h-3 w-3" />
                                            Afvis
                                        </Button>
                                    </div>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

// ── Hoved-side ───────────────────────────────────────────────────────────────

export default function RettighedsmidlerNotifikationerPage() {
    const [stats, setStats] = useState({ pending: 0, sent: 0, failed: 0, open_tasks: 0 })
    const [notifications, setNotifications] = useState<RightsNotification[]>([])
    const [tasks, setTasks] = useState<AdminTask[]>([])
    const [loading, setLoading] = useState(true)
    const [showManual, setShowManual] = useState(false)
    const [activeTab, setActiveTab] = useState("opgaver")

    async function loadData() {
        setLoading(true)
        const [sRes, nRes, tRes] = await Promise.all([
            getNotificationStats(),
            getRightsNotifications({ limit: 200 }),
            getAdminTasks(),
        ])
        if (sRes.success) setStats({ pending: sRes.pending, sent: sRes.sent, failed: sRes.failed, open_tasks: sRes.open_tasks })
        if (nRes.success) setNotifications(nRes.notifications)
        if (tRes.success) setTasks(tRes.tasks)
        setLoading(false)
    }

    useEffect(() => { loadData() }, [])

    const pendingNotifs = notifications.filter(n => n.status === "pending")
    const sentNotifs = notifications.filter(n => n.status === "sent")
    const failedNotifs = notifications.filter(n => n.status === "failed")
    const openTasks = tasks.filter(t => t.status === "open" || t.status === "in_progress")
    const resolvedTasks = tasks.filter(t => t.status === "resolved" || t.status === "dismissed")

    return (
        <div className="space-y-6">
            <PageHeader
                title="Notifikationer"
                subtitle="Udgående beskeder og admin-opgavekø for rettighedsmidler"
                actions={
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={loadData}
                            disabled={loading}
                        >
                            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                            Opdatér
                        </Button>
                        <Button size="sm" onClick={() => setShowManual(true)}>
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Manuel notifikation
                        </Button>
                    </div>
                }
            />

            {/* Overblikskort */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-xs font-medium text-muted-foreground">Afventende</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        <div className="flex items-end gap-2">
                            <span className="text-2xl font-bold">{stats.pending}</span>
                            <Clock className="mb-1 h-4 w-4 text-muted-foreground" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-xs font-medium text-muted-foreground">Sendt</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        <div className="flex items-end gap-2">
                            <span className="text-2xl font-bold">{stats.sent}</span>
                            <CheckCircle className="mb-1 h-4 w-4 text-green-600" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-xs font-medium text-muted-foreground">Fejlede</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        <div className="flex items-end gap-2">
                            <span className="text-2xl font-bold">{stats.failed}</span>
                            <XCircle className="mb-1 h-4 w-4 text-destructive" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-xs font-medium text-muted-foreground">Åbne opgaver</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        <div className="flex items-end gap-2">
                            <span className="text-2xl font-bold">{stats.open_tasks}</span>
                            <Bell className={`mb-1 h-4 w-4 ${stats.open_tasks > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Fejlede — fremhævet advarsel */}
            {stats.failed > 0 && (
                <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div>
                        <p className="text-sm font-medium text-destructive">
                            {stats.failed} notifikation{stats.failed !== 1 ? "er" : ""} fejlede
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Tjek fanen "Fejlede" og vurder om de skal sendes igen manuelt.
                        </p>
                    </div>
                </div>
            )}

            {/* Faner */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="opgaver" className="gap-1.5">
                        Opgavekø
                        {openTasks.length > 0 && (
                            <Badge variant="secondary" className="h-4 px-1 text-[10px]">{openTasks.length}</Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="afventende" className="gap-1.5">
                        Afventende
                        {pendingNotifs.length > 0 && (
                            <Badge variant="secondary" className="h-4 px-1 text-[10px]">{pendingNotifs.length}</Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="sendt">Sendt</TabsTrigger>
                    <TabsTrigger value="fejlede" className="gap-1.5">
                        Fejlede
                        {failedNotifs.length > 0 && (
                            <Badge variant="destructive" className="h-4 px-1 text-[10px]">{failedNotifs.length}</Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="afsluttede">Afsluttede opgaver</TabsTrigger>
                </TabsList>

                <TabsContent value="opgaver" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Åbne admin-opgaver</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <AdminTasksTable tasks={openTasks} onRefresh={loadData} />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="afventende" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Afventende notifikationer</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <NotificationsTable notifications={pendingNotifs} onRefresh={loadData} />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="sendt" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Sendte notifikationer</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <NotificationsTable notifications={sentNotifs} onRefresh={loadData} />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="fejlede" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Fejlede notifikationer</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <NotificationsTable notifications={failedNotifs} onRefresh={loadData} />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="afsluttede" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Løste og afviste opgaver</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <AdminTasksTable tasks={resolvedTasks} onRefresh={loadData} />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <ManualNotificationDialog
                open={showManual}
                onClose={() => setShowManual(false)}
                onCreated={loadData}
            />
        </div>
    )
}
