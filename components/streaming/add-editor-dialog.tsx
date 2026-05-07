"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Search, UserCheck, UserPlus, X, Mail } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────

interface ExistingUser {
    id: string
    name: string
    email: string
    cprMasked?: string
}

interface AddEditorDialogProps {
    open: boolean
    onClose: () => void
    productionTitle: string
    isSeries: boolean
    onAdd: (editor: {
        userId?: string
        name: string
        email?: string
        cprNumber?: string      // Kun ved ny bruger — gemmes krypteret
        episodes?: string
        createUser: boolean
    }) => void
}

// ── Mock brugere ──────────────────────────────────────────────

const mockUsers: ExistingUser[] = [
    { id: "u1", name: "Lars Wissing", email: "lars@wissing.dk", cprMasked: "280282-****" },
    { id: "u2", name: "Michael Bauer", email: "michael@bauer.dk", cprMasked: "240183-****" },
    { id: "u3", name: "Anders Hoffmann", email: "anders@hoffmann.dk", cprMasked: "060772-****" },
    { id: "u4", name: "Anja Farsig", email: "anja@farsig.dk", cprMasked: "091171-****" },
    { id: "u5", name: "Benjamin Binderup", email: "benjamin@binderup.dk", cprMasked: "150390-****" },
    { id: "u6", name: "Janus Billeskov Jansen", email: "janus@billeskov.dk", cprMasked: "251151-****" },
]

// ── Helpers ──────────────────────────────────────────────────

function formatCprInput(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 10)
    if (digits.length > 6) return `${digits.slice(0, 6)}-${digits.slice(6)}`
    return digits
}

function initials(name: string): string {
    return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
}

// ── Component ────────────────────────────────────────────────

type Step = "search" | "confirm-existing" | "create-new"

