"use client"

import { useEffect, useState, useMemo, useRef, useCallback } from "react"
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
    Info, TrendingUp, TrendingDown, Minus, FileUp, ScrollText, Coins, Wand2, RotateCcw,
    Users, RefreshCw, Upload, GitCompare, ChevronUp, ChevronDown, ChevronRight, UserPlus, UserMinus, Building2,
} from "lucide-react"
import { toast } from "sonner"
import NoteringGuide from "@/components/notering-guide"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    getProducerGroups,
    getGroupMembers,
    getGroupMemberCounts,
    getNonGroupEmployers,
    upsertEmployerInGroup,
    removeFromGroup,
    moveToGroup,
    renameGroup,
    deleteGroup,
    bulkImportToGroup,
    setAssocieret,
    setParentEmployer,
    getSubsidiaries,
    getActiveGroupCount,
    type DbEmployer,
    type DbEmployerWithGroup,
    type EmployerInput,
} from "@/lib/db/employers"

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
        } catch (e: any) { toast.error(e.message) }
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
        } catch (e: any) { toast.error(e.message) }
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
        } catch (e: any) { toast.error(e.message) }
        finally { setSaving(false) }
    }
    return (
        <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader><DialogTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4" />Tilføj chunk</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="grid grid-cols-2 gap-3">
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
        } catch (e: any) { toast.error(e.message) }
    }

    const addNote = async () => {
        try {
            const res = await fetch("/api/legal-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Ny notering", body: "", priority: "baggrund" }) })
            if (!res.ok) throw new Error((await res.json()).error)
            const created: LegalNote = await res.json()
            setNotes(prev => [created, ...prev])
            setEditingId(created.id)
        } catch (e: any) { toast.error(e.message) }
    }

    const deleteNote = async (id: string) => {
        try {
            const res = await fetch("/api/legal-notes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
            if (!res.ok) throw new Error((await res.json()).error)
            setNotes(prev => prev.filter(n => n.id !== id))
            if (editingId === id) setEditingId(null)
            toast.success("Notering slettet")
        } catch (e: any) { toast.error(e.message) }
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
        } catch (e: any) { toast.error(e.message) }
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
        } catch (e: any) { toast.error(e.message) }
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
                        AI'en genererer en struktureret notering baseret på din beskrivelse. Du kan altid redigere inden du gemmer.
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
                                                await apiPatch(note.id, { priority: next }).catch(e => toast.error(e.message))
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
                                            <div className="grid grid-cols-2 gap-3">
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
                        <p className="text-sm text-muted-foreground">Ingen noteringer. Brug editoren ovenfor eller klik "Tilføj notering".</p>
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
        setExpandedGroups(prev => { const s = new Set(prev); s.has(titel) ? s.delete(titel) : s.add(titel); return s })

    const updateLocal = (id: string, patch: Partial<LearnedPattern>) =>
        setPatterns(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))

    const savePattern = async (p: LearnedPattern) => {
        try {
            await fetch("/api/learned-patterns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, titel: p.titel, regel: p.regel, semantisk_beskrivelse: p.semantisk_beskrivelse }) })
            setEditingId(null)
            toast.success("Regel gemt")
        } catch (e: any) { toast.error(e.message) }
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
        } catch (e: any) { toast.error(e.message) }
        finally { setSavingApprove(false) }
    }

    const addNew = async () => {
        try {
            const res = await fetch("/api/learned-patterns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titel: "Ny regel", regel: "", semantisk_beskrivelse: "" }) })
            if (!res.ok) throw new Error((await res.json()).error)
            const created: LearnedPattern = await res.json()
            setPatterns(prev => [created, ...prev])
            setEditingId(created.id)
        } catch (e: any) { toast.error(e.message) }
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
                        <p className="text-sm text-muted-foreground">Ingen lærte regler endnu. Klik "Tilføj regel" eller godkend feedback ovenfor.</p>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
    const [indekseredeBilag, setIndekseredeBilag] = useState<{ type: string; antal: number; satser?: any }[]>([])

    useEffect(() => {
        fetch(`/api/admin/overenskomst/bilag?overenskomst=${ok}&gyldigFra=${ver.gyldig_fra}`)
            .then(r => r.json())
            .then(d => setIndekseredeBilag(d.bilag ?? []))
            .catch(() => {})
    }, [ok, ver.gyldig_fra])

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
                    filnavn: bilagFil.name,
                }),
            })
            if (!res.ok) throw new Error((await res.json()).error)
            const data = await res.json()
            toast.success(`${bilagFil.name}: ${data.indekseret} chunks indekseret`)
            setBilagFil(null); setBilagType("")
            // Refresh bilag-liste
            const refresh = await fetch(`/api/admin/overenskomst/bilag?overenskomst=${ok}&gyldigFra=${ver.gyldig_fra}`)
            const refreshData = await refresh.json()
            setIndekseredeBilag(refreshData.bilag ?? [])
        } catch (e: any) { toast.error(e.message) }
        finally { setIndekserer(false) }
    }

    return (
        <div className={!ver.aktiv ? "opacity-50" : ""}>
            <div className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-medium">Gyldig fra {ver.gyldig_fra}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {ver.antal} sektioner · {ver.kategorier.join(" · ")}
                    </p>
                    {(ver.bilag ?? []).length > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Bilag: {(ver.bilag ?? []).map(b => BILAG_TYPER.find(t => t.id === b)?.label ?? b).join(" · ")}
                        </p>
                    )}
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
                        <strong>{OVERENSKOMST_TYPER.find(t => t.id === ok)?.label ?? ok}</strong> (gyldig fra {ver.gyldig_fra}).
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

const OVERENSKOMST_TYPER = [
    { id: "de4", label: "De4 (fiktion)" },
    { id: "faf", label: "FAF (fiktion)" },
    { id: "faf-dokumentar", label: "FAF (dokumentar)" },
]

