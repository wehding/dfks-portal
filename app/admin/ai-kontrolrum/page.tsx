"use client"

/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { errorMessage } from "@/lib/error-message";
import { useEffect, useState, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
    Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    CheckCircle2, Pencil, Plus, X, Loader2, BookOpen,
    Brain, ListChecks, FlaskConical, AlertCircle, AlertTriangle,
    Info, TrendingUp, TrendingDown, Minus, FileUp, ScrollText, Wand2, RotateCcw,
    RefreshCw, ChevronRight, Copy, Check, Terminal,
} from "lucide-react"
import { PROMPT_REGISTRY, PROMPT_GROUPS } from "@/lib/prompt-registry"
import { toast } from "sonner"
import NoteringGuide from "@/components/notering-guide"
import { AiUsageModelsTab } from "@/components/admin/ai-usage-models-tab"

// ── Shared types ───────────────────────────────────────────────

type Chunk = {
    kilde_id: string
    kilde_titel: string
    tekst: string
    kilde_type: string
    metadata: { dfks_fortolkning?: string | null; raa_tekst?: string | null; roede_flag?: string[] } | null
}

type LegalNote = {
    id: string
    title: string
    body: string
    priority: "baggrund" | "altid"
    active: boolean
    exclude_for_overenskomst: boolean
    gyldig_fra: string | null
    gyldig_til: string | null
    created_at: string
}

type LearnedPattern = {
    id: string
    titel: string
    regel: string
    semantisk_beskrivelse: string
    aktiv: boolean
    godkendt_af: string | null
    created_at: string
}

type PendingFeedback = {
    id: string
    fund_titel: string
    fund_svaerhedsgrad: string
    korrektion_beskrivelse: string | null
    jurist_korrektion: string | null
    created_at: string
}

type FeedbackRow = {
    id: string
    fund_titel: string
    fund_svaerhedsgrad: string
    godkendt: boolean
    korrektion_beskrivelse: string | null
    created_at: string
}

// ─────────────────────────────────────────────────────────────
// Fane 1 — Videnbase
// ─────────────────────────────────────────────────────────────

