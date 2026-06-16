"use client"

/**
 * components/contract-intake-fields.tsx
 *
 * Delte UI-komponenter og konstanter til kontraktgennemgangs-formular.
 * Bruges af både portal (app/portal/kontraktgennemgang) og
 * admin (app/admin/kontraktgennemgang — ManuelGennemgang).
 *
 * FOCUS_AREAS og chip-brug hertil forbliver i portal-filen
 * da admin-værktøjet ikke bruger fokusområder.
 */

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, Loader2 } from "lucide-react"
import type {
    ContractType,
    ProductionType,
    DistributionChannel,
    ProducerSelection,
} from "@/lib/types"

// ── Chip ─────────────────────────────────────────────────────

export function Chip({
    label,
    selected,
    onClick,
    color = "default",
}: {
    label: string
    selected: boolean
    onClick: () => void
    color?: "default" | "amber"
}) {
    const base = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium cursor-pointer transition-all select-none"
    const active =
        color === "amber"
            ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
            : "border-primary bg-primary text-primary-foreground"
    const inactive = "border-muted-foreground/25 bg-transparent text-muted-foreground hover:border-foreground/50 hover:text-foreground"
    return (
        <button type="button" onClick={onClick} className={`${base} ${selected ? active : inactive}`}>
            {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
            {label}
        </button>
    )
}

// ── SegmentedControl ──────────────────────────────────────────

export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string }[]
    value: T | null
    onChange: (v: T) => void
}) {
    return (
        <div className="flex rounded-lg border overflow-hidden">
            {options.map((opt, i) => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={[
                        "flex-1 px-3 py-2 text-sm font-medium transition-colors",
                        i > 0 && "border-l",
                        value === opt.value
                            ? "bg-primary text-primary-foreground"
                            : "bg-transparent text-muted-foreground hover:bg-muted",
                    ].filter(Boolean).join(" ")}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}

// ── ProducerCombobox ──────────────────────────────────────────

interface ProducerHit { id: string; name: string; isOverenskomstBound?: boolean; source: "dfks" | "dfi" }

export function ProducerCombobox({
    value,
    onChange,
}: {
    value: ProducerSelection | null
    onChange: (v: ProducerSelection) => void
}) {
    const [query, setQuery] = useState(value?.name ?? "")
    const [open, setOpen] = useState(false)
    const [dfksHits, setDfksHits] = useState<ProducerHit[]>([])
    const [dfiHits, setDfiHits] = useState<ProducerHit[]>([])
    const [loading, setLoading] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", onClickOutside)
        return () => document.removeEventListener("mousedown", onClickOutside)
    }, [])

    function search(q: string) {
        if (timerRef.current) clearTimeout(timerRef.current)
        if (q.length < 2) { setDfksHits([]); setDfiHits([]); setOpen(false); return }
        timerRef.current = setTimeout(async () => {
            setLoading(true)
            try {
                const [dfksRes, dfiRes] = await Promise.allSettled([
                    fetch(`/api/producers/search?q=${encodeURIComponent(q)}`).then(r => r.json()),
                    fetch(`/api/dfi/search?q=${encodeURIComponent(q)}`).then(r => r.json()),
                ])
                setDfksHits(
                    dfksRes.status === "fulfilled"
                        ? (dfksRes.value.results ?? []).map((r: any) => ({ ...r, source: "dfks" as const }))
                        : []
                )
                setDfiHits(
                    dfiRes.status === "fulfilled"
                        ? (dfiRes.value.results ?? []).map((r: any) => ({ ...r, source: "dfi" as const }))
                        : []
                )
                setOpen(true)
            } finally {
                setLoading(false)
            }
        }, 300)
    }

    function select(hit: ProducerHit) {
        setQuery(hit.name)
        setOpen(false)
        onChange({
            name: hit.name,
            dfksId: hit.source === "dfks" ? hit.id : undefined,
            dfiId: hit.source === "dfi" ? hit.id : undefined,
            isOverenskomstBound: hit.isOverenskomstBound,
            source: hit.source,
        })
    }

    function confirmManual() {
        if (!query.trim()) return
        setOpen(false)
        onChange({ name: query.trim(), source: "manual" })
    }

    const hasResults = dfksHits.length > 0 || dfiHits.length > 0

    return (
        <div ref={containerRef} className="relative">
            <div className="relative">
                <input
                    type="text"
                    value={query}
                    onChange={e => { setQuery(e.target.value); search(e.target.value) }}
                    onFocus={() => query.length >= 2 && setOpen(true)}
                    placeholder="Søg produktionsselskab..."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pr-8"
                />
                {loading
                    ? <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                    : <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />}
            </div>

            {open && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-72 overflow-y-auto">
                    {!hasResults ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                            Ingen match — fortsæt med det du har skrevet
                        </div>
                    ) : (
                        <>
                            {dfksHits.length > 0 && (
                                <>
                                    <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fra DFKS</div>
                                    {dfksHits.map(h => (
                                        <button
                                            key={h.id}
                                            type="button"
                                            onClick={() => select(h)}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                                        >
                                            <span className="flex-1">{h.name}</span>
                                            {h.isOverenskomstBound && (
                                                <span className="shrink-0 rounded-full bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 font-medium dark:bg-emerald-950 dark:text-emerald-300">
                                                    Overenskomst
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </>
                            )}
                            {dfiHits.length > 0 && (
                                <>
                                    <div className={`px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${dfksHits.length > 0 ? "border-t" : ""}`}>Fra DFI</div>
                                    {dfiHits.map(h => (
                                        <button
                                            key={h.id}
                                            type="button"
                                            onClick={() => select(h)}
                                            className="flex w-full items-center px-3 py-2 text-sm hover:bg-muted text-left"
                                        >
                                            {h.name}
                                        </button>
                                    ))}
                                </>
                            )}
                        </>
                    )}
                    {query.trim().length >= 2 && (
                        <div className="border-t px-3 py-2">
                            <button
                                type="button"
                                onClick={confirmManual}
                                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Brug &quot;{query.trim()}&quot; som fritekst
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Konstanter ────────────────────────────────────────────────

export const CONTRACT_TYPE_OPTIONS: { value: ContractType; label: string }[] = [
    { value: "ansaettelse", label: "Ansættelse" },
    { value: "freelance",   label: "Freelance / leverandør" },
    { value: "ukendt",      label: "Ved ikke" },
]

export const PRODUCTION_TYPES: { value: ProductionType; label: string }[] = [
    { value: "dokumentar",  label: "Dokumentar" },
    { value: "fiktion",     label: "Fiktion / drama" },
    { value: "tv_program",  label: "TV-program" },
    { value: "reklame",     label: "Reklame / branded content" },
    { value: "streaming",   label: "Streaming-original" },
    { value: "shortform",   label: "Short-form / online" },
    { value: "ukendt",      label: "Ved ikke" },
]

export const DISTRIBUTION_CHANNELS: { value: DistributionChannel; label: string }[] = [
    { value: "biograf",              label: "Biograf" },
    { value: "tv_lineaer",           label: "TV (lineær)" },
    { value: "streaming_svod",       label: "Streaming (SVOD)" },
    { value: "streaming_avod",       label: "Streaming (AVOD/gratis)" },
    { value: "festival",             label: "Festival" },
    { value: "internationalt_salg",  label: "Internationalt salg" },
    { value: "ukendt",               label: "Ved ikke" },
]