const KATEGORIER = [
    { id: "helligdagsbetaling", label: "Helligdagsbetaling" },
    { id: "beta-fond", label: "BETA-fond" },
    { id: "copydan-forbehold", label: "Copydan-forbehold" },
    { id: "streaming-forbehold", label: "Streaming-forbehold" },
    { id: "royalty", label: "Royalty" },
    { id: "pension", label: "Pension" },
    { id: "opsigelse", label: "Opsigelse" },
    { id: "andet", label: "Andet" },
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

    // Ny fil-tilføjelse state
    const [nyFil, setNyFil] = useState<File | null>(null)
    const [nyOverenskomst, setNyOverenskomst] = useState("")
    const [nyGyldigFra, setNyGyldigFra] = useState("")

    const refreshAktive = () => {
        fetch("/api/admin/overenskomst")
            .then(r => r.json())
            .then(d => setVersioner(d.versioner ?? {}))
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
        // Præ-udfyld upload-formularen med den aktuelle overenskomst-type
        setNyOverenskomst(overenskomst)
        setNyGyldigFra("")
        setNyFil(null)
        // Scroll til toppen
        window.scrollTo({ top: 0, behavior: "smooth" })
        toast("Upload ny version i formularen øverst")
    }

    const tilføjTilKø = () => {
        if (!nyFil || !nyOverenskomst || !nyGyldigFra) return
        setKø(prev => [...prev, {
            id: crypto.randomUUID(),
            fil: nyFil,
            overenskomst: nyOverenskomst,
            gyldigFra: nyGyldigFra,
            status: "afventer",
            sektioner: [],
        }])
        setNyFil(null)
        setNyOverenskomst("")
        setNyGyldigFra("")
        // Reset file input
        const input = document.getElementById("ok-fil-input") as HTMLInputElement
        if (input) input.value = ""
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
        } catch (e: any) {
            oppdaterKø(id, { status: "fejl", fejlbesked: e.message })
            toast.error(`${item.fil.name}: ${e.message}`)
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
        } catch (e: any) {
            oppdaterKø(id, { status: "fejl", fejlbesked: e.message })
            toast.error(e.message)
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

    const afventende = kø.filter(i => i.status === "afventer").length
    const klarTilIndeksering = kø.filter(i => i.status === "klar")

    return (
        <div className="space-y-6">
            {/* Sektion A — Tilføj til kø */}
            <div className="rounded-lg border p-4 space-y-4">
                <p className="text-sm font-medium">Tilføj overenskomst</p>
                <div className="space-y-3">
                    <div
                        className="rounded-lg border-2 border-dashed p-4 text-center cursor-pointer hover:border-muted-foreground/40 transition-colors"
                        onClick={() => document.getElementById("ok-fil-input")?.click()}
                    >
                        <input id="ok-fil-input" type="file" accept=".pdf" className="hidden"
                            onChange={e => setNyFil(e.target.files?.[0] ?? null)} />
                        {nyFil ? (
                            <p className="text-sm font-medium">{nyFil.name}</p>
                        ) : (
                            <>
                                <FileUp className="mx-auto h-5 w-5 text-muted-foreground/50 mb-1" />
                                <p className="text-xs text-muted-foreground">Klik for at vælge PDF</p>
                            </>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Overenskomst</Label>
                            <Select value={nyOverenskomst} onValueChange={setNyOverenskomst}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Vælg..." /></SelectTrigger>
                                <SelectContent>
                                    {OVERENSKOMST_TYPER.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Gyldig fra</Label>
                            <Input type="date" className="h-8 text-xs" value={nyGyldigFra} onChange={e => setNyGyldigFra(e.target.value)} />
                        </div>
                    </div>
                    <Button className="w-full gap-1.5" onClick={tilføjTilKø}
                        disabled={!nyFil || !nyOverenskomst || !nyGyldigFra}>
                        <Plus className="h-3.5 w-3.5" />Tilføj til kø
                    </Button>
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
                                {/* Header */}
                                <div className="flex items-center justify-between px-4 py-3 border-b gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium truncate">{item.fil.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {OVERENSKOMST_TYPER.find(t => t.id === item.overenskomst)?.label} · {item.gyldigFra}
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

                                {/* Bekræftelsespanel */}
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
                                                        <Select value={s.kategori} onValueChange={v => opdaterSektion(item.id, i, { kategori: v })}>
                                                            <SelectTrigger className="h-6 text-xs flex-1"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                {KATEGORIER.map(k => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}
                                                            </SelectContent>
                                                        </Select>
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

                    {/* Indeksér alle klare */}
                    {klarTilIndeksering.length > 1 && (
                        <Button variant="outline" className="w-full gap-1.5"
                            onClick={() => klarTilIndeksering.forEach(i => indekserItem(i.id))}>
                            Indeksér alle klare ({klarTilIndeksering.length})
                        </Button>
                    )}
                </div>
            )}

            {/* Sektion C — Indekserede overenskomster */}
            {Object.keys(versioner).length > 0 && (
                <div className="space-y-3">
                    <Separator />
                    <p className="text-sm font-medium">Indekserede overenskomster</p>
                    <div className="space-y-2">
                        {Object.entries(versioner).map(([ok, vers]) => (
                            <div key={ok} className="rounded-lg border">
                                <div className="px-4 py-2.5 border-b bg-muted/30">
                                    <p className="text-sm font-medium">{OVERENSKOMST_TYPER.find(t => t.id === ok)?.label ?? ok}</p>
                                </div>
                                <div className="divide-y">
                                    {vers.map(ver => (
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

type Sats = {
    id: string
    overenskomst: string
    kategori: string
    beskrivelse: string
    vaerdi: number
    enhed: string
    gyldig_fra: string
    gyldig_til: string | null
}

const OVERENSKOMST_LABELS: Record<string, string> = {
    "de4-fiktion": "De4 Fiktionsoverenskomst",
    "dokumentar": "FAF Dokumentaroverenskomst",
}

const ENHED_OPTIONS = ["kr/uge", "kr/dag", "kr/time", "%"]

function SatserTab() {
    const [valgtOverenskomst, setValgtOverenskomst] = useState("de4-fiktion")
    const [satser, setSatser] = useState<Sats[]>([])
    const [loading, setLoading] = useState(false)
    const [visNyDialog, setVisNyDialog] = useState(false)
    const [visRundeDialog, setVisRundeDialog] = useState(false)
    const [nyForm, setNyForm] = useState({ beskrivelse: "", kategori: "", vaerdi: "", enhed: "kr/uge", gyldig_fra: new Date().toISOString().slice(0, 10) })
    const [rundeGyldigFra, setRundeGyldigFra] = useState(new Date().toISOString().slice(0, 10))
    const [rundeSatser, setRundeSatser] = useState<Omit<Sats, "id" | "overenskomst" | "gyldig_til">[]>([])
    const [gemmer, setGemmer] = useState(false)

    async function hentSatser(ov: string) {
        setLoading(true)
        try {
            const res = await fetch(`/api/admin/satser?overenskomst=${ov}`)
            const data = await res.json()
            setSatser(Array.isArray(data) ? data : [])
        } catch {
            toast.error("Kunne ikke hente satser")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { hentSatser(valgtOverenskomst) }, [valgtOverenskomst])

    async function gemNySats() {
        setGemmer(true)
        try {
            const res = await fetch("/api/admin/satser", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ overenskomst: valgtOverenskomst, ...nyForm, vaerdi: parseFloat(nyForm.vaerdi) }),
            })
            if (!res.ok) throw new Error((await res.json()).error)
            toast.success("Sats tilføjet")
            setVisNyDialog(false)
            setNyForm({ beskrivelse: "", kategori: "", vaerdi: "", enhed: "kr/uge", gyldig_fra: new Date().toISOString().slice(0, 10) })
            hentSatser(valgtOverenskomst)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setGemmer(false)
        }
    }

    async function gemNyRunde() {
        setGemmer(true)
        try {
            const res = await fetch("/api/admin/satser", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ overenskomst: valgtOverenskomst, satser: rundeSatser, gyldig_fra: rundeGyldigFra }),
            })
            if (!res.ok) throw new Error((await res.json()).error)
            toast.success("Ny overenskomstrunde gemt")
            setVisRundeDialog(false)
            hentSatser(valgtOverenskomst)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setGemmer(false)
        }
    }

    function åbnRundeDialog() {
        // Forudfyld med aktuelle satser
        setRundeSatser(satser.map(s => ({ overenskomst: s.overenskomst, kategori: s.kategori, beskrivelse: s.beskrivelse, vaerdi: s.vaerdi, enhed: s.enhed, gyldig_fra: rundeGyldigFra })))
        setVisRundeDialog(true)
    }

    function formatSats(vaerdi: number, enhed: string) {
        if (enhed === "%") return `${vaerdi.toLocaleString("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} %`
        return `${vaerdi.toLocaleString("da-DK")} ${enhed}`
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <Select value={valgtOverenskomst} onValueChange={setValgtOverenskomst}>
                    <SelectTrigger className="w-64 h-8 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Object.entries(OVERENSKOMST_LABELS).map(([id, label]) => (
                            <SelectItem key={id} value={id}>{label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={åbnRundeDialog}>
                        <Plus className="h-3.5 w-3.5 mr-1" />Ny overenskomstrunde
                    </Button>
                    <Button size="sm" className="text-xs h-7" onClick={() => setVisNyDialog(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1" />Tilføj sats
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />Henter satser...
                </div>
            ) : satser.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4">Ingen satser fundet. Kør SQL-migration og seed i Supabase.</p>
            ) : (
                <div className="rounded-md border">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b bg-muted/40">
                                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Beskrivelse</th>
                                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Sats</th>
                                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Gyldig fra</th>
                            </tr>
                        </thead>
                        <tbody>
                            {satser.map(s => (
                                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/20">
                                    <td className="px-3 py-2">
                                        <span className="font-medium">{s.beskrivelse}</span>
                                        <span className="ml-2 text-muted-foreground">({s.kategori})</span>
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                                        {formatSats(s.vaerdi, s.enhed)}
                                    </td>
                                    <td className="px-3 py-2 text-right text-muted-foreground">
                                        {new Date(s.gyldig_fra).toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "numeric" })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Ny sats dialog */}
            <Dialog open={visNyDialog} onOpenChange={setVisNyDialog}>
                <DialogContent>
                    <DialogHeader><DialogTitle className="text-sm">Tilføj ny sats</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                        <div><Label className="text-xs">Beskrivelse</Label>
                            <Input className="h-8 text-xs mt-1" value={nyForm.beskrivelse} onChange={e => setNyForm(f => ({ ...f, beskrivelse: e.target.value }))} /></div>
                        <div><Label className="text-xs">Kategori (internt ID)</Label>
                            <Input className="h-8 text-xs mt-1" placeholder="fx normallon, pension, royalty" value={nyForm.kategori} onChange={e => setNyForm(f => ({ ...f, kategori: e.target.value }))} /></div>
                        <div className="flex gap-2">
                            <div className="flex-1"><Label className="text-xs">Værdi</Label>
                                <Input className="h-8 text-xs mt-1" type="number" value={nyForm.vaerdi} onChange={e => setNyForm(f => ({ ...f, vaerdi: e.target.value }))} /></div>
                            <div><Label className="text-xs">Enhed</Label>
                                <Select value={nyForm.enhed} onValueChange={v => setNyForm(f => ({ ...f, enhed: v }))}>
                                    <SelectTrigger className="h-8 text-xs mt-1 w-28"><SelectValue /></SelectTrigger>
                                    <SelectContent>{ENHED_OPTIONS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                                </Select></div>
                        </div>
                        <div><Label className="text-xs">Gyldig fra</Label>
                            <Input className="h-8 text-xs mt-1" type="date" value={nyForm.gyldig_fra} onChange={e => setNyForm(f => ({ ...f, gyldig_fra: e.target.value }))} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setVisNyDialog(false)}>Annuller</Button>
                        <Button size="sm" onClick={gemNySats} disabled={gemmer}>
                            {gemmer && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Gem
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Ny overenskomstrunde dialog */}
            <Dialog open={visRundeDialog} onOpenChange={setVisRundeDialog}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="text-sm">Ny overenskomstrunde — {OVERENSKOMST_LABELS[valgtOverenskomst]}</DialogTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                            Alle aktuelle satser lukkes (gyldig_til = i dag) og nye oprettes med nedenståede værdier.
                        </p>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div><Label className="text-xs">Ny gyldig_fra</Label>
                            <Input className="h-8 text-xs mt-1" type="date" value={rundeGyldigFra} onChange={e => setRundeGyldigFra(e.target.value)} /></div>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {rundeSatser.map((s, i) => (
                                <div key={i} className="flex gap-2 items-center">
                                    <span className="text-xs text-muted-foreground w-40 truncate">{s.beskrivelse}</span>
                                    <Input className="h-7 text-xs w-24" type="number" value={s.vaerdi}
                                        onChange={e => setRundeSatser(rs => rs.map((r, j) => j === i ? { ...r, vaerdi: parseFloat(e.target.value) } : r))} />
                                    <span className="text-xs text-muted-foreground">{s.enhed}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setVisRundeDialog(false)}>Annuller</Button>
                        <Button size="sm" onClick={gemNyRunde} disabled={gemmer}>
                            {gemmer && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Gem ny runde
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// Fane 7 — Producentlister (ProF-medlemmer)
// ─────────────────────────────────────────────────────────────

function ProducenterTab() {
    const [dbGroupNames, setDbGroupNames] = useState<string[]>([])
    const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})
    const [activeGroupName, setActiveGroupName] = useState<string | null>(null)
    const [dbMembers, setDbMembers] = useState<DbEmployerWithGroup[]>([])
    const [groupsLoading, setGroupsLoading] = useState(true)
    const [membersLoading, setMembersLoading] = useState(false)
    const [editingGroupOldName, setEditingGroupOldName] = useState<string | null>(null)
    const [editingGroupNewName, setEditingGroupNewName] = useState("")
    const [pendingNewGroup, setPendingNewGroup] = useState<string | null>(null)
    const [addCompanyName, setAddCompanyName] = useState("")
    const [memberSearch, setMemberSearch] = useState("")
    const [memberSortAsc, setMemberSortAsc] = useState<boolean | null>(null)
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
    const [subsidiariesMap, setSubsidiariesMap] = useState<Record<string, DbEmployer[]>>({})
    const [nonMembers, setNonMembers] = useState<{ id: string; name: string }[]>([])
    const [nonMembersLoading, setNonMembersLoading] = useState(false)
    const [nonMembersLoaded, setNonMembersLoaded] = useState(false)
    const uploadRef = useRef<HTMLInputElement>(null)

    type DiffNy      = { name: string; data: EmployerInput; approved: boolean }
    type DiffUdgaaet = { name: string; id: string; inOtherGroups: number; approved: boolean }
    type DiffAendret = { name: string; id: string; data: Partial<EmployerInput>; current: Partial<EmployerInput>; approved: boolean }
    const [diffResult, setDiffResult] = useState<{
        ny: DiffNy[]; udgaaet: DiffUdgaaet[]; aendret: DiffAendret[]
    } | null>(null)
    const [diffLoading, setDiffLoading] = useState(false)
    const [applyingDiff, setApplyingDiff] = useState(false)

    const loadGroups = useCallback(async () => {
        setGroupsLoading(true)
        const names = await getProducerGroups()
        setDbGroupNames(names)
        const counts = await getGroupMemberCounts()
        setMemberCounts(counts)
        if (names.length > 0 && !activeGroupName) setActiveGroupName(names[0])
        setGroupsLoading(false)
    }, [activeGroupName])

    const loadMembers = useCallback(async (groupName: string) => {
        setMembersLoading(true)
        const members = await getGroupMembers(groupName)
        setDbMembers(members)
        // Forudhent underselskaber for alle selskaber med parent_id-reference i gruppen
        const parentIds = [...new Set(members.map(m => m.id))]
        const subsResults = await Promise.all(parentIds.map(id => getSubsidiaries(id)))
        const newMap: Record<string, DbEmployer[]> = {}
        parentIds.forEach((id, i) => { if (subsResults[i].length > 0) newMap[id] = subsResults[i] })
        setSubsidiariesMap(newMap)
        // Åbn automatisk dem der har underselskaber
        setExpandedIds(new Set(Object.keys(newMap)))
        setMembersLoading(false)
    }, [])

    useEffect(() => { loadGroups() }, [])
    useEffect(() => { if (activeGroupName) loadMembers(activeGroupName) }, [activeGroupName])

    const switchGroup = (name: string) => { setActiveGroupName(name); setMemberSearch("") }

    const handleCreateGroup = () => {
        setPendingNewGroup("")
        setEditingGroupNewName("")
    }

    const commitNewGroup = async () => {
        const name = editingGroupNewName.trim()
        if (!name) { setPendingNewGroup(null); return }
        const next = [...dbGroupNames, name]
        setDbGroupNames(next)
        setActiveGroupName(name)
        setPendingNewGroup(null)
        setEditingGroupOldName(null)
        toast.success(`Liste "${name}" oprettet`)
    }

    const commitRename = async () => {
        const oldName = editingGroupOldName
        const newName = editingGroupNewName.trim()
        if (!oldName || !newName || newName === oldName) { setEditingGroupOldName(null); return }
        await renameGroup(oldName, newName)
        setDbGroupNames(prev => prev.map(n => n === oldName ? newName : n))
        if (activeGroupName === oldName) setActiveGroupName(newName)
        setEditingGroupOldName(null)
        toast.success("Liste omdøbt")
    }

    const handleDeleteGroup = async (name: string) => {
        if (!confirm(`Slet listen "${name}" og fjern alle selskaber fra den?`)) return
        await deleteGroup(name)
        const next = dbGroupNames.filter(n => n !== name)
        setDbGroupNames(next)
        if (activeGroupName === name) setActiveGroupName(next[0] ?? null)
        toast.success("Liste slettet")
    }

    const handleAddCompany = async () => {
        const name = addCompanyName.trim()
        if (!name || !activeGroupName) return
        if (dbMembers.some(m => m.name.toLowerCase() === name.toLowerCase())) {
            toast.error("Selskabet er allerede på listen"); return
        }
        await upsertEmployerInGroup({ name }, activeGroupName)
        setAddCompanyName("")
        await loadMembers(activeGroupName)
        setMemberCounts(prev => ({ ...prev, [activeGroupName]: (prev[activeGroupName] ?? 0) + 1 }))
    }

    const handleMoveCompany = async (employerId: string, fromGroup: string, toGroup: string) => {
        await moveToGroup(employerId, fromGroup, toGroup)
        await loadMembers(fromGroup)
        setMemberCounts(prev => ({
            ...prev,
            [fromGroup]: Math.max(0, (prev[fromGroup] ?? 1) - 1),
            [toGroup]: (prev[toGroup] ?? 0) + 1,
        }))
        toast.success("Selskab flyttet")
    }

    const handleRemoveCompany = async (employerId: string, groupName: string, companyName: string) => {
        if (!confirm(`Fjern "${companyName}" fra listen?`)) return
        await removeFromGroup(employerId, groupName)
        await loadMembers(groupName)
        setMemberCounts(prev => ({ ...prev, [groupName]: Math.max(0, (prev[groupName] ?? 1) - 1) }))
        toast.success("Selskab fjernet")
    }

    const parseExcel = async (file: File): Promise<EmployerInput[]> => {
        const XLSX = await import("xlsx")
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: "array" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" })
        const NAME_HDRS    = ["selskab", "producent", "name", "navn", "firma", "company", "virksomhed"]
        const CONTACT_HDRS = ["kontaktperson", "contact name", "kontakt", "contact", "ejere", "ceo", "direktor"]
        const WEB_HDRS     = ["hjemmeside", "website", "url", "web"]
        const PHONE_HDRS   = ["telefon", "phone", "tlf", "mobil"]
        const EMAIL_HDRS   = ["email", "e-mail", "mail"]
        const keys = Object.keys(rows[0] ?? {})
        const nameKey    = keys.find(k => NAME_HDRS.some(h => k.toLowerCase().includes(h)))
        const contactKey = keys.find(k => CONTACT_HDRS.some(h => k.toLowerCase().includes(h)))
        const webKey     = keys.find(k => WEB_HDRS.some(h => k.toLowerCase().includes(h)))
        const phoneKey   = keys.find(k => PHONE_HDRS.some(h => k.toLowerCase().includes(h)))
        const emailKey   = keys.find(k => EMAIL_HDRS.some(h => k.toLowerCase().includes(h)))
        if (!nameKey) throw new Error("Ingen kolonneoverskrift fundet (Selskab/Producent/Name)")
        return rows.map((r: Record<string, unknown>) => ({
            name:          String(r[nameKey] ?? "").trim(),
            contact_name:  contactKey ? String(r[contactKey] ?? "").trim() || null : undefined,
            contact_phone: phoneKey   ? String(r[phoneKey]   ?? "").trim() || null : undefined,
            contact_email: emailKey   ? String(r[emailKey]   ?? "").trim() || null : undefined,
            website:       webKey     ? String(r[webKey]     ?? "").trim() || null : undefined,
        })).filter(r => r.name)
    }

    const normStr = (s: string) => s.toLowerCase()
        .replace(/[‘’ʼ´`]/g, "'").replace(/[–—]/g, "-")
        .replace(/[.,\s]+/g, " ").trim()

    const handleUploadForDiff = async (file: File) => {
        if (!activeGroupName) return
        setDiffLoading(true)
        setDiffResult(null)
        try {
            const fileRows = await parseExcel(file)
            if (fileRows.length === 0) { toast.error("Ingen selskaber i filen"); return }
            const current = await getGroupMembers(activeGroupName)
            setDbMembers(current)
            if (current.length === 0) {
                const result = await bulkImportToGroup(fileRows, activeGroupName)
                await loadMembers(activeGroupName)
                setMemberCounts(prev => ({ ...prev, [activeGroupName!]: result.inserted }))
                toast.success(`${result.inserted} selskaber importeret`)
                return
            }
            const fileMap = new Map(fileRows.map(r => [normStr(r.name), r]))
            const dbMap   = new Map(current.map(m => [normStr(m.name), m]))
            const ny: DiffNy[] = []
            const udgaaet: DiffUdgaaet[] = []
            const aendret: DiffAendret[] = []
            for (const [n, data] of fileMap) {
                if (!dbMap.has(n)) ny.push({ name: data.name, data, approved: true })
            }
            for (const [n, m] of dbMap) {
                if (!fileMap.has(n)) {
                    const total = await getActiveGroupCount(m.id)
                    udgaaet.push({ name: m.name, id: m.id, inOtherGroups: Math.max(0, total - 1), approved: true })
                }
            }
            for (const [n, data] of fileMap) {
                const m = dbMap.get(n)
                if (!m) continue
                const changes: Partial<EmployerInput> = {}
                const prev: Partial<EmployerInput> = {}
                if (data.contact_name  !== undefined && data.contact_name  !== m.contact_name)  { changes.contact_name  = data.contact_name;  prev.contact_name  = m.contact_name }
                if (data.contact_phone !== undefined && data.contact_phone !== m.contact_phone) { changes.contact_phone = data.contact_phone; prev.contact_phone = m.contact_phone }
                if (data.contact_email !== undefined && data.contact_email !== m.contact_email) { changes.contact_email = data.contact_email; prev.contact_email = m.contact_email }
                if (data.website       !== undefined && data.website       !== m.website)       { changes.website       = data.website;       prev.website       = m.website }
                if (Object.keys(changes).length > 0) aendret.push({ name: m.name, id: m.id, data: changes, current: prev, approved: true })
            }
            setDiffResult({ ny, udgaaet, aendret })
            if (ny.length === 0 && udgaaet.length === 0 && aendret.length === 0) toast.success("Listen er identisk med filen")
        } catch (e: any) {
            toast.error(e.message ?? "Fejl ved læsning af fil")
        } finally {
            setDiffLoading(false)
        }
    }

    const applyDiff = async () => {
        if (!diffResult || !activeGroupName) return
        setApplyingDiff(true)
        try {
            let inserted = 0, removed = 0, updated = 0
            for (const item of diffResult.ny.filter(i => i.approved)) {
                await upsertEmployerInGroup(item.data, activeGroupName); inserted++
            }
            for (const item of diffResult.udgaaet.filter(i => i.approved)) {
                await removeFromGroup(item.id, activeGroupName); removed++
            }
            const supabase = createClient()
            for (const item of diffResult.aendret.filter(i => i.approved)) {
                await supabase.from("employers").update(item.data).eq("id", item.id); updated++
            }
            await loadMembers(activeGroupName)
            setMemberCounts(prev => ({ ...prev, [activeGroupName!]: (prev[activeGroupName!] ?? 0) + inserted - removed }))
            // Genindlæs ikke-medlemmer automatisk hvis der er fjernet nogen
            if (removed > 0 || inserted > 0) await loadNonMembers()
            setDiffResult(null)
            const parts = [inserted && `${inserted} tilføjet`, removed && `${removed} fjernet`, updated && `${updated} opdateret`].filter(Boolean)
            toast.success(parts.join(", ") || "Ingen ændringer")
        } catch (e: any) {
            toast.error(e.message ?? "Fejl ved anvendelse")
        } finally {
            setApplyingDiff(false)
        }
    }


    const loadNonMembers = async () => {
        setNonMembersLoading(true)
        const result = await getNonGroupEmployers()
        setNonMembers(result)
        setNonMembersLoaded(true)
        setNonMembersLoading(false)
    }

    const addNonMemberToGroup = async (employerId: string, name: string, groupName: string) => {
        await upsertEmployerInGroup({ name }, groupName)
        setNonMembers(prev => prev.filter(e => e.id !== employerId))
        setMemberCounts(prev => ({ ...prev, [groupName]: (prev[groupName] ?? 0) + 1 }))
        if (activeGroupName === groupName) await loadMembers(groupName)
        toast.success(`"${name}" tilføjet til ${groupName}`)
    }

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-muted-foreground">
                        Kun ProF-medlemmer er juridisk bundet af overenskomsten. AI-screeningen bruger listerne til at identificere om producenten er overenskomstdækket.
                    </p>
                </div>
                <Button size="sm" variant="outline" onClick={handleCreateGroup}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />Tilføj liste
                </Button>
            </div>

            {groupsLoading ? (
                <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
                    <RefreshCw className="h-4 w-4 animate-spin" />Henter lister…
                </div>
            ) : dbGroupNames.length === 0 && !pendingNewGroup ? (
                <div className="rounded-lg border-2 border-dashed flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                    <Users className="h-8 w-8 opacity-30" />
                    <p className="text-sm">Ingen lister endnu</p>
                    <Button size="sm" variant="outline" onClick={handleCreateGroup}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" />Opret første liste
                    </Button>
                </div>
            ) : (
                <div className="rounded-lg border overflow-hidden">
                    <div className="flex items-center border-b bg-muted/30 px-2 pt-2 gap-0.5 flex-wrap">
                        {dbGroupNames.map(name => (
                            <div
                                key={name}
                                className={`group flex items-center gap-1 px-3 py-2 rounded-t-md cursor-pointer text-sm border-b-2 transition-colors ${name === activeGroupName ? "border-foreground bg-background font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                                onClick={() => { if (editingGroupOldName !== name) switchGroup(name) }}
                            >
                                {editingGroupOldName === name ? (
                                    <input autoFocus className="w-32 text-sm bg-transparent border-b border-foreground outline-none"
                                        value={editingGroupNewName} onChange={e => setEditingGroupNewName(e.target.value)}
                                        onBlur={commitRename} onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingGroupOldName(null) }}
                                        onClick={e => e.stopPropagation()} />
                                ) : (
                                    <>
                                        <span onDoubleClick={e => { e.stopPropagation(); setEditingGroupOldName(name); setEditingGroupNewName(name) }} title="Dobbeltklik for at omdøbe">{name}</span>
                                        {(memberCounts[name] ?? 0) > 0 && <span className="text-[10px] text-muted-foreground ml-0.5">({memberCounts[name]})</span>}
                                        <button className="opacity-0 group-hover:opacity-60 hover:!opacity-100 ml-1 text-muted-foreground hover:text-destructive transition-opacity"
                                            onClick={e => { e.stopPropagation(); handleDeleteGroup(name) }} title="Slet liste">
                                            <X className="h-3 w-3" />
                                        </button>
                                    </>
                                )}
                            </div>
                        ))}
                        {pendingNewGroup !== null && (
                            <div className="flex items-center gap-1 px-2 py-1.5">
                                <input autoFocus className="w-32 text-sm bg-transparent border-b border-foreground outline-none"
                                    value={editingGroupNewName} onChange={e => setEditingGroupNewName(e.target.value)}
                                    onBlur={commitNewGroup} onKeyDown={e => { if (e.key === "Enter") commitNewGroup(); if (e.key === "Escape") { setPendingNewGroup(null); setEditingGroupOldName(null) } }}
                                    placeholder="Listenavn…" />
                            </div>
                        )}
                    </div>

                    {activeGroupName && (
                        <div className="p-4 flex items-center gap-3">
                            <div className="relative flex-1">
                                <input type="text" value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
                                    placeholder="Søg i listen…"
                                    className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                                {memberSearch && <button onClick={() => setMemberSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
                            </div>
                            <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground cursor-pointer hover:border-muted-foreground/50 transition-colors whitespace-nowrap"
                                onClick={() => uploadRef.current?.click()}>
                                <input ref={uploadRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { if (e.target.files?.[0]) { handleUploadForDiff(e.target.files[0]); e.target.value = "" } }} />
                                {diffLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                {diffLoading ? "Analyserer..." : "Importer / Opdater"}
                            </div>
                        </div>
                    )}

                    {/* Diff-visning */}
                    {diffResult && (diffResult.ny.length > 0 || diffResult.udgaaet.length > 0 || diffResult.aendret.length > 0) && (
                        <div className="mx-4 mb-4 rounded-lg border bg-muted/20 p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium">Gennemse ændringer inden du anvender</p>
                                <button onClick={() => setDiffResult(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                            </div>
                            {diffResult.ny.length > 0 && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><UserPlus className="h-3.5 w-3.5" />Nye ({diffResult.ny.length})</p>
                                        <button onClick={() => setDiffResult(p => p ? { ...p, ny: p.ny.map(i => ({ ...i, approved: true })) } : p)} className="text-xs underline text-muted-foreground">Vælg alle</button>
                                    </div>
                                    <div className="space-y-1">
                                        {diffResult.ny.map((item, idx) => (
                                            <label key={item.name} className="flex items-center gap-2 rounded bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 cursor-pointer">
                                                <input type="checkbox" checked={item.approved} onChange={e => setDiffResult(p => p ? { ...p, ny: p.ny.map((i, j) => j === idx ? { ...i, approved: e.target.checked } : i) } : p)} className="h-3.5 w-3.5" />
                                                <span className="text-xs flex-1">{item.name}</span>
                                                {item.data.contact_name && <span className="text-xs text-muted-foreground">{item.data.contact_name}</span>}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {diffResult.udgaaet.length > 0 && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-1"><UserMinus className="h-3.5 w-3.5" />Udgåede ({diffResult.udgaaet.length})</p>
                                        <button onClick={() => setDiffResult(p => p ? { ...p, udgaaet: p.udgaaet.map(i => ({ ...i, approved: true })) } : p)} className="text-xs underline text-muted-foreground">Vælg alle</button>
                                    </div>
                                    <div className="space-y-1">
                                        {diffResult.udgaaet.map((item, idx) => (
                                            <label key={item.name} className="flex items-center gap-2 rounded bg-red-50 dark:bg-red-950/30 px-3 py-1.5 cursor-pointer">
                                                <input type="checkbox" checked={item.approved} onChange={e => setDiffResult(p => p ? { ...p, udgaaet: p.udgaaet.map((i, j) => j === idx ? { ...i, approved: e.target.checked } : i) } : p)} className="h-3.5 w-3.5" />
                                                <span className="text-xs flex-1">{item.name}</span>
                                                {item.inOtherGroups > 0
                                                    ? <span className="text-xs text-amber-600">Stadig i {item.inOtherGroups} anden liste</span>
                                                    : <span className="text-xs text-muted-foreground">Flyttes til ikke-medlemmer</span>}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {diffResult.aendret.length > 0 && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5" />Ændrede felter ({diffResult.aendret.length})</p>
                                        <button onClick={() => setDiffResult(p => p ? { ...p, aendret: p.aendret.map(i => ({ ...i, approved: true })) } : p)} className="text-xs underline text-muted-foreground">Vælg alle</button>
                                    </div>
                                    <div className="space-y-1">
                                        {diffResult.aendret.map((item, idx) => (
                                            <label key={item.name} className="flex items-start gap-2 rounded bg-amber-50 dark:bg-amber-950/30 px-3 py-2 cursor-pointer">
                                                <input type="checkbox" checked={item.approved} onChange={e => setDiffResult(p => p ? { ...p, aendret: p.aendret.map((i, j) => j === idx ? { ...i, approved: e.target.checked } : i) } : p)} className="h-3.5 w-3.5 mt-0.5" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-medium">{item.name}</p>
                                                    {Object.entries(item.data).map(([k, v]) => (
                                                        <p key={k} className="text-[10px] text-muted-foreground">
                                                            {k}: <span className="line-through">{(item.current as Record<string,unknown>)[k] as string ?? "—"}</span> {"->"} <span className="text-foreground">{v as string ?? "—"}</span>
                                                        </p>
                                                    ))}
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="flex items-center justify-end gap-2 pt-1 border-t">
                                <Button variant="outline" size="sm" onClick={() => setDiffResult(null)}>Annuller</Button>
                                <Button size="sm" onClick={applyDiff} disabled={applyingDiff} className="gap-1.5">
                                    {applyingDiff && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                                    Anvend valgte ændringer
                                </Button>
                            </div>
                        </div>
                    )}


                    {activeGroupName && (
                        <div className="border-t overflow-x-auto">
                            {membersLoading ? (
                                <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm"><RefreshCw className="h-4 w-4 animate-spin" />Henter medlemmer…</div>
                            ) : (
                                <>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="text-xs cursor-pointer select-none" onClick={() => setMemberSortAsc(prev => prev === true ? false : true)}>
                                                    <span className="flex items-center gap-1">Selskab
                                                        {memberSortAsc === true && <ChevronUp className="h-3 w-3" />}
                                                        {memberSortAsc === false && <ChevronDown className="h-3 w-3" />}
                                                        {memberSortAsc === null && <ChevronUp className="h-3 w-3 opacity-30" />}
                                                    </span>
                                                </TableHead>
                                                <TableHead className="text-xs">Kontaktperson</TableHead>
                                                <TableHead className="text-xs w-14" title="Associerede medlemmer er ikke overenskomstbundet">Assoc.</TableHead>
                                                <TableHead className="text-xs w-28" />
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {(memberSortAsc === null ? dbMembers : [...dbMembers].sort((a, b) => memberSortAsc ? a.name.localeCompare(b.name, "da") : b.name.localeCompare(a.name, "da")))
                                                .filter(m => !memberSearch || m.name.toLowerCase().includes(memberSearch.toLowerCase()))
                                                .map(m => {
                                                    const otherGroups = dbGroupNames.filter(n => n !== activeGroupName)
                                                    return (
                                                        <>
                                                        <TableRow key={m.id}>
                                                            <TableCell className="text-xs font-medium">{m.name}</TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">{m.contact_name ?? "—"}</TableCell>
                                                            <TableCell className="text-xs w-20">
                                                                <input type="checkbox" checked={m.associeret ?? false}
                                                                    onChange={async e => {
                                                                        const ok = await setAssocieret(m.id, e.target.checked)
                                                                        if (ok) setDbMembers(prev => prev.map(x => x.id === m.id ? { ...x, associeret: e.target.checked } : x))
                                                                        else toast.error("Kunne ikke opdatere")
                                                                    }}
                                                                    className="h-3.5 w-3.5 cursor-pointer"
                                                                    title="Associeret medlem — ikke overenskomstbundet" />
                                                            </TableCell>
                                                            <TableCell className="text-xs">
                                                                <div className="flex items-center gap-1 justify-end">
                                                                    {otherGroups.length > 0 && (
                                                                        <Select onValueChange={toName => handleMoveCompany(m.id, activeGroupName, toName)}>
                                                                            <SelectTrigger className="h-6 text-xs w-[110px] px-2"><SelectValue placeholder="Flyt til…" /></SelectTrigger>
                                                                            <SelectContent>{otherGroups.map(gn => <SelectItem key={gn} value={gn} className="text-xs">{gn}</SelectItem>)}</SelectContent>
                                                                        </Select>
                                                                    )}
                                                                    <button onClick={() => handleRemoveCompany(m.id, activeGroupName, m.name)} className="text-muted-foreground hover:text-destructive transition-colors" title="Fjern fra liste"><X className="h-3.5 w-3.5" /></button>
                                                            <button
                                                                title="Vis/skjul underselskaber"
                                                                className="text-muted-foreground hover:text-foreground transition-colors"
                                                                onClick={async () => {
                                                                    const isOpen = expandedIds.has(m.id)
                                                                    if (!isOpen && !subsidiariesMap[m.id]) {
                                                                        const subs = await getSubsidiaries(m.id)
                                                                        setSubsidiariesMap(prev => ({ ...prev, [m.id]: subs }))
                                                                    }
                                                                    setExpandedIds(prev => {
                                                                        const next = new Set(prev)
                                                                        isOpen ? next.delete(m.id) : next.add(m.id)
                                                                        return next
                                                                    })
                                                                }}
                                                            >
                                                                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expandedIds.has(m.id) ? "rotate-90" : ""}`} />
                                                            </button>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                        {expandedIds.has(m.id) && (subsidiariesMap[m.id] ?? []).map(sub => (
                                                            <TableRow key={sub.id} className="bg-muted/30">
                                                                <TableCell className="text-xs pl-8 text-muted-foreground italic">↳ {sub.name}</TableCell>
                                                                <TableCell className="text-xs text-muted-foreground">{sub.contact_name ?? "—"}</TableCell>
                                                                <TableCell className="text-xs" />
                                                                <TableCell className="text-xs">
                                                                    <button onClick={async () => {
                                                                        await setParentEmployer(sub.id, null)
                                                                        setSubsidiariesMap(prev => ({ ...prev, [m.id]: (prev[m.id] ?? []).filter(s => s.id !== sub.id) }))
                                                                        await loadNonMembers()
                                                                        toast.success("Underselskab fjernet")
                                                                    }} className="text-muted-foreground hover:text-destructive" title="Fjern tilknytning"><X className="h-3 w-3" /></button>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                        </>
                                                    )
                                                })}
                                            {dbMembers.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-6">Ingen selskaber på listen endnu</TableCell></TableRow>}
                                        </TableBody>
                                    </Table>
                                    <div className="flex items-center gap-2 px-4 py-2 border-t bg-muted/30">
                                        <input type="text" value={addCompanyName} onChange={e => setAddCompanyName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddCompany()}
                                            placeholder="Tilføj nyt selskab manuelt…"
                                            className="flex-1 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                                        <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={handleAddCompany} disabled={!addCompanyName.trim()}>
                                            <Plus className="h-3 w-3 mr-1" />Tilføj
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className="rounded-lg border">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div>
                        <h3 className="text-sm font-medium">Selskaber uden producentforeningsmedlemskab</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Selskaber i databasen der ikke optræder i nogen producentliste.</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={loadNonMembers} disabled={nonMembersLoading}>
                        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${nonMembersLoading ? "animate-spin" : ""}`} />
                        {nonMembersLoaded ? "Opdatér" : "Vis ikke-medlemmer"}
                    </Button>
                </div>
                {nonMembersLoaded && (
                    nonMembers.length === 0 ? (
                        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />Alle selskaber er tilknyttet mindst én producentliste.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader><TableRow><TableHead className="w-[32px] text-xs">#</TableHead><TableHead className="text-xs">Selskab</TableHead><TableHead className="text-xs" /></TableRow></TableHeader>
                                <TableBody>
                                    {nonMembers.map((e, i) => (
                                        <TableRow key={e.id}>
                                            <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                                            <TableCell className="text-xs">{e.name}</TableCell>
                                            <TableCell className="text-xs">
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    {dbGroupNames.length > 0 && (
                                                        <Select onValueChange={gn => addNonMemberToGroup(e.id, e.name, gn)}>
                                                            <SelectTrigger className="h-6 text-xs w-[100px] px-2"><SelectValue placeholder="Tilføj til…" /></SelectTrigger>
                                                            <SelectContent>{dbGroupNames.map(gn => <SelectItem key={gn} value={gn} className="text-xs">{gn}</SelectItem>)}</SelectContent>
                                                        </Select>
                                                    )}
                                                    <Select onValueChange={async (parentId) => {
                                                        const ok = await setParentEmployer(e.id, parentId)
                                                        if (ok) {
                                                            setNonMembers(prev => prev.filter(x => x.id !== e.id))
                                                            await loadMembers(activeGroupName!)
                                                            toast.success(`"${e.name}" tilknyttet som underselskab`)
                                                        } else toast.error("Kunne ikke tilknytte underselskab")
                                                    }}>
                                                        <SelectTrigger className="h-6 text-xs w-[110px] px-2"><SelectValue placeholder="Underselskab af…" /></SelectTrigger>
                                                        <SelectContent>
                                                            {dbMembers.map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            <div className="px-4 py-2 text-xs text-muted-foreground border-t">{nonMembers.length} selskab{nonMembers.length !== 1 ? "er" : ""} uden producentforeningsmedlemskab</div>
                        </div>
                    )
                )}
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// Hovedside
// ─────────────────────────────────────────────────────────────

export default function AiKontrolrumPage() {
    return (
        <div className="space-y-6 max-w-3xl">
            <PageHeader
                title="AI Videns-kontrolrum"
                subtitle="Videnbase, noteringer, lærte mønstre og kvalitetsmonitor"
            />
            <Tabs defaultValue="overenskomster">
                <TabsList className="flex flex-wrap h-auto gap-1 justify-start">
                    <TabsTrigger value="overenskomster" className="gap-1.5 text-xs whitespace-nowrap">
                        <ScrollText className="h-3.5 w-3.5 shrink-0" />Overenskomster
                    </TabsTrigger>
                    <TabsTrigger value="satser" className="gap-1.5 text-xs whitespace-nowrap">
                        <Coins className="h-3.5 w-3.5 shrink-0" />Satser
                    </TabsTrigger>
                    <TabsTrigger value="producenter" className="gap-1.5 text-xs whitespace-nowrap">
                        <Building2 className="h-3.5 w-3.5 shrink-0" />Producenter
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
                </TabsList>
                <TabsContent value="overenskomster" className="mt-4"><OverenskomsterTab /></TabsContent>
                <TabsContent value="satser" className="mt-4"><SatserTab /></TabsContent>
                <TabsContent value="producenter" className="mt-4"><ProducenterTab /></TabsContent>
                <TabsContent value="videnbase" className="mt-4"><VidenbaseTab /></TabsContent>
                <TabsContent value="noteringer" className="mt-4"><NoteringerTab /></TabsContent>
                <TabsContent value="moenstre" className="mt-4"><LaerteMoenstreTab /></TabsContent>
                <TabsContent value="kvalitet" className="mt-4"><KvalitetTab /></TabsContent>
            </Tabs>
        </div>
    )
}
