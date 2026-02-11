"use client"

import { useState } from "react"
import { Film, Download, Users, Eye, ChevronDown, ChevronUp, Upload } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { mockWorks, mockContracts } from "@/lib/mock-data"
import { PageHeader } from "@/components/page-header"
import { PdfViewer } from "@/components/pdf-viewer"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Work } from "@/lib/types"

function RightsBadges({ rights }: { rights: Work["rights"] }) {
    return (
        <div className="flex gap-1">
            {rights.svod && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                    SVOD
                </Badge>
            )}
            {rights.copydan && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                    Copydan
                </Badge>
            )}
            {rights.royalty && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                    {rights.royaltyPercent ? `${rights.royaltyPercent}%` : "Royalty"}
                </Badge>
            )}
            {!rights.svod && !rights.copydan && !rights.royalty && (
                <span className="text-xs text-muted-foreground">—</span>
            )}
        </div>
    )
}

function DurationDisplay({ work }: { work: Work }) {
    const { t } = useI18n()
    const [expanded, setExpanded] = useState(false)

    if (work.episodes && work.episodes.length > 0) {
        const totalMin = work.episodes.reduce((s, e) => s + e.duration, 0)
        return (
            <div>
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="inline-flex items-center gap-1 text-sm tabular-nums hover:text-foreground transition-colors"
                >
                    {work.episodes.length} {t("works.episodes")}
                    {expanded ? (
                        <ChevronUp className="h-3 w-3" />
                    ) : (
                        <ChevronDown className="h-3 w-3" />
                    )}
                </button>
                {expanded && (
                    <div className="mt-1.5 space-y-0.5">
                        {work.episodes.map((ep) => (
                            <div key={ep.number} className="text-xs text-muted-foreground">
                                {ep.number}. {ep.title} — {ep.duration} {t("common.minutes")}
                            </div>
                        ))}
                        <div className="text-xs font-medium mt-1">
                            Total: {totalMin} {t("common.minutes")}
                        </div>
                    </div>
                )}
            </div>
        )
    }

    return (
        <span className="tabular-nums">
            {work.duration} {t("common.minutes")}
        </span>
    )
}

