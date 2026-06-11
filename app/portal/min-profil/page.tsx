
"use client"

import { useState, useEffect } from "react"
import { Lock, Heart, User, Save, Info, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"

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
}

export default function MinProfilPage() {
    const [profile, setProfile] = useState<ProfileData | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Editable fields
    const [name, setName]     = useState("")
    const [email, setEmail]   = useState("")
    const [phone, setPhone]   = useState("")
    const [address, setAddress] = useState("")

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
                .select("id, full_name, email, phone, address, cpr_no, created_at")
                .eq("user_id", user.id)
                .single()

            // Fallback: slå op via email
            if (!rh && user.email) {
                const res = await supabase
                    .from("rettighedshavere")
                    .select("id, full_name, email, phone, address, cpr_no, created_at")
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
                }
                setProfile(profileData)
                setName(rh.full_name)
                setEmail(rh.email ?? "")
                setPhone(rh.phone ?? "")
                setAddress(rh.address ?? "")
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
                .update({ full_name: name, email, phone, address })
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
        </div>
    )
}
