"use client"

/**
 * app/admin/overenskomster/page.tsx
 *
 * Admin panel for managing collective agreements (overenskomster),
 * wage schedules, standard contracts, and the ProF member list.
 * Documents stored here are used as context for all AI contract screenings.
 */

import { useState, useRef, useCallback, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import {
    Upload,
    Trash2,
    Check,
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
    X,
    GitCompare,
    UserPlus,
    UserMinus,
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
    setMemberListGroups,
    getCaseLearnings,
    setCaseLearnings,
    extractTextFromFile,
    type ReferenceDoc,
    type MemberListGroup,
    type MemberList,
    type LegalNote,
    type LegalNotePriority,
    type DocOwner,
    type CaseLearning,
    type CaseLearningKontrakttype,
} from "@/lib/ai"
import {
    getReferenceDocs,
    saveReferenceDoc,
    updateReferenceDoc as updateDbReferenceDoc,
    deleteReferenceDoc,
    getLegalNotes as getDbLegalNotes,
    saveLegalNote,
    updateLegalNote as updateDbLegalNote,
    deleteLegalNote,
    getCaseLearnings as getDbCaseLearnings,
    saveCaseLearning,
    updateCaseLearning as updateDbCaseLearning,
    deleteCaseLearning,
} from "@/lib/db/overenskomster"
import {
    getProducerGroups,
    getGroupMembers,
    getGroupMemberCounts,
    getNonGroupEmployers,
    upsertEmployerInGroup,
    addToGroup,
    removeFromGroup,
    moveToGroup,
    renameGroup,
    deleteGroup,
    bulkImportToGroup,
    type DbEmployerWithGroup,
    type EmployerInput,
} from "@/lib/db/employers"

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

// ── Component ────────────────────────────────────────────────

// ── DB → UI type mappers ──────────────────────────────────────

function mapDbDocToRef(d: import("@/lib/db/types").DbReferenceDoc): ReferenceDoc {
    return {
        id: d.id,
        name: d.file_name ?? d.title,
        type: (d.doc_subtype ?? "Reference") as ReferenceDoc["type"],
        owner: (d.owner ?? "de4") as DocOwner,
        text: d.content_text ?? "",
        addedAt: d.created_at,
    }
}

function mapDbNoteToLegal(d: import("@/lib/db/types").DbLegalNote): LegalNote {
    return {
        id: d.id,
        title: d.title,
        text: d.body,
        priority: d.priority as LegalNotePriority,
        excludeForOverenskomst: d.exclude_for_overenskomst.length > 0,
        updatedAt: d.created_at,
    }
}

export default function OverenskomsterPage() {
    const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
    const [orgId, setOrgId] = useState<string>(DFKS_ORG_ID)
    const [docs, setDocs] = useState<ReferenceDoc[]>([])
    const [archivedDocs, setArchivedDocs] = useState<ReferenceDoc[]>([])
    const [docsLoading, setDocsLoading] = useState(true)
    const [legalNotes, setLegalNotesState] = useState<LegalNote[]>([])
    const [notesLoading, setNotesLoading] = useState(true)
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
    const [caseLearnings, setCaseLearningsState] = useState<CaseLearning[]>([])
    const [editingLearningId, setEditingLearningId] = useState<string | null>(null)

    // ── DB-backed producer list state ────────────────────────
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

    const [nonMembers, setNonMembers] = useState<{ id: string; name: string }[]>([])
    const [nonMembersLoading, setNonMembersLoading] = useState(false)
    const [memberSortAsc, setMemberSortAsc] = useState<boolean | null>(null)
    const [nonMembersLoaded, setNonMembersLoaded] = useState(false)

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
    const [memberSearch, setMemberSearch] = useState("")
    const [memberUploading, setMemberUploading] = useState(false)
    const profSyncFileRef = useRef<HTMLInputElement>(null)
    const [profSyncLoading, setProfSyncLoading] = useState(false)
    const [profSyncResult, setProfSyncResult] = useState<{
        onlyInProf: string[]
        onlyInDb: string[]
    } | null>(null)
    const [profSyncOpen, setProfSyncOpen] = useState(false)
    const [showArchive, setShowArchive] = useState(false)

    const fileRef = useRef<HTMLInputElement>(null)
    const memberFileRef = useRef<HTMLInputElement>(null)

    // ── Load org + docs + notes + producer groups on mount ───
    useEffect(() => {
        const supabase = createClient()
        supabase.auth.getUser().then(({ data: { user } }) => {
            const oid = user?.user_metadata?.org_id ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
            setOrgId(oid)
            loadDocs(oid)
            loadNotes(oid)
            loadLearnings(oid)
        })
        loadGroups()
    }, [])

    const loadDocs = async (oid: string) => {
        setDocsLoading(true)
        const dbDocs = await getReferenceDocs(oid)
        setDocs(dbDocs.filter(d => !d.archived).map(mapDbDocToRef))
        setArchivedDocs(dbDocs.filter(d => d.archived).map(mapDbDocToRef))
        setDocsLoading(false)
    }

    const loadNotes = async (oid: string) => {
        setNotesLoading(true)
        const dbNotes = await getDbLegalNotes(oid)
        setLegalNotesState(dbNotes.map(mapDbNoteToLegal))
        setNotesLoading(false)
    }

    const loadLearnings = async (oid: string) => {
        const dbLearnings = await getDbCaseLearnings(oid)
        setCaseLearningsState(dbLearnings.map(l => ({
            id: l.id,
            kontrakttype: l.kontrakttype as CaseLearningKontrakttype,
            titel: l.titel,
            regel: l.regel,
            addedAt: l.added_at,
        })))
    }

    const loadGroups = async () => {
        setGroupsLoading(true)
        const [names, counts] = await Promise.all([getProducerGroups(), getGroupMemberCounts()])
        setDbGroupNames(names)
        setMemberCounts(counts)
        setGroupsLoading(false)
        if (names.length > 0 && !activeGroupName) {
            const first = names[0]
            setActiveGroupName(first)
            await loadMembers(first, counts)
        }
    }

    const loadMembers = async (groupName: string, counts?: Record<string, number>) => {
        setMembersLoading(true)
        const members = await getGroupMembers(groupName)
        setDbMembers(members)
        setMembersLoading(false)
        // Sync to localStorage for AI context (buildScreeningPrompt reads this)
        syncAiContext(groupName, members, counts)
    }

    const syncAiContext = (
        changedGroup: string,
        changedMembers: DbEmployerWithGroup[],
        counts?: Record<string, number>
    ) => {
        // Build MemberListGroup[] from current DB state for AI context
        const allGroups: MemberListGroup[] = dbGroupNames.map(name => {
            const members = name === changedGroup ? changedMembers : []
            const parsed = members.map(m => m.name)
            return {
                id: name,
                name,
                memberList: { raw: parsed.join("\n"), parsed, updatedAt: null } satisfies MemberList,
                createdAt: "",
            }
        })
        setMemberListGroups(allGroups)
    }

    // ── Document upload ──────────────────────────────────────

    const handleDocFiles = useCallback(async (files: FileList | File[]) => {
        if (!orgId) return
        setUploading(true)
        const arr = Array.from(files)
        const supabase = createClient()

        for (const f of arr) {
            try {
                const text = await extractTextFromFile(f)

                // Upload fil til Supabase Storage
                const ext = f.name.split(".").pop() ?? "bin"
                const storagePath = `reference-docs/${crypto.randomUUID()}.${ext}`
                const { error: uploadError } = await supabase.storage
                    .from("documents")
                    .upload(storagePath, f)

                let fileUrl: string | null = null
                if (!uploadError) {
                    const { data: urlData } = supabase.storage
                        .from("documents")
                        .getPublicUrl(storagePath)
                    fileUrl = urlData?.publicUrl ?? null
                }

                // Gem i reference_docs
                const saved = await saveReferenceDoc({
                    org_id: orgId,
                    title: f.name,
                    file_name: f.name,
                    url: fileUrl,
                    doc_type: "dokument",
                    doc_subtype: guessDocType(f.name),
                    owner: "de4",
                    content_text: text,
                })

                if (saved) {
                    toast.success(`"${f.name}" gemt`)
                } else {
                    toast.error(`"${f.name}" kunne ikke gemmes — tjek RLS-regler`)
                }
            } catch (e: any) {
                toast.error(`Fejl ved ${f.name}: ${e.message}`)
            }
        }

        // loadDocs kaldes med den aktuelle orgId-værdi direkte
        const dbDocs = await getReferenceDocs(orgId)
        setDocs(dbDocs.filter(d => !d.archived).map(mapDbDocToRef))
        setArchivedDocs(dbDocs.filter(d => d.archived).map(mapDbDocToRef))
        setUploading(false)
    }, [orgId])

    const downloadDoc = async (doc: ReferenceDoc) => {
        // Generate signed URL from Storage
        const supabase = createClient()
        // Try to find storage path from URL
        if (doc.addedAt) {
            // Use public URL directly if doc has one stored
            const { data: dbDoc } = await supabase
                .from("reference_docs")
                .select("url")
                .eq("id", doc.id)
                .single()
            if (dbDoc?.url) {
                window.open(dbDoc.url, "_blank")
                return
            }
        }
        toast.error("Download ikke tilgængeligt")
    }

    const updateDocOwner = async (id: string, owner: DocOwner) => {
        await updateDbReferenceDoc(id, { owner })
        setDocs(prev => prev.map(d => d.id === id ? { ...d, owner } : d))
    }

    const updateDocType = async (id: string, type: DocType) => {
        await updateDbReferenceDoc(id, { doc_subtype: type })
        setDocs(prev => prev.map(d => d.id === id ? { ...d, type } : d))
    }

    const archiveDoc = async (id: string) => {
        const doc = docs.find(d => d.id === id)
        if (!doc) return
        await updateDbReferenceDoc(id, { archived: true })
        setDocs(prev => prev.filter(d => d.id !== id))
        setArchivedDocs(prev => [{ ...doc } as any, ...prev])
        toast.success(`"${doc.name}" arkiveret`)
    }

    const unarchiveDoc = async (id: string) => {
        const doc = archivedDocs.find(d => d.id === id)
        if (!doc) return
        await updateDbReferenceDoc(id, { archived: false })
        setArchivedDocs(prev => prev.filter(d => d.id !== id))
        setDocs(prev => [{ ...doc } as any, ...prev])
        toast.success(`"${doc.name}" gendannet`)
    }

    const removeDoc = async (id: string) => {
        await deleteReferenceDoc(id)
        setDocs(prev => prev.filter(d => d.id !== id))
    }

    // ── Member list DB handlers ──────────────────────────────

    const switchGroup = async (name: string) => {
        setActiveGroupName(name)
        setMemberSearch("")
        await loadMembers(name)
    }

    const handleCreateGroup = () => {
        setPendingNewGroup("Ny liste")
        setEditingGroupOldName("__new__")
        setEditingGroupNewName("Ny liste")
    }

    const commitNewGroup = async () => {
        const name = editingGroupNewName.trim()
        if (!name) { setPendingNewGroup(null); setEditingGroupOldName(null); return }
        // Group exists in DB only when first member is added — just add to local list
        const next = [...dbGroupNames, name]
        setDbGroupNames(next)
        setMemberCounts(prev => ({ ...prev, [name]: 0 }))
        setPendingNewGroup(null)
        setEditingGroupOldName(null)
        setActiveGroupName(name)
        setDbMembers([])
    }

    const commitRename = async () => {
        const oldName = editingGroupOldName
        const newName = editingGroupNewName.trim()
        setEditingGroupOldName(null)
        if (!oldName || oldName === "__new__" || !newName || newName === oldName) return
        const ok = await renameGroup(oldName, newName)
        if (ok) {
            setDbGroupNames(prev => prev.map(n => n === oldName ? newName : n))
            if (activeGroupName === oldName) setActiveGroupName(newName)
            setMemberCounts(prev => {
                const next = { ...prev }
                next[newName] = next[oldName] ?? 0
                delete next[oldName]
                return next
            })
            toast.success(`Liste omdøbt til "${newName}"`)
        } else {
            toast.error("Kunne ikke omdøbe listen")
        }
    }

    const handleDeleteGroup = async (name: string) => {
        if (!confirm(`Slet listen "${name}"? Selskaberne fjernes fra listen men forbliver i databasen.`)) return
        const ok = await deleteGroup(name)
        if (ok) {
            const next = dbGroupNames.filter(n => n !== name)
            setDbGroupNames(next)
            setMemberCounts(prev => { const c = { ...prev }; delete c[name]; return c })
            if (activeGroupName === name) {
                const nextActive = next[0] ?? null
                setActiveGroupName(nextActive)
                if (nextActive) await loadMembers(nextActive)
                else setDbMembers([])
            }
            toast.success(`Listen "${name}" slettet`)
        }
    }

    const handleAddCompany = async () => {
        const name = addCompanyName.trim()
        if (!name || !activeGroupName) return
        if (dbMembers.some(m => m.name.toLowerCase() === name.toLowerCase())) {
            toast.error("Selskabet er allerede på listen")
            return
        }
        const id = await upsertEmployerInGroup({ name }, activeGroupName)
        if (id) {
            setAddCompanyName("")
            await loadMembers(activeGroupName)
            setMemberCounts(prev => ({ ...prev, [activeGroupName]: (prev[activeGroupName] ?? 0) + 1 }))
            toast.success(`"${name}" tilføjet`)
        } else {
            toast.error("Kunne ikke tilføje selskabet")
        }
    }

    const handleMoveCompany = async (employerId: string, fromGroup: string, toGroup: string) => {
        const ok = await moveToGroup(employerId, fromGroup, toGroup)
        if (ok) {
            await loadMembers(fromGroup)
            setMemberCounts(prev => ({
                ...prev,
                [fromGroup]: Math.max(0, (prev[fromGroup] ?? 1) - 1),
                [toGroup]: (prev[toGroup] ?? 0) + 1,
            }))
            toast.success(`Selskab flyttet til "${toGroup}"`)
        } else {
            toast.error("Kunne ikke flytte selskabet")
        }
    }

    const handleRemoveCompany = async (employerId: string, groupName: string, companyName: string) => {
        const ok = await removeFromGroup(employerId, groupName)
        if (ok) {
            setDbMembers(prev => prev.filter(m => m.id !== employerId))
            setMemberCounts(prev => ({ ...prev, [groupName]: Math.max(0, (prev[groupName] ?? 1) - 1) }))
            toast.success(`"${companyName}" fjernet fra listen`)
        } else {
            toast.error("Kunne ikke fjerne selskabet")
        }
    }

    const handleMemberFile = async (files: FileList | File[]) => {
        const f = Array.from(files)[0]
        if (!f) return
        setMemberUploading(true)
        try {
            const name = f.name.toLowerCase()
            if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
                const XLSX = await import("xlsx")
                const buf = await f.arrayBuffer()
                const wb = XLSX.read(buf, { type: "array" })
                // Use first sheet
                const ws = wb.Sheets[wb.SheetNames[0]]
                const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1 })

                // Detect header row: find row containing keywords (substring match)
                const NAME_HDRS    = ["selskab", "producent", "name", "navn", "firma", "company", "virksomhed"]
                const CONTACT_HDRS = ["kontaktperson", "contact name", "kontakt", "contact"]
                const WEB_HDRS     = ["hjemmeside", "website", "url", "web"]
                const PHONE_HDRS   = ["telefon", "phone", "tlf", "mobil", "mobile", "tel"]
                const EMAIL_HDRS   = ["email", "e-mail", "mail"]

                const matchHdr = (cell: string, hdrs: string[]) => hdrs.some(h => cell.includes(h))

                let headerIdx = -1
                let nameCol = -1
                let contactCol = -1
                let webCol = -1
                let phoneCol = -1
                let emailCol = -1

                for (let r = 0; r < Math.min(rows.length, 5); r++) {
                    const row = rows[r].map(c => String(c ?? "").toLowerCase().trim())
                    const ni = row.findIndex(c => matchHdr(c, NAME_HDRS))
                    if (ni !== -1) {
                        headerIdx = r
                        nameCol = ni
                        contactCol = row.findIndex(c => matchHdr(c, CONTACT_HDRS))
                        webCol = row.findIndex(c => matchHdr(c, WEB_HDRS))
                        phoneCol = row.findIndex(c => matchHdr(c, PHONE_HDRS))
                        emailCol = row.findIndex(c => matchHdr(c, EMAIL_HDRS))
                        break
                    }
                }

                const structured: EmployerInput[] = []

                if (headerIdx !== -1) {
                    for (let r = headerIdx + 1; r < rows.length; r++) {
                        const xlsRow = rows[r]
                        const n = String(xlsRow[nameCol] ?? "").trim()
                        if (!n || /^\d+$/.test(n)) continue
                        if (n.includes("Kilde:") || n.includes("·") || n.length > 80) continue
                        structured.push({
                            name: n,
                            contact_name: contactCol !== -1 && xlsRow[contactCol] ? String(xlsRow[contactCol]).trim() : null,
                            contact_phone: phoneCol !== -1 && xlsRow[phoneCol] ? String(xlsRow[phoneCol]).trim() : null,
                            contact_email: emailCol !== -1 && xlsRow[emailCol] ? String(xlsRow[emailCol]).trim() : null,
                            website: webCol !== -1 && xlsRow[webCol] ? String(xlsRow[webCol]).trim() : null,
                        })
                    }
                } else {
                    rows.forEach(xlsRow => {
                        const val = String(xlsRow[0] ?? "").trim()
                        if (val && !/^\d+$/.test(val) && val.length > 1 && val.length < 80) {
                            structured.push({ name: val })
                        }
                    })
                }

                if (!activeGroupName) {
                    toast.error("Vælg en liste først")
                    setMemberUploading(false)
                    return
                }
                const result = await bulkImportToGroup(structured, activeGroupName)
                await loadMembers(activeGroupName)
                setMemberCounts(prev => ({ ...prev, [activeGroupName]: (prev[activeGroupName] ?? 0) + result.inserted }))
                toast.success(`Excel indlæst — ${result.inserted} nye, ${result.updated} opdateret`)
            } else {
                toast.error("Kun Excel-filer (.xlsx/.xls) understøttes")
            }
        } catch (e: any) {
            toast.error(`Fejl: ${e.message}`)
        }
        setMemberUploading(false)
    }

    const runProfSync = async (file: File) => {
        if (!activeGroupName) return
        setProfSyncLoading(true)
        setProfSyncResult(null)
        try {
            const XLSX = await import("xlsx")
            const buf = await file.arrayBuffer()
            const wb = XLSX.read(buf, { type: "array" })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1 })

            const NAME_HDRS = ["selskab", "producent", "name", "navn", "firma", "company", "virksomhed"]
            const matchHdr = (cell: string, hdrs: string[]) => hdrs.some(h => cell.toLowerCase().includes(h))

            let nameCol = -1
            let headerRow = -1
            for (let r = 0; r < Math.min(rows.length, 10); r++) {
                const row = rows[r].map(c => String(c ?? "").toLowerCase().trim())
                const ni = row.findIndex(c => matchHdr(c, NAME_HDRS))
                if (ni !== -1) { nameCol = ni; headerRow = r; break }
            }
            if (nameCol === -1) {
                toast.error("Kunne ikke finde kolonne med selskabsnavne (\"Selskab\", \"Producent\" m.fl.)")
                setProfSyncLoading(false)
                return
            }

            const names: string[] = []
            for (let r = headerRow + 1; r < rows.length; r++) {
                const n = String(rows[r][nameCol] ?? "").trim()
                if (n.length > 1) names.push(n)
            }

            const res = await fetch("/api/prof-sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: names.join("\n"), group: activeGroupName }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? "Fejl")
            setProfSyncResult({ onlyInProf: data.onlyInProf, onlyInDb: data.onlyInDb })
            toast.success(`${names.length} selskaber sammenlignet`)
        } catch (e: any) {
            toast.error(`Synk fejlede: ${e.message}`)
        }
        setProfSyncLoading(false)
    }

    const acceptProfAddition = async (name: string) => {
        if (!activeGroupName) return
        const id = await upsertEmployerInGroup({ name }, activeGroupName)
        if (id) {
            setProfSyncResult(prev => prev ? { ...prev, onlyInProf: prev.onlyInProf.filter(n => n !== name) } : null)
            setMemberCounts(prev => ({ ...prev, [activeGroupName]: (prev[activeGroupName] ?? 0) + 1 }))
            await loadMembers(activeGroupName)
            toast.success(`"${name}" tilføjet`)
        }
    }

    const acceptProfRemoval = async (name: string) => {
        if (!activeGroupName) return
        const member = dbMembers.find(m => m.name.toLowerCase() === name.toLowerCase())
        if (!member) return
        const ok = await removeFromGroup(member.id, activeGroupName)
        if (ok) {
            setProfSyncResult(prev => prev ? { ...prev, onlyInDb: prev.onlyInDb.filter(n => n !== name) } : null)
            setDbMembers(prev => prev.filter(m => m.id !== member.id))
            setMemberCounts(prev => ({ ...prev, [activeGroupName]: Math.max(0, (prev[activeGroupName] ?? 1) - 1) }))
            toast.success(`"${name}" fjernet fra listen`)
        }
    }

    const loadNonMembers = async () => {
        setNonMembersLoading(true)
        const data = await getNonGroupEmployers()
        setNonMembers(data.map(e => ({ id: e.id, name: e.name })))
        setNonMembersLoaded(true)
        setNonMembersLoading(false)
    }

    const addNonMemberToGroup = async (employerId: string, employerName: string, groupName: string) => {
        const ok = await addToGroup(employerId, groupName)
        if (ok) {
            setNonMembers(prev => prev.filter(e => e.id !== employerId))
            setMemberCounts(prev => ({ ...prev, [groupName]: (prev[groupName] ?? 0) + 1 }))
            if (activeGroupName === groupName) await loadMembers(groupName)
            toast.success(`"${employerName}" tilføjet til "${groupName}"`)
        }
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
    const docsReady = !docsLoading
    const memberCount = Object.values(memberCounts).reduce((a, b) => a + b, 0)

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
                {activeGroupName && dbMembers.length > 0 && (
                    <div className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        {activeGroupName}: {dbMembers.length} aktive medlemmer
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
                                            <TableHead></TableHead>
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
                                                <TableCell className="text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 text-xs"
                                                        onClick={() => unarchiveDoc(doc.id)}
                                                    >
                                                        Gendan
                                                    </Button>
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

            {/* ── Section B: Producer lists ────────────────────── */}
            <div className="space-y-4">
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-base font-semibold">B — Producentlister</h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Kun ProF-medlemmer er juridisk bundet af overenskomsten. Opret en liste per overenskomstgruppe — AI-screeningen bruger listerne til at identificere om producenten er medlem.
                        </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={handleCreateGroup}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        Tilføj liste
                    </Button>
                </div>

                {groupsLoading ? (
                    <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Henter lister…
                    </div>
                ) : dbGroupNames.length === 0 && !pendingNewGroup ? (
                    <div className="rounded-lg border-2 border-dashed flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                        <Users className="h-8 w-8 opacity-30" />
                        <p className="text-sm">Ingen lister endnu</p>
                        <Button size="sm" variant="outline" onClick={handleCreateGroup}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Opret første liste
                        </Button>
                    </div>
                ) : (
                    <div className="rounded-lg border overflow-hidden">
                        {/* Group tab bar */}
                        <div className="flex items-center border-b bg-muted/30 px-2 pt-2 gap-0.5 flex-wrap">
                            {dbGroupNames.map(name => (
                                <div
                                    key={name}
                                    className={`group flex items-center gap-1 px-3 py-2 rounded-t-md cursor-pointer text-sm border-b-2 transition-colors ${
                                        name === activeGroupName
                                            ? "border-foreground bg-background font-medium text-foreground"
                                            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                    }`}
                                    onClick={() => { if (editingGroupOldName !== name) switchGroup(name) }}
                                >
                                    {editingGroupOldName === name ? (
                                        <input
                                            autoFocus
                                            className="w-32 text-sm bg-transparent border-b border-foreground outline-none"
                                            value={editingGroupNewName}
                                            onChange={e => setEditingGroupNewName(e.target.value)}
                                            onBlur={commitRename}
                                            onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingGroupOldName(null) }}
                                            onClick={e => e.stopPropagation()}
                                        />
                                    ) : (
                                        <>
                                            <span
                                                onDoubleClick={e => { e.stopPropagation(); setEditingGroupOldName(name); setEditingGroupNewName(name) }}
                                                title="Dobbeltklik for at omdøbe"
                                            >
                                                {name}
                                            </span>
                                            {(memberCounts[name] ?? 0) > 0 && (
                                                <span className="text-[10px] text-muted-foreground ml-0.5">({memberCounts[name]})</span>
                                            )}
                                            <button
                                                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 ml-1 text-muted-foreground hover:text-destructive transition-opacity"
                                                onClick={e => { e.stopPropagation(); handleDeleteGroup(name) }}
                                                title="Slet liste"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            ))}
                            {/* Pending new group input */}
                            {pendingNewGroup !== null && (
                                <div className="flex items-center gap-1 px-2 py-1.5">
                                    <input
                                        autoFocus
                                        className="w-32 text-sm bg-transparent border-b border-foreground outline-none"
                                        value={editingGroupNewName}
                                        onChange={e => setEditingGroupNewName(e.target.value)}
                                        onBlur={commitNewGroup}
                                        onKeyDown={e => { if (e.key === "Enter") commitNewGroup(); if (e.key === "Escape") { setPendingNewGroup(null); setEditingGroupOldName(null) } }}
                                        placeholder="Listenavn…"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Upload + search bar */}
                        {activeGroupName && (
                            <div className="p-4 flex items-center gap-3">
                                <div className="relative flex-1">
                                    <input
                                        type="text"
                                        value={memberSearch}
                                        onChange={e => setMemberSearch(e.target.value)}
                                        placeholder="Søg i listen…"
                                        className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                    {memberSearch && (
                                        <button
                                            onClick={() => setMemberSearch("")}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                                <div
                                    className="flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground cursor-pointer hover:border-muted-foreground/50 transition-colors whitespace-nowrap"
                                    onClick={() => memberFileRef.current?.click()}
                                >
                                    <input
                                        ref={memberFileRef}
                                        type="file"
                                        accept=".xlsx,.xls"
                                        className="hidden"
                                        onChange={e => e.target.files && handleMemberFile(e.target.files)}
                                    />
                                    {memberUploading
                                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                        : <Upload className="h-3.5 w-3.5" />
                                    }
                                    Upload Excel
                                </div>
                                <button
                                    onClick={() => setProfSyncOpen(o => !o)}
                                    className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors whitespace-nowrap"
                                    title="Sammenlign med ProF-hjemmeside"
                                >
                                    <GitCompare className="h-3.5 w-3.5" />
                                    Sammenlign med ProF
                                </button>
                            </div>
                        )}

                        {/* ProF sync panel */}
                        {activeGroupName && profSyncOpen && (
                            <div className="mx-4 mb-4 rounded-lg border bg-muted/30 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-medium">Sammenlign med ProF-liste</p>
                                    <button onClick={() => setProfSyncOpen(false)} className="text-muted-foreground hover:text-foreground">
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Upload en Excel-fil med en kolonne der hedder <strong>"Selskab"</strong> (eller "Producent", "Navn"). Portalen sammenligner den kolonne med din liste.
                                </p>
                                <div
                                    className="rounded-lg border-2 border-dashed p-6 text-center cursor-pointer hover:border-muted-foreground/40 transition-colors"
                                    onClick={() => profSyncFileRef.current?.click()}
                                >
                                    <input
                                        ref={profSyncFileRef}
                                        type="file"
                                        accept=".xlsx,.xls"
                                        className="hidden"
                                        onChange={e => e.target.files?.[0] && runProfSync(e.target.files[0])}
                                    />
                                    {profSyncLoading ? (
                                        <RefreshCw className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                                    ) : (
                                        <>
                                            <Upload className="mx-auto h-5 w-5 text-muted-foreground/50" />
                                            <p className="mt-2 text-sm text-muted-foreground">Klik for at vælge Excel-fil</p>
                                        </>
                                    )}
                                </div>

                                {profSyncResult && (
                                    <div className="space-y-3 pt-1">
                                        {profSyncResult.onlyInProf.length === 0 && profSyncResult.onlyInDb.length === 0 && (
                                            <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
                                                <CheckCircle2 className="h-4 w-4" /> Listen er i overensstemmelse med ProF-hjemmesiden.
                                            </p>
                                        )}

                                        {profSyncResult.onlyInProf.length > 0 && (
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                                        <UserPlus className="h-3.5 w-3.5" />
                                                        På ProF, men ikke i din liste ({profSyncResult.onlyInProf.length})
                                                    </p>
                                                    <button
                                                        onClick={async () => { for (const n of [...profSyncResult.onlyInProf]) await acceptProfAddition(n) }}
                                                        className="text-xs text-emerald-700 dark:text-emerald-400 underline underline-offset-2 hover:no-underline"
                                                    >
                                                        Tilføj alle
                                                    </button>
                                                </div>
                                                <div className="space-y-1">
                                                    {profSyncResult.onlyInProf.map(name => (
                                                        <div key={name} className="flex items-center justify-between rounded bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5">
                                                            <span className="text-xs">{name}</span>
                                                            <button
                                                                onClick={() => acceptProfAddition(name)}
                                                                className="text-xs text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                                                            >
                                                                Tilføj
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {profSyncResult.onlyInDb.length > 0 && (
                                            <div className="space-y-1.5">
                                                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                                    <UserMinus className="h-3.5 w-3.5" />
                                                    I din liste, men ikke på ProF — muligvis udmeldt ({profSyncResult.onlyInDb.length})
                                                </p>
                                                <div className="space-y-1">
                                                    {profSyncResult.onlyInDb.map(name => (
                                                        <div key={name} className="flex items-center justify-between rounded bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5">
                                                            <span className="text-xs">{name}</span>
                                                            <button
                                                                onClick={() => acceptProfRemoval(name)}
                                                                className="text-xs text-amber-700 dark:text-amber-400 font-medium hover:underline"
                                                            >
                                                                Fjern fra liste
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Producer table */}
                        {activeGroupName && (
                            <div className="border-t overflow-x-auto">
                                {membersLoading ? (
                                    <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                        Henter medlemmer…
                                    </div>
                                ) : (
                                    <>
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead
                                                        className="text-xs cursor-pointer select-none hover:text-foreground"
                                                        onClick={() => setMemberSortAsc(prev => prev === true ? false : true)}
                                                    >
                                                        <span className="flex items-center gap-1">
                                                            Selskab
                                                            {memberSortAsc === true && <ChevronUp className="h-3 w-3" />}
                                                            {memberSortAsc === false && <ChevronDown className="h-3 w-3" />}
                                                            {memberSortAsc === null && <ChevronUp className="h-3 w-3 opacity-30" />}
                                                        </span>
                                                    </TableHead>
                                                    <TableHead className="text-xs">Kontaktperson</TableHead>
                                                    <TableHead className="text-xs">Telefon</TableHead>
                                                    <TableHead className="text-xs">Email</TableHead>
                                                    <TableHead className="text-xs">Hjemmeside</TableHead>
                                                    <TableHead className="text-xs">Medlem siden</TableHead>
                                                    <TableHead className="text-xs w-[160px]" />
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {(memberSortAsc === null
                                                    ? dbMembers
                                                    : [...dbMembers].sort((a, b) =>
                                                        memberSortAsc
                                                            ? a.name.localeCompare(b.name, "da")
                                                            : b.name.localeCompare(a.name, "da")
                                                    )
                                                ).filter(m =>
                                                    !memberSearch || m.name.toLowerCase().includes(memberSearch.toLowerCase())
                                                ).map((m, i) => {
                                                    const otherGroups = dbGroupNames.filter(n => n !== activeGroupName)
                                                    return (
                                                        <TableRow key={m.id}>
                                                            <TableCell className="text-xs font-medium">{m.name}</TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">{m.contact_name ?? "—"}</TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">{m.contact_phone ?? "—"}</TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">{m.contact_email ?? "—"}</TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">
                                                                {m.website
                                                                    ? <a href={m.website} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground truncate block max-w-[140px]">{m.website.replace(/^https?:\/\//, "")}</a>
                                                                    : "—"}
                                                            </TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">
                                                                {m.member_since ? new Date(m.member_since).toLocaleDateString("da-DK") : "—"}
                                                            </TableCell>
                                                            <TableCell className="text-xs">
                                                                <div className="flex items-center gap-1 justify-end">
                                                                    {otherGroups.length > 0 && (
                                                                        <Select onValueChange={toName => handleMoveCompany(m.id, activeGroupName, toName)}>
                                                                            <SelectTrigger className="h-6 text-xs w-[110px] px-2">
                                                                                <SelectValue placeholder="Flyt til…" />
                                                                            </SelectTrigger>
                                                                            <SelectContent>
                                                                                {otherGroups.map(gn => (
                                                                                    <SelectItem key={gn} value={gn} className="text-xs">{gn}</SelectItem>
                                                                                ))}
                                                                            </SelectContent>
                                                                        </Select>
                                                                    )}
                                                                    <button
                                                                        onClick={() => handleRemoveCompany(m.id, activeGroupName, m.name)}
                                                                        className="text-muted-foreground hover:text-destructive transition-colors"
                                                                        title="Fjern fra liste"
                                                                    >
                                                                        <X className="h-3.5 w-3.5" />
                                                                    </button>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                                {dbMembers.length === 0 && (
                                                    <TableRow>
                                                        <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">
                                                            Ingen selskaber på listen endnu
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                        {/* Add company row */}
                                        <div className="flex items-center gap-2 px-4 py-2 border-t bg-muted/30">
                                            <input
                                                type="text"
                                                value={addCompanyName}
                                                onChange={e => setAddCompanyName(e.target.value)}
                                                onKeyDown={e => e.key === "Enter" && handleAddCompany()}
                                                placeholder="Tilføj nyt selskab manuelt…"
                                                className="flex-1 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                            />
                                            <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={handleAddCompany} disabled={!addCompanyName.trim()}>
                                                <Plus className="h-3 w-3 mr-1" />
                                                Tilføj
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Non-members panel ────────────────────────────── */}
            <div className="rounded-lg border">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div>
                        <h3 className="text-sm font-medium">Selskaber uden producentforeningsmedlemskab</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Selskaber i databasen der ikke optræder i nogen af producentlisterne ovenfor.
                        </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={loadNonMembers} disabled={nonMembersLoading}>
                        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${nonMembersLoading ? "animate-spin" : ""}`} />
                        {nonMembersLoaded ? "Opdatér" : "Vis ikke-medlemmer"}
                    </Button>
                </div>
                {nonMembersLoaded && (
                    nonMembers.length === 0 ? (
                        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            Alle selskaber i databasen er tilknyttet mindst én producentliste.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[32px] text-xs">#</TableHead>
                                        <TableHead className="text-xs">Selskab</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {nonMembers.map((e, i) => (
                                        <TableRow key={e.id}>
                                            <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                                            <TableCell className="text-xs">{e.name}</TableCell>
                                            <TableCell className="text-xs">
                                                {dbGroupNames.length > 0 && (
                                                    <Select onValueChange={gn => addNonMemberToGroup(e.id, e.name, gn)}>
                                                        <SelectTrigger className="h-6 text-xs w-[120px] px-2">
                                                            <SelectValue placeholder="Tilføj til…" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {dbGroupNames.map(gn => (
                                                                <SelectItem key={gn} value={gn} className="text-xs">{gn}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            <div className="px-4 py-2 text-xs text-muted-foreground border-t">
                                {nonMembers.length} selskab{nonMembers.length !== 1 ? "er" : ""} uden producentforeningsmedlemskab
                            </div>
                        </div>
                    )
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
                        onClick={async () => {
                            if (!orgId) return
                            const saved = await saveLegalNote({
                                org_id: orgId,
                                scope: [],
                                title: "Ny notering",
                                body: "",
                                priority: "fast-regel",
                                active: true,
                                exclude_for_overenskomst: [],
                                sort_order: legalNotes.length,
                            })
                            if (saved) {
                                await loadNotes(orgId)
                                setEditingNoteId(saved.id)
                            }
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
                            // Optimistic local update
                            setLegalNotesState(prev => prev.map(n => n.id === note.id ? { ...n, ...patch } : n))
                        }
                        const saveNote = async (patch: Partial<LegalNote>) => {
                            const dbPatch: any = {}
                            if (patch.title !== undefined) dbPatch.title = patch.title
                            if (patch.text !== undefined) dbPatch.body = patch.text
                            if (patch.priority !== undefined) dbPatch.priority = patch.priority
                            if (patch.excludeForOverenskomst !== undefined)
                                dbPatch.exclude_for_overenskomst = patch.excludeForOverenskomst ? ["alle"] : []
                            await updateDbLegalNote(note.id, dbPatch)
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
                                            onClick={async () => {
                                                const idx = PRIORITY_ORDER.indexOf(note.priority ?? "fast-regel")
                                                const next = PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length]
                                                updateNote({ priority: next })
                                                await saveNote({ priority: next })
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
                                            variant={isEditing ? "default" : "ghost"}
                                            size="icon"
                                            className="h-7 w-7"
                                            title={isEditing ? "Gem ændringer" : "Rediger"}
                                            onClick={async () => {
                                                if (isEditing) {
                                                    try {
                                                        await saveNote({ title: note.title, text: note.text, excludeForOverenskomst: note.excludeForOverenskomst })
                                                        setEditingNoteId(null)
                                                        toast.success("Notering gemt")
                                                    } catch (e: any) {
                                                        toast.error("Kunne ikke gemme — tjek konsollen")
                                                        console.error("[saveNote]", e)
                                                    }
                                                } else {
                                                    setEditingNoteId(note.id)
                                                }
                                            }}
                                        >
                                            {isEditing
                                                ? <Check className="h-3.5 w-3.5" />
                                                : <Pencil className="h-3.5 w-3.5" />}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            title="Slet notering"
                                            onClick={async () => {
                                                await deleteLegalNote(note.id)
                                                setLegalNotesState(prev => prev.filter(n => n.id !== note.id))
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
                                            onChange={async (e) => {
                                                updateNote({ excludeForOverenskomst: e.target.checked })
                                                await saveNote({ excludeForOverenskomst: e.target.checked })
                                            }}
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
                        onClick={async () => {
                            const saved = await saveCaseLearning({
                                org_id: orgId,
                                kontrakttype: "alle",
                                titel: "Ny sagserfaring",
                                regel: "",
                                added_at: new Date().toISOString(),
                            })
                            if (!saved) { toast.error("Kunne ikke oprette sagserfaring"); return }
                            const newLearning: CaseLearning = {
                                id: saved.id,
                                kontrakttype: saved.kontrakttype as CaseLearningKontrakttype,
                                titel: saved.titel,
                                regel: saved.regel,
                                addedAt: saved.added_at,
                            }
                            setCaseLearningsState(prev => [newLearning, ...prev])
                            setEditingLearningId(newLearning.id)
                            // Embed i knowledge base (kræver tekst — sker ved gem)
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
                            setCaseLearningsState(prev => prev.map(l => l.id === learning.id ? { ...l, ...patch } : l))
                        }
                        const saveLearning = async () => {
                            await updateDbCaseLearning(learning.id, {
                                kontrakttype: learning.kontrakttype,
                                titel: learning.titel,
                                regel: learning.regel,
                            })
                            // Embed opdateret sagserfaring i RAG-videnbase
                            if (learning.regel.trim()) {
                                fetch("/api/knowledge/upsert", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        kilde_id: learning.id,
                                        kilde_type: "sagserfaring",
                                        kilde_titel: learning.titel,
                                        tekst: `${learning.titel}: ${learning.regel}`,
                                        org_id: orgId,
                                        metadata: { kontrakttype: learning.kontrakttype },
                                    }),
                                }).catch(e => console.warn("RAG embed fejlede:", e))
                            }
                            setEditingLearningId(null)
                            toast.success("Sagserfaring gemt")
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
                                                    saveLearning()
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
                                            onClick={async () => {
                                                await deleteCaseLearning(learning.id)
                                                // Fjern fra RAG-videnbase
                                                fetch("/api/knowledge/upsert", {
                                                    method: "DELETE",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({ kilde_id: learning.id }),
                                                }).catch(() => {})
                                                setCaseLearningsState(prev => prev.filter(l => l.id !== learning.id))
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