export default function MineVaerkerPage() {
    const { t } = useI18n()
    const [previewPdf, setPreviewPdf] = useState<string | null>(null)
    const [localPdfUrl, setLocalPdfUrl] = useState<string | null>(null)

    const handleLocalPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) setLocalPdfUrl(URL.createObjectURL(file))
    }

    return (
        <div className="space-y-6">
            <PageHeader title={t("works.title")} subtitle={t("works.subtitle")} />

            {mockWorks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                    <Film className="h-10 w-10 text-muted-foreground/40" />
                    <h3 className="mt-4 text-sm font-medium">{t("works.noWorks")}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {t("works.noWorksDesc")}
                    </p>
                </div>
            ) : (
                <div className="rounded-lg border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t("works.workTitle")}</TableHead>
                                <TableHead>{t("works.credit")}</TableHead>
                                <TableHead>{t("works.sharedCredit")}</TableHead>
                                <TableHead>{t("works.rights")}</TableHead>
                                <TableHead>{t("works.duration")}</TableHead>
                                <TableHead className="w-[100px]">{t("works.contract")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {mockWorks.map((work) => (
                                <TableRow key={work.id}>
                                    <TableCell>
                                        <div>
                                            <span className="font-medium">{work.title}</span>
                                            <span className="ml-2 text-xs text-muted-foreground">
                                                ({work.premiereYear})
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{work.creditedRole}</TableCell>
                                    <TableCell>
                                        {work.sharedCredit ? (
                                            <Tooltip>
                                                <TooltipTrigger>
                                                    <Badge
                                                        variant="secondary"
                                                        className="gap-1 font-normal"
                                                    >
                                                        <Users className="h-3 w-3" />
                                                        {t("works.yes")}
                                                    </Badge>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p className="text-xs">
                                                        {t("works.sharedWith")}:{" "}
                                                        {work.sharedWith?.join(", ")}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <span className="text-muted-foreground text-sm">
                                                {t("works.no")}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <RightsBadges rights={work.rights} />
                                    </TableCell>
                                    <TableCell>
                                        <DurationDisplay work={work} />
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => setPreviewPdf(work.contractId)}
                                            >
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                                <Download className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* Contract Preview Dialog */}
            <Dialog open={!!previewPdf} onOpenChange={() => { setPreviewPdf(null); setLocalPdfUrl(null) }}>
                <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>{t("common.preview")}</DialogTitle>
                    </DialogHeader>
                    {(() => {
                        const contract = mockContracts.find(c => c.id === previewPdf)
                        const data = contract?.extractedData
                        const isApproved = contract?.status === "approved"

                        return (
                            <div className={`flex-1 grid gap-4 overflow-hidden ${isApproved && data ? "lg:grid-cols-2" : ""}`}>
                                {/* PDF Side */}
                                <div className="rounded-lg border overflow-hidden flex flex-col">
                                    {localPdfUrl ? (
                                        <PdfViewer url={localPdfUrl} />
                                    ) : (
                                        <div className="flex flex-1 flex-col items-center justify-center bg-muted/30">
                                            <p className="text-sm text-muted-foreground mb-3">
                                                Vælg en PDF for at teste preview
                                            </p>
                                            <label className="cursor-pointer">
                                                <input
                                                    type="file"
                                                    accept=".pdf"
                                                    className="hidden"
                                                    onChange={handleLocalPdf}
                                                />
                                                <span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors">
                                                    <Upload className="h-4 w-4" />
                                                    Vælg PDF
                                                </span>
                                            </label>
                                        </div>
                                    )}
                                </div>

                                {/* Extracted Data Side (only for approved) */}
                                {isApproved && data && (
                                    <div className="rounded-lg border overflow-auto">
                                        <div className="flex items-center gap-2 border-b px-4 py-3 sticky top-0 bg-background z-10">
                                            <span className="text-sm font-medium">{t("admin.validation.extracted")}</span>
                                            <Badge variant="default" className="ml-auto text-[10px] font-normal">
                                                {t("admin.contracts.approved")}
                                            </Badge>
                                        </div>
                                        <div className="p-4 space-y-4 text-sm">
                                            {/* Salary */}
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.salary")}</p>
                                                <p className="font-medium tabular-nums">
                                                    {data.salary?.toLocaleString("da-DK")} {t("common.kr")} / {t(`admin.validation.${data.salaryUnit || "monthly"}` as any)}
                                                </p>
                                            </div>

                                            <Separator />

                                            {/* Employment */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.startDate")}</p>
                                                    <p>{data.startDate}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.endDate")}</p>
                                                    <p>{data.endDate}</p>
                                                </div>
                                            </div>

                                            {data.pensionSupplement && (
                                                <>
                                                    <Separator />
                                                    <div>
                                                        <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.pension")}</p>
                                                        <p className="tabular-nums">{data.pensionSupplement?.toLocaleString("da-DK")} {t("common.kr")}</p>
                                                    </div>
                                                </>
                                            )}

                                            <Separator />

                                            {/* Rights */}
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-2">{t("admin.validation.rights")}</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    <Badge variant={data.svod ? "default" : "outline"} className="font-normal">
                                                        SVOD {data.svod ? "✓" : "✗"}
                                                    </Badge>
                                                    <Badge variant={data.copydan ? "default" : "outline"} className="font-normal">
                                                        Copydan {data.copydan ? "✓" : "✗"}
                                                    </Badge>
                                                    <Badge variant={data.royalty ? "default" : "outline"} className="font-normal">
                                                        Royalty {data.royalty ? `${data.royaltyPercent}%` : "✗"}
                                                    </Badge>
                                                </div>
                                            </div>

                                            {data.distribution && data.distribution.length > 0 && (
                                                <>
                                                    <Separator />
                                                    <div>
                                                        <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.distribution")}</p>
                                                        <p>{data.distribution.join(", ")}</p>
                                                    </div>
                                                </>
                                            )}

                                            {data.collectiveAgreement && (
                                                <>
                                                    <Separator />
                                                    <div>
                                                        <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.agreement")}</p>
                                                        <p>{data.collectiveAgreementName}</p>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    )
}