function VidenbaseTab() {
    const [chunks, setChunks] = useState<Chunk[]>([])
    const [loading, setLoading] = useState(true)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editValue, setEditValue] = useState("")
    const [saving, setSaving] = useState(false)
    const [showAdd, setShowAdd] = useState(false)
    const [reindexing, setReindexing] = useState(false)
    const [reindexResult, setReindexResult] = useState<{ opdateret: number; uændret: number; fejl: number } | null>(null)
    const [syncing, setSyncing] = useState(false)
    const [, setSyncResult] = useState<{ ok: number; fejl: number } | null>(null)
    const [sidstOpdateret, setSidstOpdateret] = useState<string | null>(null)

    useEffect(() => {
        fetch("/api/videnbase")
            .then(r => r.json())
            .then((data: (Chunk & { sidst_opdateret?: string })[]) => {
                const filtered = (data ?? []).filter(c => !c.kilde_id.startsWith("note-"))
                setChunks(filtered)
                // Nyeste sidst_opdateret på tværs af alle chunks
                const dates = filtered.map(c => (c as any).sidst_opdateret).filter(Boolean)
                if (dates.length) setSidstOpdateret(dates.sort().at(-1))
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [])

    const saveEdit = async (kilde_id: string) => {
        setSaving(true)
        try {
            const res = await fetch("/api/videnbase", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kilde_id, dfks_fortolkning: editValue }),
            })
            if (!res.ok) throw new Error((await res.json()).error)
            setChunks(prev => prev.map(c =>
                c.kilde_id === kilde_id ? { ...c, metadata: { ...c.metadata, dfks_fortolkning: editValue || null } } : c
            ))
            setEditingId(null)
            toast.success("Fortolkning gemt og genindekseret")
        } catch (e: unknown) { toast.error(errorMessage(e)) }
        finally { setSaving(false) }
    }

    const filled = chunks.filter(c => c.metadata?.dfks_fortolkning).length

    const handleReindex = async () => {
        setReindexing(true)
        setReindexResult(null)
        try {
            const res = await fetch("/api/admin/reindex", { method: "POST" })
            if (!res.ok) throw new Error((await res.json()).error)
            const result = await res.json()
            setReindexResult(result)
            setSidstOpdateret(new Date().toISOString())
        } catch (e: unknown) { toast.error(errorMessage(e)) }
        finally { setReindexing(false) }
    }

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm text-muted-foreground">{chunks.length} chunks · {filled} med DFKS-fortolkning</p>
                    {sidstOpdateret && (
                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                            Sidst opdateret: {new Date(sidstOpdateret).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" })}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {reindexResult && (
                        <span className="text-xs text-muted-foreground">
                            {reindexResult.opdateret} opdateret{reindexResult.fejl > 0 ? `, ${reindexResult.fejl} fejl` : ""}
                        </span>
                    )}
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReindex} disabled={reindexing}>
                        {reindexing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span>↻</span>}
                        {reindexing ? "Genindekserer..." : "Genindeksér"}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={async () => {
                        setSyncing(true); setSyncResult(null)
                        try {
                            const res = await fetch("/api/admin/sync-retsinformation", { method: "POST" })
                            if (!res.ok) throw new Error((await res.json()).error)
                            const data = await res.json()
                            setSyncResult({ ok: data.ok, fejl: data.fejl })
                            toast.success(`Retsinformation synkroniseret — ${data.ok} paragraffer opdateret`)
                        } catch (e: unknown) { toast.error(errorMessage(e)) }
                        finally { setSyncing(false) }
                    }} disabled={syncing} title="Hent opdateret lovtekst fra retsinformation.dk">
                        {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
                        {syncing ? "Henter love..." : "Sync retsinformation"}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAdd(true)}>
                        <Plus className="h-3.5 w-3.5" />Tilføj chunk
                    </Button>
                </div>
            </div>
            <div className="space-y-2">
                {chunks.map(chunk => {
                    const fortolkning = chunk.metadata?.dfks_fortolkning
                    const isEditing = editingId === chunk.kilde_id
                    return (
                        <div key={chunk.kilde_id} className={`rounded-lg border p-4 space-y-2 ${!fortolkning ? "border-dashed opacity-75" : ""}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="text-sm font-medium">{chunk.kilde_titel}</p>
                                        {fortolkning && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{chunk.tekst}</p>
                                </div>
                                {!isEditing && (
                                    <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-xs"
                                        onClick={() => { setEditingId(chunk.kilde_id); setEditValue(fortolkning ?? "") }}>
                                        <Pencil className="h-3 w-3" />{fortolkning ? "Rediger" : "Tilføj"}
                                    </Button>
                                )}
                            </div>
                            {!isEditing && fortolkning && (
                                <p className="text-xs text-muted-foreground border-l-2 border-emerald-300 pl-3 italic">{fortolkning}</p>
                            )}
                            {!isEditing && !fortolkning && (
                                <p className="text-xs text-muted-foreground/50 italic">Ingen DFKS-fortolkning — klik Tilføj</p>
                            )}
                            {isEditing && (
                                <div className="space-y-2 pt-1">
                                    <Textarea value={editValue} onChange={e => setEditValue(e.target.value)}
                                        placeholder="DFKS's fortolkning og anbefaling..." className="text-xs min-h-[100px]" autoFocus />
                                    <div className="flex gap-2 justify-end">
                                        <Button variant="outline" size="sm" onClick={() => setEditingId(null)} disabled={saving}>
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button size="sm" onClick={() => saveEdit(chunk.kilde_id)} disabled={saving}>
                                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Gem og genindeksér"}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
            <AddChunkDialog open={showAdd} onClose={() => setShowAdd(false)}
                onSaved={c => { setChunks(prev => [...prev, c].sort((a, b) => a.kilde_id.localeCompare(b.kilde_id))); setShowAdd(false) }} />
        </div>
    )
}

function AddChunkDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (c: Chunk) => void }) {
    const [form, setForm] = useState({ kilde_id: "", kilde_titel: "", tekst: "", dfks_fortolkning: "" })
    const [saving, setSaving] = useState(false)
    const save = async () => {
        if (!form.kilde_id || !form.kilde_titel || !form.tekst) return
        setSaving(true)
        try {
            const res = await fetch("/api/videnbase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, kilde_type: "sagserfaring" }) })
            if (!res.ok) throw new Error((await res.json()).error)
            onSaved({ kilde_id: form.kilde_id, kilde_titel: form.kilde_titel, tekst: form.tekst, kilde_type: "sagserfaring", metadata: { dfks_fortolkning: form.dfks_fortolkning || null } })
            setForm({ kilde_id: "", kilde_titel: "", tekst: "", dfks_fortolkning: "" })
            toast.success("Chunk tilføjet og indekseret")
        } catch (e: unknown) { toast.error(errorMessage(e)) }
        finally { setSaving(false) }
    }
    return (
        <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader><DialogTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4" />Tilføj chunk</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1"><Label className="text-xs">ID (unikt)</Label><Input className="h-8 text-xs" placeholder="fx erfaring-001" value={form.kilde_id} onChange={e => setForm(f => ({ ...f, kilde_id: e.target.value }))} /></div>
                        <div className="space-y-1"><Label className="text-xs">Titel</Label><Input className="h-8 text-xs" value={form.kilde_titel} onChange={e => setForm(f => ({ ...f, kilde_titel: e.target.value }))} /></div>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Semantisk beskrivelse</Label><Textarea className="text-xs min-h-[80px]" value={form.tekst} onChange={e => setForm(f => ({ ...f, tekst: e.target.value }))} /></div>
                    <div className="space-y-1"><Label className="text-xs">DFKS-fortolkning <span className="text-muted-foreground">(valgfri)</span></Label><Textarea className="text-xs min-h-[80px]" value={form.dfks_fortolkning} onChange={e => setForm(f => ({ ...f, dfks_fortolkning: e.target.value }))} /></div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>Annuller</Button>
                    <Button onClick={save} disabled={saving || !form.kilde_id || !form.kilde_titel || !form.tekst}>
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}Gem og indeksér
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─────────────────────────────────────────────────────────────
// Fane 2 — Noteringer  (samme mønster som overenskomster/page.tsx Section C)
// ─────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
    altid:    { label: "Altid",    color: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800", dot: "bg-orange-500" },
    baggrund: { label: "Baggrund", color: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800",  dot: "bg-indigo-500" },
}
const PRIORITY_ORDER = ["altid", "baggrund"] as const

type GeneretNotering = { titel: string; body: string }

function NoteringerTab() {
    const supabase = createClient()

    // ── Eksisterende noteringer ───────────────────────────────
    const [notes, setNotes] = useState<LegalNote[]>([])
    const [loading, setLoading] = useState(true)
    const [editingId, setEditingId] = useState<string | null>(null)

    // ── AI-editor state ───────────────────────────────────────
    const [fritekst, setFritekst] = useState("")
    const [aiPrioritet, setAiPrioritet] = useState<"altid" | "baggrund">("altid")
    const [genererer, setGenererer] = useState(false)
    const [generetNotering, setGeneretNotering] = useState<GeneretNotering | null>(null)
    const [gemmerAi, setGemmerAi] = useState(false)

    useEffect(() => {
        fetch("/api/legal-notes").then(r => r.json())
            .then(data => { setNotes(data ?? []); setLoading(false) })
            .catch(() => setLoading(false))
    }, [])

    const apiPatch = async (id: string, updates: Record<string, unknown>) => {
        const res = await fetch("/api/legal-notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...updates }) })
        if (!res.ok) throw new Error((await res.json()).error)
        return res.json() as Promise<LegalNote>
    }

    const updateLocal = (id: string, patch: Partial<LegalNote>) =>
        setNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n))

    const saveNote = async (note: LegalNote) => {
        try {
            await apiPatch(note.id, {
                title: note.title,
                body: note.body,
                priority: note.priority,
                gyldig_fra: note.gyldig_fra,
                gyldig_til: note.gyldig_til,
                exclude_for_overenskomst: note.exclude_for_overenskomst ? ["alle"] : [],
            })
            setEditingId(null)
            toast.success("Notering gemt")
        } catch (e: unknown) { toast.error(errorMessage(e)) }
    }

    const addNote = async () => {
        try {
            const res = await fetch("/api/legal-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Ny notering", body: "", priority: "baggrund" }) })
            if (!res.ok) throw new Error((await res.json()).error)
            const created: LegalNote = await res.json()
            setNotes(prev => [created, ...prev])
            setEditingId(created.id)
        } catch (e: unknown) { toast.error(errorMessage(e)) }
    }

    const deleteNote = async (id: string) => {
        try {
            const res = await fetch("/api/legal-notes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
            if (!res.ok) throw new Error((await res.json()).error)
            setNotes(prev => prev.filter(n => n.id !== id))
            if (editingId === id) setEditingId(null)
            toast.success("Notering slettet")
        } catch (e: unknown) { toast.error(errorMessage(e)) }
    }

    // ── AI-generering ─────────────────────────────────────────
    const genererNotering = async () => {
        if (!fritekst.trim()) return
        setGenererer(true)
        setGeneretNotering(null)
        try {
            const res = await fetch("/api/admin/generer-notering", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fritekst, prioritet: aiPrioritet }),
            })
            if (!res.ok) throw new Error((await res.json()).error)
            const data = await res.json()
            setGeneretNotering(data)
        } catch (e: unknown) { toast.error(errorMessage(e)) }
        finally { setGenererer(false) }
    }

    const gemAiNotering = async () => {
        if (!generetNotering) return
        setGemmerAi(true)
        try {
            const { data, error } = await supabase
                .from("legal_notes")
                .insert({
                    title: generetNotering.titel,
                    body: generetNotering.body,
                    priority: aiPrioritet,
                    active: true,
                })
                .select()
                .single()
            if (error) throw new Error(error.message)
            setNotes(prev => [data as LegalNote, ...prev])
            setGeneretNotering(null)
            setFritekst("")
            toast.success("Notering gemt")
        } catch (e: unknown) { toast.error(errorMessage(e)) }
        finally { setGemmerAi(false) }
    }

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>

    return (
        <div className="space-y-6">

            {/* ── AI-noteringseditor ── */}
            <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Opret ny notering</p>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs">Beskriv reglen med dine egne ord:</Label>
                    <Textarea
                        value={fritekst}
                        onChange={e => setFritekst(e.target.value)}
                        rows={4}
                        placeholder="Beskriv reglen med dine egne ord — fx: Når en kontrakt er på engelsk og lovvalget er udenlandsk, skal vi altid bede om dansk ret..."
                        className="text-sm resize-none"
                    />
                    <p className="text-xs text-muted-foreground">
                        AI&apos;en genererer en struktureret notering baseret på din beskrivelse. Du kan altid redigere inden du gemmer.
                    </p>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Label className="text-xs shrink-0">Prioritet:</Label>
                        <Select value={aiPrioritet} onValueChange={v => setAiPrioritet(v as "altid" | "baggrund")}>
                            <SelectTrigger className="h-7 text-xs w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="altid">Altid</SelectItem>
                                <SelectItem value="baggrund">Baggrund</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Button
                        size="sm"
                        onClick={genererNotering}
                        disabled={genererer || !fritekst.trim()}
                        className="gap-1.5"
                    >
                        {genererer
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Genererer notering...</>
                            : <><Wand2 className="h-3.5 w-3.5" />Generér notering med AI →</>
                        }
                    </Button>
                </div>

                {/* AI-forslag */}
                {generetNotering && (
                    <div className="rounded-md border border-dashed bg-muted/30 p-4 space-y-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI foreslår</p>

                        <div className="space-y-1.5">
                            <Label className="text-xs">Titel:</Label>
                            <input
                                className="w-full text-sm bg-background border rounded px-3 py-1.5 outline-none ring-0 focus:ring-1 focus:ring-ring"
                                value={generetNotering.titel}
                                onChange={e => setGeneretNotering(n => n ? { ...n, titel: e.target.value } : n)}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs">Body (rediger hvis nødvendigt):</Label>
                            <Textarea
                                value={generetNotering.body}
                                onChange={e => setGeneretNotering(n => n ? { ...n, body: e.target.value } : n)}
                                rows={7}
                                className="text-sm font-mono"
                            />
                        </div>

                        <div className="flex items-center justify-between pt-1">
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={genererNotering}
                                disabled={genererer}
                            >
                                {genererer
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <RotateCcw className="h-3.5 w-3.5" />
                                }
                                Prøv igen
                            </Button>
                            <Button
                                size="sm"
                                onClick={gemAiNotering}
                                disabled={gemmerAi || !generetNotering.titel || !generetNotering.body}
                                className="gap-1.5"
                            >
                                {gemmerAi
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <CheckCircle2 className="h-3.5 w-3.5" />
                                }
                                Gem notering
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Eksisterende noteringer ── */}
            <div className="space-y-4">
                <div className="flex items-start justify-between">
                    <p className="text-sm text-muted-foreground mt-1">
                        Noteringer injiceres i alle kontraktanalyser. <em>Altid</em> kommenteres altid på, <em>Baggrund</em> bruges som kontekst.
                    </p>
                    <div className="flex items-center gap-2">
                        <NoteringGuide />
                        <Button size="sm" variant="outline" onClick={addNote}>
                            <Plus className="mr-1.5 h-3.5 w-3.5" />Tilføj notering
                        </Button>
                    </div>
                </div>

                <div className="space-y-3">
                    {notes.map(note => {
                        const isEditing = editingId === note.id
                        const pc = PRIORITY_CONFIG[note.priority] ?? PRIORITY_CONFIG.baggrund
                        return (
                            <div key={note.id} className="rounded-lg border">
                                <div className="flex items-center justify-between px-4 py-3 border-b gap-3">
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        {isEditing ? (
                                            <input
                                                className="flex-1 text-sm font-medium bg-transparent border-0 outline-none ring-1 ring-border rounded px-2 py-0.5"
                                                value={note.title}
                                                onChange={e => updateLocal(note.id, { title: e.target.value })}
                                            />
                                        ) : (
                                            <span className="text-sm font-medium truncate">{note.title}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            title="Skift type"
                                            onClick={async () => {
                                                const idx = PRIORITY_ORDER.indexOf(note.priority as any)
                                                const next = PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length]
                                                updateLocal(note.id, { priority: next })
                                                await apiPatch(note.id, { priority: next }).catch(e => toast.error(errorMessage(e)))
                                            }}
                                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium cursor-pointer transition-opacity hover:opacity-80 ${pc.color}`}
                                        >
                                            <span className={`h-1.5 w-1.5 rounded-full ${pc.dot}`} />
                                            {pc.label}
                                        </button>
                                        <span className="text-xs text-muted-foreground hidden sm:block">
                                            {new Date(note.created_at).toLocaleDateString("da-DK")}
                                        </span>
                                        <Button
                                            variant={isEditing ? "default" : "ghost"}
                                            size="icon"
                                            className="h-7 w-7"
                                            title={isEditing ? "Gem" : "Rediger"}
                                            onClick={() => isEditing ? saveNote(note) : setEditingId(note.id)}
                                        >
                                            {isEditing ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteNote(note.id)}>
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="px-4 py-3 space-y-3">
                                    {isEditing ? (
                                        <>
                                            <Textarea
                                                value={note.body}
                                                onChange={e => updateLocal(note.id, { body: e.target.value })}
                                                rows={5}
                                                className="text-sm font-mono"
                                            />
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Gyldig fra</Label>
                                                    <Input type="date" className="h-7 text-xs" value={note.gyldig_fra ?? ""} onChange={e => updateLocal(note.id, { gyldig_fra: e.target.value || null })} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Gyldig til</Label>
                                                    <Input type="date" className="h-7 text-xs" value={note.gyldig_til ?? ""} onChange={e => updateLocal(note.id, { gyldig_til: e.target.value || null })} />
                                                </div>
                                            </div>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={note.exclude_for_overenskomst ?? false}
                                                    onChange={async e => {
                                                        updateLocal(note.id, { exclude_for_overenskomst: e.target.checked })
                                                        await apiPatch(note.id, { exclude_for_overenskomst: e.target.checked ? ["alle"] : [] }).catch(err => toast.error(err.message))
                                                    }}
                                                    className="h-3.5 w-3.5 rounded"
                                                />
                                                <span className="text-xs text-muted-foreground">Fravalgt ved overenskomst-kontrakter</span>
                                            </label>
                                        </>
                                    ) : (
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.body}</p>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>

                {notes.length === 0 && (
                    <div className="rounded-lg border border-dashed px-4 py-6 text-center">
                        <p className="text-sm text-muted-foreground">Ingen noteringer. Brug editoren ovenfor eller klik &quot;Tilføj notering&quot;.</p>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// Fane 3 — Lærte mønstre (samme mønster som overenskomster/page.tsx Section D)
// ─────────────────────────────────────────────────────────────

function LaerteMoenstreTab() {
    const [patterns, setPatterns] = useState<LearnedPattern[]>([])
    const [pending, setPending] = useState<PendingFeedback[]>([])
    const [loading, setLoading] = useState(true)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [approving, setApproving] = useState<string | null>(null)
    const [approveForm, setApproveForm] = useState({ titel: "", regel: "", semantisk_beskrivelse: "" })
    const [savingApprove, setSavingApprove] = useState(false)

    useEffect(() => {
        fetch("/api/learned-patterns").then(r => r.json()).then(data => {
            setPatterns(data.patterns ?? [])
            setPending(data.pending ?? [])
            setLoading(false)
        }).catch(() => setLoading(false))
    }, [])

    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

    const grouped = useMemo(() => {
        const map: Record<string, { items: PendingFeedback[]; korrektioner: string[] }> = {}
        for (const f of pending) {
            if (!map[f.fund_titel]) map[f.fund_titel] = { items: [], korrektioner: [] }
            map[f.fund_titel].items.push(f)
            if (f.jurist_korrektion && !map[f.fund_titel].korrektioner.includes(f.jurist_korrektion))
                map[f.fund_titel].korrektioner.push(f.jurist_korrektion)
        }
        return Object.entries(map).sort((a, b) => b[1].items.length - a[1].items.length)
    }, [pending])

    const toggleExpand = (titel: string) =>
        setExpandedGroups(prev => {
            const next = new Set(prev)
            if (next.has(titel)) next.delete(titel)
            else next.add(titel)
            return next
        })

    const updateLocal = (id: string, patch: Partial<LearnedPattern>) =>
        setPatterns(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))

    const savePattern = async (p: LearnedPattern) => {
        try {
            await fetch("/api/learned-patterns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, titel: p.titel, regel: p.regel, semantisk_beskrivelse: p.semantisk_beskrivelse }) })
            setEditingId(null)
            toast.success("Regel gemt")
        } catch (e: unknown) { toast.error(errorMessage(e)) }
    }

    const addFromFeedback = async () => {
        setSavingApprove(true)
        try {
            const items = pending.filter(p => p.fund_titel === approving)
            const res = await fetch("/api/learned-patterns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...approveForm, kilde_feedback_id: items[0]?.id ?? null }) })
            const created: LearnedPattern = await res.json()
            if (!res.ok) throw new Error((created as any).error)
            setPatterns(prev => [created, ...prev])
            setPending(prev => prev.filter(p => p.fund_titel !== approving))
            setApproving(null)
            toast.success("Regel gemt og indekseret")
        } catch (e: unknown) { toast.error(errorMessage(e)) }
        finally { setSavingApprove(false) }
    }

    const addNew = async () => {
        try {
            const res = await fetch("/api/learned-patterns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titel: "Ny regel", regel: "", semantisk_beskrivelse: "" }) })
            if (!res.ok) throw new Error((await res.json()).error)
            const created: LearnedPattern = await res.json()
            setPatterns(prev => [created, ...prev])
            setEditingId(created.id)
        } catch (e: unknown) { toast.error(errorMessage(e)) }
    }

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>

    return (
        <div className="space-y-6">
            {/* Afventer godkendelse */}
            {grouped.length > 0 && (
                <div className="space-y-4">
                    <div>
                        <h3 className="text-sm font-semibold">Afventer godkendelse</h3>
                        <p className="text-sm text-muted-foreground mt-0.5">Gentagne fejl fra juristers feedback — kan godkendes som permanente regler.</p>
                    </div>
                    <div className="space-y-3">
                        {grouped.map(([titel, { items, korrektioner }]) => {
                            const isExpanded = expandedGroups.has(titel)
                            const svaerhed = items[0]?.fund_svaerhedsgrad
                            const svaerhedColor = svaerhed === "kritisk" ? "text-red-600" : svaerhed === "advarsel" ? "text-amber-600" : "text-muted-foreground"
                            return (
                            <div key={titel} className="rounded-lg border">
                                <div className="flex items-center justify-between px-4 py-3 border-b gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        <span className="text-sm font-medium truncate">{titel}</span>
                                        <span className={`text-xs shrink-0 ${svaerhedColor}`}>{svaerhed}</span>
                                        <span className="text-xs text-muted-foreground shrink-0">× {items.length}</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Button size="sm" variant="ghost" className="text-xs h-7 px-2"
                                            onClick={() => toggleExpand(titel)}>
                                            {isExpanded ? "Skjul" : "Se detaljer"}
                                        </Button>
                                        {approving !== titel && (
                                            <Button size="sm" variant="outline" className="text-xs h-7"
                                                onClick={() => {
                                                    // Byg regel-forslag fra jurist-korrektioner + korrektion-beskrivelser
                                                    const regelForslag = korrektioner.length > 0
                                                        ? korrektioner.join("\n\n")
                                                        : items.map(i => i.korrektion_beskrivelse).filter(Boolean).join("\n\n")
                                                    setApproving(titel)
                                                    setApproveForm({ titel, semantisk_beskrivelse: titel, regel: regelForslag })
                                                }}>
                                                Godkend som regel
                                            </Button>
                                        )}
                                    </div>
                                </div>
                                {isExpanded && approving !== titel && (
                                    <div className="px-4 py-3 space-y-3 border-b bg-muted/30">
                                        {items.map((item, i) => (
                                            <div key={item.id} className="space-y-1">
                                                <p className="text-xs text-muted-foreground font-medium">
                                                    #{i + 1} — {new Date(item.created_at).toLocaleDateString("da-DK")}
                                                </p>
                                                {item.korrektion_beskrivelse && (
                                                    <p className="text-sm text-foreground/80 whitespace-pre-wrap">{item.korrektion_beskrivelse}</p>
                                                )}
                                                {item.jurist_korrektion && (
                                                    <p className="text-sm text-blue-700 dark:text-blue-400 whitespace-pre-wrap italic border-l-2 border-blue-300 pl-2">{item.jurist_korrektion}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="px-4 py-3 space-y-3">
                                    {korrektioner.length > 0 && approving !== titel && !isExpanded && (
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap italic">{korrektioner[0]}</p>
                                    )}
                                    {approving === titel && (
                                        <div className="space-y-2">
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">Titel</Label>
                                                <input className="w-full text-sm bg-transparent border-0 outline-none ring-1 ring-border rounded px-2 py-1" value={approveForm.titel} onChange={e => setApproveForm(f => ({ ...f, titel: e.target.value }))} />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">Regel (injiceres i AI-prompten)</Label>
                                                <Textarea value={approveForm.regel} onChange={e => setApproveForm(f => ({ ...f, regel: e.target.value }))} rows={4} className="text-sm font-mono" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">Semantisk beskrivelse (til søgning)</Label>
                                                <Textarea value={approveForm.semantisk_beskrivelse} onChange={e => setApproveForm(f => ({ ...f, semantisk_beskrivelse: e.target.value }))} rows={2} className="text-sm" />
                                            </div>
                                            <div className="flex gap-2 justify-end">
                                                <Button variant="outline" size="sm" onClick={() => setApproving(null)} disabled={savingApprove}><X className="h-3.5 w-3.5" /></Button>
                                                <Button size="sm" onClick={addFromFeedback} disabled={savingApprove || !approveForm.titel || !approveForm.regel}>
                                                    {savingApprove ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Gem som regel"}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            )
                        })}
                    </div>
                    <Separator />
                </div>
            )}

            {/* Aktive regler */}
            <div className="space-y-4">
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-sm font-semibold">Lærte regler</h3>
                        <p className="text-sm text-muted-foreground mt-0.5">Matches semantisk og injiceres kun i relevante analyser.</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={addNew}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" />Tilføj regel
                    </Button>
                </div>
                <div className="space-y-3">
                    {patterns.map(p => {
                        const isEditing = editingId === p.id
                        return (
                            <div key={p.id} className={`rounded-lg border ${!p.aktiv ? "opacity-50" : ""}`}>
                                <div className="flex items-center justify-between px-4 py-3 border-b gap-3">
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        {isEditing ? (
                                            <input
                                                className="flex-1 text-sm font-medium bg-transparent border-0 outline-none ring-1 ring-border rounded px-2 py-0.5"
                                                value={p.titel}
                                                onChange={e => updateLocal(p.id, { titel: e.target.value })}
                                            />
                                        ) : (
                                            <span className="text-sm font-medium truncate">{p.titel}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-xs text-muted-foreground hidden sm:block">
                                            {new Date(p.created_at).toLocaleDateString("da-DK")}
                                        </span>
                                        <Button
                                            variant={isEditing ? "default" : "ghost"}
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => isEditing ? savePattern(p) : setEditingId(p.id)}
                                        >
                                            {isEditing ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                                            onClick={async () => {
                                                await fetch("/api/learned-patterns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, aktiv: !p.aktiv }) })
                                                updateLocal(p.id, { aktiv: !p.aktiv })
                                            }}>
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="px-4 py-3 space-y-2">
                                    {isEditing ? (
                                        <>
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">Regel (injiceres i AI-prompten)</Label>
                                                <Textarea value={p.regel} onChange={e => updateLocal(p.id, { regel: e.target.value })} rows={4} className="text-sm font-mono" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">Semantisk beskrivelse (til søgning)</Label>
                                                <Textarea value={p.semantisk_beskrivelse} onChange={e => updateLocal(p.id, { semantisk_beskrivelse: e.target.value })} rows={2} className="text-sm" />
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{p.regel || <span className="italic">Ingen regel skrevet endnu</span>}</p>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
                {patterns.length === 0 && (
                    <div className="rounded-lg border border-dashed px-4 py-6 text-center">
                        <p className="text-sm text-muted-foreground">Ingen lærte regler endnu. Klik &quot;Tilføj regel&quot; eller godkend feedback ovenfor.</p>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// Fane 4 — Kvalitet (inline fra kvalitet/page.tsx)
// ─────────────────────────────────────────────────────────────

const SVAERHEDSGRAD_CONFIG = {
    kritisk:  { label: "Kritisk",  icon: AlertCircle,   color: "text-red-600",     bg: "bg-red-50 dark:bg-red-950/30"     },
    advarsel: { label: "Advarsel", icon: AlertTriangle, color: "text-amber-600",   bg: "bg-amber-50 dark:bg-amber-950/30" },
    positiv:  { label: "Positiv",  icon: CheckCircle2,  color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
    info:     { label: "Info",     icon: Info,          color: "text-blue-600",    bg: "bg-blue-50 dark:bg-blue-950/30"   },
} as const

function KvalitetTab() {
    const [feedback, setFeedback] = useState<FeedbackRow[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        createClient().from("analysis_feedback").select("*").order("created_at", { ascending: false })
            .then(({ data }) => { setFeedback(data ?? []); setLoading(false) })
    }, [])

    const stats = useMemo(() => {
        const total = feedback.length
        const correct = feedback.filter(f => f.godkendt).length
        const pct = total === 0 ? null : Math.round((correct / total) * 100)
        const bySvaerhed: Record<string, { correct: number; total: number }> = {}
        for (const f of feedback) {
            const k = f.fund_svaerhedsgrad ?? "info"
            if (!bySvaerhed[k]) bySvaerhed[k] = { correct: 0, total: 0 }
            bySvaerhed[k].total++
            if (f.godkendt) bySvaerhed[k].correct++
        }
        const incorrectMap: Record<string, number> = {}
        for (const f of feedback.filter(f => !f.godkendt)) {
            incorrectMap[f.fund_titel] = (incorrectMap[f.fund_titel] ?? 0) + 1
        }
        const topForkerte = Object.entries(incorrectMap).sort((a, b) => b[1] - a[1]).slice(0, 6)
        const medKorrektion = feedback.filter(f => !f.godkendt && f.korrektion_beskrivelse)
        return { total, correct, incorrect: total - correct, pct, bySvaerhed, topForkerte, medKorrektion }
    }, [feedback])

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>

    if (stats.total === 0) return (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
            <FlaskConical className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium">Ingen feedback endnu</p>
            <p className="text-xs text-muted-foreground max-w-sm">Indsamles automatisk fra kontraktgennemgangen.</p>
        </div>
    )

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
                {[
                    { label: "Fund vurderet", value: stats.total },
                    { label: "Samlet præcision", value: stats.pct === null ? "—" : `${stats.pct}%` },
                    { label: "Korrekte", value: stats.correct },
                    { label: "Forkerte", value: stats.incorrect },
                ].map(s => (
                    <div key={s.label} className="rounded-lg border p-4 space-y-1">
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <p className="text-2xl font-bold tabular-nums">{s.value}</p>
                    </div>
                ))}
            </div>
            <div className="space-y-3">
                {(["kritisk", "advarsel", "positiv", "info"] as const).map(k => {
                    const cfg = SVAERHEDSGRAD_CONFIG[k]
                    const d = stats.bySvaerhed[k] ?? { correct: 0, total: 0 }
                    const pct = d.total === 0 ? null : Math.round((d.correct / d.total) * 100)
                    const Icon = cfg.icon
                    return (
                        <div key={k} className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                                    <span className="text-sm font-medium">{cfg.label}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {pct !== null && (pct >= 80 ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> : pct >= 60 ? <Minus className="h-3.5 w-3.5 text-amber-500" /> : <TrendingDown className="h-3.5 w-3.5 text-red-500" />)}
                                    <span className="text-sm tabular-nums">{pct === null ? "—" : `${pct}%`}</span>
                                    <span className="text-xs text-muted-foreground">{d.correct}/{d.total}</span>
                                </div>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                {pct !== null && <div className={`h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />}
                            </div>
                        </div>
                    )
                })}
            </div>
            {stats.topForkerte.length > 0 && (
                <div className="space-y-2">
                    <p className="text-sm font-semibold">Hyppigst forkerte fund</p>
                    <div className="rounded-lg border divide-y">
                        {stats.topForkerte.map(([titel, count]) => (
                            <div key={titel} className="flex items-center justify-between px-4 py-2.5">
                                <span className="text-sm">{titel}</span>
                                <Badge variant="outline" className="tabular-nums">{count}×</Badge>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {stats.medKorrektion.length > 0 && (
                <div className="space-y-2">
                    <p className="text-sm font-semibold">Seneste korrektioner fra jurist</p>
                    <p className="text-xs text-muted-foreground">
                        Når juristen markerer et fund som forkert og skriver en korrektion, vises den her.
                        Gem dem som sagserfaringer under <strong>Kontraktgennemgang</strong> eller direkte i fanen <strong>Mønstre</strong> ovenfor — så bruges de automatisk ved næste analyse.
                    </p>
                    <div className="space-y-2">
                        {stats.medKorrektion.slice(0, 10).map(f => {
                            const cfg = SVAERHEDSGRAD_CONFIG[f.fund_svaerhedsgrad as keyof typeof SVAERHEDSGRAD_CONFIG] ?? SVAERHEDSGRAD_CONFIG.info
                            const Icon = cfg.icon
                            return (
                                <div key={f.id} className={`rounded-lg border p-4 space-y-2 ${cfg.bg}`}>
                                    <div className="flex items-center gap-2">
                                        <Icon className={`h-3.5 w-3.5 ${cfg.color} shrink-0`} />
                                        <span className="text-sm font-medium">{f.fund_titel}</span>
                                        <span className="text-xs text-muted-foreground ml-auto">
                                            {new Date(f.created_at).toLocaleDateString("da-DK")}
                                        </span>
                                    </div>
                                    <p className="text-xs text-foreground/80 pl-5">{f.korrektion_beskrivelse}</p>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// Overenskomst version-række med bilag-funktion
// ─────────────────────────────────────────────────────────────

function OverenskomstVersionRække({ ok, ver, onToggleArkiv, onSlet, onErstat }: {
    ok: string
    ver: { kategorier: string[]; bilag: string[]; antal: number; aktiv: boolean; gyldig_fra: string }
    onToggleArkiv: () => void
    onSlet: () => void
    onErstat: () => void
}) {
    const [bekræftSlet, setBekræftSlet] = useState(false)
    const [visbilag, setVisbilag] = useState(false)
    const [bilagFil, setBilagFil] = useState<File | null>(null)
    const [bilagType, setBilagType] = useState("")
    const [indekserer, setIndekserer] = useState(false)
    const [indekseredeBilag, setIndekseredeBilag] = useState<{ type: string; label: string; antal: number; satser?: any; chunks: { id: string; titel: string; tekst: string }[] }[]>([])
    const [udvidetBilag, setUdvidetBilag] = useState<string | null>(null)
    const [sletterBilag, setSletterBilag] = useState<string | null>(null)
    const [visOkChunks, setVisOkChunks] = useState(false)
    const [okChunks, setOkChunks] = useState<{ id: string; titel: string; tekst: string; kategori: string }[]>([])
    const [henterOkChunks, setHenterOkChunks] = useState(false)

    const hentOkChunks = async () => {
        setHenterOkChunks(true)
        try {
            const r = await fetch(`/api/admin/overenskomst/chunks?overenskomst=${ok}&gyldigFra=${ver.gyldig_fra}`)
            const d = await r.json()
            setOkChunks(d.chunks ?? [])
            setVisOkChunks(true)
        } catch { toast.error("Kunne ikke hente chunks") }
        finally { setHenterOkChunks(false) }
    }

    const hentBilag = async () => {
        const r = await fetch(`/api/admin/overenskomst/bilag?overenskomst=${ok}&gyldigFra=${ver.gyldig_fra}`)
        const d = await r.json()
        setIndekseredeBilag(d.bilag ?? [])
    }

    useEffect(() => { hentBilag().catch(() => {}) }, [ok, ver.gyldig_fra])

    const sletBilag = async (type: string) => {
        setSletterBilag(type)
        try {
            const res = await fetch(`/api/admin/overenskomst/bilag?overenskomst=${ok}&gyldigFra=${ver.gyldig_fra}&type=${type}`, { method: "DELETE" })
            if (!res.ok) throw new Error((await res.json()).error)
            toast.success("Bilag slettet")
            await hentBilag()
            if (udvidetBilag === type) setUdvidetBilag(null)
        } catch (e: unknown) { toast.error(errorMessage(e)) }
        finally { setSletterBilag(null) }
    }

    const indekser = async () => {
        if (!bilagFil || !bilagType) return
        setIndekserer(true)
        try {
            // Konvertér til base64 og tekst
            const buf = await bilagFil.arrayBuffer()
            const bytes = new Uint8Array(buf)
            let binary = ""
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
            const pdfBase64 = btoa(binary)

            // Udtræk tekst client-side er ikke muligt for PDF uden server — send base64 og lad server udtræk tekst
            const res = await fetch("/api/admin/overenskomst/bilag", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pdfBase64,
                    pdfTekst: `${BILAG_TYPER.find(b => b.id === bilagType)?.label} for ${ok} overenskomst ${ver.gyldig_fra}`,
                    overenskomst: ok,
                    gyldigFra: ver.gyldig_fra,
                    bilagType,
                    bilagLabel: BILAG_TYPER.find(b => b.id === bilagType)?.label,
                    filnavn: bilagFil.name,
                }),
            })
            if (!res.ok) throw new Error((await res.json()).error)
            const data = await res.json()
            toast.success(`${bilagFil.name}: ${data.indekseret} chunks indekseret`)
            setBilagFil(null); setBilagType("")
            await hentBilag()
        } catch (e: unknown) { toast.error(errorMessage(e)) }
        finally { setIndekserer(false) }
    }

    return (
        <div className={!ver.aktiv ? "opacity-50" : ""}>
            <div className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-medium">Gyldig fra {ver.gyldig_fra}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        <button onClick={hentOkChunks} disabled={henterOkChunks}
                            className="hover:underline disabled:opacity-50 shrink-0">
                            {henterOkChunks ? "Henter…" : `${ver.antal} sektioner`}
                        </button>
                        {ver.kategorier.length > 0 && <span className="truncate"> · {ver.kategorier.join(" · ")}</span>}
                    </p>
                    {indekseredeBilag.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                            {indekseredeBilag.filter(b => b.type !== "lønskema-satser").map(b => (
                                <button key={b.type}
                                    onClick={() => setUdvidetBilag(b.type)}
                                    className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors">
                                    {b.label}
                                    <span className="ml-1 opacity-50">{b.antal}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {/* Bilag-dialog */}
                    {(() => {
                        const b = indekseredeBilag.find(x => x.type === udvidetBilag)
                        return (
                            <Dialog open={!!b} onOpenChange={open => { if (!open) setUdvidetBilag(null) }}>
                                <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                                    <DialogHeader>
                                        <DialogTitle className="text-sm flex items-center justify-between pr-6">
                                            <span>{b?.label ?? b?.type} — {b?.antal} chunks</span>
                                            <button
                                                onClick={() => b && sletBilag(b.type)}
                                                disabled={sletterBilag === b?.type}
                                                className="text-xs text-destructive hover:underline disabled:opacity-50 font-normal">
                                                {sletterBilag === b?.type ? "Sletter…" : "Slet bilag"}
                                            </button>
                                        </DialogTitle>
                                    </DialogHeader>
                                    <div className="overflow-y-auto flex-1 space-y-3 pr-1">
                                        {b?.chunks.map((c, i) => (
                                            <div key={c.id} className="rounded border p-3 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="outline" className="text-[10px] font-normal px-1.5 shrink-0">Chunk {i + 1}</Badge>
                                                    <span className="text-xs font-medium">{c.titel}</span>
                                                </div>
                                                <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{c.tekst}</p>
                                            </div>
                                        ))}
                                    </div>
                                </DialogContent>
                            </Dialog>
                        )
                    })()}
                    {/* Overenskomst-chunks-dialog */}
                    <Dialog open={visOkChunks} onOpenChange={setVisOkChunks}>
                        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                            <DialogHeader>
                                <DialogTitle className="text-sm">{ok} — indekserede sektioner ({okChunks.length})</DialogTitle>
                            </DialogHeader>
                            <div className="overflow-y-auto flex-1 space-y-3 pr-1">
                                {okChunks.map((c, i) => (
                                    <div key={c.id} className="rounded border p-3 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="text-[10px] font-normal px-1.5 shrink-0">{c.kategori}</Badge>
                                            <span className="text-xs font-medium">{c.titel}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{c.tekst}</p>
                                    </div>
                                ))}
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"
                        onClick={() => setVisbilag(v => !v)}>
                        <Plus className="h-3 w-3" />Bilag
                    </Button>
                    <Badge variant={ver.aktiv ? "default" : "outline"} className="font-normal text-xs">
                        {ver.aktiv ? "● Aktiv" : "Arkiveret"}
                    </Badge>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onToggleArkiv}>
                        {ver.aktiv ? "Arkivér" : "Genaktivér"}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onErstat}>
                        Erstat
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => setBekræftSlet(true)}>
                        Slet
                    </Button>
                </div>
            </div>

            {/* Bekræftelsesdialog */}
            <Dialog open={bekræftSlet} onOpenChange={setBekræftSlet}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Slet overenskomst</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Er du sikker? Dette fjerner alle <strong>{ver.antal} chunks</strong> for{" "}
                        <strong>{ok}</strong> (gyldig fra {ver.gyldig_fra}).
                        Handlingen kan ikke fortrydes.
                    </p>
                    <div className="flex gap-2 justify-end pt-2">
                        <Button variant="outline" onClick={() => setBekræftSlet(false)}>Annuller</Button>
                        <Button variant="destructive" onClick={() => { setBekræftSlet(false); onSlet() }}>Slet</Button>
                    </div>
                </DialogContent>
            </Dialog>

            {visbilag && (
                <div className="px-4 pb-4 space-y-3 border-t bg-muted/20">
                    <p className="text-xs font-medium pt-3">Tilføj bilag</p>
                    <div className="grid grid-cols-2 gap-2">
                        <div
                            className="rounded border-2 border-dashed p-3 text-center cursor-pointer hover:border-muted-foreground/40 transition-colors col-span-2"
                            onClick={() => document.getElementById(`bilag-input-${ok}-${ver.gyldig_fra}`)?.click()}
                        >
                            <input id={`bilag-input-${ok}-${ver.gyldig_fra}`} type="file" accept=".pdf,.docx,.doc" className="hidden"
                                onChange={e => setBilagFil(e.target.files?.[0] ?? null)} />
                            {bilagFil
                                ? <p className="text-xs font-medium">{bilagFil.name}</p>
                                : <p className="text-xs text-muted-foreground">Klik for at vælge fil (PDF, DOCX, DOC)</p>}
                        </div>
                        <Select value={bilagType} onValueChange={setBilagType}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Bilagstype..." /></SelectTrigger>
                            <SelectContent>
                                {BILAG_TYPER.map(b => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={indekser}
                            disabled={!bilagFil || !bilagType || indekserer}>
                            {indekserer ? <><Loader2 className="h-3 w-3 animate-spin" />Indekserer...</> : "Indeksér bilag"}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// Fane 5 — Overenskomster
// ─────────────────────────────────────────────────────────────

const BILAG_TYPER = [
    { id: "lønskema", label: "Lønskema" },
    { id: "standardkontrakt-aloen", label: "Standardkontrakt (A-løn)" },
    { id: "standardkontrakt-leverandoer", label: "Standardkontrakt (leverandør)" },
    { id: "bilag", label: "Andet bilag" },
]



type Sektion = {
    titel: string
    tekst: string
    kategori: string
    tillid: "høj" | "lav"
    sats?: string
    godkendt?: boolean
}

type KøItem = {
    id: string
    fil: File
    overenskomst: string
    gyldigFra: string
    status: "afventer" | "analyserer" | "klar" | "indekserer" | "done" | "fejl"
    sektioner: Sektion[]
    pdfTekst?: string
    fejlbesked?: string
    resultat?: { kategoriserede: number; fuldeChunks: number; total: number }
}

type PensionRuleItem = {
    id: string
    employment_form: string
    employer_percent: number
    employee_percent: number
    basis: string
    scheme_kind: string
    valid_from: string
    valid_to: string | null
    section_reference: string
    source_note: string | null
    status: "draft" | "approved" | "archived"
}

type WageRuleItem = {
    id: string
    profession_role: string
    wage_group: string | null
    employment_form: string
    rate_kind: "minimum" | "normalløn" | "source_requires_review" | "individual_or_classified"
    amount: number | null
    currency: "DKK"
    unit: "time" | "dag" | "uge" | "måned" | null
    pension_included: boolean
    valid_from: string
    valid_to: string | null
    source_title: string
    source_url: string
    source_section: string | null
    source_checked_at: string
    source_note: string | null
    status: "draft" | "approved" | "archived"
}

type PercentageRuleItem = {
    id: string
    label: string
    percent: number
    basis: string
    trigger_condition: string
    category: string
    profession_role: string | null
    employment_form: string | null
    section_reference: string | null
    source_title: string | null
    source_url: string | null
    source_checked_at: string | null
    source_note: string | null
    fortolkningsnote: string | null
    valid_from: string
    valid_to: string | null
    status: "draft" | "approved" | "archived"
}

type AgreementRegistryItem = {
    id: string
    code: string
    title: string
    parties: string[]
    production_types: string[]
    profession_roles: string[]
    employment_forms: string[]
    content_url: string | null
    source_url: string | null
    status: "draft" | "approved" | "archived"
    valid_from: string | null
    valid_to: string | null
    notes: string | null
    agreement_pension_rules: PensionRuleItem[]
    agreement_wage_rules: WageRuleItem[]
    agreement_percentage_rules: PercentageRuleItem[]
}

type PensionPreviewItem = {
    contractId: string
    title: string
    pensionTag: string
    agreementTitle: string
}

async function filTilBase64(fil: File): Promise<string> {
    const buf = await fil.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ""
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
}

function OverenskomsterTab() {
    const [kø, setKø] = useState<KøItem[]>([])
    const [aktivItem, setAktivItem] = useState<string | null>(null) // ID for item i bekræftelsesfasen
    type OkVersion = { kategorier: string[]; bilag: string[]; antal: number; aktiv: boolean; gyldig_fra: string }
    const [versioner, setVersioner] = useState<Record<string, OkVersion[]>>({})
    const [agreementRegistry, setAgreementRegistry] = useState<AgreementRegistryItem[]>([])
    const [registryError, setRegistryError] = useState<string | null>(null)
    const [kategorier, setKategorier] = useState<string[]>([])
    const [pensionPreview, setPensionPreview] = useState<PensionPreviewItem[] | null>(null)
    const [pensionPreviewLoading, setPensionPreviewLoading] = useState(false)

    // Ny fil-tilføjelse state
    const [nyFil, setNyFil] = useState<File | null>(null)
    const [nyGyldigFra, setNyGyldigFra] = useState("")
    const [uploadTarget, setUploadTarget] = useState<string | null>(null) // agreement.id
    const [visOpretForm, setVisOpretForm] = useState(false)
    const [opretForm, setOpretForm] = useState({ code: "", title: "", parties: "", valid_from: "" })
    const [opretLoading, setOpretLoading] = useState(false)
    const [nyOverenskomst, setNyOverenskomst] = useState("")

    // Stamdata-redigering: agreement.id → form state
    type StamdataForm = { title: string; parties: string; short_code: string; valid_from: string; valid_to: string; notes: string; source_url: string; content_url: string }
    const [editStamdata, setEditStamdata] = useState<string | null>(null) // agreement.id
    const [stamdataForm, setStamdataForm] = useState<StamdataForm>({ title: "", parties: "", short_code: "", valid_from: "", valid_to: "", notes: "", source_url: "", content_url: "" })
    const [stamdataSaving, setStamdataSaving] = useState(false)

    // Løn- og pensionsregel-redigering / oprettelse
    type WageRuleForm = {
        profession_role: string; wage_group: string; employment_form: string
        rate_kind: string; amount: string; unit: string; pension_included: boolean
        valid_from: string; valid_to: string
        source_title: string; source_url: string; source_section: string; source_checked_at: string; source_note: string
    }
    type PensionRuleForm = {
        employment_form: string; employer_percent: string; employee_percent: string
        basis: string; scheme_kind: string; valid_from: string; valid_to: string
        section_reference: string; source_note: string
    }
    const emptyWageForm = (): WageRuleForm => ({
        profession_role: "", wage_group: "", employment_form: "a-løn", rate_kind: "normalløn",
        amount: "", unit: "uge", pension_included: false, valid_from: "", valid_to: "",
        source_title: "", source_url: "", source_section: "", source_checked_at: new Date().toISOString().slice(0, 10), source_note: "",
    })
    const emptyPensionForm = (): PensionRuleForm => ({
        employment_form: "a-løn", employer_percent: "", employee_percent: "0",
        basis: "normalløn", scheme_kind: "occupational_pension", valid_from: "", valid_to: "",
        section_reference: "", source_note: "",
    })
    const [editWageRule, setEditWageRule] = useState<string | null>(null)
    const [wageRuleForm, setWageRuleForm] = useState<WageRuleForm>(emptyWageForm())
    const [editPensionRule, setEditPensionRule] = useState<string | null>(null)
    const [pensionRuleForm, setPensionRuleForm] = useState<PensionRuleForm>(emptyPensionForm())
    const [newWageAgreementId, setNewWageAgreementId] = useState<string | null>(null)
    const [newWageForm, setNewWageForm] = useState<WageRuleForm & { rate_key: string }>(Object.assign(emptyWageForm(), { rate_key: "" }))
    const [newPensionAgreementId, setNewPensionAgreementId] = useState<string | null>(null)
    const [newPensionForm, setNewPensionForm] = useState<PensionRuleForm>(emptyPensionForm())
    const [newPctAgreementId, setNewPctAgreementId] = useState<string | null>(null)
    const [newPctForm, setNewPctForm] = useState({ label: "", percent: "", basis: "", trigger_condition: "", category: "overarbejde", valid_from: "", section_reference: "", source_title: "", label_key: "", fortolkningsnote: "" })
    const [ruleSaving, setRuleSaving] = useState(false)

    // ── AI-udtræk af satser ────────────────────────────────────
    type SatsKandidat = {
        _id: string
        type: "wage" | "pension" | "percentage"
        checked: boolean
        // løn
        profession_role: string
        wage_group: string
        employment_form: string
        rate_kind: string
        amount: string
        unit: string
        pension_included: boolean
        // pension
        employer_percent: string
        employee_percent: string
        basis: string
        scheme_kind: string
        // procent
        label: string
        percent: string
        trigger_condition: string
        category: string
        // fælles
        valid_from: string
        section_reference: string
        citation: string
        confidence: "høj" | "lav"
        // kilde (sættes fra dialog)
        source_title: string
        source_url: string
        source_checked_at: string
    }
    const [satserUdtraekAgreementId, setSatserUdtraekAgreementId] = useState<string | null>(null)
    const [satserPhase, setSatserPhase] = useState<"input" | "kandidater">("input")
    const [satserInputMode, setSatserInputMode] = useState<"upload" | "bilag">("upload")
    const [satserFil, setSatserFil] = useState<File | null>(null)
    const [satserKildeTitel, setSatserKildeTitel] = useState("")
    const [satserKildeUrl, setSatserKildeUrl] = useState("")
    const [satserKildeCheckedAt, setSatserKildeCheckedAt] = useState(new Date().toISOString().slice(0, 10))
    const [satserBilagValg, setSatserBilagValg] = useState("")
    const [tilgaengeligeBilag, setTilgaengeligeBilag] = useState<{ overenskomst: string; gyldigFra: string; bilagType: string; label: string }[]>([])
    const [satserUdtraekker, setSatserUdtraekker] = useState(false)
    const [satserKandidater, setSatserKandidater] = useState<SatsKandidat[]>([])
    const [satserOpretter, setSatserOpretter] = useState(false)

    const åbnSatserUdtraek = async (agreementId: string) => {
        setSatserUdtraekAgreementId(agreementId)
        setSatserPhase("input")
        setSatserInputMode("upload")
        setSatserFil(null)
        setSatserKildeTitel("")
        setSatserKildeUrl("")
        setSatserBilagValg("")
        setSatserKandidater([])
        // Hent eksisterende lønskema-bilag for denne overenskomst
        try {
            const r = await fetch(`/api/admin/overenskomst/satser-udtraek?agreementId=${agreementId}`)
            const d = await r.json()
            setTilgaengeligeBilag(d.bilag ?? [])
        } catch { setTilgaengeligeBilag([]) }
    }

    const udtraekSatser = async (agreementId: string) => {
        setSatserUdtraekker(true)
        try {
            const body: Record<string, unknown> = {
                agreementId,
                kildeTitel: satserKildeTitel,
                kildeUrl: satserKildeUrl,
            }
            if (satserInputMode === "upload" && satserFil) {
                const buf = await satserFil.arrayBuffer()
                const bytes = new Uint8Array(buf)
                let binary = ""
                for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
                body.pdfBase64 = btoa(binary)
                body.filnavn = satserFil.name
                if (!satserKildeTitel) body.kildeTitel = satserFil.name
            } else if (satserInputMode === "bilag" && satserBilagValg) {
                const ref = JSON.parse(satserBilagValg)
                body.bilagOverenskomst = ref.overenskomst
                body.bilagGyldigFra = ref.gyldigFra
                body.bilagType = ref.bilagType
                if (!satserKildeTitel) body.kildeTitel = ref.label
            } else {
                toast.error("Vælg en fil eller et eksisterende bilag")
                return
            }
            const res = await fetch("/api/admin/overenskomst/satser-udtraek", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            const raw = await res.json()
            if (!res.ok) {
                const msg = raw?.error ?? `Serverfejl ${res.status}`
                toast.error(`Udtræk fejlede: ${msg}`)
                return
            }
            const data = raw
            const now = new Date().toISOString().slice(0, 10)
            const kildenavn = (body.kildeTitel as string) || (data.kildeTitel ?? "")
            const kildelink = (body.kildeUrl as string) || (data.kildeUrl ?? "")
            const mapped: SatsKandidat[] = (data.kandidater ?? []).map((k: Record<string, unknown>, i: number) => ({
                _id: `k-${i}`,
                type: (["wage","pension","percentage"].includes(k.type as string) ? k.type : "wage") as "wage"|"pension"|"percentage",
                checked: k.confidence === "høj",
                profession_role: String(k.profession_role ?? ""),
                wage_group: String(k.wage_group ?? ""),
                employment_form: String(k.employment_form ?? "a-løn"),
                rate_kind: String(k.rate_kind ?? "normalløn"),
                amount: k.amount != null ? String(k.amount) : "",
                unit: String(k.unit ?? "uge"),
                pension_included: !!k.pension_included,
                employer_percent: k.employer_percent != null ? String(k.employer_percent) : "",
                employee_percent: k.employee_percent != null ? String(k.employee_percent) : "0",
                basis: String(k.basis ?? "normalløn"),
                scheme_kind: String(k.scheme_kind ?? "occupational_pension"),
                label: String(k.label ?? ""),
                percent: k.percent != null ? String(k.percent) : "",
                trigger_condition: String(k.trigger_condition ?? ""),
                category: String(k.category ?? "andet"),
                valid_from: String(k.valid_from ?? ""),
                section_reference: String(k.section_reference ?? ""),
                citation: String(k.citation ?? ""),
                confidence: (k.confidence === "høj" ? "høj" : "lav") as "høj" | "lav",
                source_title: kildenavn,
                source_url: kildelink,
                source_checked_at: now,
            }))
            setSatserKandidater(mapped)
            setSatserPhase("kandidater")
        } catch (e: unknown) { toast.error(errorMessage(e)) }
        finally { setSatserUdtraekker(false) }
    }

    const opretValgte = async (agreementId: string) => {
        const valgte = satserKandidater.filter(k => k.checked)
        if (valgte.length === 0) { toast.error("Ingen kandidater valgt"); return }
        setSatserOpretter(true)
        let ok = 0; let fejl = 0
        const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9æøå]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
        for (const k of valgte) {
            try {
                const today = new Date().toISOString().slice(0, 10)
                const body = k.type === "wage"
                    ? {
                        wageRule: {
                            agreementId,
                            rate_key: `${slugify(k.profession_role || "regel")}-${slugify(k.wage_group || k.rate_kind || "")}-${slugify(k.employment_form)}-${k.valid_from || "ukendt"}`,
                            profession_role: k.profession_role,
                            wage_group: k.wage_group || null,
                            employment_form: k.employment_form,
                            rate_kind: k.rate_kind,
                            amount: k.amount !== "" ? Number(k.amount) : null,
                            unit: k.unit || null,
                            pension_included: k.pension_included,
                            valid_from: k.valid_from || today,
                            source_title: k.source_title,
                            source_url: k.source_url,
                            source_section: k.section_reference,
                            source_checked_at: k.source_checked_at,
                            source_note: k.citation || null,
                        },
                    }
                    : k.type === "pension"
                    ? {
                        pensionRule: {
                            agreementId,
                            employment_form: k.employment_form,
                            employer_percent: Number(k.employer_percent),
                            employee_percent: Number(k.employee_percent),
                            basis: k.basis,
                            scheme_kind: k.scheme_kind,
                            valid_from: k.valid_from || today,
                            section_reference: k.section_reference,
                            source_note: k.citation || null,
                        },
                    }
                    : {
                        percentageRule: {
                            agreementId,
                            rate_key: `${slugify(k.label || "regel")}-${k.valid_from || "ukendt"}`,
                            label: k.label,
                            percent: Number(k.percent),
                            basis: k.basis,
                            trigger_condition: k.trigger_condition,
                            category: k.category,
                            employment_form: k.employment_form || null,
                            section_reference: k.section_reference || null,
                            source_title: k.source_title || null,
                            source_url: k.source_url || null,
                            source_checked_at: k.source_checked_at || null,
                            source_note: k.citation || null,
                            valid_from: k.valid_from || today,
                        },
                    }
                const res = await fetch("/api/admin/agreements", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                })
                if (res.ok) { ok++ } else { fejl++ }
            } catch { fejl++ }
        }
        setSatserOpretter(false)
        if (ok > 0) toast.success(`${ok} regel${ok > 1 ? "r" : ""} oprettet som kladde`)
        if (fejl > 0) toast.error(`${fejl} regel${fejl > 1 ? "r" : ""} fejlede (duplikat eller manglende felter)`)
        setSatserUdtraekAgreementId(null)
        if (ok > 0) refreshAktive()
    }

    const refreshAktive = () => {
        fetch("/api/admin/overenskomst")
            .then(r => r.json())
            .then(d => {
                setVersioner(d.versioner ?? {})
                setAgreementRegistry(d.agreementRegistry ?? [])
                setRegistryError(d.registryError ?? null)
                setKategorier(d.kategorier ?? [])
            })
            .catch(() => {})
    }

    useEffect(() => { refreshAktive() }, [])

    const toggleArkiv = async (overenskomst: string, gyldigFra: string, aktiv: boolean) => {
        await fetch("/api/admin/overenskomst", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ overenskomst, gyldigFra, aktiv }),
        })
        refreshAktive()
        toast.success(aktiv ? "Overenskomst genaktiveret" : "Overenskomst arkiveret")
    }

    const setAgreementStatus = async (agreementId: string, status: AgreementRegistryItem["status"]) => {
        const res = await fetch("/api/admin/overenskomst", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agreementId, status }),
        })
        const data = await res.json()
        if (!res.ok) return toast.error(data.error ?? "Status kunne ikke ændres")
        refreshAktive()
        toast.success(status === "approved" ? "Overenskomsten er godkendt" : "Overenskomsten er arkiveret")
    }

    const findMissingPension = async () => {
        setPensionPreviewLoading(true)
        const res = await fetch("/api/admin/overenskomst/pension-preview")
        const data = await res.json()
        setPensionPreviewLoading(false)
        if (!res.ok) return toast.error(data.error ?? "Kontrakterne kunne ikke kontrolleres")
        setPensionPreview(data.candidates ?? [])
    }

    const applyMissingPension = async () => {
        if (!pensionPreview?.length) return
        setPensionPreviewLoading(true)
        const res = await fetch("/api/admin/overenskomst/pension-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contractIds: pensionPreview.map(item => item.contractId) }),
        })
        const data = await res.json()
        setPensionPreviewLoading(false)
        if (!res.ok) return toast.error(data.error ?? "Pension kunne ikke opdateres")
        toast.success(`${data.updated} kontraktkladder blev opdateret${data.skipped?.length ? ` · ${data.skipped.length} sprunget over` : ""}`)
        setPensionPreview(null)
    }

    const sletVersion = async (overenskomst: string, gyldigFra: string) => {
        const res = await fetch("/api/admin/overenskomst", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ overenskomst, gyldigFra }),
        })
        if (res.ok) { refreshAktive(); toast.success("Overenskomst slettet") }
        else toast.error((await res.json()).error)
    }

    const erstatVersion = (overenskomst: string) => {
        const agreement = agreementRegistry.find(a => a.code === overenskomst)
        if (agreement) {
            setUploadTarget(agreement.id)
        }
        setNyOverenskomst(overenskomst)
        setNyGyldigFra("")
        setNyFil(null)
    }

    const tilføjTilKø = (agreementCode?: string) => {
        const overenskomst = agreementCode ?? nyOverenskomst
        if (!nyFil || !overenskomst || !nyGyldigFra) return
        setKø(prev => [...prev, {
            id: crypto.randomUUID(),
            fil: nyFil,
            overenskomst,
            gyldigFra: nyGyldigFra,
            status: "afventer",
            sektioner: [],
        }])
        setNyFil(null)
        setNyOverenskomst("")
        setNyGyldigFra("")
        setUploadTarget(null)
        const input = document.getElementById(`ok-fil-input-${overenskomst}`) as HTMLInputElement
        if (input) input.value = ""
    }

    const opretOverenskomst = async () => {
        if (!opretForm.code || !opretForm.title) return
        setOpretLoading(true)
        const parties = opretForm.parties.split(",").map(s => s.trim()).filter(Boolean)
        const res = await fetch("/api/admin/agreements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...opretForm, parties }),
        })
        const data = await res.json()
        setOpretLoading(false)
        if (!res.ok) return toast.error(data.error ?? "Kunne ikke oprette overenskomst")
        toast.success("Overenskomst oprettet")
        setVisOpretForm(false)
        setOpretForm({ code: "", title: "", parties: "", valid_from: "" })
        refreshAktive()
    }

    const analyserItem = async (id: string) => {
        const item = kø.find(i => i.id === id)
        if (!item) return
        oppdaterKø(id, { status: "analyserer" })
        try {
            const b64 = await filTilBase64(item.fil)
            const res = await fetch("/api/admin/overenskomst", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pdfBase64: b64, overenskomst: item.overenskomst, gyldigFra: item.gyldigFra }),
            })
            if (!res.ok) throw new Error((await res.json()).error)
            const data = await res.json()
            oppdaterKø(id, {
                status: "klar",
                sektioner: (data.sektioner ?? []).map((s: Sektion) => ({ ...s, godkendt: s.tillid === "høj" })),
                pdfTekst: data.pdfTekst ?? "",
            })
            setAktivItem(id)
        } catch (e: unknown) {
            oppdaterKø(id, { status: "fejl", fejlbesked: errorMessage(e) })
            toast.error(`${item.fil.name}: ${errorMessage(e)}`)
        }
    }

    const analyserAlle = async () => {
        const afventende = kø.filter(i => i.status === "afventer")
        for (const item of afventende) {
            await analyserItem(item.id)
        }
    }

    const indekserItem = async (id: string) => {
        const item = kø.find(i => i.id === id)
        if (!item) return
        const godkendte = item.sektioner.filter(s => s.godkendt)
        if (!godkendte.length) return
        oppdaterKø(id, { status: "indekserer" })
        try {
            const pdfTekst = item.pdfTekst ?? godkendte.map(s => `${s.titel}\n${s.tekst}`).join("\n\n")
            const res = await fetch("/api/admin/overenskomst", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sektioner: godkendte, overenskomst: item.overenskomst, gyldigFra: item.gyldigFra, pdfTekst, filnavn: item.fil.name }),
            })
            if (!res.ok) throw new Error((await res.json()).error)
            const data = await res.json()
            oppdaterKø(id, { status: "done", resultat: data })
            if (aktivItem === id) setAktivItem(null)
            refreshAktive()
            toast.success(`${item.fil.name}: ${data.total} chunks indekseret`)
        } catch (e: unknown) {
            oppdaterKø(id, { status: "fejl", fejlbesked: errorMessage(e) })
            toast.error(errorMessage(e))
        }
    }

    const oppdaterKø = (id: string, patch: Partial<KøItem>) => {
        setKø(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
    }

    const opdaterSektion = (itemId: string, idx: number, patch: Partial<Sektion>) => {
        setKø(prev => prev.map(i => i.id === itemId
            ? { ...i, sektioner: i.sektioner.map((s, j) => j === idx ? { ...s, ...patch } : s) }
            : i))
    }

    const gemStamdata = async (agreementId: string) => {
        setStamdataSaving(true)
        const res = await fetch("/api/admin/agreements", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agreementId, ...stamdataForm }),
        })
        setStamdataSaving(false)
        if (!res.ok) return toast.error((await res.json()).error ?? "Kunne ikke gemme")
        toast.success("Stamdata gemt")
        setEditStamdata(null)
        refreshAktive()
    }

    const gemWageRule = async (wageRuleId: string) => {
        setRuleSaving(true)
        const res = await fetch("/api/admin/agreements", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wageRuleId, ...wageRuleForm }),
        })
        setRuleSaving(false)
        if (!res.ok) return toast.error((await res.json()).error ?? "Kunne ikke gemme")
        toast.success("Lønregel gemt")
        setEditWageRule(null)
        refreshAktive()
    }

    const gemPensionRule = async (pensionRuleId: string) => {
        setRuleSaving(true)
        const res = await fetch("/api/admin/agreements", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pensionRuleId, ...pensionRuleForm }),
        })
        setRuleSaving(false)
        if (!res.ok) return toast.error((await res.json()).error ?? "Kunne ikke gemme")
        toast.success("Pensionsregel gemt")
        setEditPensionRule(null)
        refreshAktive()
    }

    const opretWageRule = async () => {
        if (!newWageAgreementId) return
        setRuleSaving(true)
        const res = await fetch("/api/admin/agreements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wageRule: { agreementId: newWageAgreementId, ...newWageForm } }),
        })
        setRuleSaving(false)
        if (!res.ok) return toast.error((await res.json()).error ?? "Kunne ikke oprette")
        toast.success("Lønregel oprettet som kladde")
        setNewWageAgreementId(null)
        setNewWageForm(Object.assign(emptyWageForm(), { rate_key: "" }))
        refreshAktive()
    }

    const opretPensionRule = async () => {
        if (!newPensionAgreementId) return
        setRuleSaving(true)
        const res = await fetch("/api/admin/agreements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pensionRule: { agreementId: newPensionAgreementId, ...newPensionForm } }),
        })
        setRuleSaving(false)
        if (!res.ok) return toast.error((await res.json()).error ?? "Kunne ikke oprette")
        toast.success("Pensionsregel oprettet som kladde")
        setNewPensionAgreementId(null)
        setNewPensionForm(emptyPensionForm())
        refreshAktive()
    }

    const sletWageRule = async (wageRuleId: string) => {
        setRuleSaving(true)
        const res = await fetch("/api/admin/agreements", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wageRuleId }),
        })
        setRuleSaving(false)
        if (!res.ok) return toast.error((await res.json()).error ?? "Kunne ikke slette")
        toast.success("Lønregel slettet/arkiveret")
        refreshAktive()
    }

    const sletPensionRule = async (pensionRuleId: string) => {
        setRuleSaving(true)
        const res = await fetch("/api/admin/agreements", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pensionRuleId }),
        })
        setRuleSaving(false)
        if (!res.ok) return toast.error((await res.json()).error ?? "Kunne ikke slette")
        toast.success("Pensionsregel slettet/arkiveret")
        refreshAktive()
    }

    const godkendWageRule = async (wageRuleId: string) => {
        setRuleSaving(true)
        const res = await fetch("/api/admin/agreements", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wageRuleId, status: "approved" }),
        })
        setRuleSaving(false)
        if (!res.ok) return toast.error((await res.json()).error ?? "Kunne ikke godkende")
        toast.success("Lønregel godkendt juridisk")
        refreshAktive()
    }

    const godkendPensionRule = async (pensionRuleId: string) => {
        setRuleSaving(true)
        const res = await fetch("/api/admin/agreements", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pensionRuleId, status: "approved" }),
        })
        setRuleSaving(false)
        if (!res.ok) return toast.error((await res.json()).error ?? "Kunne ikke godkende")
        toast.success("Pensionsregel godkendt juridisk")
        refreshAktive()
    }

    const afventende = kø.filter(i => i.status === "afventer").length
    const klarTilIndeksering = kø.filter(i => i.status === "klar")

    // Beregn hvilke versioner der IKKE er koblet til et registerkort
    const linkedCodes = new Set(agreementRegistry.map(a => a.code))
    const unlinkedKeys = Object.keys(versioner).filter(k => !linkedCodes.has(k))

    return (
        <div className="space-y-6">
            <div className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p className="text-sm font-medium">Overenskomster som grundkilder</p>
                        <p className="max-w-3xl text-xs text-muted-foreground">
                            Overenskomsterne bruges både til AI-aflæsning af løn og pension og som juridisk grundkilde i kontraktgennemgangen. AI må kun bruge en sats automatisk, når reglen er godkendt, dato, funktion og ansættelsesform passer, og kontrakten faktisk er omfattet. En leverandørkontrakt er ikke dækket alene, fordi den nævner en overenskomst.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" disabled={pensionPreviewLoading} onClick={findMissingPension}>
                        {pensionPreviewLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                        Find manglende pension
                    </Button>
                </div>
                {pensionPreview && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <p className="font-medium">Forhåndsvisning: {pensionPreview.length} kontraktkladder kan opdateres</p>
                    <p className="mt-1 text-xs">Validerede kontrakter og manuelt låste pensionsfelter ændres ikke.</p>
                    {pensionPreview.length > 0 && <div className="mt-3 space-y-1">
                        {pensionPreview.slice(0, 20).map(item => <p key={item.contractId} className="text-xs">{item.title} · {item.pensionTag}</p>)}
                        {pensionPreview.length > 20 && <p className="text-xs">… og {pensionPreview.length - 20} flere</p>}
                        <Button size="sm" className="mt-2" disabled={pensionPreviewLoading} onClick={applyMissingPension}>Opdatér kontraktkladder</Button>
                    </div>}
                </div>}
                {registryError && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Registeret er ikke klar endnu. Kør den tilhørende databasemigration.</p>}
                <div className="grid gap-3 lg:grid-cols-2">
                    {agreementRegistry.map(agreement => {
                        const agreementVersions = versioner[agreement.code] ?? []
                        const isUploadOpen = uploadTarget === agreement.id
                        return (
                            <div key={agreement.id} className="rounded-md border p-3 space-y-3">
                                {/* Stamdata-redigeringsform — fuld bredde når åben */}
                                {editStamdata === agreement.id ? (
                                    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                                        <p className="text-xs font-medium">Redigér stamdata</p>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Titel</Label>
                                            <Input className="h-7 text-xs" value={stamdataForm.title} onChange={e => setStamdataForm(f => ({ ...f, title: e.target.value }))} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Parter (kommasepareret)</Label>
                                            <Input className="h-7 text-xs" value={stamdataForm.parties} onChange={e => setStamdataForm(f => ({ ...f, parties: e.target.value }))} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Versionsgruppe</Label>
                                            <input
                                                list="short-code-list"
                                                className="flex h-7 w-full rounded-md border border-input bg-background px-3 py-1 text-xs font-mono shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                placeholder="Vælg eksisterende eller skriv ny…"
                                                value={stamdataForm.short_code}
                                                onChange={e => setStamdataForm(f => ({ ...f, short_code: e.target.value.toLowerCase().replace(/\s+/g, "-") }))}
                                            />
                                            <datalist id="short-code-list">
                                                {[...new Set(agreementRegistry.flatMap(a => [(a as Record<string, unknown>).short_code as string].filter(Boolean)))].map(sc => (
                                                    <option key={sc} value={sc} />
                                                ))}
                                            </datalist>
                                            <p className="text-[10px] text-muted-foreground">Brug samme gruppe på alle versioner af samme overenskomst, så systemet kan finde den rigtige version ud fra kontraktdatoen. Fx bruger FAF Fiktionsoverenskomst 2020 og 2025 begge gruppen <span className="font-mono">faf-fiktion</span>.</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="space-y-1">
                                                <Label className="text-xs">Gyldig fra</Label>
                                                <Input type="date" className="h-7 text-xs" value={stamdataForm.valid_from} onChange={e => setStamdataForm(f => ({ ...f, valid_from: e.target.value }))} />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Gyldig til</Label>
                                                <Input type="date" className="h-7 text-xs" value={stamdataForm.valid_to} onChange={e => setStamdataForm(f => ({ ...f, valid_to: e.target.value }))} />
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Officiel kildeside (URL)</Label>
                                            <Input className="h-7 text-xs" placeholder="https://..." value={stamdataForm.source_url} onChange={e => setStamdataForm(f => ({ ...f, source_url: e.target.value }))} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Aftaletekst (URL)</Label>
                                            <Input className="h-7 text-xs" placeholder="https://..." value={stamdataForm.content_url} onChange={e => setStamdataForm(f => ({ ...f, content_url: e.target.value }))} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Bemærkning</Label>
                                            <Input className="h-7 text-xs" value={stamdataForm.notes} onChange={e => setStamdataForm(f => ({ ...f, notes: e.target.value }))} />
                                        </div>
                                        <div className="flex gap-2 pt-1">
                                            <Button size="sm" className="flex-1" disabled={stamdataSaving} onClick={() => gemStamdata(agreement.id)}>
                                                {stamdataSaving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}Gem
                                            </Button>
                                            <Button size="sm" variant="ghost" onClick={() => setEditStamdata(null)}>Annullér</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-medium">{agreement.title}</p>
                                                <Badge variant={agreement.status === "approved" ? "default" : agreement.status === "draft" ? "outline" : "secondary"}>{agreement.status === "approved" ? "Godkendt" : agreement.status === "draft" ? "Kladde" : "Arkiveret"}</Badge>
                                            </div>
                                            <p className="mt-1 text-xs text-muted-foreground">{agreement.parties.join(" · ")} · {agreement.valid_from ?? "ukendt dato"}{agreement.valid_to ? ` – ${agreement.valid_to}` : ""}</p>
                                            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{agreement.code}</p>
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => {
                                                setEditStamdata(agreement.id)
                                                setStamdataForm({
                                                    title: agreement.title,
                                                    parties: agreement.parties.join(", "),
                                                    short_code: ((agreement as Record<string, unknown>).short_code as string | null | undefined) ?? "",
                                                    valid_from: agreement.valid_from ?? "",
                                                    valid_to: agreement.valid_to ?? "",
                                                    notes: agreement.notes ?? "",
                                                    source_url: agreement.source_url ?? "",
                                                    content_url: agreement.content_url ?? "",
                                                })
                                            }}>Redigér</Button>
                                            {agreement.status !== "approved" && <Button size="sm" variant="outline" onClick={() => setAgreementStatus(agreement.id, "approved")}>Godkend</Button>}
                                            {agreement.status === "approved" && <Button size="sm" variant="ghost" onClick={() => setAgreementStatus(agreement.id, "archived")}>Arkivér</Button>}
                                        </div>
                                    </div>
                                )}
                                <div className="space-y-2">
                                    {/* ── Lønregler ── */}
                                    <details className="group rounded-md border bg-background" open>
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
                                            <span>Lønsatser</span>
                                            <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
                                        </summary>
                                        <div className="space-y-2 border-t p-3">
                                            {agreement.agreement_wage_rules.length === 0 && <p className="text-xs text-muted-foreground">Der er endnu ikke registreret et kontrolleret lønskema.</p>}
                                            {agreement.agreement_wage_rules
                                                .slice()
                                                .sort((a, b) => b.valid_from.localeCompare(a.valid_from))
                                                .map(rule => (
                                                    <div key={rule.id} className={`rounded px-3 py-2 text-xs space-y-1 ${rule.status === "archived" ? "opacity-50 bg-muted/20" : "bg-muted/40"}`}>
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div>
                                                                {rule.amount !== null && rule.unit ? (
                                                                    <p className="font-medium">{rule.profession_role}: {Number(rule.amount).toLocaleString("da-DK")} kr. pr. {rule.unit}</p>
                                                                ) : (
                                                                    <p className="font-medium">{rule.profession_role} — {rule.rate_kind}</p>
                                                                )}
                                                                <p className="text-muted-foreground">
                                                                    {[rule.wage_group, rule.employment_form === "a-løn" ? "A-løn" : "Lønmodtagerfreelance", `fra ${rule.valid_from}`, rule.valid_to ? `til ${rule.valid_to}` : null].filter(Boolean).join(" · ")}
                                                                    {rule.status === "approved" ? " · godkendt" : rule.status === "archived" ? " · arkiveret" : " · afventer godkendelse"}
                                                                </p>
                                                            </div>
                                                            <div className="flex gap-1 shrink-0">
                                                                {rule.status === "draft" && <button type="button" className="text-[10px] text-green-600 underline hover:text-green-700" disabled={ruleSaving} onClick={() => godkendWageRule(rule.id)}>godkend</button>}
                                                                <button type="button" className="text-[10px] text-muted-foreground underline hover:text-foreground" onClick={() => {
                                                                    setEditWageRule(rule.id)
                                                                    setWageRuleForm({
                                                                        profession_role: rule.profession_role, wage_group: rule.wage_group ?? "",
                                                                        employment_form: rule.employment_form, rate_kind: rule.rate_kind,
                                                                        amount: rule.amount != null ? String(rule.amount) : "", unit: rule.unit ?? "uge",
                                                                        pension_included: rule.pension_included, valid_from: rule.valid_from, valid_to: rule.valid_to ?? "",
                                                                        source_title: rule.source_title ?? "", source_url: rule.source_url ?? "",
                                                                        source_section: rule.source_section ?? "", source_checked_at: rule.source_checked_at ?? "",
                                                                        source_note: rule.source_note ?? "",
                                                                    })
                                                                }}>redigér</button>
                                                                <button type="button" className="text-[10px] text-destructive underline hover:opacity-80" disabled={ruleSaving} onClick={() => sletWageRule(rule.id)}>
                                                                    {rule.status === "draft" || rule.status === "archived" ? "slet" : "arkivér"}
                                                                </button>
                                                            </div>
                                                        </div>
                                                        {editWageRule === rule.id && (
                                                            <div className="space-y-1.5 pt-2 border-t mt-1">
                                                                <div className="grid grid-cols-2 gap-1.5">
                                                                    <div><Label className="text-[10px]">Funktion</Label><Input className="h-6 text-xs" value={wageRuleForm.profession_role} onChange={e => setWageRuleForm(f => ({ ...f, profession_role: e.target.value }))} /></div>
                                                                    <div><Label className="text-[10px]">Løngruppe</Label><Input className="h-6 text-xs" value={wageRuleForm.wage_group} onChange={e => setWageRuleForm(f => ({ ...f, wage_group: e.target.value }))} /></div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-1.5">
                                                                    <div><Label className="text-[10px]">Ansættelsesform</Label>
                                                                        <Select value={wageRuleForm.employment_form} onValueChange={v => setWageRuleForm(f => ({ ...f, employment_form: v }))}>
                                                                            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                                                                            <SelectContent><SelectItem value="a-løn">A-løn</SelectItem><SelectItem value="lønmodtager-freelance">Lønmodtagerfreelance</SelectItem></SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                    <div><Label className="text-[10px]">Satstype</Label>
                                                                        <Select value={wageRuleForm.rate_kind} onValueChange={v => setWageRuleForm(f => ({ ...f, rate_kind: v }))}>
                                                                            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="normalløn">Normalløn</SelectItem>
                                                                                <SelectItem value="minimum">Minimum</SelectItem>
                                                                                <SelectItem value="source_requires_review">Kræver juridisk review</SelectItem>
                                                                                <SelectItem value="individual_or_classified">Individuel/klassificeret</SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-1.5">
                                                                    <div><Label className="text-[10px]">Beløb (DKK)</Label><Input type="number" className="h-6 text-xs" value={wageRuleForm.amount} onChange={e => setWageRuleForm(f => ({ ...f, amount: e.target.value }))} /></div>
                                                                    <div><Label className="text-[10px]">Enhed</Label>
                                                                        <Select value={wageRuleForm.unit} onValueChange={v => setWageRuleForm(f => ({ ...f, unit: v }))}>
                                                                            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                                                                            <SelectContent><SelectItem value="uge">uge</SelectItem><SelectItem value="dag">dag</SelectItem><SelectItem value="time">time</SelectItem><SelectItem value="måned">måned</SelectItem></SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-1.5">
                                                                    <div><Label className="text-[10px]">Gyldig fra</Label><Input type="date" className="h-6 text-xs" value={wageRuleForm.valid_from} onChange={e => setWageRuleForm(f => ({ ...f, valid_from: e.target.value }))} /></div>
                                                                    <div><Label className="text-[10px]">Gyldig til</Label><Input type="date" className="h-6 text-xs" value={wageRuleForm.valid_to} onChange={e => setWageRuleForm(f => ({ ...f, valid_to: e.target.value }))} /></div>
                                                                </div>
                                                                <div><Label className="text-[10px]">Kilde-titel</Label><Input className="h-6 text-xs" value={wageRuleForm.source_title} onChange={e => setWageRuleForm(f => ({ ...f, source_title: e.target.value }))} /></div>
                                                                <div><Label className="text-[10px]">Kilde-URL</Label><Input className="h-6 text-xs" value={wageRuleForm.source_url} onChange={e => setWageRuleForm(f => ({ ...f, source_url: e.target.value }))} /></div>
                                                                <div className="grid grid-cols-2 gap-1.5">
                                                                    <div><Label className="text-[10px]">Afsnit/paragraf</Label><Input className="h-6 text-xs" value={wageRuleForm.source_section} onChange={e => setWageRuleForm(f => ({ ...f, source_section: e.target.value }))} /></div>
                                                                    <div><Label className="text-[10px]">Kontrolleret dato</Label><Input type="date" className="h-6 text-xs" value={wageRuleForm.source_checked_at} onChange={e => setWageRuleForm(f => ({ ...f, source_checked_at: e.target.value }))} /></div>
                                                                </div>
                                                                <div><Label className="text-[10px]">Note</Label><Input className="h-6 text-xs" value={wageRuleForm.source_note} onChange={e => setWageRuleForm(f => ({ ...f, source_note: e.target.value }))} /></div>
                                                                <div className="flex gap-1.5">
                                                                    <Button size="sm" className="h-6 text-xs flex-1" disabled={ruleSaving} onClick={() => gemWageRule(rule.id)}>{ruleSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Gem</Button>
                                                                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditWageRule(null)}>✕</Button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            <div className="flex gap-1.5 mt-1">
                                                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs gap-1" onClick={() => { setNewWageAgreementId(agreement.id); setNewWageForm(Object.assign(emptyWageForm(), { rate_key: "" })) }}>
                                                    <Plus className="h-3.5 w-3.5" />Tilføj lønregel
                                                </Button>
                                                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => åbnSatserUdtraek(agreement.id)}>
                                                    <Wand2 className="h-3.5 w-3.5" />AI-udtræk
                                                </Button>
                                            </div>
                                        </div>
                                    </details>

                                    {/* ── Dialog: ny lønregel ── */}
                                    <Dialog open={newWageAgreementId === agreement.id} onOpenChange={open => { if (!open) setNewWageAgreementId(null) }}>
                                        <DialogContent className="max-w-lg">
                                            <DialogHeader><DialogTitle className="text-sm">Ny lønregel — {agreement.title}</DialogTitle></DialogHeader>
                                            <div className="space-y-2 text-xs">
                                                <div><Label className="text-[10px]">Rate key (unikt ID, fx "editor-normallon-2026")</Label><Input className="h-7 text-xs" value={newWageForm.rate_key} onChange={e => setNewWageForm(f => ({ ...f, rate_key: e.target.value }))} /></div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Funktion *</Label><Input className="h-7 text-xs" value={newWageForm.profession_role} onChange={e => setNewWageForm(f => ({ ...f, profession_role: e.target.value }))} /></div>
                                                    <div><Label className="text-[10px]">Løngruppe</Label><Input className="h-7 text-xs" value={newWageForm.wage_group} onChange={e => setNewWageForm(f => ({ ...f, wage_group: e.target.value }))} /></div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Ansættelsesform *</Label>
                                                        <Select value={newWageForm.employment_form} onValueChange={v => setNewWageForm(f => ({ ...f, employment_form: v }))}>
                                                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent><SelectItem value="a-løn">A-løn</SelectItem><SelectItem value="lønmodtager-freelance">Lønmodtagerfreelance</SelectItem></SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div><Label className="text-[10px]">Satstype *</Label>
                                                        <Select value={newWageForm.rate_kind} onValueChange={v => setNewWageForm(f => ({ ...f, rate_kind: v }))}>
                                                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="normalløn">Normalløn</SelectItem>
                                                                <SelectItem value="minimum">Minimum</SelectItem>
                                                                <SelectItem value="source_requires_review">Kræver juridisk review</SelectItem>
                                                                <SelectItem value="individual_or_classified">Individuel/klassificeret</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Beløb (DKK)</Label><Input type="number" className="h-7 text-xs" value={newWageForm.amount} onChange={e => setNewWageForm(f => ({ ...f, amount: e.target.value }))} /></div>
                                                    <div><Label className="text-[10px]">Enhed</Label>
                                                        <Select value={newWageForm.unit} onValueChange={v => setNewWageForm(f => ({ ...f, unit: v }))}>
                                                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent><SelectItem value="uge">uge</SelectItem><SelectItem value="dag">dag</SelectItem><SelectItem value="time">time</SelectItem><SelectItem value="måned">måned</SelectItem></SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Gyldig fra *</Label><Input type="date" className="h-7 text-xs" value={newWageForm.valid_from} onChange={e => setNewWageForm(f => ({ ...f, valid_from: e.target.value }))} /></div>
                                                    <div><Label className="text-[10px]">Gyldig til</Label><Input type="date" className="h-7 text-xs" value={newWageForm.valid_to} onChange={e => setNewWageForm(f => ({ ...f, valid_to: e.target.value }))} /></div>
                                                </div>
                                                <div><Label className="text-[10px]">Kilde-titel *</Label><Input className="h-7 text-xs" value={newWageForm.source_title} onChange={e => setNewWageForm(f => ({ ...f, source_title: e.target.value }))} /></div>
                                                <div><Label className="text-[10px]">Kilde-URL *</Label><Input className="h-7 text-xs" value={newWageForm.source_url} onChange={e => setNewWageForm(f => ({ ...f, source_url: e.target.value }))} /></div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Afsnit/paragraf</Label><Input className="h-7 text-xs" value={newWageForm.source_section} onChange={e => setNewWageForm(f => ({ ...f, source_section: e.target.value }))} /></div>
                                                    <div><Label className="text-[10px]">Kontrolleret dato *</Label><Input type="date" className="h-7 text-xs" value={newWageForm.source_checked_at} onChange={e => setNewWageForm(f => ({ ...f, source_checked_at: e.target.value }))} /></div>
                                                </div>
                                                <div><Label className="text-[10px]">Note</Label><Input className="h-7 text-xs" value={newWageForm.source_note} onChange={e => setNewWageForm(f => ({ ...f, source_note: e.target.value }))} /></div>
                                                <p className="text-muted-foreground text-[10px]">Oprettes som kladde — kræver juridisk godkendelse inden AI anvender satsen.</p>
                                            </div>
                                            <DialogFooter>
                                                <Button variant="outline" size="sm" onClick={() => setNewWageAgreementId(null)}>Annuller</Button>
                                                <Button size="sm" disabled={ruleSaving} onClick={opretWageRule}>{ruleSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Opret kladde</Button>
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>

                                    {/* ── Dialog: AI-udtræk af satser ── */}
                                    <Dialog open={satserUdtraekAgreementId === agreement.id} onOpenChange={open => { if (!open) setSatserUdtraekAgreementId(null) }}>
                                        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
                                            <DialogHeader>
                                                <DialogTitle className="text-sm flex items-center gap-2">
                                                    <Wand2 className="h-4 w-4" />
                                                    AI-udtræk af satser — {agreement.title}
                                                </DialogTitle>
                                            </DialogHeader>

                                            {satserPhase === "input" ? (
                                                <div className="space-y-4 overflow-y-auto flex-1">
                                                    {/* Inputkilde */}
                                                    <div className="flex gap-2">
                                                        <Button size="sm" variant={satserInputMode === "upload" ? "default" : "outline"} className="text-xs h-7" onClick={() => setSatserInputMode("upload")}>Upload fil</Button>
                                                        <Button size="sm" variant={satserInputMode === "bilag" ? "default" : "outline"} className="text-xs h-7" disabled={tilgaengeligeBilag.length === 0} onClick={() => setSatserInputMode("bilag")}>
                                                            Eksisterende bilag {tilgaengeligeBilag.length === 0 && "(ingen)"}
                                                        </Button>
                                                    </div>

                                                    {satserInputMode === "upload" ? (
                                                        <div
                                                            className="rounded border-2 border-dashed p-4 text-center cursor-pointer hover:border-muted-foreground/40 transition-colors"
                                                            onClick={() => document.getElementById(`satser-fil-${agreement.id}`)?.click()}
                                                        >
                                                            <input id={`satser-fil-${agreement.id}`} type="file" accept=".pdf,.docx,.doc" className="hidden" onChange={e => setSatserFil(e.target.files?.[0] ?? null)} />
                                                            {satserFil ? (
                                                                <p className="text-xs font-medium">{satserFil.name}</p>
                                                            ) : (
                                                                <>
                                                                    <FileUp className="mx-auto h-5 w-5 text-muted-foreground/50 mb-1" />
                                                                    <p className="text-xs text-muted-foreground">Klik for at vælge lønskema/bilag (PDF, DOCX, DOC)</p>
                                                                </>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <Select value={satserBilagValg} onValueChange={setSatserBilagValg}>
                                                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Vælg indekseret bilag…" /></SelectTrigger>
                                                            <SelectContent>
                                                                {tilgaengeligeBilag.map(b => (
                                                                    <SelectItem key={`${b.gyldigFra}-${b.bilagType}`} value={JSON.stringify(b)}>{b.label}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    )}

                                                    {/* Kildeinfo (bruges som source_title/url på de oprettede regler) */}
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Kilde-titel (til reglernes kildefelt)</Label>
                                                        <Input className="h-7 text-xs" placeholder="fx Lønoversigt De4 2022" value={satserKildeTitel} onChange={e => setSatserKildeTitel(e.target.value)} />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Kilde-URL</Label>
                                                        <Input className="h-7 text-xs" placeholder="https://pro-f.dk/…" value={satserKildeUrl} onChange={e => setSatserKildeUrl(e.target.value)} />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Kontrolleret dato</Label>
                                                        <Input type="date" className="h-7 text-xs" value={satserKildeCheckedAt} onChange={e => setSatserKildeCheckedAt(e.target.value)} />
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground">AI-udtræk opretter kandidater som <strong>kladder</strong> — kræver juridisk godkendelse inden de bruges.</p>
                                                </div>
                                            ) : (
                                                <div className="overflow-y-auto flex-1 space-y-3 pr-1">
                                                    <p className="text-xs text-muted-foreground">
                                                        {satserKandidater.length} kandidater fundet. Markerede oprettes som kladder. Ret felter direkte inden oprettelse.
                                                    </p>

                                                    {/* Lønkandidater */}
                                                    {satserKandidater.filter(k => k.type === "wage").length > 0 && (
                                                        <div className="space-y-1.5">
                                                            <p className="text-xs font-medium">Lønsatser ({satserKandidater.filter(k => k.type === "wage").length})</p>
                                                            {satserKandidater.filter(k => k.type === "wage").map(k => (
                                                                <div key={k._id} className={`rounded border p-2.5 text-xs space-y-1.5 ${k.checked ? "bg-muted/30" : "opacity-50"}`}>
                                                                    <div className="flex items-start gap-2">
                                                                        <input type="checkbox" className="mt-0.5 shrink-0 accent-primary" checked={k.checked} onChange={e => setSatserKandidater(prev => prev.map(c => c._id === k._id ? { ...c, checked: e.target.checked } : c))} />
                                                                        <div className="flex-1 space-y-1.5">
                                                                            <div className="flex gap-1.5 items-center flex-wrap">
                                                                                <Badge variant={k.confidence === "høj" ? "default" : "outline"} className="text-[9px] px-1.5 py-0">{k.confidence} tillid</Badge>
                                                                                {k.citation && <span className="text-[10px] text-muted-foreground italic">"{k.citation}"</span>}
                                                                            </div>
                                                                            <div className="grid grid-cols-2 gap-1">
                                                                                <div><Label className="text-[9px]">Funktion</Label><Input className="h-5 text-[10px]" value={k.profession_role} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, profession_role: e.target.value } : c))} /></div>
                                                                                <div><Label className="text-[9px]">Løngruppe</Label><Input className="h-5 text-[10px]" value={k.wage_group} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, wage_group: e.target.value } : c))} /></div>
                                                                                <div><Label className="text-[9px]">Beløb (DKK)</Label><Input type="number" className="h-5 text-[10px]" value={k.amount} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, amount: e.target.value } : c))} /></div>
                                                                                <div><Label className="text-[9px]">Enhed</Label>
                                                                                    <Select value={k.unit} onValueChange={v => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, unit: v } : c))}>
                                                                                        <SelectTrigger className="h-5 text-[10px]"><SelectValue /></SelectTrigger>
                                                                                        <SelectContent><SelectItem value="uge">uge</SelectItem><SelectItem value="dag">dag</SelectItem><SelectItem value="time">time</SelectItem><SelectItem value="måned">måned</SelectItem></SelectContent>
                                                                                    </Select>
                                                                                </div>
                                                                                <div><Label className="text-[9px]">Ansættelsesform</Label>
                                                                                    <Select value={k.employment_form} onValueChange={v => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, employment_form: v } : c))}>
                                                                                        <SelectTrigger className="h-5 text-[10px]"><SelectValue /></SelectTrigger>
                                                                                        <SelectContent><SelectItem value="a-løn">A-løn</SelectItem><SelectItem value="lønmodtager-freelance">Freelance</SelectItem></SelectContent>
                                                                                    </Select>
                                                                                </div>
                                                                                <div><Label className="text-[9px]">Gyldig fra</Label><Input type="date" className="h-5 text-[10px]" value={k.valid_from} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, valid_from: e.target.value } : c))} /></div>
                                                                            </div>
                                                                            {k.section_reference && <p className="text-[9px] text-muted-foreground">§ {k.section_reference}</p>}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Pensionskandidater */}
                                                    {satserKandidater.filter(k => k.type === "pension").length > 0 && (
                                                        <div className="space-y-1.5">
                                                            <p className="text-xs font-medium">Pensionssatser ({satserKandidater.filter(k => k.type === "pension").length})</p>
                                                            {satserKandidater.filter(k => k.type === "pension").map(k => (
                                                                <div key={k._id} className={`rounded border p-2.5 text-xs space-y-1.5 ${k.checked ? "bg-muted/30" : "opacity-50"}`}>
                                                                    <div className="flex items-start gap-2">
                                                                        <input type="checkbox" className="mt-0.5 shrink-0 accent-primary" checked={k.checked} onChange={e => setSatserKandidater(prev => prev.map(c => c._id === k._id ? { ...c, checked: e.target.checked } : c))} />
                                                                        <div className="flex-1 space-y-1.5">
                                                                            <div className="flex gap-1.5 items-center flex-wrap">
                                                                                <Badge variant={k.confidence === "høj" ? "default" : "outline"} className="text-[9px] px-1.5 py-0">{k.confidence} tillid</Badge>
                                                                                {k.citation && <span className="text-[10px] text-muted-foreground italic">"{k.citation}"</span>}
                                                                            </div>
                                                                            <div className="grid grid-cols-2 gap-1">
                                                                                <div><Label className="text-[9px]">Ansættelsesform</Label>
                                                                                    <Select value={k.employment_form} onValueChange={v => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, employment_form: v } : c))}>
                                                                                        <SelectTrigger className="h-5 text-[10px]"><SelectValue /></SelectTrigger>
                                                                                        <SelectContent><SelectItem value="a-løn">A-løn</SelectItem><SelectItem value="lønmodtager-freelance">Freelance</SelectItem></SelectContent>
                                                                                    </Select>
                                                                                </div>
                                                                                <div><Label className="text-[9px]">Grundlag</Label>
                                                                                    <Select value={k.basis} onValueChange={v => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, basis: v } : c))}>
                                                                                        <SelectTrigger className="h-5 text-[10px]"><SelectValue /></SelectTrigger>
                                                                                        <SelectContent><SelectItem value="normalløn">Normalløn</SelectItem><SelectItem value="minimumsløn">Minimumsløn</SelectItem><SelectItem value="grundløn">Grundløn</SelectItem><SelectItem value="alle-løndele">Alle løndele</SelectItem><SelectItem value="honorar">Honorar</SelectItem></SelectContent>
                                                                                    </Select>
                                                                                </div>
                                                                                <div><Label className="text-[9px]">Arbejdsgiver %</Label><Input type="number" step="0.001" className="h-5 text-[10px]" value={k.employer_percent} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, employer_percent: e.target.value } : c))} /></div>
                                                                                <div><Label className="text-[9px]">Medarbejder %</Label><Input type="number" step="0.001" className="h-5 text-[10px]" value={k.employee_percent} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, employee_percent: e.target.value } : c))} /></div>
                                                                                <div><Label className="text-[9px]">Gyldig fra</Label><Input type="date" className="h-5 text-[10px]" value={k.valid_from} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, valid_from: e.target.value } : c))} /></div>
                                                                                <div><Label className="text-[9px]">Paragraf</Label><Input className="h-5 text-[10px]" value={k.section_reference} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, section_reference: e.target.value } : c))} /></div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Procentkandidater */}
                                                    {satserKandidater.filter(k => k.type === "percentage").length > 0 && (
                                                        <div className="space-y-1.5">
                                                            <p className="text-xs font-medium">Procentsatser og tillæg ({satserKandidater.filter(k => k.type === "percentage").length})</p>
                                                            {satserKandidater.filter(k => k.type === "percentage").map(k => (
                                                                <div key={k._id} className={`rounded border p-2.5 text-xs space-y-1.5 ${k.checked ? "bg-muted/30" : "opacity-50"}`}>
                                                                    <div className="flex items-start gap-2">
                                                                        <input type="checkbox" className="mt-0.5 shrink-0 accent-primary" checked={k.checked} onChange={e => setSatserKandidater(prev => prev.map(c => c._id === k._id ? { ...c, checked: e.target.checked } : c))} />
                                                                        <div className="flex-1 space-y-1.5">
                                                                            <div className="flex gap-1.5 items-center flex-wrap">
                                                                                <Badge variant={k.confidence === "høj" ? "default" : "outline"} className="text-[9px] px-1.5 py-0">{k.confidence} tillid</Badge>
                                                                                <Badge variant="outline" className="text-[9px] px-1.5 py-0">{k.category}</Badge>
                                                                                {k.citation && <span className="text-[10px] text-muted-foreground italic">"{k.citation}"</span>}
                                                                            </div>
                                                                            <p className="text-[10px] text-muted-foreground">Af: {k.basis} · Gælder: {k.trigger_condition}</p>
                                                                            <div className="grid grid-cols-2 gap-1">
                                                                                <div><Label className="text-[9px]">Betegnelse</Label><Input className="h-5 text-[10px]" value={k.label} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, label: e.target.value } : c))} /></div>
                                                                                <div><Label className="text-[9px]">Procent</Label><Input type="number" step="0.01" className="h-5 text-[10px]" value={k.percent} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, percent: e.target.value } : c))} /></div>
                                                                                <div><Label className="text-[9px]">Beregningsgrundlag</Label><Input className="h-5 text-[10px]" value={k.basis} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, basis: e.target.value } : c))} /></div>
                                                                                <div><Label className="text-[9px]">Gyldig fra</Label><Input type="date" className="h-5 text-[10px]" value={k.valid_from} onChange={e => setSatserKandidater(p => p.map(c => c._id === k._id ? { ...c, valid_from: e.target.value } : c))} /></div>
                                                                            </div>
                                                                            {k.section_reference && <p className="text-[9px] text-muted-foreground">§ {k.section_reference}</p>}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {satserKandidater.length === 0 && (
                                                        <p className="text-xs text-muted-foreground py-4 text-center">AI fandt ingen satser i dokumentet.</p>
                                                    )}
                                                </div>
                                            )}

                                            <DialogFooter className="pt-2 border-t gap-2 flex-wrap">
                                                {satserPhase === "kandidater" && (
                                                    <Button size="sm" variant="outline" className="text-xs" onClick={() => setSatserPhase("input")}>
                                                        ← Tilbage
                                                    </Button>
                                                )}
                                                <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSatserUdtraekAgreementId(null)}>Luk</Button>
                                                {satserPhase === "input" ? (
                                                    <Button size="sm" className="text-xs gap-1" disabled={satserUdtraekker || (satserInputMode === "upload" ? !satserFil : !satserBilagValg)} onClick={() => udtraekSatser(agreement.id)}>
                                                        {satserUdtraekker ? <><Loader2 className="h-3 w-3 animate-spin" />Udtrækker…</> : <><Wand2 className="h-3 w-3" />Udtræk satser</>}
                                                    </Button>
                                                ) : (
                                                    <Button size="sm" className="text-xs gap-1" disabled={satserOpretter || satserKandidater.filter(k => k.checked).length === 0} onClick={() => opretValgte(agreement.id)}>
                                                        {satserOpretter ? <><Loader2 className="h-3 w-3 animate-spin" />Opretter…</> : `Opret valgte (${satserKandidater.filter(k => k.checked).length})`}
                                                    </Button>
                                                )}
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>

                                    {/* ── Pensionsregler ── */}
                                    <details className="group rounded-md border bg-background">
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
                                            <span>Pension</span>
                                            <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
                                        </summary>
                                        <div className="space-y-2 border-t p-3">
                                            {agreement.agreement_pension_rules.length === 0 && <p className="text-xs text-muted-foreground">Der er endnu ikke registreret en pensionsregel.</p>}
                                            {agreement.agreement_pension_rules
                                                .slice()
                                                .sort((a, b) => a.valid_from.localeCompare(b.valid_from))
                                                .map(rule => (
                                                    <div key={rule.id} className={`rounded px-3 py-2 text-xs space-y-1 ${rule.status === "archived" ? "opacity-50 bg-muted/20" : "bg-muted/40"}`}>
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div>
                                                                <p className="font-medium">{rule.employment_form === "a-løn" ? "A-løn" : "Lønmodtagerfreelance"}: arbejdsgiver {Number(rule.employer_percent).toLocaleString("da-DK")}%{Number(rule.employee_percent) > 0 ? ` + medarbejder ${Number(rule.employee_percent).toLocaleString("da-DK")}%` : ""}</p>
                                                                <p className="text-muted-foreground">Beregnes af {rule.basis} · {rule.section_reference} · fra {rule.valid_from}{rule.valid_to ? ` til ${rule.valid_to}` : ""}{rule.status === "approved" ? " · godkendt" : rule.status === "archived" ? " · arkiveret" : " · afventer godkendelse"}</p>
                                                            </div>
                                                            <div className="flex gap-1 shrink-0">
                                                                {rule.status === "draft" && <button type="button" className="text-[10px] text-green-600 underline hover:text-green-700" disabled={ruleSaving} onClick={() => godkendPensionRule(rule.id)}>godkend</button>}
                                                                <button type="button" className="text-[10px] text-muted-foreground underline hover:text-foreground" onClick={() => {
                                                                    setEditPensionRule(rule.id)
                                                                    setPensionRuleForm({
                                                                        employment_form: rule.employment_form,
                                                                        employer_percent: String(rule.employer_percent),
                                                                        employee_percent: String(rule.employee_percent),
                                                                        basis: rule.basis, scheme_kind: rule.scheme_kind ?? "occupational_pension",
                                                                        valid_from: rule.valid_from, valid_to: rule.valid_to ?? "",
                                                                        section_reference: rule.section_reference,
                                                                        source_note: rule.source_note ?? "",
                                                                    })
                                                                }}>redigér</button>
                                                                <button type="button" className="text-[10px] text-destructive underline hover:opacity-80" disabled={ruleSaving} onClick={() => sletPensionRule(rule.id)}>
                                                                    {rule.status === "draft" || rule.status === "archived" ? "slet" : "arkivér"}
                                                                </button>
                                                            </div>
                                                        </div>
                                                        {editPensionRule === rule.id && (
                                                            <div className="space-y-1.5 pt-2 border-t mt-1">
                                                                <div className="grid grid-cols-2 gap-1.5">
                                                                    <div><Label className="text-[10px]">Ansættelsesform</Label>
                                                                        <Select value={pensionRuleForm.employment_form} onValueChange={v => setPensionRuleForm(f => ({ ...f, employment_form: v }))}>
                                                                            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                                                                            <SelectContent><SelectItem value="a-løn">A-løn</SelectItem><SelectItem value="lønmodtager-freelance">Lønmodtagerfreelance</SelectItem></SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                    <div><Label className="text-[10px]">Ordningstype</Label>
                                                                        <Select value={pensionRuleForm.scheme_kind} onValueChange={v => setPensionRuleForm(f => ({ ...f, scheme_kind: v }))}>
                                                                            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                                                                            <SelectContent><SelectItem value="occupational_pension">Erhvervspension</SelectItem><SelectItem value="pension_savings">Pensionsopsparing</SelectItem></SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-1.5">
                                                                    <div><Label className="text-[10px]">Arbejdsgiver %</Label><Input type="number" step="0.001" className="h-6 text-xs" value={pensionRuleForm.employer_percent} onChange={e => setPensionRuleForm(f => ({ ...f, employer_percent: e.target.value }))} /></div>
                                                                    <div><Label className="text-[10px]">Medarbejder %</Label><Input type="number" step="0.001" className="h-6 text-xs" value={pensionRuleForm.employee_percent} onChange={e => setPensionRuleForm(f => ({ ...f, employee_percent: e.target.value }))} /></div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-1.5">
                                                                    <div><Label className="text-[10px]">Beregningsgrundlag</Label>
                                                                        <Select value={pensionRuleForm.basis} onValueChange={v => setPensionRuleForm(f => ({ ...f, basis: v }))}>
                                                                            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="normalløn">Normalløn</SelectItem><SelectItem value="minimumsløn">Minimumsløn</SelectItem>
                                                                                <SelectItem value="grundløn">Grundløn</SelectItem><SelectItem value="alle-løndele">Alle løndele</SelectItem>
                                                                                <SelectItem value="honorar">Honorar</SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                    <div><Label className="text-[10px]">Paragraf</Label><Input className="h-6 text-xs" value={pensionRuleForm.section_reference} onChange={e => setPensionRuleForm(f => ({ ...f, section_reference: e.target.value }))} /></div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-1.5">
                                                                    <div><Label className="text-[10px]">Gyldig fra</Label><Input type="date" className="h-6 text-xs" value={pensionRuleForm.valid_from} onChange={e => setPensionRuleForm(f => ({ ...f, valid_from: e.target.value }))} /></div>
                                                                    <div><Label className="text-[10px]">Gyldig til</Label><Input type="date" className="h-6 text-xs" value={pensionRuleForm.valid_to} onChange={e => setPensionRuleForm(f => ({ ...f, valid_to: e.target.value }))} /></div>
                                                                </div>
                                                                <div><Label className="text-[10px]">Note</Label><Input className="h-6 text-xs" value={pensionRuleForm.source_note} onChange={e => setPensionRuleForm(f => ({ ...f, source_note: e.target.value }))} /></div>
                                                                <div className="flex gap-1.5">
                                                                    <Button size="sm" className="h-6 text-xs flex-1" disabled={ruleSaving} onClick={() => gemPensionRule(rule.id)}>{ruleSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Gem</Button>
                                                                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditPensionRule(null)}>✕</Button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            <Button size="sm" variant="outline" className="w-full h-7 text-xs mt-1 gap-1" onClick={() => { setNewPensionAgreementId(agreement.id); setNewPensionForm(emptyPensionForm()) }}>
                                                <Plus className="h-3.5 w-3.5" />Tilføj pensionsregel
                                            </Button>
                                        </div>
                                    </details>

                                    {/* ── Dialog: ny pensionsregel ── */}
                                    <Dialog open={newPensionAgreementId === agreement.id} onOpenChange={open => { if (!open) setNewPensionAgreementId(null) }}>
                                        <DialogContent className="max-w-lg">
                                            <DialogHeader><DialogTitle className="text-sm">Ny pensionsregel — {agreement.title}</DialogTitle></DialogHeader>
                                            <div className="space-y-2 text-xs">
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Ansættelsesform *</Label>
                                                        <Select value={newPensionForm.employment_form} onValueChange={v => setNewPensionForm(f => ({ ...f, employment_form: v }))}>
                                                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent><SelectItem value="a-løn">A-løn</SelectItem><SelectItem value="lønmodtager-freelance">Lønmodtagerfreelance</SelectItem></SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div><Label className="text-[10px]">Ordningstype *</Label>
                                                        <Select value={newPensionForm.scheme_kind} onValueChange={v => setNewPensionForm(f => ({ ...f, scheme_kind: v }))}>
                                                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent><SelectItem value="occupational_pension">Erhvervspension</SelectItem><SelectItem value="pension_savings">Pensionsopsparing</SelectItem></SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Arbejdsgiver % *</Label><Input type="number" step="0.001" className="h-7 text-xs" value={newPensionForm.employer_percent} onChange={e => setNewPensionForm(f => ({ ...f, employer_percent: e.target.value }))} /></div>
                                                    <div><Label className="text-[10px]">Medarbejder % *</Label><Input type="number" step="0.001" className="h-7 text-xs" value={newPensionForm.employee_percent} onChange={e => setNewPensionForm(f => ({ ...f, employee_percent: e.target.value }))} /></div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Beregningsgrundlag *</Label>
                                                        <Select value={newPensionForm.basis} onValueChange={v => setNewPensionForm(f => ({ ...f, basis: v }))}>
                                                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="normalløn">Normalløn</SelectItem><SelectItem value="minimumsløn">Minimumsløn</SelectItem>
                                                                <SelectItem value="grundløn">Grundløn</SelectItem><SelectItem value="alle-løndele">Alle løndele</SelectItem>
                                                                <SelectItem value="honorar">Honorar</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div><Label className="text-[10px]">Paragraf *</Label><Input className="h-7 text-xs" value={newPensionForm.section_reference} onChange={e => setNewPensionForm(f => ({ ...f, section_reference: e.target.value }))} /></div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Gyldig fra *</Label><Input type="date" className="h-7 text-xs" value={newPensionForm.valid_from} onChange={e => setNewPensionForm(f => ({ ...f, valid_from: e.target.value }))} /></div>
                                                    <div><Label className="text-[10px]">Gyldig til</Label><Input type="date" className="h-7 text-xs" value={newPensionForm.valid_to} onChange={e => setNewPensionForm(f => ({ ...f, valid_to: e.target.value }))} /></div>
                                                </div>
                                                <div><Label className="text-[10px]">Note</Label><Input className="h-7 text-xs" value={newPensionForm.source_note} onChange={e => setNewPensionForm(f => ({ ...f, source_note: e.target.value }))} /></div>
                                                <p className="text-muted-foreground text-[10px]">Oprettes som kladde — kræver juridisk godkendelse.</p>
                                            </div>
                                            <DialogFooter>
                                                <Button variant="outline" size="sm" onClick={() => setNewPensionAgreementId(null)}>Annuller</Button>
                                                <Button size="sm" disabled={ruleSaving} onClick={opretPensionRule}>{ruleSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Opret kladde</Button>
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>

                                    {/* ── Procentsatser og tillæg ── */}
                                    <details className="group rounded-md border bg-background">
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
                                            <span>Procentsatser og tillæg</span>
                                            <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
                                        </summary>
                                        <div className="space-y-2 border-t p-3">
                                            {(agreement.agreement_percentage_rules ?? []).length === 0 && <p className="text-xs text-muted-foreground">Ingen procentsatser registreret endnu.</p>}
                                            {(agreement.agreement_percentage_rules ?? [])
                                                .slice()
                                                .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
                                                .map(rule => (
                                                    <div key={rule.id} className={`rounded px-3 py-2 text-xs space-y-0.5 ${rule.status === "archived" ? "opacity-50 bg-muted/20" : "bg-muted/40"}`}>
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div>
                                                                <p className="font-medium">{rule.label}: {Number(rule.percent).toLocaleString("da-DK")}%</p>
                                                                <p className="text-muted-foreground">Af {rule.basis} · {rule.trigger_condition}</p>
                                                                <p className="text-muted-foreground">{rule.section_reference && `${rule.section_reference} · `}fra {rule.valid_from}{rule.status === "approved" ? " · godkendt" : rule.status === "archived" ? " · arkiveret" : " · afventer godkendelse"}</p>
                                                        {rule.fortolkningsnote && <p className="mt-1 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1">⚠ {rule.fortolkningsnote}</p>}
                                                            </div>
                                                            <div className="flex gap-1 shrink-0">
                                                                {rule.status === "draft" && (
                                                                    <button type="button" className="text-[10px] text-green-600 underline hover:text-green-700" disabled={ruleSaving} onClick={async () => {
                                                                        setRuleSaving(true)
                                                                        await fetch("/api/admin/agreements", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ percentageRuleId: rule.id, status: "approved" }) })
                                                                        setRuleSaving(false)
                                                                        refreshAktive()
                                                                    }}>godkend</button>
                                                                )}
                                                                <button type="button" className="text-[10px] text-destructive underline hover:opacity-80" disabled={ruleSaving} onClick={async () => {
                                                                    setRuleSaving(true)
                                                                    await fetch("/api/admin/agreements", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ percentageRuleId: rule.id }) })
                                                                    setRuleSaving(false)
                                                                    refreshAktive()
                                                                }}>
                                                                    {rule.status === "draft" || rule.status === "archived" ? "slet" : "arkivér"}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            <Button size="sm" variant="outline" className="w-full h-7 text-xs mt-1 gap-1" onClick={() => setNewPctAgreementId(agreement.id)}>
                                                <Plus className="h-3.5 w-3.5" />Tilføj procentregel
                                            </Button>
                                        </div>
                                    </details>

                                    {/* ── Dialog: ny procentregel ── */}
                                    <Dialog open={newPctAgreementId === agreement.id} onOpenChange={open => { if (!open) setNewPctAgreementId(null) }}>
                                        <DialogContent className="max-w-lg">
                                            <DialogHeader><DialogTitle className="text-sm">Ny procentregel — {agreement.title}</DialogTitle></DialogHeader>
                                            <div className="space-y-2 text-xs">
                                                <div><Label className="text-[10px]">Betegnelse *</Label><Input className="h-7 text-xs" placeholder="fx Overarbejdstillæg, 1. time" value={newPctForm.label} onChange={e => setNewPctForm(f => ({ ...f, label: e.target.value }))} /></div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Procent *</Label><Input type="number" step="0.01" className="h-7 text-xs" placeholder="25" value={newPctForm.percent} onChange={e => setNewPctForm(f => ({ ...f, percent: e.target.value }))} /></div>
                                                    <div><Label className="text-[10px]">Kategori *</Label>
                                                        <Select value={newPctForm.category} onValueChange={v => setNewPctForm(f => ({ ...f, category: v }))}>
                                                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="overarbejde">Overarbejde</SelectItem>
                                                                <SelectItem value="weekend-helligdag">Weekend/helligdag</SelectItem>
                                                                <SelectItem value="royalty">Royalty</SelectItem>
                                                                <SelectItem value="fond">Fond</SelectItem>
                                                                <SelectItem value="kort-engagement">Kort engagement</SelectItem>
                                                                <SelectItem value="lønregulering">Lønregulering</SelectItem>
                                                                <SelectItem value="erstatning">Erstatning</SelectItem>
                                                                <SelectItem value="andet">Andet</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                                <div><Label className="text-[10px]">Beregningsgrundlag *</Label><Input className="h-7 text-xs" placeholder="fx normaltimeløn, ferieberettiget løn" value={newPctForm.basis} onChange={e => setNewPctForm(f => ({ ...f, basis: e.target.value }))} /></div>
                                                <div><Label className="text-[10px]">Hvornår gælder den *</Label><Input className="h-7 text-xs" placeholder="fx varslet overarbejde, 1. time" value={newPctForm.trigger_condition} onChange={e => setNewPctForm(f => ({ ...f, trigger_condition: e.target.value }))} /></div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div><Label className="text-[10px]">Gyldig fra *</Label><Input type="date" className="h-7 text-xs" value={newPctForm.valid_from} onChange={e => setNewPctForm(f => ({ ...f, valid_from: e.target.value }))} /></div>
                                                    <div><Label className="text-[10px]">Paragraf</Label><Input className="h-7 text-xs" placeholder="§ 4, stk. 2" value={newPctForm.section_reference} onChange={e => setNewPctForm(f => ({ ...f, section_reference: e.target.value }))} /></div>
                                                </div>
                                                <div><Label className="text-[10px]">Kilde-titel</Label><Input className="h-7 text-xs" value={newPctForm.source_title} onChange={e => setNewPctForm(f => ({ ...f, source_title: e.target.value }))} /></div>
                                                <div><Label className="text-[10px]">Kendt begreb (valgfrit — sikrer korrekt nøgleordsmatching)</Label>
                                                    <Select value={newPctForm.label_key} onValueChange={v => setNewPctForm(f => ({ ...f, label_key: v }))}>
                                                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Ingen (de fleste regler)" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="">Ingen</SelectItem>
                                                            <SelectItem value="beta_pulje">BETA-puljen</SelectItem>
                                                            <SelectItem value="helligdagsbetaling">Helligdagsbetaling</SelectItem>
                                                            <SelectItem value="feriepenge">Feriepenge/ferietillæg</SelectItem>
                                                            <SelectItem value="royalty">Royalty</SelectItem>
                                                            <SelectItem value="svod">SVOD-tillæg</SelectItem>
                                                            <SelectItem value="copydan">Copydan</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div><Label className="text-[10px]">Fortolkningsnote (vises som advarsel på valideringssiden)</Label><textarea className="w-full rounded-md border bg-background px-2 py-1.5 text-xs min-h-[60px] resize-y" placeholder="Fx: Tilstedeværelse af denne klausul betyder at rettigheder IKKE er bevaret — det er en buy-out." value={newPctForm.fortolkningsnote} onChange={e => setNewPctForm(f => ({ ...f, fortolkningsnote: e.target.value }))} /></div>
                                            </div>
                                            <DialogFooter className="pt-2 gap-2">
                                                <Button variant="outline" size="sm" onClick={() => setNewPctAgreementId(null)}>Annuller</Button>
                                                <Button size="sm" disabled={ruleSaving} onClick={async () => {
                                                    if (!newPctForm.label || !newPctForm.percent || !newPctForm.basis || !newPctForm.trigger_condition || !newPctForm.valid_from) {
                                                        toast.error("Udfyld alle obligatoriske felter"); return
                                                    }
                                                    setRuleSaving(true)
                                                    const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9æøå]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
                                                    const res = await fetch("/api/admin/agreements", {
                                                        method: "POST",
                                                        headers: { "Content-Type": "application/json" },
                                                        body: JSON.stringify({ percentageRule: { agreementId: agreement.id, rate_key: `${slugify(newPctForm.label)}-${newPctForm.valid_from}`, ...newPctForm, percent: Number(newPctForm.percent), label_key: newPctForm.label_key || null, fortolkningsnote: newPctForm.fortolkningsnote || null } }),
                                                    })
                                                    setRuleSaving(false)
                                                    if (res.ok) { toast.success("Procentregel oprettet som kladde"); setNewPctAgreementId(null); refreshAktive() }
                                                    else { toast.error((await res.json()).error ?? "Fejl") }
                                                }}>{ruleSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Opret kladde</Button>
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>

                                    <details className="group rounded-md border bg-background">
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
                                            <span>Kilder og brug i kontraktgennemgang</span>
                                            <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
                                        </summary>
                                        <div className="space-y-3 border-t p-3 text-xs text-muted-foreground">
                                            <p>
                                                Kilderne giver AI’en et kontrolleret sammenligningsgrundlag. De beviser ikke i sig selv, at en kontrakt er omfattet. AI’en skal også kontrollere kontraktens henvisning, produktionstype, funktion, dato og ansættelsesform og vise usikkerhed for administratoren.
                                            </p>
                                            <div className="space-y-1">
                                                {agreement.source_url && <p><span className="font-medium text-foreground">Officiel oversigt: </span><a href={agreement.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">Producentforeningens eller organisationens kildeside</a></p>}
                                                {agreement.content_url && <p><span className="font-medium text-foreground">Aftaletekst: </span><a href={agreement.content_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">Åbn den registrerede overenskomst</a></p>}
                                                {Array.from(new Map(agreement.agreement_wage_rules.map(rule => [rule.source_url, rule])).values()).map(rule => (
                                                    <p key={rule.source_url}><span className="font-medium text-foreground">Lønskema: </span><a href={rule.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{rule.source_title}</a> · kontrolleret {rule.source_checked_at}</p>
                                                ))}
                                            </div>
                                            <p>Funktioner i registeret: {agreement.profession_roles.join(", ") || "ikke angivet"}</p>
                                            {agreement.notes && <p><span className="font-medium text-foreground">Bemærkning: </span>{agreement.notes}</p>}
                                        </div>
                                    </details>

                                    {/* Indekserede versioner + upload */}
                                    <details className="group rounded-md border bg-background" open={agreementVersions.length === 0 || isUploadOpen}>
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
                                            <span>Indekserede versioner {agreementVersions.length > 0 ? `(${agreementVersions.length})` : ""}</span>
                                            <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
                                        </summary>
                                        <div className="border-t">
                                            {agreementVersions.length === 0 && !isUploadOpen && (
                                                <p className="px-3 py-3 text-xs text-muted-foreground">Ingen indekserede versioner endnu.</p>
                                            )}
                                            {agreementVersions.length > 0 && (
                                                <div className="divide-y">
                                                    {agreementVersions.map(ver => (
                                                        <OverenskomstVersionRække
                                                            key={ver.gyldig_fra}
                                                            ok={agreement.code}
                                                            ver={ver}
                                                            onToggleArkiv={() => toggleArkiv(agreement.code, ver.gyldig_fra, !ver.aktiv)}
                                                            onSlet={() => sletVersion(agreement.code, ver.gyldig_fra)}
                                                            onErstat={() => { setUploadTarget(agreement.id); setNyGyldigFra(""); setNyFil(null) }}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                            {/* Inline upload form */}
                                            {isUploadOpen ? (
                                                <div className="p-3 space-y-3 border-t">
                                                    <p className="text-xs font-medium">Tilføj ny version til {agreement.code}</p>
                                                    <div
                                                        className="rounded border-2 border-dashed p-3 text-center cursor-pointer hover:border-muted-foreground/40 transition-colors"
                                                        onClick={() => document.getElementById(`ok-fil-input-${agreement.id}`)?.click()}
                                                    >
                                                        <input
                                                            id={`ok-fil-input-${agreement.id}`}
                                                            type="file"
                                                            accept=".pdf"
                                                            className="hidden"
                                                            onChange={e => setNyFil(e.target.files?.[0] ?? null)}
                                                        />
                                                        {nyFil ? (
                                                            <p className="text-xs font-medium">{nyFil.name}</p>
                                                        ) : (
                                                            <>
                                                                <FileUp className="mx-auto h-4 w-4 text-muted-foreground/50 mb-1" />
                                                                <p className="text-xs text-muted-foreground">Klik for at vælge PDF</p>
                                                            </>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">Gyldig fra</Label>
                                                        <Input type="date" className="h-8 text-xs" value={nyGyldigFra} onChange={e => setNyGyldigFra(e.target.value)} />
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <Button size="sm" className="flex-1 gap-1" onClick={() => tilføjTilKø(agreement.code)} disabled={!nyFil || !nyGyldigFra}>
                                                            <Plus className="h-3 w-3" />Tilføj til kø
                                                        </Button>
                                                        <Button size="sm" variant="ghost" onClick={() => { setUploadTarget(null); setNyFil(null); setNyGyldigFra("") }}>
                                                            Annullér
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-2">
                                                    <Button size="sm" variant="ghost" className="w-full gap-1.5 text-xs"
                                                        onClick={() => { setUploadTarget(agreement.id); setNyGyldigFra(""); setNyFil(null) }}>
                                                        <Plus className="h-3 w-3" />Tilføj version
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </details>
                                </div>
                            </div>
                        )
                    })}

                    {/* Opret ny overenskomst-kort */}
                    {visOpretForm ? (
                        <div className="rounded-md border p-3 space-y-3">
                            <p className="text-sm font-medium">Opret overenskomst</p>
                            <div className="space-y-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">Overenskomst-id (code)</Label>
                                    <Input className="h-8 text-xs font-mono" placeholder="fx de4-fiction-2022" value={opretForm.code} onChange={e => setOpretForm(f => ({ ...f, code: e.target.value.toLowerCase().replace(/\s+/g, "-") }))} />
                                    <p className="text-[10px] text-muted-foreground">Bruges som nøgle i RAG — brug bindestreg, ikke mellemrum</p>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Titel</Label>
                                    <Input className="h-8 text-xs" placeholder="De4 Fiktionsoverenskomst 2022" value={opretForm.title} onChange={e => setOpretForm(f => ({ ...f, title: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Parter (kommasepareret)</Label>
                                    <Input className="h-8 text-xs" placeholder="DFKS, De4" value={opretForm.parties} onChange={e => setOpretForm(f => ({ ...f, parties: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Gyldig fra</Label>
                                    <Input type="date" className="h-8 text-xs" value={opretForm.valid_from} onChange={e => setOpretForm(f => ({ ...f, valid_from: e.target.value }))} />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button size="sm" className="flex-1" disabled={!opretForm.code || !opretForm.title || opretLoading} onClick={opretOverenskomst}>
                                    {opretLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}Opret
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setVisOpretForm(false); setOpretForm({ code: "", title: "", parties: "", valid_from: "" }) }}>Annullér</Button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setVisOpretForm(true)}
                            className="rounded-md border border-dashed p-3 flex flex-col items-center justify-center gap-2 min-h-[120px] hover:border-muted-foreground/40 hover:bg-muted/20 transition-colors w-full text-left"
                        >
                            <Plus className="h-5 w-5 text-muted-foreground/50" />
                            <p className="text-xs text-muted-foreground">Opret overenskomst</p>
                        </button>
                    )}
                </div>
            </div>

            {/* Kø */}
            {kø.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{kø.length} overenskomst{kø.length !== 1 ? "er" : ""} i kø</p>
                        {afventende > 0 && (
                            <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                                onClick={analyserAlle}>
                                <Brain className="h-3.5 w-3.5" />Analysér alle ({afventende})
                            </Button>
                        )}
                    </div>
                    <div className="space-y-2">
                        {kø.map(item => (
                            <div key={item.id} className="rounded-lg border">
                                <div className="flex items-center justify-between px-4 py-3 border-b gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium truncate">{item.fil.name}</p>
                                        <p className="text-xs text-muted-foreground font-mono">
                                            {item.overenskomst} · {item.gyldigFra}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {item.status === "afventer" && (
                                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                                                onClick={() => analyserItem(item.id)}>
                                                Analysér →
                                            </Button>
                                        )}
                                        {item.status === "analyserer" && (
                                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <Loader2 className="h-3 w-3 animate-spin" />Analyserer...
                                            </span>
                                        )}
                                        {item.status === "klar" && (
                                            <Button size="sm" className="h-7 text-xs gap-1"
                                                onClick={() => setAktivItem(aktivItem === item.id ? null : item.id)}>
                                                {aktivItem === item.id ? "Skjul" : `Bekræft (${item.sektioner.filter(s => s.godkendt).length})`}
                                            </Button>
                                        )}
                                        {item.status === "indekserer" && (
                                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <Loader2 className="h-3 w-3 animate-spin" />Indekserer...
                                            </span>
                                        )}
                                        {item.status === "done" && (
                                            <Badge variant="default" className="text-[10px]">
                                                ✓ {item.resultat?.total} chunks
                                            </Badge>
                                        )}
                                        {item.status === "fejl" && (
                                            <Badge variant="destructive" className="text-[10px]">Fejl</Badge>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"
                                            onClick={() => { setKø(prev => prev.filter(i => i.id !== item.id)); if (aktivItem === item.id) setAktivItem(null) }}>
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>

                                {aktivItem === item.id && item.sektioner.length > 0 && (
                                    <div className="p-4 space-y-3">
                                        <p className="text-xs text-muted-foreground">
                                            AI fandt {item.sektioner.length} sektioner — {item.sektioner.filter(s => s.godkendt).length} godkendt
                                        </p>
                                        <div className="space-y-2">
                                            {item.sektioner.map((s, i) => (
                                                <div key={i} className={`rounded border p-3 space-y-2 ${!s.godkendt ? "opacity-50" : ""}`}>
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <Badge variant={s.tillid === "høj" ? "default" : "outline"} className="text-[10px] font-normal px-1.5">
                                                                {s.tillid === "høj" ? "✓" : "?"} {s.tillid === "høj" ? "Høj" : "Lav"} tillid
                                                            </Badge>
                                                            <span className="text-xs font-medium">{s.titel}</span>
                                                            {s.sats && <span className="text-xs text-muted-foreground">({s.sats})</span>}
                                                        </div>
                                                        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0"
                                                            onClick={() => opdaterSektion(item.id, i, { godkendt: !s.godkendt })}>
                                                            <X className="h-2.5 w-2.5" />
                                                        </Button>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground line-clamp-2">{s.tekst}</p>
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-xs shrink-0">Kategori:</Label>
                                                        <Input
                                                            list="ok-kategorier-list"
                                                            className="h-6 text-xs flex-1"
                                                            value={s.kategori}
                                                            onChange={e => opdaterSektion(item.id, i, { kategori: e.target.value })}
                                                        />
                                                        <datalist id="ok-kategorier-list">
                                                            {kategorier.map(k => <option key={k} value={k} />)}
                                                        </datalist>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <Button className="w-full gap-1.5" onClick={() => indekserItem(item.id)}
                                            disabled={item.sektioner.filter(s => s.godkendt).length === 0}>
                                            Indeksér {item.sektioner.filter(s => s.godkendt).length} sektioner
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {klarTilIndeksering.length > 1 && (
                        <Button variant="outline" className="w-full gap-1.5"
                            onClick={() => klarTilIndeksering.forEach(i => indekserItem(i.id))}>
                            Indeksér alle klare ({klarTilIndeksering.length})
                        </Button>
                    )}
                </div>
            )}

            {/* Ældre indekserede versioner der ikke er koblet til et registerkort */}
            {unlinkedKeys.length > 0 && (
                <div className="space-y-3">
                    <Separator />
                    <div>
                        <p className="text-sm font-medium">Ældre indekserede versioner</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Disse versioner er ikke koblet til et registerkort. Upload ny version via det relevante registerkort for at opdatere.</p>
                    </div>
                    <div className="space-y-2">
                        {unlinkedKeys.map(ok => (
                            <div key={ok} className="rounded-lg border">
                                <div className="px-4 py-2.5 border-b bg-muted/30">
                                    <p className="text-sm font-medium font-mono">{ok}</p>
                                </div>
                                <div className="divide-y">
                                    {versioner[ok].map(ver => (
                                        <OverenskomstVersionRække
                                            key={ver.gyldig_fra}
                                            ok={ok}
                                            ver={ver}
                                            onToggleArkiv={() => toggleArkiv(ok, ver.gyldig_fra, !ver.aktiv)}
                                            onSlet={() => sletVersion(ok, ver.gyldig_fra)}
                                            onErstat={() => erstatVersion(ok)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Arkiverede overenskomster bruges automatisk ved analyse af ældre kontrakter baseret på kontraktdatoen.
                    </p>
                </div>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// Satser-fane
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Fane — Prompter (læse-visning)
// ─────────────────────────────────────────────────────────────

function PrompterTab() {
    const [search, setSearch] = useState("")
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    const q = search.trim().toLowerCase()
    const filtered = PROMPT_REGISTRY.filter(e =>
        !q || e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.group.toLowerCase().includes(q)
    )

    const copy = async (entry: (typeof PROMPT_REGISTRY)[0]) => {
        await navigator.clipboard.writeText(entry.prompt)
        setCopiedId(entry.id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <Input
                    placeholder="Søg i prompter..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-8 text-sm max-w-sm"
                />
                <span className="text-xs text-muted-foreground shrink-0">{filtered.length} prompter</span>
            </div>

            {PROMPT_GROUPS.map(group => {
                const entries = filtered.filter(e => e.group === group)
                if (!entries.length) return null
                return (
                    <div key={group} className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group}</p>
                        {entries.map(entry => {
                            const isExpanded = expandedId === entry.id
                            return (
                                <div key={entry.id} className="rounded-lg border overflow-hidden">
                                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                <span className="text-sm font-medium">{entry.title}</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-0.5 ml-5">{entry.description}</p>
                                            <p className="text-[10px] text-muted-foreground/50 mt-0.5 ml-5 font-mono">{entry.file}</p>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs gap-1.5"
                                                onClick={() => copy(entry)}
                                            >
                                                {copiedId === entry.id
                                                    ? <><Check className="h-3 w-3 text-emerald-500" />Kopieret</>
                                                    : <><Copy className="h-3 w-3" />Kopiér</>
                                                }
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                                            >
                                                {isExpanded ? "Skjul" : "Vis"}
                                            </Button>
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div className="border-t bg-muted/30 px-4 py-3">
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/80 max-h-96 overflow-y-auto">{entry.prompt}</pre>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )
            })}

            {filtered.length === 0 && (
                <div className="rounded-lg border border-dashed px-4 py-10 text-center">
                    <p className="text-sm text-muted-foreground">Ingen prompter matcher søgningen.</p>
                </div>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// Hovedside
// ─────────────────────────────────────────────────────────────

export default function AiKontrolrumPage() {
    return (
        <div className="min-w-0 max-w-7xl space-y-4 sm:space-y-6">
            <PageHeader
                title="AI Videns-kontrolrum"
                subtitle="Videnbase, noteringer, lærte mønstre og kvalitetsmonitor"
            />
            <Tabs defaultValue="forbrug" className="min-w-0">
                <div className="-mx-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
                <TabsList className="h-9 w-max flex-nowrap justify-start gap-1 md:h-auto md:flex-wrap">
                    <TabsTrigger value="forbrug" className="gap-1.5 text-xs whitespace-nowrap">
                        <TrendingUp className="h-3.5 w-3.5 shrink-0" />Forbrug & modeller
                    </TabsTrigger>
                    <TabsTrigger value="overenskomster" className="gap-1.5 text-xs whitespace-nowrap">
                        <ScrollText className="h-3.5 w-3.5 shrink-0" />Overenskomster
                    </TabsTrigger>
                    <TabsTrigger value="videnbase" className="gap-1.5 text-xs whitespace-nowrap">
                        <BookOpen className="h-3.5 w-3.5 shrink-0" />Videnbase
                    </TabsTrigger>
                    <TabsTrigger value="noteringer" className="gap-1.5 text-xs whitespace-nowrap">
                        <ListChecks className="h-3.5 w-3.5 shrink-0" />Noteringer
                    </TabsTrigger>
                    <TabsTrigger value="moenstre" className="gap-1.5 text-xs whitespace-nowrap">
                        <Brain className="h-3.5 w-3.5 shrink-0" />Mønstre
                    </TabsTrigger>
                    <TabsTrigger value="kvalitet" className="gap-1.5 text-xs whitespace-nowrap">
                        <FlaskConical className="h-3.5 w-3.5 shrink-0" />Kvalitet
                    </TabsTrigger>
                    <TabsTrigger value="prompter" className="gap-1.5 text-xs whitespace-nowrap">
                        <Terminal className="h-3.5 w-3.5 shrink-0" />Prompter
                    </TabsTrigger>
                </TabsList>
                </div>
                <TabsContent value="forbrug" className="mt-4"><AiUsageModelsTab /></TabsContent>
                <TabsContent value="overenskomster" className="mt-4"><OverenskomsterTab /></TabsContent>
                <TabsContent value="videnbase" className="mt-4"><VidenbaseTab /></TabsContent>
                <TabsContent value="noteringer" className="mt-4"><NoteringerTab /></TabsContent>
                <TabsContent value="moenstre" className="mt-4"><LaerteMoenstreTab /></TabsContent>
                <TabsContent value="kvalitet" className="mt-4"><KvalitetTab /></TabsContent>
                <TabsContent value="prompter" className="mt-4"><PrompterTab /></TabsContent>
            </Tabs>
        </div>
    )
}
