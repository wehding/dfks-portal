
"use client"

import { useState, useEffect, type ChangeEvent } from "react"
import { Lock, Heart, User, Save, Info, Loader2, Plus, X, RefreshCw, Film, Upload } from "lucide-react"
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
import { useI18n } from "@/lib/i18n"

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
    portrait_url: string | null
}

export default function MinProfilPage() {
    const { locale, t } = useI18n()
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
    const [matchAlternativeName, setMatchAlternativeName] = useState("")
    const [selectedPortraitUrl, setSelectedPortraitUrl] = useState<string | null>(null)
    const [uploadingPortrait, setUploadingPortrait] = useState(false)

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
                .select("id, full_name, email, phone, address, cpr_no, created_at, alternative_names, portrait_url")
                .eq("user_id", user.id)
                .single()

            // Fallback: slå op via email
            if (!rh && user.email) {
                const res = await supabase
                    .from("rettighedshavere")
                    .select("id, full_name, email, phone, address, cpr_no, created_at, alternative_names, portrait_url")
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
                    portrait_url: rh.portrait_url ?? null,
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
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Fejl ved gem")
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
        setSelectedPortraitUrl(candidates.find(candidate => candidate.imageUrl)?.imageUrl ?? profile?.portrait_url ?? null)
        if (!result.success) setPersonError(result.error ?? "Kunne ikke søge efter navneprofiler.")
        setPersonSearching(false)
    }

    const confirmPersonMatch = async () => {
        const selected = Object.entries(selectedPeople).filter(([, active]) => active).map(([key]) => personCandidates.find(candidate => candidate.key === key)).filter((candidate): candidate is PersonCandidate => Boolean(candidate))
        if (personCandidates.length > 0 && selected.length === 0) { setPersonError("Vælg mindst én navneprofil."); return }
        const result = await confirmExternalPersonIdentity(selected, name || profile?.full_name || "", altNavne, selectedPortraitUrl)
        if (!result.success) { setPersonError(result.error ?? "Personmatch kunne ikke gemmes."); return }
        if (result.portraitUrl || selectedPortraitUrl) setProfile(current => current ? { ...current, portrait_url: result.portraitUrl ?? selectedPortraitUrl } : current)
        setPersonMatchOpen(false)
        setCreditSearchOpen(true)
    }

    const addMatchAlternativeName = async () => {
        const value = matchAlternativeName.trim()
        if (!value || altNavne.some(item => item.localeCompare(value, "da-DK", { sensitivity: "base" }) === 0)) return
        const nextNames = [...altNavne, value]
        setAltNavne(nextNames)
        setMatchAlternativeName("")
        setPersonSearching(true)
        const result = await discoverPersonCandidates(value, nextNames)
        const candidates = result.success ? result.candidates : []
        setPersonCandidates(current => Array.from(new Map([...current, ...candidates].map(candidate => [candidate.key, candidate])).values()).sort((a, b) => b.score - a.score))
        setSelectedPeople(current => ({ ...current, ...Object.fromEntries(candidates.filter(candidate => candidate.score >= 0.78).map(candidate => [candidate.key, true])) }))
        if (!selectedPortraitUrl) setSelectedPortraitUrl(candidates.find(candidate => candidate.imageUrl)?.imageUrl ?? null)
        if (!result.success) setPersonError(result.error ?? "Kunne ikke søge efter navneprofiler.")
        setPersonSearching(false)
    }

    const handlePortraitUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ""
        if (!file || !profile) return
        setUploadingPortrait(true)
        const supabase = createClient()
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Du skal være logget ind for at uploade billede.")
            const extension = file.name.split(".").pop()?.toLowerCase() || "jpg"
            const path = `${user.id}/${Date.now()}.${extension}`
            const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: false })
            if (uploadError) throw new Error(uploadError.message)
            const { data } = supabase.storage.from("avatars").getPublicUrl(path)
            const publicUrl = data.publicUrl
            const { error } = await supabase.from("rettighedshavere").update({ portrait_url: publicUrl }).eq("id", profile.id)
            if (error) throw new Error(error.message)
            setProfile(current => current ? { ...current, portrait_url: publicUrl } : current)
            toast.success("Profilbillede opdateret")
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "Profilbilledet kunne ikke uploades")
        } finally {
            setUploadingPortrait(false)
        }
    }

    const portraitOptions = Array.from(
        new Map(
            personCandidates
                .filter(candidate => selectedPeople[candidate.key])
                .flatMap(candidate => (candidate.portraitUrls?.length ? candidate.portraitUrls : candidate.imageUrl ? [candidate.imageUrl] : []).map(url => [url, candidate] as const))
        ).entries()
    )

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
                title={t("profile.title")}
                subtitle={t("profile.subtitle")}
            />

            <section className="rounded-lg border">
                <div className="flex items-center gap-2 border-b px-5 py-4">
                    <Film className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-medium">{t("profile.findMissingWorks")}</h2>
                </div>
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">{t("profile.findMissingWorksIntro")}</p>
                    <Button type="button" variant="outline" onClick={openPersonSearch} className="shrink-0 gap-2">
                        <RefreshCw className="h-4 w-4" /> {t("profile.searchNewTitles")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={openPersonSearch} className="shrink-0">{t("profile.editPersonMatch")}</Button>
                </div>
            </section>

            {/* Personoplysninger */}
            <section className="rounded-lg border">
                <div className="flex items-center gap-2 px-5 py-4 border-b">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-medium">{t("profile.personalInfo")}</h2>
                </div>
                <div className="p-5 space-y-4">
                    <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center">
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-background">
                            {profile?.portrait_url ? (
                                <img src={profile.portrait_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <User className="h-8 w-8 text-muted-foreground" />
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="font-medium">{t("profile.portrait")}</div>
                            <p className="text-sm text-muted-foreground">{t("profile.portraitText")}</p>
                        </div>
                        <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
                            {uploadingPortrait ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            {t("profile.changePicture")}
                            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handlePortraitUpload} disabled={uploadingPortrait} />
                        </label>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>{t("profile.name")}</Label>
                            <Input value={name} onChange={e => setName(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="flex items-center gap-1.5">
                                {t("profile.cpr")}
                                <Lock className="h-3 w-3 text-muted-foreground" />
                            </Label>
                            <Input
                                value={profile?.cpr_no ? `${profile.cpr_no.slice(0, 6)}-****` : "—"}
                                disabled
                                className="bg-muted/50 text-muted-foreground"
                            />
                            <p className="text-[11px] text-muted-foreground">{t("profile.contactAdminForCpr")}</p>
                        </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>{t("profile.email")}</Label>
                            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t("profile.phone")}</Label>
                            <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+45 XX XX XX XX" />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>{t("profile.address")}</Label>
                        <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Vejnavn og husnummer, postnummer, by" />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                        <div>
                            <Label>{t("profile.alternativeNames")}</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {t("profile.alternativeNamesIntro")}
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
                                    placeholder={t("profile.altNamePlaceholder")}
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
                                    title={t("common.add")}
                                >
                                    <Plus className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {profile && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Badge variant={profile.is_member ? "default" : "secondary"} className="text-[10px] font-normal">
                                {profile.is_member ? t("profile.activeMember") : t("profile.nonMember")}
                            </Badge>
                            {profile.member_no && (
                                <Badge variant="outline" className="text-[10px] font-normal">
                                    {t("profile.memberNo").replace("{number}", profile.member_no)}
                                </Badge>
                            )}
                            {profile.valid_from && (
                                <Badge variant="outline" className="text-[10px] font-normal">
                                    {t("profile.memberSince").replace("{date}", new Date(profile.valid_from).toLocaleDateString(locale === "da" ? "da-DK" : "en-US", { year: "numeric", month: "long" }))}
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
                    <h2 className="font-medium">{t("profile.inheritanceContact")}</h2>
                </div>
                <div className="p-5 space-y-4">
                    <div className="flex gap-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3.5 py-3 text-xs text-amber-800 dark:text-amber-300">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <p>
                            {t("profile.inheritanceIntro")}
                        </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>{t("profile.name")}</Label>
                            <Input value={kinName} onChange={e => setKinName(e.target.value)} placeholder={t("profile.fullNamePlaceholder")} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t("profile.relation")}</Label>
                            <Input value={kinRelation} onChange={e => setKinRelation(e.target.value)} placeholder={t("profile.relationPlaceholder")} />
                        </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>{t("profile.phone")}</Label>
                            <Input type="tel" value={kinPhone} onChange={e => setKinPhone(e.target.value)} placeholder="+45 XX XX XX XX" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t("profile.email")}</Label>
                            <Input type="email" value={kinEmail} onChange={e => setKinEmail(e.target.value)} placeholder={t("profile.contactEmailPlaceholder")} />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>{t("profile.notesOptional")}</Label>
                        <Input value={kinNotes} onChange={e => setKinNotes(e.target.value)} placeholder={t("profile.notesPlaceholder")} />
                    </div>
                </div>
            </section>

            <Separator />

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t("profile.saveChanges")}
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
                    <DialogHeader><DialogTitle>{t("profile.personProfilesTitle")}</DialogTitle></DialogHeader>
                    <p className="text-sm text-muted-foreground">{t("profile.personProfilesIntro")}</p>
                    <div className="space-y-2 rounded-md border bg-muted/30 p-3"><div><Label>{t("profile.alternativeNames")}</Label><p className="text-xs text-muted-foreground">{t("profile.alternativeNamesIntro")}</p></div><div className="flex gap-2"><Input value={matchAlternativeName} onChange={event => setMatchAlternativeName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addMatchAlternativeName() } }} placeholder={t("profile.addNameVariant")} /><Button type="button" variant="outline" onClick={() => void addMatchAlternativeName()} disabled={!matchAlternativeName.trim() || personSearching}>{t("profile.addAndSearch")}</Button></div></div>
                    <PersonIdentityPicker candidates={personCandidates} selected={selectedPeople} loading={personSearching} error={personError} onSelect={candidate => { setSelectedPeople(current => ({ ...current, [candidate.key]: !current[candidate.key] })); setPersonError(null) }} />
                    {portraitOptions.length > 1 && (
                        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                            <Label>{t("profile.choosePortrait")}</Label>
                            <div className="flex flex-wrap gap-2">
                                {portraitOptions.map(([url, candidate]) => (
                                    <button
                                        key={url}
                                        type="button"
                                        onClick={() => setSelectedPortraitUrl(url)}
                                        className={`flex items-center gap-2 rounded-md border bg-background p-2 text-left text-xs ${selectedPortraitUrl === url ? "border-foreground ring-1 ring-foreground" : ""}`}
                                    >
                                        <img src={url} alt="" className="h-12 w-10 rounded object-cover" />
                                        <span className="font-medium">{candidate.source.toUpperCase()}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <DialogFooter><Button variant="outline" onClick={() => setPersonMatchOpen(false)}>{t("common.cancel")}</Button><Button onClick={confirmPersonMatch} disabled={personSearching}>{t("profile.confirmAndFindWorks")}</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
