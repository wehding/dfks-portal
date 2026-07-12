
"use client"

import { useState, useEffect } from "react"
import { Lock, Heart, User, Save, Info, Loader2, Plus, X, RefreshCw, Film } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { DfiImportWizard } from "@/app/portal/mine-vaerker/components/DfiImportWizard"
import { confirmExternalPersonIdentity, discoverPersonCandidates, type PersonCandidate } from "@/app/actions/person-discovery"
import { PersonIdentityPicker } from "@/components/works/person-identity-picker"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface ProfileData {
    id: string
    full_name: string
    email: string | null
    phone: string | null
    address: string | null
    cpr_no: string | null
    created_at: string
    is_member: boolean
    member_no: string | null
    valid_from: string | null
    alternative_names: string[]
}

export default function MinProfilPage() {
    const router = useRouter()
    const [profile, setProfile] = useState<ProfileData | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [creditSearchOpen, setCreditSearchOpen] = useState(false)
    const [personMatchOpen, setPersonMatchOpen] = useState(false)
    const [personCandidates, setPersonCandidates] = useState<PersonCandidate[]>([])
    const [selectedPeople, setSelectedPeople] = useState<Record<string, boolean>>({})
    const [personSearching, setPersonSearching] = useState(false)
    const [personError, setPersonError] = useState<string | null>(null)

    // Editable fields
    const [name, setName]         = useState("")
    const [email, setEmail]       = useState("")
    const [phone, setPhone]       = useState("")
    const [address, setAddress]   = useState("")
    const [altNavne, setAltNavne] = useState<string[]>([])
    const [nytAltNavn, setNytAltNavn] = useState("")

    // Arvekontakt (stored in user_metadata — ingen DB-tabel endnu)
    const [kinName, setKinName]         = useState("")
    const [kinRelation, setKinRelation] = useState("")
    const [kinPhone, setKinPhone]       = useState("")
    const [kinEmail, setKinEmail]       = useState("")
    const [kinNotes, setKinNotes]       = useState("")

    useEffect(() => {
        const load = async () => {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { setLoading(false); return }

            // Slå op via user_id
            let { data: rh } = await supabase
                .from("rettighedshavere")
                .select("id, full_name, email, phone, address, cpr_no, created_at, alternative_names")
                .eq("user_id", user.id)
                .single()

            // Fallback: slå op via email
            if (!rh && user.email) {
                const res = await supabase
                    .from("rettighedshavere")
                    .select("id, full_name, email, phone, address, cpr_no, created_at, alternative_names")
                    .eq("email", user.email)
                    .single()
                rh = res.data
            }

            if (rh) {
                // Hent org-affiliation
                const { data: aff } = await supabase
                    .from("org_affiliations")
                    .select("is_member, member_no, valid_from")
                    .eq("rights_holder_id", rh.id)
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .single()

                const profileData: ProfileData = {
                    ...rh,
                    is_member: aff?.is_member ?? false,
                    member_no: aff?.member_no ?? null,
                    valid_from: aff?.valid_from ?? null,
                    alternative_names: rh.alternative_names ?? [],
                }
                setProfile(profileData)
                setName(rh.full_name)
                setEmail(rh.email ?? "")
                setPhone(rh.phone ?? "")
                setAddress(rh.address ?? "")
                setAltNavne(rh.alternative_names ?? [])
            }

            // Arvekontakt fra user_metadata
            const kin = user.user_metadata?.next_of_kin ?? {}
            setKinName(kin.name ?? "")
            setKinRelation(kin.relation ?? "")
            setKinPhone(kin.phone ?? "")
            setKinEmail(kin.email ?? "")
            setKinNotes(kin.notes ?? "")

            setLoading(false)
        }
        load()
    }, [])

    const handleSave = async () => {
        if (!profile) return
        setSaving(true)
        const supabase = createClient()
        try {
            // Opdater rettighedshaver
            const { error } = await supabase
                .from("rettighedshavere")
                .update({ full_name: name, email, phone, address, alternative_names: altNavne })
                .eq("id", profile.id)
            if (error) throw new Error(error.message)

            // Gem arvekontakt i user_metadata
            await supabase.auth.updateUser({
                data: {
                    next_of_kin: {
                        name: kinName, relation: kinRelation,
                        phone: kinPhone, email: kinEmail, notes: kinNotes,
                    }
                }
            })

            toast.success("Dine oplysninger er gemt")
        } catch (e: any) {
            toast.error(e.message ?? "Fejl ved gem")
        } finally {
            setSaving(false)
        }
    }

    const openPersonSearch = async () => {
        setPersonMatchOpen(true)
        setPersonSearching(true)
        setPersonError(null)
        setSelectedPeople({})
        const result = await discoverPersonCandidates(name || profile?.full_name || "", altNavne)
        const candidates = result.success ? result.candidates : []
        setPersonCandidates(candidates)
        setSelectedPeople(Object.fromEntries(candidates.filter(candidate => candidate.score >= 0.78).map(candidate => [candidate.key, true])))
        if (!result.success) setPersonError(result.error ?? "Kunne ikke søge efter navneprofiler.")
        setPersonSearching(false)
    }

    const confirmPersonMatch = async () => {
        const selected = Object.entries(selectedPeople).filter(([, active]) => active).map(([key]) => personCandidates.find(candidate => candidate.key === key)).filter((candidate): candidate is PersonCandidate => Boolean(candidate))
        if (personCandidates.length > 0 && selected.length === 0) { setPersonError("Vælg mindst én navneprofil."); return }
        const result = await confirmExternalPersonIdentity(selected, name || profile?.full_name || "")
        if (!result.success) { setPersonError(result.error ?? "Personmatch kunne ikke gemmes."); return }
        setPersonMatchOpen(false)
        setCreditSearchOpen(true)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-8 max-w-2xl">
            <PageHeader
                title="Min profil"
                subtitle="Ret dine personlige oplysninger og kontaktdata"
            />

            <section className="rounded-lg border">
                <div className="flex items-center gap-2 border-b px-5 py-4">
                    <Film className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-medium">Find manglende værker</h2>
                </div>
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">Søg efter produktioner, hvor du er krediteret, men som endnu ikke findes under Mine værker.</p>
                    <Button type="button" variant="outline" onClick={openPersonSearch} className="shrink-0 gap-2">
                        <RefreshCw className="h-4 w-4" /> Søg nye titler på dit navn
                    </Button>
                    <Button type="button" variant="ghost" onClick={openPersonSearch} className="shrink-0">Ret personmatch</Button>
                </div>
            </section>

            {/* Personoplysninger */}
            <section className="rounded-lg border">
                <div className="flex items-center gap-2 px-5 py-4 border-b">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-medium">Personoplysninger</h2>
                </div>
                <div className="p-5 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>Navn</Label>
                            <Input value={name} onChange={e => setName(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="flex items-center gap-1.5">
                                CPR-nummer
                                <Lock className="h-3 w-3 text-muted-foreground" />
                            </Label>
                            <Input
                                value={profile?.cpr_no ? `${profile.cpr_no.slice(0, 6)}-****` : "—"}
                                disabled
                                className="bg-muted/50 text-muted-foreground"
                            />
                            <p className="text-[11px] text-muted-foreground">Kontakt DFKS for at ændre CPR-nummer</p>
                        </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>E-mail</Label>
                            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Telefon</Label>
                            <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+45 XX XX XX XX" />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Adresse</Label>
                        <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Vejnavn og husnummer, postnummer, by" />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                        <div>
                            <Label>Alternative navne</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Fx tidligere navn, kunstnernavn eller forkortede versioner. Bruges til at genkende dig i kontrakter og sikre korrekt kreditering.
                            </p>
                        </div>
                        <div className="space-y-2">
                            {altNavne.map((navn, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <Input
                                        value={navn}
                                        onChange={e => {
                                            const ny = [...altNavne]
                                            ny[i] = e.target.value
                                            setAltNavne(ny)
                                        }}
                                        className="h-8 text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setAltNavne(altNavne.filter((_, j) => j !== i))}
                                        className="text-muted-foreground hover:text-destructive transition-colors"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                            <div className="flex items-center gap-2">
                                <Input
                                    value={nytAltNavn}
                                    onChange={e => setNytAltNavn(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter" && nytAltNavn.trim()) {
                                            e.preventDefault()
                                            setAltNavne([...altNavne, nytAltNavn.trim()])
                                            setNytAltNavn("")
                                        }
                                    }}
                                    placeholder="Tilføj alternativt navn..."
                                    className="h-8 text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (nytAltNavn.trim()) {
                                            setAltNavne([...altNavne, nytAltNavn.trim()])
                                            setNytAltNavn("")
                                        }
                                    }}
                                    className="text-muted-foreground hover:text-primary transition-colors"
                                    title="Tilføj"
                                >
                                    <Plus className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {profile && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Badge variant={profile.is_member ? "default" : "secondary"} className="text-[10px] font-normal">
                                {profile.is_member ? "Aktivt medlem" : "Ikke-medlem"}
                            </Badge>
                            {profile.member_no && (
                                <Badge variant="outline" className="text-[10px] font-normal">
                                    Medlemsnr. {profile.member_no}
                                </Badge>
                            )}
                            {profile.valid_from && (
                                <Badge variant="outline" className="text-[10px] font-normal">
                                    Medlem siden {new Date(profile.valid_from).toLocaleDateString("da-DK", { year: "numeric", month: "long" })}
                                </Badge>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* Arvekontakt */}
            <section className="rounded-lg border border-amber-200 dark:border-amber-900">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-amber-200 dark:border-amber-900">
                    <Heart className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <h2 className="font-medium">Kontakt i forbindelse med arv</h2>
                </div>
                <div className="p-5 space-y-4">
                    <div className="flex gap-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3.5 py-3 text-xs text-amber-800 dark:text-amber-300">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <p>
                            Rettigheder til vederlag fra DFKS er <strong>arvelige</strong>. Vi anbefaler at du registrerer en kontaktperson, så vi kan tage kontakt til dine nærmeste og sikre at rettigheder videregives korrekt.
                        </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>Navn</Label>
                            <Input value={kinName} onChange={e => setKinName(e.target.value)} placeholder="Fulde navn" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Relation</Label>
                            <Input value={kinRelation} onChange={e => setKinRelation(e.target.value)} placeholder="f.eks. Ægtefælle, Barn, Søskende" />
                        </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>Telefon</Label>
                            <Input type="tel" value={kinPhone} onChange={e => setKinPhone(e.target.value)} placeholder="+45 XX XX XX XX" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>E-mail</Label>
                            <Input type="email" value={kinEmail} onChange={e => setKinEmail(e.target.value)} placeholder="kontakt@eksempel.dk" />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Noter (valgfrit)</Label>
                        <Input value={kinNotes} onChange={e => setKinNotes(e.target.value)} placeholder="f.eks. advokat, notarforhold, særlige ønsker" />
                    </div>
                </div>
            </section>

            <Separator />

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Gem ændringer
                </Button>
            </div>

            <DfiImportWizard
                isOpen={creditSearchOpen}
                onClose={() => setCreditSearchOpen(false)}
                userName={profile?.full_name ?? name}
                dfiPersonId={null}
                onImportComplete={(message, success) => {
                    if (success) toast.success(message)
                    else toast.error(message)
                    if (success) setCreditSearchOpen(false)
                }}
                reloadAssignments={async () => { router.refresh() }}
            />
            <Dialog open={personMatchOpen} onOpenChange={setPersonMatchOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader><DialogTitle>Vælg de navneprofiler, der er dig</DialogTitle></DialogHeader>
                    <p className="text-sm text-muted-foreground">Søgningen inkluderer stavevarianter, manglende mellemnavne og initialer. Du kan vælge flere profiler fra samme database. De tekniske ID&apos;er gemmes skjult.</p>
                    <PersonIdentityPicker candidates={personCandidates} selected={selectedPeople} loading={personSearching} error={personError} onSelect={candidate => { setSelectedPeople(current => ({ ...current, [candidate.key]: !current[candidate.key] })); setPersonError(null) }} />
                    <DialogFooter><Button variant="outline" onClick={() => setPersonMatchOpen(false)}>Annuller</Button><Button onClick={confirmPersonMatch} disabled={personSearching}>Bekræft og find værker</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
