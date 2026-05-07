"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, CheckCircle2 } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────

interface Editor {
    id: string
    name: string
}

interface ShareEntry {
    editorId: string
    name: string
    percent: string // string for input kontrol
}

interface CreateDistributionKeyDialogProps {
    open: boolean
    onClose: () => void
    productionTitle: string
    editors: Editor[]
    onCreate: (shares: { editorId: string; name: string; sharePercent: number }[]) => void
}

// ── Helpers ──────────────────────────────────────────────────

function parsePercent(s: string): number {
    return parseFloat(s.replace(",", ".")) || 0
}

function distributeEvenly(editors: Editor[]): ShareEntry[] {
    if (editors.length === 0) return []
    const equal = (100 / editors.length)
    return editors.map((e, i) => ({
        editorId: e.id,
        name: e.name,
        // Giv den første klipper resten for at summer til 100
        percent: i === editors.length - 1
            ? String((100 - equal * (editors.length - 1)).toFixed(2)).replace(".", ",")
            : String(equal.toFixed(2)).replace(".", ","),
    }))
}

// ── Component ────────────────────────────────────────────────

export function CreateDistributionKeyDialog({
    open, onClose, productionTitle, editors, onCreate
}: CreateDistributionKeyDialogProps) {
    const [shares, setShares] = useState<ShareEntry[]>([])

    // Initialiser med ligelig fordeling
    useEffect(() => {
        if (open) setShares(distributeEvenly(editors))
    }, [open, editors])

    const total = shares.reduce((s, e) => s + parsePercent(e.percent), 0)
    const totalRounded = Math.round(total * 100) / 100
    const isValid = Math.abs(totalRounded - 100) < 0.01 && shares.length > 0

    function updatePercent(editorId: string, value: string) {
        setShares(prev => prev.map(s =>
            s.editorId === editorId ? { ...s, percent: value } : s
        ))
    }

    function handleEvenSplit() {
        setShares(distributeEvenly(editors))
    }

    function handleSubmit() {
        if (!isValid) return
        onCreate(shares.map(s => ({
            editorId: s.editorId,
            name: s.name,
            sharePercent: parsePercent(s.percent),
        })))
        onClose()
    }

    const totalColor = isValid
        ? "text-green-600"
        : totalRounded > 100
            ? "text-destructive"
            : "text-amber-600"

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Opret fordelingsnøgle</DialogTitle>
                    <p className="text-sm text-muted-foreground">{productionTitle}</p>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {editors.length === 0 ? (
                        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            Tilføj klippere til produktionen før du opretter en fordelingsnøgle
                        </div>
                    ) : (
                        <>
                            {/* Fordeling */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>Fordeling</Label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs"
                                        onClick={handleEvenSplit}
                                    >
                                        Fordel ligeligt
                                    </Button>
                                </div>

                                <div className="rounded-md border divide-y">
                                    {shares.map(share => (
                                        <div key={share.editorId} className="flex items-center gap-3 px-3 py-2.5">
                                            <span className="flex-1 text-sm">{share.name}</span>
                                            <div className="relative w-24">
                                                <Input
                                                    value={share.percent}
                                                    onChange={e => updatePercent(share.editorId, e.target.value)}
                                                    className="pr-7 text-right tabular-nums h-8"
                                                />
                                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Total */}
                            <div className={`flex items-center justify-between text-sm font-medium px-1 ${totalColor}`}>
                                <span>Total</span>
                                <span className="tabular-nums">
                                    {totalRounded.toFixed(2).replace(".", ",")} %
                                </span>
                            </div>

                            {/* Status */}
                            {isValid ? (
                                <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800 px-3 py-2 text-xs text-green-700 dark:text-green-300">
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    Fordelingen summer til 100% — klar til at sende til klipperne
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                    {totalRounded > 100
                                        ? `Fordelingen er ${(totalRounded - 100).toFixed(2).replace(".", ",")}% for høj`
                                        : `Fordelingen mangler ${(100 - totalRounded).toFixed(2).replace(".", ",")}%`
                                    }
                                </div>
                            )}

                            {/* Info om flow */}
                            <p className="text-xs text-muted-foreground">
                                Nøglen sendes til klipperne som skal acceptere individuelt.
                                Når alle har accepteret, kan du låse nøglen og registrere udbetalinger.
                            </p>
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSubmit} disabled={!isValid}>
                        Send til klippere
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
