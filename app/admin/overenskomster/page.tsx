"use client"

/**
 * app/admin/overenskomster/page.tsx
 *
 * Admin panel for managing collective agreements (overenskomster),
 * wage schedules, standard contracts, and the ProF member list.
 * Documents stored here are used as context for all AI contract screenings.
 */

import { useState, useRef, useCallback, useEffect } from "react"
import {
    Upload,
    Trash2,
    CheckCircle2,
    AlertCircle,
    FileText,
    Users,
    RefreshCw,
    Archive,
    ChevronDown,
    ChevronUp,
    Plus,
    BookOpen,
    Pencil,
    Download,
    Eye,
} from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
    setReferences,
    setMemberList,
    getReferences,
    getMemberList,
    getLegalNotes,
    setLegalNotes,
    getCaseLearnings,
    setCaseLearnings,
    extractTextFromFile,
    type ReferenceDoc,
    type MemberList,
    type LegalNote,
    type LegalNotePriority,
    type DocOwner,
    type CaseLearning,
    type CaseLearningKontrakttype,
} from "@/lib/ai"

// ── Types ────────────────────────────────────────────────────

type DocType = ReferenceDoc["type"]

const DOC_TYPE_OPTIONS: { group: string; values: DocType[] }[] = [
    {
        group: "Overenskomster",
        values: ["Fiktion-overenskomst", "Dokumentar-overenskomst"],
    },
    {
        group: "Lønskemaer",
        values: ["Lønskema (fiktion)", "Lønskema (dokumentar)"],
    },
    {
        group: "Standardkontrakter — fiktion",
        values: [
            "Standardkontrakt — fiktion (A-løn)",
            "Standardkontrakt — fiktion (leverandør)",
        ],
    },
    {
        group: "Standardkontrakter — dokumentar",
        values: [
            "Standardkontrakt — dokumentar (A-løn)",
            "Standardkontrakt — dokumentar (leverandør)",
        ],
    },
    { group: "Andet", values: ["Reference"] },
]

const TYPE_COLORS: Record<DocType, string> = {
    "Fiktion-overenskomst": "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800",
    "Dokumentar-overenskomst": "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
    "Lønskema (fiktion)": "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
    "Lønskema (dokumentar)": "bg-lime-50 text-lime-700 border-lime-200 dark:bg-lime-950 dark:text-lime-300 dark:border-lime-800",
    "Standardkontrakt — fiktion (A-løn)": "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800",
    "Standardkontrakt — fiktion (leverandør)": "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800",
    "Standardkontrakt — dokumentar (A-løn)": "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800",
    "Standardkontrakt — dokumentar (leverandør)": "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800",
    "Reference": "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800",
}

const PRIORITY_CONFIG: Record<LegalNotePriority, { label: string; color: string; dot: string }> = {
    "aktiv-indsats": {
        label: "Aktiv indsats",
        color: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800",
        dot: "bg-orange-500",
    },
    "fast-regel": {
        label: "Altid tjek",
        color: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800",
        dot: "bg-indigo-500",
    },
    "orientering": {
        label: "Orientering",
        color: "bg-muted text-muted-foreground border-border",
        dot: "bg-muted-foreground",
    },
}

const PRIORITY_ORDER: LegalNotePriority[] = ["aktiv-indsats", "fast-regel", "orientering"]

