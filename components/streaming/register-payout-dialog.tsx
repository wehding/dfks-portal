"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { AlertCircle } from "lucide-react"
import { useMasterData } from "@/lib/hooks"
import type { ExploitationType } from "@/lib/streaming-types"

// ── Types ─────────────────────────────────────────────────────

type PayoutType = "irf" | "succesbetaling" | "betaling"

export interface ExploitationOption {
    id: string
    platform: string
    type: ExploitationType
    payer?: string
}

interface RegisterPayoutDialogProps {
    open: boolean
    onClose: () => void
    productionTitle: string
    existingExploitations: ExploitationOption[]
    preselectedExploitationId?: string
    onRegister: (data: {
        exploitation: { id?: string; platform: string; type: ExploitationType; payer?: string }
        payout: {
            payoutYear: number
            type: PayoutType
            grossAmount: number
            adminFeePercent: number
            receivedAt: string
            notes?: string
        }
    }) => void
}

// ── Constants ─────────────────────────────────────────────────

const EXPLOITATION_TYPES: { value: ExploitationType; label: string }[] = [
    { value: "streaming",  label: "Streaming" },
    { value: "broadcast",  label: "Broadcast (TV/visning)" },
    { value: "royalties",  label: "Royalties (fra producent)" },
    { value: "copydan",    label: "Copydan" },
]

const EXPLOITATION_TYPE_LABELS: Record<ExploitationType, string> = {
    streaming: "Streaming", broadcast: "Broadcast",
    royalties: "Royalties", copydan: "Copydan",
}

// ── Helpers ──────────────────────────────────────────────────

function fmt2(n: number) {
    return new Intl.NumberFormat("da-DK", {
        style: "currency", currency: "DKK",
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n)
}

function parseAmount(s: string): number {
    return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0
}

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 10 }, (_, i) => currentYear - i)

function loadAdminFees() {
    if (typeof window === "undefined") return { irf: 15, succesbetaling: 15, royalties: 10, copydan: 8 }
    try {
        const fees = JSON.parse(localStorage.getItem("streaming_admin_fees") ?? "{}")
        return {
            irf:            fees.irf            ?? 15,
            succesbetaling: fees.succesbetaling ?? 15,
            royalties:      fees.royalties      ?? 10,
            copydan:        fees.copydan        ?? 8,
        }
    } catch { return { irf: 15, succesbetaling: 15, royalties: 10, copydan: 8 } }
}

const isStreamingLike = (t: ExploitationType) => t === "streaming" || t === "broadcast"

// ── Component ────────────────────────────────────────────────

