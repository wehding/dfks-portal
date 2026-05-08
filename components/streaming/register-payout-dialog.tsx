"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { AlertCircle } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────

type PayoutType = "irf" | "succesbetaling" | "royalties" | "copydan"

interface RegisterPayoutDialogProps {
    open: boolean
    onClose: () => void
    productionTitle: string
    onRegister: (payout: {
        payoutYear: number
        type: PayoutType
        payer?: string
        grossAmount: number
        adminFeePercent: number
        receivedAt: string
        notes?: string
    }) => void
}

const PAYOUT_LABELS: Record<PayoutType, string> = {
    irf:           "IRF (første udbetaling)",
    succesbetaling: "Succesbetaling (løbende)",
    royalties:     "Royalties",
    copydan:       "Copydan",
}

const PAYOUT_SOURCES: Record<PayoutType, string> = {
    irf:           "Create Denmark",
    succesbetaling: "Create Denmark",
    royalties:     "Producent",
    copydan:       "Copydan",
}

function loadAdminFees() {
    if (typeof window === "undefined") return { irf: 15, succesbetaling: 15, royalties: 10, copydan: 8 }
    try {
        const stored = localStorage.getItem("streaming_admin_fees")
        const fees = stored ? JSON.parse(stored) : {}
        return {
            irf:            fees.irf            ?? 15,
            succesbetaling: fees.succesbetaling ?? 15,
            royalties:      fees.royalties      ?? 10,
            copydan:        fees.copydan        ?? 8,
        }
    } catch { return { irf: 15, succesbetaling: 15, royalties: 10, copydan: 8 } }
}

// ── Helpers ──────────────────────────────────────────────────

function fmt2(n: number) {
    return new Intl.NumberFormat("da-DK", {
        style: "currency", currency: "DKK",
        minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(n)
}

function parseAmount(s: string): number {
    // Accepter både "33.438,59" (da-DK) og "33438.59" (en-US)
    const cleaned = s.replace(/\./g, "").replace(",", ".")
    return parseFloat(cleaned) || 0
}

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 10 }, (_, i) => currentYear - i)

// ── Component ────────────────────────────────────────────────

export function RegisterPayoutDialog({
    open, onClose, productionTitle, onRegister
}: RegisterPayoutDialogProps) {
    const [payoutYear, setPayoutYear] = useState(String(currentYear - 1))
    const [type, setType] = useState<PayoutType>("succesbetaling")
    const [payer, setPayer] = useState("")
    const [grossInput, setGrossInput] = useState("")
    const [receivedAt, setReceivedAt] = useState(
        new Date().toISOString().split("T")[0]
    )
    const [notes, setNotes] = useState("")

    const adminFees = loadAdminFees()
    const adminFeePercent = adminFees[type]
    const grossAmount = parseAmount(grossInput)
    const adminFeeAmount = grossAmount > 0
        ? grossAmount * adminFeePercent / (100 + adminFeePercent)
        : 0
    const netAmount = grossAmount - adminFeeAmount

    const isValid = grossAmount > 0 && payoutYear && receivedAt

    function handleSubmit() {
        if (!isValid) return
        onRegister({
            payoutYear: parseInt(payoutYear),
            type,
            payer: type === "royalties" ? payer || undefined : undefined,
            grossAmount,
            adminFeePercent,
            receivedAt,
            notes: notes || undefined,
        })
        setGrossInput("")
        setPayer("")
        setNotes("")
        onClose()
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Registrér betaling</DialogTitle>
                    <p className="text-sm text-muted-foreground">{productionTitle}</p>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* År + type */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Udbetalingsår</Label>
                            <Select value={payoutYear} onValueChange={setPayoutYear}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {years.map(y => (
                                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Type</Label>
                            <Select value={type} onValueChange={v => setType(v as PayoutType)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {(Object.entries(PAYOUT_LABELS) as [PayoutType, string][]).map(([val, label]) => (
                                        <SelectItem key={val} value={val}>{label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Kilde */}
                    <p className="text-xs text-muted-foreground -mt-2">
                        Kilde: <span className="font-medium">{PAYOUT_SOURCES[type]}</span>
                        {" — "}adm. bidrag: <span className="font-medium">{adminFeePercent}%</span>
                    </p>

                    {/* Producentnavn — kun ved royalties */}
                    {type === "royalties" && (
                        <div className="space-y-1.5">
                            <Label htmlFor="payer">
                                Producent <span className="text-muted-foreground font-normal">(valgfri)</span>
                            </Label>
                            <Input
                                id="payer"
                                placeholder="Producentens navn"
                                value={payer}
                                onChange={e => setPayer(e.target.value)}
                            />
                        </div>
                    )}

                    {/* Beløb */}
                    <div className="space-y-1.5">
                        <Label htmlFor="gross">
                            Modtaget beløb (inkl. adm.)
                        </Label>
                        <div className="relative">
                            <Input
                                id="gross"
                                placeholder="33.438,59"
                                value={grossInput}
                                onChange={e => setGrossInput(e.target.value)}
                                className="pr-12"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                DKK
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Brug komma som decimaltegn, f.eks. 33.438,59
                        </p>
                    </div>

                    {/* Beregning */}
                    {grossAmount > 0 && (
                        <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Modtaget fra Create Denmark</span>
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

                    {/* Modtaget dato */}
                    <div className="space-y-1.5">
                        <Label htmlFor="receivedAt">Modtaget dato</Label>
                        <Input
                            id="receivedAt"
                            type="date"
                            value={receivedAt}
                            onChange={e => setReceivedAt(e.target.value)}
                        />
                    </div>

                    {/* Noter */}
                    <div className="space-y-1.5">
                        <Label htmlFor="notes">
                            Note <span className="text-muted-foreground font-normal">(valgfri)</span>
                        </Label>
                        <Input
                            id="notes"
                            placeholder="F.eks. reference til Create Denmark afregning"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                        />
                    </div>

                    {/* Advarsel hvis ingen låst nøgle */}
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-300">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <p>
                            Beløbet kan registreres nu, men kan ikke eksporteres til lønsystem
                            før fordelingsnøglen er låst.
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSubmit} disabled={!isValid}>
                        Registrér
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