const KONTRAKTTYPE_CONFIG: Record<CaseLearningKontrakttype, { label: string; color: string }> = {
    "a-loen":      { label: "A-lønskontrakt", color: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800" },
    "leverandoer": { label: "Leverandørkontrakt", color: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800" },
    "alle":        { label: "Alle typer", color: "bg-muted text-muted-foreground border-border" },
}
const KONTRAKTTYPE_ORDER: CaseLearningKontrakttype[] = ["a-loen", "leverandoer", "alle"]

const OWNER_CONFIG: Record<DocOwner, { label: string; color: string }> = {
    "de4": {
        label: "De4 / DFKS",
        color: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800",
    },
    "anden-fagforening": {
        label: "Anden fagforening",
        color: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700",
    },
}

function guessDocType(filename: string): DocType {
    const fn = filename.toLowerCase()
    const isLoen = fn.includes("loen") || fn.includes("løn") || fn.includes("wage")
    const isStd = fn.includes("standard") || fn.includes("skabelon")
    const isDok = fn.includes("dok") || fn.includes("doc")
    const isFik = fn.includes("fik") || fn.includes("fic") || fn.includes("de4")
    const isLev = fn.includes("leverand") || fn.includes("freelance")

    if (isLoen && isDok) return "Lønskema (dokumentar)"
    if (isLoen) return "Lønskema (fiktion)"
    if (isStd && isDok && isLev) return "Standardkontrakt — dokumentar (leverandør)"
    if (isStd && isDok) return "Standardkontrakt — dokumentar (A-løn)"
    if (isStd && isLev) return "Standardkontrakt — fiktion (leverandør)"
    if (isStd) return "Standardkontrakt — fiktion (A-løn)"
    if (isDok) return "Dokumentar-overenskomst"
    if (isFik) return "Fiktion-overenskomst"
    return "Reference"
}

function parseMemberList(raw: string): string[] {
    return raw
        .split(/[\n,;]/)
        .map((s) => s.trim().replace(/^\d+[.)]\s*/, "").trim())
        .filter((s) => s.length > 2)
}

// ── Component ────────────────────────────────────────────────

export default function OverenskomsterPage() {
    const [docs, setDocs] = useState<ReferenceDoc[]>(() => getReferences())
    const [memberList, setMemberListState] = useState<MemberList>(() => getMemberList())
    const [archivedDocs, setArchivedDocs] = useState<ReferenceDoc[]>([])
    const [legalNotes, setLegalNotesState] = useState<LegalNote[]>(() => getLegalNotes())
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
    const [caseLearnings, setCaseLearningsState] = useState<CaseLearning[]>(() => getCaseLearnings())
    const [editingLearningId, setEditingLearningId] = useState<string | null>(null)

    const [uploading, setUploading] = useState(false)
    const [viewingDoc, setViewingDoc] = useState<ReferenceDoc | null>(null)
    const [viewHtml, setViewHtml] = useState<string | null>(null)

    useEffect(() => {
        if (!viewingDoc?.fileData) { setViewHtml(null); return }
        const isDocx = viewingDoc.name.toLowerCase().endsWith(".docx") ||
            viewingDoc.fileType?.includes("wordprocessingml")
        if (!isDocx) { setViewHtml(null); return }
        // Convert DOCX base64 → HTML via mammoth
        import("mammoth").then(({ default: mammoth }) => {
            const binary = atob(viewingDoc.fileData!)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            mammoth.convertToHtml({ arrayBuffer: bytes.buffer })
                .then(result => setViewHtml(result.value))
                .catch(() => setViewHtml(null))
        })
    }, [viewingDoc])
    const [memberText, setMemberText] = useState(memberList.raw)
    const [memberTab, setMemberTab] = useState<"paste" | "upload">("paste")
    const [memberUploading, setMemberUploading] = useState(false)
    const [showArchive, setShowArchive] = useState(false)

    const fileRef = useRef<HTMLInputElement>(null)
    const memberFileRef = useRef<HTMLInputElement>(null)

    // ── Document upload ──────────────────────────────────────

    const handleDocFiles = useCallback(async (files: FileList | File[]) => {
        setUploading(true)
        const arr = Array.from(files)
        for (const f of arr) {
            try {
                const [text, fileData] = await Promise.all([
                    extractTextFromFile(f),
                    new Promise<string>((res) => {
                        const reader = new FileReader()
                        reader.onload = (e) => res((e.target?.result as string).split(",")[1] ?? "")
                        reader.readAsDataURL(f)
                    }),
                ])
                const newDoc: ReferenceDoc = {
                    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    name: f.name,
                    type: guessDocType(f.name),
                    owner: "de4",
                    text,
                    fileData,
                    fileType: f.type || "application/octet-stream",
                    addedAt: new Date().toISOString(),
                }
                setDocs((prev) => {
                    const next = [...prev, newDoc]
                    setReferences(next)
                    return next
                })
                toast.success(`"${f.name}" tilføjet`)
            } catch (e: any) {
                toast.error(`Fejl ved indlæsning af ${f.name}: ${e.message}`)
            }
        }
        setUploading(false)
    }, [])

    const downloadDoc = (doc: ReferenceDoc) => {
        if (!doc.fileData) return
        const link = document.createElement("a")
        link.href = `data:${doc.fileType ?? "application/octet-stream"};base64,${doc.fileData}`
        link.download = doc.name
        link.click()
    }

    const updateDocOwner = (id: string, owner: DocOwner) => {
        setDocs((prev) => {
            const next = prev.map((d) => (d.id === id ? { ...d, owner } : d))
            setReferences(next)
            return next
        })
    }

    const updateDocType = (id: string, type: DocType) => {
        setDocs((prev) => {
            const next = prev.map((d) => (d.id === id ? { ...d, type } : d))
            setReferences(next)
            return next
        })
    }

    const archiveDoc = (id: string) => {
        const doc = docs.find((d) => d.id === id)
        if (!doc) return
        const archived = { ...doc, archivedAt: new Date().toISOString() }
        setArchivedDocs((prev) => [archived as any, ...prev])
        setDocs((prev) => {
            const next = prev.filter((d) => d.id !== id)
            setReferences(next)
            return next
        })
        toast.success(`"${doc.name}" arkiveret`)
    }

    const removeDoc = (id: string) => {
        setDocs((prev) => {
            const next = prev.filter((d) => d.id !== id)
            setReferences(next)
            return next
        })
    }

    // ── Member list ──────────────────────────────────────────

    const handleMemberFile = async (files: FileList | File[]) => {
        const f = Array.from(files)[0]
        if (!f) return
        setMemberUploading(true)
        try {
            const text = await extractTextFromFile(f)
            setMemberText(text)
            toast.success("Fil indlæst — klik 'Gem og aktivér liste' for at gemme")
        } catch (e: any) {
            toast.error(`Fejl: ${e.message}`)
        }
        setMemberUploading(false)
    }

    const saveMemberList = () => {
        const parsed = parseMemberList(memberText)
        const updated: MemberList = {
            raw: memberText,
            parsed,
            updatedAt: new Date().toISOString(),
        }
        setMemberListState(updated)
        setMemberList(updated)
        toast.success(`${parsed.length} ProF-medlemmer gemt og aktiveret`)
    }

    // ── Drag & drop for doc zone ─────────────────────────────

    const [dragging, setDragging] = useState(false)

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            setDragging(false)
            handleDocFiles(e.dataTransfer.files)
        },
        [handleDocFiles]
    )

    // ── Render ───────────────────────────────────────────────

    const activeCount = docs.length
    const memberCount = memberList.parsed.length

    return (
        <div className="space-y-8">
            <PageHeader
                title="Overenskomster & baggrundsviden"
                subtitle="Administrer de dokumenter AI-screeningen bruger som kontekst ved kontraktvalidering"
            />

            {/* Status bar */}
            <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Aktive dokumenter</span>
                    <Badge variant={activeCount > 0 ? "default" : "outline"} className="ml-1">
                        {activeCount}
                    </Badge>
                </div>
                <div className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">ProF-medlemmer</span>
                    <Badge variant={memberCount > 0 ? "default" : "outline"} className="ml-1">
                        {memberCount}
                    </Badge>
                </div>
                {memberList.updatedAt && (
                    <div className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm text-muted-foreground">
                        <RefreshCw className="h-3.5 w-3.5" />
                        Liste opdateret{" "}
                        {new Date(memberList.updatedAt).toLocaleDateString("da-DK")}
                    </div>
                )}
            </div>

            {activeCount === 0 && memberCount === 0 && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div className="text-sm text-amber-800 dark:text-amber-200">
                        <strong>Ingen baggrundsviden indlæst.</strong> AI-screeningen kører uden
                        overenskomstkontekst og vil flage forhold der måske er dækket af
                        overenskomsten. Upload overenskomsterne nedenfor for præcise resultater.
                    </div>
                </div>
            )}

            {/* ── Section A: Documents ──────────────────────── */}
            <div className="space-y-4">
                <div>
                    <h2 className="text-base font-semibold">A — Overenskomstdokumenter</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Upload overenskomsttekster, lønskemaer og standardkontrakter. Ældre
                        versioner arkiveres automatisk når du uploader en ny.
                    </p>
                </div>

                {/* Existing docs */}
                {docs.length > 0 && (
                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Dokument</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Ejer</TableHead>
                                    <TableHead className="hidden sm:table-cell">Tilføjet</TableHead>
                                    <TableHead className="w-[130px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {docs.map((doc) => {
                                    const ownerCfg = OWNER_CONFIG[doc.owner ?? "de4"]
                                    return (
                                    <TableRow key={doc.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                                <span className="text-sm font-medium truncate max-w-[180px]">
                                                    {doc.name}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Select
                                                value={doc.type}
                                                onValueChange={(v) => updateDocType(doc.id, v as DocType)}
                                            >
                                                <SelectTrigger className="h-7 w-auto min-w-[160px] text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {DOC_TYPE_OPTIONS.map((group) => (
                                                        <SelectGroup key={group.group}>
                                                            <SelectLabel className="text-xs">
                                                                {group.group}
                                                            </SelectLabel>
                                                            {group.values.map((v) => (
                                                                <SelectItem key={v} value={v} className="text-xs">
                                                                    {v}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectGroup>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <button
                                                type="button"
                                                title="Skift ejer"
                                                onClick={() => updateDocOwner(doc.id, doc.owner === "de4" ? "anden-fagforening" : "de4")}
                                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${ownerCfg.color}`}
                                            >
                                                {ownerCfg.label}
                                            </button>
                                        </TableCell>
                                        <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                                            {new Date(doc.addedAt).toLocaleDateString("da-DK")}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-1 justify-end">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    title="Vis dokument"
                                                    onClick={() => setViewingDoc(doc)}
                                                >
                                                    <Eye className="h-3.5 w-3.5" />
                                                </Button>
                                                {doc.fileData && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                        title="Download original"
                                                        onClick={() => downloadDoc(doc)}
                                                    >
                                                        <Download className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    title="Arkivér"
                                                    onClick={() => archiveDoc(doc.id)}
                                                >
                                                    <Archive className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                                    title="Slet permanent"
                                                    onClick={() => removeDoc(doc.id)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {/* Upload zone */}
                <div
                    className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                        dragging
                            ? "border-foreground/40 bg-muted/50"
                            : "border-muted-foreground/20 hover:border-muted-foreground/40"
                    }`}
                    onDragOver={(e) => {
                        e.preventDefault()
                        setDragging(true)
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileRef.current?.click()}
                    style={{ cursor: "pointer" }}
                >
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".pdf,.txt,.docx"
                        multiple
                        className="hidden"
                        onChange={(e) =>
                            e.target.files && handleDocFiles(e.target.files)
                        }
                    />
                    {uploading ? (
                        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            Indlæser...
                        </div>
                    ) : (
                        <>
                            <Upload className="mx-auto h-8 w-8 text-muted-foreground/40" />
                            <p className="mt-3 text-sm">
                                Træk dokumenter hertil eller klik for at vælge
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                PDF · TXT · DOCX — overenskomsttekst, lønskema,
                                standardkontrakt, rettighedsforbehold
                            </p>
                        </>
                    )}
                </div>

                {activeCount > 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <p className="text-sm text-emerald-800 dark:text-emerald-200">
                            <strong>{activeCount} dokument{activeCount !== 1 ? "er" : ""} aktiv</strong> —
                            alle kontraktanalyser inkluderer nu overenskomstkontekst.
                            Typer:{" "}
                            {[...new Set(docs.map((d) => d.type))].join(", ")}
                        </p>
                    </div>
                )}

                {/* Archive */}
                {archivedDocs.length > 0 && (
                    <Collapsible open={showArchive} onOpenChange={setShowArchive}>
                        <CollapsibleTrigger asChild>
                            <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                <Archive className="h-3.5 w-3.5" />
                                Arkiv ({archivedDocs.length} historiske versioner)
                                {showArchive ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                )}
                            </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div className="mt-3 rounded-lg border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Dokument</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Tilføjet</TableHead>
                                            <TableHead>Arkiveret</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {archivedDocs.map((doc: any) => (
                                            <TableRow
                                                key={doc.id}
                                                className="text-muted-foreground"
                                            >
                                                <TableCell className="text-sm">
                                                    {doc.name}
                                                </TableCell>
                                                <TableCell>
                                                    <span
                                                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                                                            TYPE_COLORS[doc.type as DocType] || ""
                                                        }`}
                                                    >
                                                        {doc.type}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {new Date(doc.addedAt).toLocaleDateString("da-DK")}
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {doc.archivedAt
                                                        ? new Date(doc.archivedAt).toLocaleDateString(
                                                              "da-DK"
                                                          )
                                                        : "—"}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                )}
            </div>

            <Separator />

            {/* ── Section B: Member list ─────────────────────── */}
            <div className="space-y-4">
                <div>
                    <h2 className="text-base font-semibold">B — ProF-medlemsliste</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Kun ProF-medlemmer er juridisk bundet af overenskomsten. AI-screeningen
                        bruger listen til automatisk at identificere om producenten er medlem.
                        Kopier listen fra{" "}
                        <a
                            href="https://pro-f.dk/dokumentarfilm"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2 hover:text-foreground"
                        >
                            pro-f.dk
                        </a>
                        .
                    </p>
                </div>

                <div className="rounded-lg border">
                    {/* Header */}
                    <div className="flex items-center justify-between border-b px-4 py-3">
                        <div>
                            <p className="text-sm font-medium">Producentforeningens medlemmer</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {memberCount > 0
                                    ? `${memberCount} virksomheder · Sidst opdateret ${
                                          memberList.updatedAt
                                              ? new Date(memberList.updatedAt).toLocaleDateString(
                                                    "da-DK"
                                                )
                                              : "—"
                                      }`
                                    : "Ingen liste indlæst endnu"}
                            </p>
                        </div>
                        {memberCount > 0 && (
                            <Badge variant="default">{memberCount} aktive</Badge>
                        )}
                    </div>

                    <div className="p-4 space-y-4">
                        {/* Tabs */}
                        <div className="flex gap-0 border-b">
                            {(["paste", "upload"] as const).map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setMemberTab(tab)}
                                    className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                                        memberTab === tab
                                            ? "border-foreground font-medium text-foreground"
                                            : "border-transparent text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {tab === "paste"
                                        ? "Indsæt liste"
                                        : "Upload fil"}
                                </button>
                            ))}
                        </div>

                        {memberTab === "paste" && (
                            <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">
                                    Gå til pro-f.dk/dokumentarfilm og pro-f.dk/spillefilm-fiktion,
                                    kopiér firmanavnene og indsæt herunder — ét navn per linje
                                    eller kommasepareret.
                                </Label>
                                <Textarea
                                    value={memberText}
                                    onChange={(e) => setMemberText(e.target.value)}
                                    placeholder={
                                        "Final Cut for Real ApS\nDanish Documentary\nElk Film\nMakropol\n..."
                                    }
                                    rows={8}
                                    className="font-mono text-xs"
                                />
                            </div>
                        )}

                        {memberTab === "upload" && (
                            <div className="space-y-3">
                                <Label className="text-xs text-muted-foreground">
                                    Upload en TXT- eller CSV-fil med firmanavne — ét navn per
                                    linje.
                                </Label>
                                <div
                                    className="rounded-lg border-2 border-dashed p-6 text-center cursor-pointer hover:border-muted-foreground/40 transition-colors"
                                    onClick={() => memberFileRef.current?.click()}
                                >
                                    <input
                                        ref={memberFileRef}
                                        type="file"
                                        accept=".txt,.csv"
                                        className="hidden"
                                        onChange={(e) =>
                                            e.target.files && handleMemberFile(e.target.files)
                                        }
                                    />
                                    {memberUploading ? (
                                        <RefreshCw className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                                    ) : (
                                        <>
                                            <Upload className="mx-auto h-5 w-5 text-muted-foreground/50" />
                                            <p className="mt-2 text-sm text-muted-foreground">
                                                Klik for at vælge TXT eller CSV
                                            </p>
                                        </>
                                    )}
                                </div>
                                {memberText && (
                                    <div className="rounded-md bg-muted/50 p-3 font-mono text-xs text-muted-foreground max-h-32 overflow-auto">
                                        {memberText.slice(0, 500)}
                                        {memberText.length > 500 ? "…" : ""}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex items-center justify-between pt-1">
                            <p className="text-xs text-muted-foreground">
                                {memberText
                                    ? `${parseMemberList(memberText).length} navne identificeret`
                                    : ""}
                            </p>
                            <Button
                                size="sm"
                                onClick={saveMemberList}
                                disabled={!memberText.trim()}
                            >
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                Gem og aktivér liste
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Member preview */}
                {memberCount > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">
                            Indlæste medlemmer (preview)
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {memberList.parsed.slice(0, 40).map((m, i) => (
                                <span
                                    key={i}
                                    className="inline-flex items-center rounded-md border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
                                >
                                    {m}
                                </span>
                            ))}
                            {memberList.parsed.length > 40 && (
                                <span className="text-xs text-muted-foreground px-1 py-0.5">
                                    +{memberList.parsed.length - 40} flere
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <Separator />

            {/* ── Section C: Legal notes ─────────────────────── */}
            <div className="space-y-4">
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-base font-semibold">C — Juridiske noteringer</h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Faste DFKS-noteringer der altid indgår som baggrundsviden ved kontraktgennemgang.
                            Kan redigeres hvis regelgrundlaget præciseres.
                        </p>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            const newNote: LegalNote = {
                                id: `note_${Date.now()}`,
                                title: "Ny notering",
                                text: "",
                                priority: "fast-regel",
                                updatedAt: new Date().toISOString(),
                            }
                            const updated = [...legalNotes, newNote]
                            setLegalNotesState(updated)
                            setLegalNotes(updated)
                            setEditingNoteId(newNote.id)
                        }}
                    >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Tilføj notering
                    </Button>
                </div>

                <div className="space-y-3">
                    {[...legalNotes]
                        .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority))
                        .map((note) => {
                        const isEditing = editingNoteId === note.id
                        const pc = PRIORITY_CONFIG[note.priority ?? "fast-regel"] ?? PRIORITY_CONFIG["fast-regel"]
                        const updateNote = (patch: Partial<LegalNote>) => {
                            const updated = legalNotes.map(n => n.id === note.id ? { ...n, ...patch } : n)
                            setLegalNotesState(updated)
                            setLegalNotes(updated)
                        }
                        return (
                            <div key={note.id} className="rounded-lg border">
                                <div className="flex items-center justify-between px-4 py-3 border-b gap-3">
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        {isEditing ? (
                                            <input
                                                className="flex-1 text-sm font-medium bg-transparent border-0 outline-none ring-1 ring-border rounded px-2 py-0.5"
                                                value={note.title}
                                                onChange={(e) => updateNote({ title: e.target.value })}
                                            />
                                        ) : (
                                            <span className="text-sm font-medium truncate">{note.title}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {/* Priority selector — cycles through on click */}
                                        <button
                                            type="button"
                                            title="Skift prioritet"
                                            onClick={() => {
                                                const idx = PRIORITY_ORDER.indexOf(note.priority ?? "fast-regel")
                                                const next = PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length]
                                                updateNote({ priority: next, updatedAt: new Date().toISOString() })
                                            }}
                                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium cursor-pointer transition-opacity hover:opacity-80 ${pc.color}`}
                                        >
                                            <span className={`h-1.5 w-1.5 rounded-full ${pc.dot}`} />
                                            {pc.label}
                                        </button>
                                        <span className="text-xs text-muted-foreground hidden sm:block">
                                            {new Date(note.updatedAt).toLocaleDateString("da-DK")}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            title={isEditing ? "Gem" : "Rediger"}
                                            onClick={() => {
                                                if (isEditing) {
                                                    updateNote({ updatedAt: new Date().toISOString() })
                                                    setEditingNoteId(null)
                                                    toast.success("Notering gemt")
                                                } else {
                                                    setEditingNoteId(note.id)
                                                }
                                            }}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            title="Slet notering"
                                            onClick={() => {
                                                const updated = legalNotes.filter(n => n.id !== note.id)
                                                setLegalNotesState(updated)
                                                setLegalNotes(updated)
                                                if (editingNoteId === note.id) setEditingNoteId(null)
                                                toast.success("Notering slettet")
                                            }}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="px-4 py-3 space-y-3">
                                    {isEditing ? (
                                        <Textarea
                                            value={note.text}
                                            onChange={(e) => updateNote({ text: e.target.value })}
                                            rows={6}
                                            className="text-sm font-mono"
                                        />
                                    ) : (
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.text}</p>
                                    )}
                                    <label className="flex items-center gap-2 cursor-pointer w-fit">
                                        <input
                                            type="checkbox"
                                            checked={note.excludeForOverenskomst ?? false}
                                            onChange={(e) => updateNote({ excludeForOverenskomst: e.target.checked })}
                                            className="h-3.5 w-3.5 rounded border-border accent-foreground"
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            Gælder ikke for overenskomstkontrakter (A-løn)
                                        </span>
                                    </label>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {legalNotes.length === 0 && (
                    <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center">
                        <p className="text-sm text-muted-foreground w-full">
                            Ingen faste noteringer. Klik "Tilføj notering" for at oprette en.
                        </p>
                    </div>
                )}
            </div>

            <Separator />

            {/* ── Section D: Case learnings ──────────────────── */}
            <div className="space-y-4">
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-base font-semibold">D — Lærte mønstre</h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Konkrete regler lært fra sagsbehandling. Tilføj hvad AI'en fejlede og formulér
                            den korrekte regel — den injiceres automatisk i alle fremtidige kontraktgennemgange.
                        </p>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            const newLearning: CaseLearning = {
                                id: `learning_${Date.now()}`,
                                kontrakttype: "alle",
                                titel: "Ny sagserfaring",
                                regel: "",
                                addedAt: new Date().toISOString(),
                            }
                            const updated = [...caseLearnings, newLearning]
                            setCaseLearningsState(updated)
                            setCaseLearnings(updated)
                            setEditingLearningId(newLearning.id)
                        }}
                    >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Tilføj sagserfaring
                    </Button>
                </div>

                <div className="space-y-3">
                    {caseLearnings.map((learning) => {
                        const isEditing = editingLearningId === learning.id
                        const kt = KONTRAKTTYPE_CONFIG[learning.kontrakttype ?? "alle"]
                        const updateLearning = (patch: Partial<CaseLearning>) => {
                            const updated = caseLearnings.map(l => l.id === learning.id ? { ...l, ...patch } : l)
                            setCaseLearningsState(updated)
                            setCaseLearnings(updated)
                        }
                        return (
                            <div key={learning.id} className="rounded-lg border">
                                <div className="flex items-center justify-between px-4 py-3 border-b gap-3">
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        {isEditing ? (
                                            <input
                                                className="flex-1 text-sm font-medium bg-transparent border-0 outline-none ring-1 ring-border rounded px-2 py-0.5"
                                                value={learning.titel}
                                                onChange={(e) => updateLearning({ titel: e.target.value })}
                                            />
                                        ) : (
                                            <span className="text-sm font-medium truncate">{learning.titel}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            title="Skift kontrakttype"
                                            onClick={() => {
                                                const idx = KONTRAKTTYPE_ORDER.indexOf(learning.kontrakttype ?? "alle")
                                                const next = KONTRAKTTYPE_ORDER[(idx + 1) % KONTRAKTTYPE_ORDER.length]
                                                updateLearning({ kontrakttype: next })
                                            }}
                                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium cursor-pointer transition-opacity hover:opacity-80 ${kt.color}`}
                                        >
                                            {kt.label}
                                        </button>
                                        <span className="text-xs text-muted-foreground hidden sm:block">
                                            {new Date(learning.addedAt).toLocaleDateString("da-DK")}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            title={isEditing ? "Gem" : "Rediger"}
                                            onClick={() => {
                                                if (isEditing) {
                                                    setEditingLearningId(null)
                                                    toast.success("Sagserfaring gemt")
                                                } else {
                                                    setEditingLearningId(learning.id)
                                                }
                                            }}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            title="Slet sagserfaring"
                                            onClick={() => {
                                                const updated = caseLearnings.filter(l => l.id !== learning.id)
                                                setCaseLearningsState(updated)
                                                setCaseLearnings(updated)
                                                if (editingLearningId === learning.id) setEditingLearningId(null)
                                                toast.success("Sagserfaring slettet")
                                            }}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="px-4 py-3">
                                    {isEditing ? (
                                        <div className="space-y-2">
                                            <Label className="text-xs text-muted-foreground">Konkret regel (injiceres i AI-prompten)</Label>
                                            <Textarea
                                                value={learning.regel}
                                                onChange={(e) => updateLearning({ regel: e.target.value })}
                                                rows={4}
                                                className="text-sm font-mono"
                                                placeholder="Fx: En kontrakt med CVR-nummer og momsopkrævning er ALTID en leverandørkontrakt — sæt aldrig collectiveAgreement til true for sådanne kontrakter."
                                            />
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{learning.regel || <span className="italic">Ingen regel skrevet endnu</span>}</p>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>

                {caseLearnings.length === 0 && (
                    <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center">
                        <p className="text-sm text-muted-foreground w-full">
                            Ingen lærte mønstre endnu. Klik "Tilføj sagserfaring" eller brug "Gem som sagserfaring" i kontraktgennemgang.
                        </p>
                    </div>
                )}
            </div>

            {/* ── Document viewer overlay ────────────────────── */}
            {viewingDoc && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setViewingDoc(null)}
                >
                    <div
                        className="bg-background rounded-lg border shadow-xl w-full max-w-4xl h-[85vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
                            <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">{viewingDoc.name}</span>
                                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${OWNER_CONFIG[viewingDoc.owner ?? "de4"].color}`}>
                                    {OWNER_CONFIG[viewingDoc.owner ?? "de4"].label}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {viewingDoc.fileData && (
                                    <Button size="sm" variant="outline" onClick={() => downloadDoc(viewingDoc)}>
                                        <Download className="mr-1.5 h-3.5 w-3.5" />
                                        Download
                                    </Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => setViewingDoc(null)}>
                                    Luk
                                </Button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            {viewingDoc.fileData && viewingDoc.fileType === "application/pdf" ? (
                                // PDF: render nativt i iframe
                                <iframe
                                    src={`data:application/pdf;base64,${viewingDoc.fileData}`}
                                    className="w-full h-full border-0"
                                    title={viewingDoc.name}
                                />
                            ) : viewHtml ? (
                                // DOCX: konverteret til HTML
                                <div
                                    className="overflow-auto h-full p-6 prose prose-sm max-w-none dark:prose-invert"
                                    dangerouslySetInnerHTML={{ __html: viewHtml }}
                                />
                            ) : (
                                // Fallback: plain text
                                <div className="overflow-auto h-full p-5">
                                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                                        {viewingDoc.text}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
