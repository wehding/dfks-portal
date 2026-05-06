"use client"

import { useState } from "react"
import {
    Check, X, FileText, Upload, ArrowLeft,
    Trash2, Clock, CheckCircle2, Eye, Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { PdfViewer } from "@/components/pdf-viewer"
import { useI18n } from "@/lib/i18n"
import { useContracts } from "@/lib/hooks"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Contract } from "@/lib/types"

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    pending: "outline", review: "secondary", approved: "default", rejected: "destructive",
}
const statusLabels: Record<string, string> = {
    pending: "admin.contracts.pending", review: "admin.contracts.review",
    approved: "admin.contracts.approved", rejected: "admin.contracts.rejected",
}

// ── Source link button ────────────────────────────────────────

function SourceBtn({ quote, active, onClick }: { quote?: string; active: boolean; onClick: () => void }) {
    if (!quote) return null
    return (
        <button
            onClick={onClick}
            title="Vis i dokument"
            className={`ml-1 inline-flex items-center justify-center w-4 h-4 rounded text-[9px] transition-colors ${
                active
                    ? "bg-yellow-400 text-yellow-900"
                    : "bg-muted text-muted-foreground hover:bg-yellow-200 hover:text-yellow-800"
            }`}
        >
            ¶
        </button>
    )
}

