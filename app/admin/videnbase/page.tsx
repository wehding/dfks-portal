"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Pencil, Plus, X, Loader2, BookOpen } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"

type Chunk = {
    kilde_id: string
    kilde_titel: string
    tekst: string
    kilde_type: string
    metadata: {
        dfks_fortolkning?: string | null
        raa_tekst?: string | null
        roede_flag?: string[]
        standard_formulering?: string | null
    } | null
}

const KILDE_TYPE_LABELS: Record<string, string> = {
    lovtekst: "Lovtekst",
    sagserfaring: "Sagserfaring",
    "juridisk-note": "Juridisk note",
}

export default function VidenbasePage() {
    const [chunks, setChunks] = useState<Chunk[]>([])
    const [loading, setLoading] = useState(true)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editValue, setEditValue] = useState("")
    const [saving, setSaving] = useState(false)
    const [showAdd, setShowAdd] = useState(false)

    useEffect(() => {
        fetch("/api/videnbase")
            .then(r => r.json())
            .then(data => { setChunks(data ?? []); setLoading(false) })
            .catch(() => setLoading(false))
    }, [])

    const startEdit = (chunk: Chunk) => {
        setEditingId(chunk.kilde_id)
        setEditValue(chunk.metadata?.dfks_fortolkning ?? "")
    }

    const cancelEdit = () => {
        setEditingId(null)
        setEditValue("")
    }

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
                c.kilde_id === kilde_id
                    ? { ...c, metadata: { ...c.metadata, dfks_fortolkning: editValue || null } }
                    : c
            ))
            setEditingId(null)
            toast.success("Fortolkning gemt og genindekseret")
        } catch (e: any) {
            toast.error(e.message ?? "Gem fejlede")
        } finally {
            setSaving(false)
        }
    }

    const filled = chunks.filter(c => c.metadata?.dfks_fortolkning).length

    return (
        <div className="space-y-6 max-w-3xl">
            <PageHeader
                title="Videnbase"
                subtitle={`${chunks.length} chunks — ${filled} med DFKS-fortolkning`}
                actions={
                    <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        Tilføj chunk
                    </Button>
                }
            />

            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <div className="space-y-2">
                    {chunks.map(chunk => {
                        const fortolkning = chunk.metadata?.dfks_fortolkning
                        const isEditing = editingId === chunk.kilde_id
                        return (
                            <div
                                key={chunk.kilde_id}
                                className={`rounded-lg border p-4 space-y-2 transition-colors ${!fortolkning ? "border-dashed opacity-75" : ""}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-sm font-medium truncate">{chunk.kilde_titel}</p>
                                            <Badge variant="outline" className="text-[10px] font-normal shrink-0">
                                                {KILDE_TYPE_LABELS[chunk.kilde_type] ?? chunk.kilde_type}
                                            </Badge>
                                            {fortolkning && (
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{chunk.tekst}</p>
                                    </div>
                                    {!isEditing && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="shrink-0 gap-1.5 text-xs"
                                            onClick={() => startEdit(chunk)}
                                        >
                                            <Pencil className="h-3 w-3" />
                                            {fortolkning ? "Rediger" : "Tilføj"}
                                        </Button>
                                    )}
                                </div>

                                {!isEditing && fortolkning && (
                                    <p className="text-xs text-muted-foreground border-l-2 border-emerald-300 pl-3 italic">
                                        {fortolkning}
                                    </p>
                                )}

                                {!isEditing && !fortolkning && (
                                    <p className="text-xs text-muted-foreground/50 italic">
                                        Ingen DFKS-fortolkning — klik Tilføj
                                    </p>
                                )}

                                {isEditing && (
                                    <div className="space-y-2 pt-1">
                                        <Textarea
                                            value={editValue}
                                            onChange={e => setEditValue(e.target.value)}
                                            placeholder="Skriv DFKS's fortolkning og anbefaling for dette punkt..."
                                            className="text-xs min-h-[100px]"
                                            autoFocus
                                        />
                                        <div className="flex gap-2 justify-end">
                                            <Button variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
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
            )}

            <AddChunkDialog
                open={showAdd}
                onClose={() => setShowAdd(false)}
                onSaved={chunk => {
                    setChunks(prev => [...prev, chunk].sort((a, b) => a.kilde_id.localeCompare(b.kilde_id)))
                    setShowAdd(false)
                }}
            />
        </div>
    )
}

function AddChunkDialog({ open, onClose, onSaved }: {
    open: boolean
    onClose: () => void
    onSaved: (chunk: Chunk) => void
}) {
    const [form, setForm] = useState({ kilde_id: "", kilde_titel: "", tekst: "", dfks_fortolkning: "" })
    const [saving, setSaving] = useState(false)

    const save = async () => {
        if (!form.kilde_id || !form.kilde_titel || !form.tekst) return
        setSaving(true)
        try {
            const res = await fetch("/api/videnbase", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...form, kilde_type: "sagserfaring" }),
            })
            if (!res.ok) throw new Error((await res.json()).error)
            onSaved({
                kilde_id: form.kilde_id,
                kilde_titel: form.kilde_titel,
                tekst: form.tekst,
                kilde_type: "sagserfaring",
                metadata: { dfks_fortolkning: form.dfks_fortolkning || null },
            })
            setForm({ kilde_id: "", kilde_titel: "", tekst: "", dfks_fortolkning: "" })
            toast.success("Chunk tilføjet og indekseret")
        } catch (e: any) {
            toast.error(e.message ?? "Fejl")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        Tilføj chunk til videnbase
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label className="text-xs">ID (unikt)</Label>
                            <Input className="h-8 text-xs" placeholder="fx erfaring-001" value={form.kilde_id}
                                onChange={e => setForm(f => ({ ...f, kilde_id: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Titel</Label>
                            <Input className="h-8 text-xs" placeholder="fx Skadesløsholdelse" value={form.kilde_titel}
                                onChange={e => setForm(f => ({ ...f, kilde_titel: e.target.value }))} />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Semantisk beskrivelse <span className="text-muted-foreground">(bruges til embedding/søgning)</span></Label>
                        <Textarea className="text-xs min-h-[80px]" placeholder="Beskriv hvad dette chunk handler om — bruges til at matche mod kontrakter..."
                            value={form.tekst} onChange={e => setForm(f => ({ ...f, tekst: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">DFKS-fortolkning <span className="text-muted-foreground">(valgfri)</span></Label>
                        <Textarea className="text-xs min-h-[80px]" placeholder="DFKS's anbefaling og fortolkning..."
                            value={form.dfks_fortolkning} onChange={e => setForm(f => ({ ...f, dfks_fortolkning: e.target.value }))} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>Annuller</Button>
                    <Button onClick={save} disabled={saving || !form.kilde_id || !form.kilde_titel || !form.tekst}>
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : null}
                        Gem og indeksér
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
