"use client"

import { useState } from "react"
import { Lock, Heart, CreditCard, User, Save, Info } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { mockUsers } from "@/lib/mock-data"
import type { NextOfKin, BankAccount, UserAddress } from "@/lib/types"

// Simulér indlogget bruger
const currentUser = mockUsers[0]

export default function MinProfilPage() {
    // Personoplysninger
    const [name, setName] = useState(currentUser.name)
    const [email, setEmail] = useState(currentUser.email)
    const [phone, setPhone] = useState(currentUser.phone ?? "")
    const [address, setAddress] = useState<UserAddress>(
        currentUser.address ?? { street: "", postalCode: "", city: "" }
    )

    // Bankoplysninger
    const [bank, setBank] = useState<BankAccount>(
        currentUser.bankAccount ?? { registrationNumber: "", accountNumber: "" }
    )

    // Arvekontakt
    const [kin, setKin] = useState<NextOfKin>(
        currentUser.nextOfKin ?? { name: "", relation: "", phone: "", email: "", notes: "" }
    )

    const handleSave = () => {
        // TODO: gem via Supabase
        toast.success("Dine oplysninger er gemt")
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
                            <Input value={currentUser.cprNumber ?? "—"} disabled className="bg-muted/50 text-muted-foreground" />
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
                        <Input value={address.street} onChange={e => setAddress(a => ({ ...a, street: e.target.value }))} placeholder="Vejnavn og husnummer" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-1.5">
                            <Label>Postnummer</Label>
                            <Input value={address.postalCode} onChange={e => setAddress(a => ({ ...a, postalCode: e.target.value }))} placeholder="0000" />
                        </div>
                        <div className="sm:col-span-2 space-y-1.5">
                            <Label>By</Label>
                            <Input value={address.city} onChange={e => setAddress(a => ({ ...a, city: e.target.value }))} placeholder="By" />
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] font-normal">
                            Medlem siden {new Date(currentUser.memberSince).toLocaleDateString("da-DK", { year: "numeric", month: "long" })}
                        </Badge>
                    </div>
                </div>
            </section>

            {/* Bankoplysninger */}
            <section className="rounded-lg border">
                <div className="flex items-center gap-2 px-5 py-4 border-b">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-medium">Bankoplysninger</h2>
                </div>
                <div className="p-5 space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Bruges til udbetaling af rettighedsvederlag fra DFKS.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-1.5">
                            <Label>Reg.nr.</Label>
                            <Input
                                value={bank.registrationNumber}
                                onChange={e => setBank(b => ({ ...b, registrationNumber: e.target.value }))}
                                placeholder="0000"
                                maxLength={4}
                            />
                        </div>
                        <div className="sm:col-span-2 space-y-1.5">
                            <Label>Kontonummer</Label>
                            <Input
                                value={bank.accountNumber}
                                onChange={e => setBank(b => ({ ...b, accountNumber: e.target.value }))}
                                placeholder="00000000"
                                maxLength={10}
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* Arvekontakt */}
            <section className="rounded-lg border border-amber-200 dark:border-amber-900">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-amber-200 dark:border-amber-900">
                    <Heart className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <h2 className="font-medium">Kontaktperson ved dødsfald</h2>
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
                            <Input value={kin.name} onChange={e => setKin(k => ({ ...k, name: e.target.value }))} placeholder="Fulde navn" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Relation</Label>
                            <Input value={kin.relation} onChange={e => setKin(k => ({ ...k, relation: e.target.value }))} placeholder="f.eks. Ægtefælle, Barn, Søskende" />
                        </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>Telefon</Label>
                            <Input type="tel" value={kin.phone ?? ""} onChange={e => setKin(k => ({ ...k, phone: e.target.value }))} placeholder="+45 XX XX XX XX" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>E-mail</Label>
                            <Input type="email" value={kin.email ?? ""} onChange={e => setKin(k => ({ ...k, email: e.target.value }))} placeholder="kontakt@eksempel.dk" />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Noter (valgfrit)</Label>
                        <Input value={kin.notes ?? ""} onChange={e => setKin(k => ({ ...k, notes: e.target.value }))} placeholder="f.eks. advokat, notarforhold, særlige ønsker" />
                    </div>
                </div>
            </section>

            <Separator />

            <div className="flex justify-end">
                <Button onClick={handleSave} className="gap-2">
                    <Save className="h-4 w-4" />
                    Gem ændringer
                </Button>
            </div>
        </div>
    )
}