export default function AdminValideringPage() {
    const { t } = useI18n()
    const { contracts, deleteContract, updateContract } = useContracts()
    const [reviewingId, setReviewingId] = useState<string | null>(null)
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [localPdfUrl, setLocalPdfUrl] = useState<string | null>(null)
    const [localPdfFile, setLocalPdfFile] = useState<File | null>(null)
    const [screening, setScreening] = useState(false)
    const [formData, setFormData] = useState<Record<string, any>>({})
    const [contractText, setContractText] = useState("")
    const [sources, setSources] = useState<Record<string, string>>({})
    const [activeSource, setActiveSource] = useState<string | null>(null)
    const setField = (key: string, value: any) => setFormData((prev) => ({ ...prev, [key]: value }))

    const unreviewedContracts = contracts.filter((c) => c.status === "pending" || c.status === "review")
    const reviewedContracts = contracts.filter((c) => c.status === "approved" || c.status === "rejected")
    const reviewingContract = contracts.find((c) => c.id === reviewingId)

    const leaveReview = () => {
        setReviewingId(null); setLocalPdfUrl(null); setLocalPdfFile(null)
        setFormData({}); setContractText(""); setSources({}); setActiveSource(null)
    }

    const handleApprove = (id: string) => {
        const c = contracts.find((x) => x.id === id)
        const hasFormData = Object.keys(formData).length > 0
        if (hasFormData) {
            updateContract(id, {
                status: "approved",
                extractedData: {
                    producerName: formData.producerName || undefined,
                    productionType: formData.productionType || undefined,
                    salary: formData.salary ? Number(formData.salary) : undefined,
                    salaryUnit: formData.salaryUnit || "monthly",
                    startDate: formData.startDate || undefined,
                    endDate: formData.endDate || undefined,
                    pensionPercent: formData.pensionPercent ? Number(formData.pensionPercent) : undefined,
                    pensionSupplement: formData.pensionSupplement ? Number(formData.pensionSupplement) : undefined,
                    personalSupplement: formData.personalSupplement ? Number(formData.personalSupplement) : undefined,
                    otherSupplements: formData.otherSupplements || undefined,
                    workingWeeks: formData.workingWeeks ? Number(formData.workingWeeks) : undefined,
                    svod: !!formData.svod,
                    copydan: !!formData.copydan,
                    royalty: !!formData.royalty,
                    royaltyPercent: formData.royaltyPercent ? Number(formData.royaltyPercent) : undefined,
                    aiDataMiningClause: !!formData.aiDataMiningClause,
                    distribution: formData.distribution ? formData.distribution.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
                    collectiveAgreement: !!formData.collectiveAgreementName,
                    collectiveAgreementName: formData.collectiveAgreementName || undefined,
                    gender: formData.gender as any || undefined,
                    holidayPayRate: formData.holidayPayRate ? Number(formData.holidayPayRate) : undefined,
                    betaRate: formData.betaRate ? Number(formData.betaRate) : undefined,
                    specialNotes: formData.specialNotes || undefined,
                },
            })
        } else {
            updateContract(id, { status: "approved" })
        }
        leaveReview()
        if (c) toast.success(`"${c.title}" er godkendt`)
    }

    const handleReject = (id: string) => {
        const c = contracts.find((x) => x.id === id)
        updateContract(id, { status: "rejected" })
        leaveReview()
        if (c) toast.error(`"${c.title}" er afvist`)
    }

    const handleExtract = async () => {
        if (!localPdfFile) { toast.error("Upload kontrakten for at køre AI-udtræk"); return }
        setScreening(true)
        try {
            // Extract text client-side then send to screen API as JSON
            const { extractTextFromFile, buildSystemPrompt } = await import("@/lib/ai")
            const text = await extractTextFromFile(localPdfFile)
            if (!text.trim()) throw new Error("Ingen tekst fundet i filen")
            const resp = await fetch("/api/screen", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    system: buildSystemPrompt(),
                    userMessage: "Analyser denne kontrakt og returner JSON:\n\n" + text.slice(0, 40000),
                }),
            })
            if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error ?? `Fejl ${resp.status}`) }
            const data = await resp.json()
            if (data.error) throw new Error(data.error)
            const ed = data.result?.extractedData
            if (!ed) throw new Error("AI returnerede ingen data")
            // Store contract text for highlighting (reuse extracted text from above)
            try {
                setContractText(text)
            } catch { /* highlighting won't work but that's ok */ }
            if (ed._sources) {
                setSources(ed._sources)
                console.log("[validering] sources:", ed._sources)
            }

            setFormData({
                producerName: ed.producerName ?? "", productionType: ed.productionType ?? "",
                salary: ed.salary ?? "", salaryUnit: ed.salaryUnit ?? "monthly",
                startDate: ed.startDate ?? "", endDate: ed.endDate ?? "",
                pensionPercent: ed.pensionPercent ?? "", pensionSupplement: ed.pensionSupplement ?? "",
                personalSupplement: ed.personalSupplement ?? "", otherSupplements: ed.otherSupplements ?? "",
                workingWeeks: ed.workingWeeks ?? "", svod: ed.svod ?? false,
                copydan: ed.copydan ?? false, royalty: ed.royalty ?? false,
                royaltyPercent: ed.royaltyPercent ?? "", aiDataMiningClause: ed.aiDataMiningClause ?? false,
                distribution: ed.distribution?.join(", ") ?? "", collectiveAgreementName: ed.collectiveAgreementName ?? "",
                gender: ed.gender ?? "", holidayPayRate: ed.holidayPayRate ?? "",
                betaRate: ed.betaRate ?? "", specialNotes: ed.specialNotes ?? "",
            })
            toast.success("Felter udfyldt — kontrollér og godkend")
        } catch (e: any) { toast.error(`Udtræk fejlede: ${e.message}`) }
        setScreening(false)
    }

    const handleDelete = (id: string) => {
        const c = contracts.find((x) => x.id === id)
        deleteContract(id); setDeleteId(null)
        if (reviewingId === id) leaveReview()
        if (c) toast.success(`"${c.title}" er slettet`)
    }

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) { setLocalPdfUrl(URL.createObjectURL(file)); setLocalPdfFile(file) }
    }

    // ── Review view ───────────────────────────────────────────
    if (reviewingContract) {
        const data = reviewingContract.extractedData
        // Computed highlight strings — must match exactly between highlights[] and SourceBtn onClick
        const salaryHl = sources.salary ?? (formData.salary ? String(formData.salary) : undefined)
        const datesHl = sources.dates ?? (formData.startDate ?? undefined) ?? undefined
        // Only use workingHours if AI returned a source string — formData fallback is too vague to match reliably
        const weeksHl = sources.workingHours ?? undefined
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={leaveReview}>
                        <ArrowLeft className="h-4 w-4" />{t("admin.validation.backToList")}
                    </Button>
                    <Separator orientation="vertical" className="h-5" />
                    <span className="text-sm font-medium">{reviewingContract.title}</span>
                    <span className="text-xs text-muted-foreground">— {reviewingContract.userName}</span>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* PDF viewer */}
                    <div className="rounded-lg border overflow-hidden" style={{ height: "80vh" }}>
                        <div className="flex items-center justify-between border-b px-4 py-3">
                            <span className="text-sm font-medium">{t("admin.validation.document")}</span>
                            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                <Upload className="h-3.5 w-3.5" />
                                {t("admin.validation.uploadLocal")}
                                <input type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={handleFileInput} />
                            </label>
                        </div>
                        {localPdfUrl ? (
                            <PdfViewer
                                url={localPdfUrl}
                                highlights={[
                                    salaryHl,
                                    sources.pension ?? null,
                                    sources.supplements ?? null,
                                    datesHl,
                                    weeksHl,
                                    sources.collectiveAgreement ?? (formData.collectiveAgreementName ?? null),
                                    sources.rights ?? null,
                                    sources.copydan ?? null,
                                    sources.svod ?? null,
                                    sources.royalty ?? null,
                                ].filter(Boolean) as string[]}
                                activeHighlight={activeSource}
                            />
                        ) : (
                            <div className="flex flex-1 h-full items-center justify-center text-sm text-muted-foreground">
                                <div className="text-center space-y-2">
                                    <FileText className="mx-auto h-8 w-8 opacity-30" />
                                    <p>{t("admin.validation.uploadPrompt")}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Data extraction form */}
                    <div className="rounded-lg border overflow-y-auto" style={{ maxHeight: "80vh" }}>
                        <div className="flex items-center gap-2 border-b px-4 py-3 sticky top-0 bg-background z-10">
                            <span className="text-sm font-medium">{t("admin.validation.extracted")}</span>
                            <div className="ml-auto flex items-center gap-2">
                                {Object.keys(sources).length > 0 && (
                                    <span className="text-[10px] text-muted-foreground">
                                        {Object.entries(sources).filter(([,v]) => v).length} kilder fundet
                                    </span>
                                )}
                                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                                    onClick={handleExtract} disabled={screening || !localPdfFile}
                                    title={!localPdfFile ? "Upload kontrakten for at aktivere AI-udtræk" : ""}>
                                    <Sparkles className={`h-3.5 w-3.5 ${screening ? "animate-pulse" : ""}`} />
                                    {screening ? "Udtrækker..." : "AI-udtræk"}
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-5 p-4">
                            <F label={t("admin.validation.producer")}>
                                <Input value={String(formData.producerName ?? data?.producerName ?? "")} onChange={(e) => setField("producerName", e.target.value)} placeholder="Producentens navn..." />
                            </F>
                            <Separator />
                            <F label="Type">
                                <Select value={formData.productionType ?? data?.productionType ?? ""} onValueChange={(v) => setField("productionType", v)}>
                                    <SelectTrigger><SelectValue placeholder="Vælg type..." /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="feature">Spillefilm</SelectItem>
                                        <SelectItem value="tvSeries">TV-serie</SelectItem>
                                        <SelectItem value="documentary">Dokumentarfilm</SelectItem>
                                        <SelectItem value="docSeries">Dokumentarserie</SelectItem>
                                        <SelectItem value="short">Kortfilm</SelectItem>
                                        <SelectItem value="tvEntertainment">TV-underholdning</SelectItem>
                                        <SelectItem value="reality">Reality</SelectItem>
                                        <SelectItem value="other">Andet</SelectItem>
                                    </SelectContent>
                                </Select>
                            </F>
                            <Separator />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={<>{t("admin.validation.salary")}<SourceBtn quote={salaryHl} active={activeSource === salaryHl} onClick={() => setActiveSource(salaryHl ?? null)} /></>}>
                                    <Input type="number" value={String(formData.salary ?? data?.salary ?? "")} onChange={(e) => setField("salary", e.target.value)} placeholder="0" />
                                </F>
                                <F label={t("admin.validation.salaryUnit")}>
                                    <Select value={formData.salaryUnit ?? data?.salaryUnit ?? "monthly"} onValueChange={(v) => setField("salaryUnit", v)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="monthly">{t("admin.validation.monthly")}</SelectItem>
                                            <SelectItem value="weekly">{t("admin.validation.weekly")}</SelectItem>
                                            <SelectItem value="daily">{t("admin.validation.daily")}</SelectItem>
                                            <SelectItem value="total">{t("admin.validation.total")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </F>
                            </div>
                            <Separator />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={<>{t("admin.validation.startDate")}<SourceBtn quote={datesHl} active={activeSource === datesHl} onClick={() => setActiveSource(datesHl ?? null)} /></>}><Input type="date" value={String(formData.startDate ?? data?.startDate ?? "")} onChange={(e) => setField("startDate", e.target.value)} /></F>
                                <F label={t("admin.validation.endDate")}><Input type="date" value={String(formData.endDate ?? data?.endDate ?? "")} onChange={(e) => setField("endDate", e.target.value)} /></F>
                            </div>
                            <Separator />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={<>{t("admin.validation.pensionPercent")}<SourceBtn quote={sources.pension ?? undefined} active={activeSource === sources.pension} onClick={() => setActiveSource(sources.pension ?? null)} /></>}>
                                    <div className="flex items-center gap-2">
                                        <Input type="number" step="0.1" value={String(formData.pensionPercent ?? data?.pensionPercent ?? "")} onChange={(e) => setField("pensionPercent", e.target.value)} placeholder="0" />
                                        <span className="text-sm text-muted-foreground">%</span>
                                    </div>
                                </F>
                                <F label={`${t("admin.validation.pension")} (kr.)`}>
                                    <Input type="number" value={String(formData.pensionSupplement ?? data?.pensionSupplement ?? "")} onChange={(e) => setField("pensionSupplement", e.target.value)} placeholder="0" />
                                </F>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={<>{t("admin.validation.personalSupplement")}<SourceBtn quote={sources.supplements ?? undefined} active={activeSource === sources.supplements} onClick={() => setActiveSource(sources.supplements ?? null)} /></>}>
                                    <Input type="number" value={String(formData.personalSupplement ?? data?.personalSupplement ?? "")} onChange={(e) => setField("personalSupplement", e.target.value)} placeholder="0" />
                                </F>
                                <F label={t("admin.validation.other")}>
                                    <Input value={String(formData.otherSupplements ?? data?.otherSupplements ?? "")} onChange={(e) => setField("otherSupplements", e.target.value)} placeholder="—" />
                                </F>
                            </div>
                            <Separator />
                            <F label={<>{t("admin.validation.workingWeeks")}<SourceBtn quote={weeksHl} active={activeSource === weeksHl} onClick={() => setActiveSource(weeksHl ?? null)} /></>}>
                                <Input type="number" value={String(formData.workingWeeks ?? data?.workingWeeks ?? "")} onChange={(e) => setField("workingWeeks", e.target.value)} placeholder="0" className="max-w-[120px]" />
                            </F>
                            <Separator />
                            <div>
                                <Label className="text-xs mb-3 block">{t("admin.validation.producerContributions")}</Label>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <F label={t("admin.validation.holidayPay")}>
                                        <div className="flex items-center gap-2">
                                            <Input type="number" step="0.1" value={String(formData.holidayPayRate ?? data?.holidayPayRate ?? "")} onChange={(e) => setField("holidayPayRate", e.target.value)} placeholder="12.5" />
                                            <span className="text-sm text-muted-foreground">%</span>
                                        </div>
                                    </F>
                                    <F label={t("admin.validation.beta")}>
                                        <div className="flex items-center gap-2">
                                            <Input type="number" step="0.01" value={String(formData.betaRate ?? data?.betaRate ?? "")} onChange={(e) => setField("betaRate", e.target.value)} placeholder="0.6" />
                                            <span className="text-sm text-muted-foreground">%</span>
                                        </div>
                                    </F>
                                </div>
                            </div>
                            <Separator />
                            <div>
                                <Label className="text-xs mb-3 block">{t("admin.validation.rights")}</Label>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm">SVOD<SourceBtn quote={sources.svod ?? sources.rights ?? undefined} active={activeSource === (sources.svod ?? sources.rights ?? null)} onClick={() => setActiveSource(sources.svod ?? sources.rights ?? null)} /></span>
                                            <p className="text-[10px] text-muted-foreground">Streaming on-demand rettighed</p>
                                        </div>
                                        <Switch checked={formData.svod ?? data?.svod ?? false} onCheckedChange={(v) => setField("svod", v)} />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm">Copydan<SourceBtn quote={sources.copydan ?? sources.rights ?? undefined} active={activeSource === (sources.copydan ?? sources.rights ?? null)} onClick={() => setActiveSource(sources.copydan ?? sources.rights ?? null)} /></span>
                                            <p className="text-[10px] text-muted-foreground">Copydan-vederlag inkluderet</p>
                                        </div>
                                        <Switch checked={formData.copydan ?? data?.copydan ?? false} onCheckedChange={(v) => setField("copydan", v)} />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1">
                                            <span className="text-sm">Royalty<SourceBtn quote={sources.royalty ?? undefined} active={activeSource === (sources.royalty ?? null)} onClick={() => setActiveSource(sources.royalty ?? null)} /></span>
                                            <p className="text-[10px] text-muted-foreground">Løbende royaltybetaling</p>
                                        </div>
                                        <Input type="number" step="0.1" value={String(formData.royaltyPercent ?? data?.royaltyPercent ?? "")} onChange={(e) => setField("royaltyPercent", e.target.value)} placeholder="%" className="w-20" />
                                        <Switch checked={formData.royalty ?? data?.royalty ?? false} onCheckedChange={(v) => setField("royalty", v)} />
                                    </div>
                                    <Separator className="my-1" />
                                    <RightRow label={t("admin.validation.aiClause")} desc={t("admin.validation.aiClauseDesc")} checked={formData.aiDataMiningClause ?? data?.aiDataMiningClause ?? false} onChange={(v) => setField("aiDataMiningClause", v)} />
                                </div>
                            </div>
                            <Separator />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={t("admin.validation.distribution")}>
                                    <Input value={formData.distribution ?? data?.distribution?.join(", ") ?? ""} onChange={(e) => setField("distribution", e.target.value)} placeholder="Netflix, DR, TV2..." />
                                </F>
                                <F label={<>{t("admin.validation.agreement")}<SourceBtn quote={sources.collectiveAgreement ?? undefined} active={activeSource === sources.collectiveAgreement} onClick={() => setActiveSource(sources.collectiveAgreement ?? null)} /></>}>
                                    <Input value={formData.collectiveAgreementName ?? (data?.collectiveAgreement ? data.collectiveAgreementName : "") ?? ""} onChange={(e) => setField("collectiveAgreementName", e.target.value)} placeholder="—" />
                                </F>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={t("admin.validation.gender")}>
                                    <Select value={formData.gender ?? data?.gender ?? ""} onValueChange={(v) => setField("gender", v)}>
                                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="male">{t("admin.stats.male")}</SelectItem>
                                            <SelectItem value="female">{t("admin.stats.female")}</SelectItem>
                                            <SelectItem value="other">Andet</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </F>
                            </div>
                            <F label={t("admin.validation.specialNotes")}>
                                <Textarea value={formData.specialNotes ?? data?.specialNotes ?? ""} onChange={(e) => setField("specialNotes", e.target.value)} placeholder="Fritekst..." rows={3} />
                            </F>
                            <Separator />
                            <div className="flex items-center gap-2 pt-1">
                                <Button className="gap-1.5" onClick={() => handleApprove(reviewingContract.id)}>
                                    <Check className="h-4 w-4" />{t("admin.validation.approve")}
                                </Button>
                                <Button variant="destructive" className="gap-1.5" onClick={() => handleReject(reviewingContract.id)}>
                                    <X className="h-4 w-4" />{t("admin.validation.reject")}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // ── List view ─────────────────────────────────────────────
    return (
        <div className="space-y-8">
            <PageHeader title={t("admin.validation.title")} subtitle={t("admin.validation.subtitle")} />
            <Tabs defaultValue="unreviewed">
                <TabsList>
                    <TabsTrigger value="unreviewed" className="gap-2">
                        <Clock className="h-3.5 w-3.5" />
                        {t("admin.validation.pending")}
                        {unreviewedContracts.length > 0 && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0">{unreviewedContracts.length}</Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="reviewed" className="gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5" />{t("admin.validation.reviewed")}
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="unreviewed" className="mt-4">
                    {unreviewedContracts.length === 0 ? (
                        <EmptyState icon={<CheckCircle2 className="h-10 w-10 text-muted-foreground/30 mb-3" />}
                            title={t("admin.validation.allReviewed")} desc={t("admin.validation.allReviewedDesc")} />
                    ) : (
                        <ContractTable contracts={unreviewedContracts} onReview={setReviewingId} onDelete={setDeleteId} t={t} />
                    )}
                </TabsContent>
                <TabsContent value="reviewed" className="mt-4">
                    {reviewedContracts.length === 0 ? (
                        <EmptyState icon={<FileText className="h-10 w-10 text-muted-foreground/30 mb-3" />}
                            title="Ingen validerede kontrakter endnu" />
                    ) : (
                        <ContractTable contracts={reviewedContracts} onReview={setReviewingId} onDelete={setDeleteId} t={t} showStatus />
                    )}
                </TabsContent>
            </Tabs>
            <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("admin.validation.deleteTitle")}</DialogTitle>
                        <DialogDescription>{t("admin.validation.deleteDesc")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>{t("common.cancel")}</Button>
                        <Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)}>{t("common.delete")}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ── Small helpers ─────────────────────────────────────────────

function F({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            {children}
        </div>
    )
}

function RightRow({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between">
            <div>
                <span className="text-sm">{label}</span>
                {desc && <p className="text-[10px] text-muted-foreground">{desc}</p>}
            </div>
            <Switch checked={checked} onCheckedChange={onChange} />
        </div>
    )
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc?: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            {icon}
            <p className="text-sm font-medium">{title}</p>
            {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
        </div>
    )
}

function ContractTable({ contracts, onReview, onDelete, t, showStatus = false }: {
    contracts: Contract[]; onReview: (id: string) => void; onDelete: (id: string) => void
    t: (key: string) => string; showStatus?: boolean
}) {
    return (
        <div className="rounded-lg border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t("upload.title")}</TableHead>
                        <TableHead>{t("upload.member")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("upload.category")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("admin.contracts.uploaded")}</TableHead>
                        {showStatus && <TableHead>{t("common.status")}</TableHead>}
                        <TableHead className="w-[100px]" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {contracts.map((c) => (
                        <TableRow key={c.id}>
                            <TableCell>
                                <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span className="text-sm font-medium">{c.title}</span>
                                </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{c.userName ?? "—"}</TableCell>
                            <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{c.category ?? "—"}</TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground tabular-nums">
                                {new Date(c.uploadedAt).toLocaleDateString("da-DK")}
                            </TableCell>
                            {showStatus && (
                                <TableCell>
                                    <Badge variant={statusVariant[c.status] ?? "outline"} className="text-xs font-normal">
                                        {t(statusLabels[c.status] ?? c.status)}
                                    </Badge>
                                </TableCell>
                            )}
                            <TableCell>
                                <div className="flex gap-1 justify-end">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onReview(c.id)}>
                                        <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(c.id)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
