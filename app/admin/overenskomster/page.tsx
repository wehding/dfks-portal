"use client"

/**
 * app/admin/overenskomster/page.tsx
 *
 * Admin panel for managing collective agreements (overenskomster),
 * wage schedules, standard contracts, and the ProF member list.
 * Documents stored here are used as context for all AI contract screenings.
 */

import { useState, useRef, useCallback } from "react"
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
    extractTextFromFile,
    type ReferenceDoc,
    type MemberList,
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

    const [uploading, setUploading] = useState(false)
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
                const text = await extractTextFromFile(f)
                const newDoc: ReferenceDoc = {
                    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    name: f.name,
                    type: guessDocType(f.name),
                    text,
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
                                    <TableHead className="hidden sm:table-cell">Størrelse</TableHead>
                                    <TableHead className="hidden sm:table-cell">Tilføjet</TableHead>
                                    <TableHead className="w-[100px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {docs.map((doc) => (
                                    <TableRow key={doc.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                                <span className="text-sm font-medium truncate max-w-[200px]">
                                                    {doc.name}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Select
                                                value={doc.type}
                                                onValueChange={(v) => updateDocType(doc.id, v as DocType)}
                                            >
                                                <SelectTrigger className="h-7 w-auto min-w-[180px] text-xs">
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
                                        <TableCell className="hidden sm:table-cell text-muted-foreground text-sm tabular-nums">
                                            {(doc.text.length / 1000).toFixed(0)}k tegn
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
                                                    title="Arkivér (bevar som historisk version)"
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
                                ))}
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
        </div>
    )
}