export function AddEditorDialog({
    open, onClose, productionTitle, isSeries, onAdd
}: AddEditorDialogProps) {
    const [step, setStep] = useState<Step>("search")
    const [query, setQuery] = useState("")
    const [selectedUser, setSelectedUser] = useState<ExistingUser | null>(null)
    const [newName, setNewName] = useState("")
    const [newEmail, setNewEmail] = useState("")
    const [newCpr, setNewCpr] = useState("")
    const [episodes, setEpisodes] = useState("")

    const results = query.length >= 2
        ? mockUsers.filter(u =>
            u.name.toLowerCase().includes(query.toLowerCase()) ||
            u.email.toLowerCase().includes(query.toLowerCase())
        )
        : []

    const noResults = query.length >= 2 && results.length === 0

    function handleSelectUser(user: ExistingUser) {
        setSelectedUser(user)
        setStep("confirm-existing")
    }

    function handleCreateNew() {
        setNewName(query.length >= 2 ? query : "")
        setStep("create-new")
    }

    function handleSubmitExisting() {
        if (!selectedUser) return
        onAdd({
            userId: selectedUser.id,
            name: selectedUser.name,
            email: selectedUser.email,
            episodes: episodes.trim() || undefined,
            createUser: false,
        })
        reset()
        onClose()
    }

    function handleSubmitNew() {
        if (!newName.trim()) return
        onAdd({
            name: newName.trim(),
            email: newEmail.trim() || undefined,
            cprNumber: newCpr.replace(/\D/g, "") || undefined,
            episodes: episodes.trim() || undefined,
            createUser: true,
        })
        reset()
        onClose()
    }

    function reset() {
        setStep("search")
        setQuery("")
        setSelectedUser(null)
        setNewName("")
        setNewEmail("")
        setNewCpr("")
        setEpisodes("")
    }

    function handleClose() { reset(); onClose() }

    // Fælles episode + kontrakt felter
    const SharedFields = () => (
        <>
            {isSeries && (
                <div className="space-y-1.5">
                    <Label htmlFor="episodes">
                        Episoder <span className="text-muted-foreground font-normal">(valgfri)</span>
                    </Label>
                    <Input
                        id="episodes"
                        placeholder="1, 3, 5"
                        value={episodes}
                        onChange={e => setEpisodes(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Adskil episodenumre med komma</p>
                </div>
            )}
        
        </>
    )

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Tilføj klipper</DialogTitle>
                    <p className="text-sm text-muted-foreground">{productionTitle}</p>
                </DialogHeader>

                {/* ── Søg ── */}
                {step === "search" && (
                    <>
                        <div className="space-y-4 py-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="query">Søg i eksisterende brugere</Label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="query"
                                        placeholder="Navn eller email..."
                                        value={query}
                                        onChange={e => setQuery(e.target.value)}
                                        className="pl-9"
                                        autoFocus
                                    />
                                </div>
                            </div>

                            {results.length > 0 && (
                                <div className="rounded-md border divide-y">
                                    {results.map(user => (
                                        <button
                                            key={user.id}
                                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left"
                                            onClick={() => handleSelectUser(user)}
                                        >
                                            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">
                                                {initials(user.name)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{user.name}</p>
                                                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                                            </div>
                                            <UserCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                                        </button>
                                    ))}
                                </div>
                            )}

                            {noResults && (
                                <div className="rounded-md border border-dashed p-4 text-center space-y-2">
                                    <p className="text-sm text-muted-foreground">
                                        Ingen bruger fundet med &quot;{query}&quot;
                                    </p>
                                    <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCreateNew}>
                                        <UserPlus className="h-3.5 w-3.5" />
                                        Opret som ny bruger
                                    </Button>
                                </div>
                            )}

                            {query.length === 0 && (
                                <p className="text-xs text-center text-muted-foreground">
                                    Skriv mindst 2 tegn for at søge
                                </p>
                            )}
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={handleClose}>Annuller</Button>
                            {query.length >= 2 && (
                                <Button variant="outline" className="gap-1.5" onClick={handleCreateNew}>
                                    <UserPlus className="h-3.5 w-3.5" />
                                    Opret ny i stedet
                                </Button>
                            )}
                        </DialogFooter>
                    </>
                )}

                {/* ── Bekræft eksisterende ── */}
                {step === "confirm-existing" && selectedUser && (
                    <>
                        <div className="space-y-4 py-2">
                            <div className="rounded-md border bg-muted/30 p-3 flex items-center gap-3">
                                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-sm font-medium shrink-0">
                                    {initials(selectedUser.name)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium">{selectedUser.name}</p>
                                    <p className="text-xs text-muted-foreground">{selectedUser.email}</p>
                                    {selectedUser.cprMasked && (
                                        <p className="text-xs text-muted-foreground font-mono">{selectedUser.cprMasked}</p>
                                    )}
                                </div>
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setStep("search")}>
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                            <Separator />
                            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                                <p className="font-medium">Kontraktdokumentation</p>
                                <p>Systemet tjekker automatisk om klipperen har en valideret kontrakt for denne produktion i arkivet. Mangler den, vil klipperen blive bedt om at uploade den på sin brugerside.</p>
                            </div>
                            <SharedFields />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setStep("search")}>Tilbage</Button>
                            <Button onClick={handleSubmitExisting}>Tilføj klipper</Button>
                        </DialogFooter>
                    </>
                )}

                {/* ── Opret ny ── */}
                {step === "create-new" && (
                    <>
                        <div className="space-y-4 py-2">
                            <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                                <Mail className="h-3.5 w-3.5 shrink-0" />
                                Klipperen oprettes som bruger og modtager en invitations-email
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="newName">
                                    Navn <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    id="newName"
                                    placeholder="Fulde navn"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="newEmail">
                                    Email <span className="text-muted-foreground font-normal">(til invitation)</span>
                                </Label>
                                <Input
                                    id="newEmail"
                                    type="email"
                                    placeholder="navn@eksempel.dk"
                                    value={newEmail}
                                    onChange={e => setNewEmail(e.target.value)}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="newCpr">
                                    CPR-nummer <span className="text-muted-foreground font-normal">(til NemKonto-udbetaling)</span>
                                </Label>
                                <Input
                                    id="newCpr"
                                    placeholder="010185-1234"
                                    value={newCpr}
                                    onChange={e => setNewCpr(formatCprInput(e.target.value))}
                                    maxLength={11}
                                    className="font-mono"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Gemmes krypteret — vises kun maskeret efterfølgende
                                </p>
                            </div>

                            {isSeries && (
                                <div className="space-y-1.5">
                                    <Label htmlFor="newEpisodes">
                                        Episoder <span className="text-muted-foreground font-normal">(valgfri)</span>
                                    </Label>
                                    <Input
                                        id="newEpisodes"
                                        placeholder="1, 3, 5"
                                        value={episodes}
                                        onChange={e => setEpisodes(e.target.value)}
                                    />
                                    <p className="text-xs text-muted-foreground">Adskil episodenumre med komma</p>
                                </div>
                            )}

                            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                                <p className="font-medium">Kontraktdokumentation</p>
                                <p>Klipperen vil blive bedt om at uploade sin kontrakt på sin brugerside som dokumentation for bevarede rettigheder.</p>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setStep("search")}>Tilbage</Button>
                            <Button onClick={handleSubmitNew} disabled={!newName.trim()}>
                                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                                Opret og tilføj
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