export function RegisterPayoutDialog({
    open, onClose, productionTitle, existingExploitations,
    preselectedExploitationId, onRegister,
}: RegisterPayoutDialogProps) {
    const { items: platforms } = useMasterData("platforms")

    // Exploitation state
    const [exploitationId, setExploitationId] = useState<string>("")
    const [newPlatform, setNewPlatform] = useState("")
    const [customPlatform, setCustomPlatform] = useState("")
    const [newType, setNewType] = useState<ExploitationType>("streaming")
    const [newPayer, setNewPayer] = useState("")

    // Payout state
    const [payoutYear, setPayoutYear] = useState(String(currentYear - 1))
    const [payoutType, setPayoutType] = useState<PayoutType>("irf")
    const [grossInput, setGrossInput] = useState("")
    const [receivedAt, setReceivedAt] = useState(new Date().toISOString().split("T")[0])
    const [notes, setNotes] = useState("")

    // Pre-select exploitation when dialog opens
    useEffect(() => {
        if (open) {
            const initial = preselectedExploitationId ?? (existingExploitations.length === 0 ? "__new" : "")
            setExploitationId(initial)
        }
    }, [open, preselectedExploitationId, existingExploitations.length])

    const isNew = exploitationId === "__new"
    const selected = existingExploitations.find(e => e.id === exploitationId)
    const effectiveType: ExploitationType = isNew ? newType : (selected?.type ?? "streaming")
    const effectivePlatform = isNew
        ? (newPlatform === "__custom" ? customPlatform : newPlatform)
        : (selected?.platform ?? "")

    const adminFees = loadAdminFees()
    const adminFeePercent =
        effectiveType === "royalties" ? adminFees.royalties
        : effectiveType === "copydan" ? adminFees.copydan
        : payoutType === "irf"        ? adminFees.irf
        :                               adminFees.succesbetaling

    const grossAmount = parseAmount(grossInput)
    const adminFeeAmount = grossAmount > 0 ? grossAmount * adminFeePercent / (100 + adminFeePercent) : 0
    const netAmount = grossAmount - adminFeeAmount

    const exploitationValid = isNew ? effectivePlatform.trim().length > 0 : !!selected
    const isValid = exploitationId !== "" && exploitationValid && grossAmount > 0 && !!payoutYear && !!receivedAt

    function handleSubmit() {
        if (!isValid) return
        onRegister({
            exploitation: isNew
                ? { platform: effectivePlatform.trim(), type: newType, payer: newType === "royalties" ? newPayer.trim() || undefined : undefined }
                : { id: selected!.id, platform: selected!.platform, type: selected!.type, payer: selected!.payer },
            payout: {
                payoutYear: parseInt(payoutYear),
                type: isStreamingLike(effectiveType) ? payoutType : "betaling",
                grossAmount,
                adminFeePercent,
                receivedAt,
                notes: notes || undefined,
            },
        })
        reset()
        onClose()
    }

    function reset() {
        setExploitationId("")
        setNewPlatform("")
        setCustomPlatform("")
        setNewType("streaming")
        setNewPayer("")
        setPayoutYear(String(currentYear - 1))
        setPayoutType("irf")
        setGrossInput("")
        setNotes("")
    }

    function handleClose() { reset(); onClose() }

    const activePlatforms = platforms.filter(p => p.active)

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Registrér betaling</DialogTitle>
                    <p className="text-sm text-muted-foreground">{productionTitle}</p>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Udnyttelse */}
                    <div className="space-y-1.5">
                        <Label>Udnyttelse</Label>
                        <Select value={exploitationId} onValueChange={setExploitationId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Vælg udnyttelse..." />
                            </SelectTrigger>
                            <SelectContent>
                                {existingExploitations.map(e => (
                                    <SelectItem key={e.id} value={e.id}>
                                        {e.platform} — {EXPLOITATION_TYPE_LABELS[e.type]}
                                        {e.payer ? ` (${e.payer})` : ""}
                                    </SelectItem>
                                ))}
                                <SelectItem value="__new">+ Ny udnyttelse...</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Ny udnyttelse — felter */}
                    {isNew && (
                        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Type</Label>
                                <Select value={newType} onValueChange={v => setNewType(v as ExploitationType)}>
                                    <SelectTrigger className="h-8 text-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {EXPLOITATION_TYPES.map(t => (
                                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs">Platform / kilde</Label>
                                <Select value={newPlatform} onValueChange={setNewPlatform}>
                                    <SelectTrigger className="h-8 text-sm">
                                        <SelectValue placeholder="Vælg..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {activePlatforms.map(p => (
                                            <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                                        ))}
                                        <SelectItem value="__custom">Anden (skriv selv)</SelectItem>
                                    </SelectContent>
                                </Select>
                                {newPlatform === "__custom" && (
                                    <Input
                                        className="h-8 text-sm"
                                        placeholder="Fx Mubi, Canal+"
                                        value={customPlatform}
                                        onChange={e => setCustomPlatform(e.target.value)}
                                        autoFocus
                                    />
                                )}
                            </div>

                            {newType === "royalties" && (
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Producent (valgfri)</Label>
                                    <Input
                                        className="h-8 text-sm"
                                        placeholder="Producentens navn"
                                        value={newPayer}
                                        onChange={e => setNewPayer(e.target.value)}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Betalingstype (kun streaming/broadcast) */}
                    {exploitationId !== "" && isStreamingLike(effectiveType) && (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>Udbetalingsår</Label>
                                <Select value={payoutYear} onValueChange={setPayoutYear}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Type</Label>
                                <Select value={payoutType} onValueChange={v => setPayoutType(v as PayoutType)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="irf">IRF (første)</SelectItem>
                                        <SelectItem value="succesbetaling">Succesbetaling</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    {/* Udbetalingsår — kun for ikke-streaming */}
                    {exploitationId !== "" && !isStreamingLike(effectiveType) && (
                        <div className="space-y-1.5">
                            <Label>Udbetalingsår</Label>
                            <Select value={payoutYear} onValueChange={setPayoutYear}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Adm. sats info */}
                    {exploitationId !== "" && (
                        <p className="text-xs text-muted-foreground -mt-2">
                            Adm. bidrag: <span className="font-medium">{adminFeePercent}%</span>
                        </p>
                    )}

                    {/* Beløb */}
                    {exploitationId !== "" && (
                        <>
                            <div className="space-y-1.5">
                                <Label htmlFor="gross">Modtaget beløb (inkl. adm.)</Label>
                                <div className="relative">
                                    <Input
                                        id="gross"
                                        placeholder="33.438,59"
                                        value={grossInput}
                                        onChange={e => setGrossInput(e.target.value)}
                                        className="pr-12"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">DKK</span>
                                </div>
                                <p className="text-xs text-muted-foreground">Brug komma som decimaltegn</p>
                            </div>

                            {grossAmount > 0 && (
                                <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Modtaget</span>
                                        <span className="tabular-nums font-medium">{fmt2(grossAmount)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Adm. gebyr ({adminFeePercent}%)</span>
                                        <span className="tabular-nums text-muted-foreground">− {fmt2(adminFeeAmount)}</span>
                                    </div>
                                    <Separator />
                                    <div className="flex justify-between font-medium">
                                        <span>Til fordeling</span>
                                        <span className="tabular-nums">{fmt2(netAmount)}</span>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label htmlFor="receivedAt">Modtaget dato</Label>
                                <Input
                                    id="receivedAt"
                                    type="date"
                                    value={receivedAt}
                                    onChange={e => setReceivedAt(e.target.value)}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="notes">
                                    Note <span className="text-muted-foreground font-normal">(valgfri)</span>
                                </Label>
                                <Input
                                    id="notes"
                                    placeholder="F.eks. reference til afregning"
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                />
                            </div>

                            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-300">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <p>Beløbet kan registreres nu, men kan ikke eksporteres før fordelingsnøglen er låst.</p>
                            </div>
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>Annuller</Button>
                    <Button onClick={handleSubmit} disabled={!isValid}>Registrér</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
