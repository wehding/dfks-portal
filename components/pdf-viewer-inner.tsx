"use client"

/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { norm, buildNeedles as resolveNeedles } from "@/lib/resolveAnker"
import type { ContractLayout } from "@/lib/contract-layout"
import { contractEvidencePage, evidenceBboxToViewportRect, type ContractEvidenceBbox, type ContractFieldEvidence, type PdfViewportDimensions } from "@/lib/contract-workbench"
import { calculatePdfFitWidthScale } from "@/lib/contract-workbench-responsive"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

if (typeof window !== "undefined" && !(URL as any).parse) {
    ;(URL as any).parse = (val: string, base?: string) => {
        try { return new URL(val, base) } catch { return null }
    }
}

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"

interface PdfViewerProps {
    url: string
    highlights?: string[]
    sectionHighlights?: string[]
    activeHighlight?: string | null
    pageNavigationHint?: string
    activePage?: number | null
    // Lag 5: koordinatbaseret highlight
    layout?: ContractLayout | null
    activeClauseId?: string | null
    activeEvidence?: ContractFieldEvidence | null
    resetViewToken?: number
}

/** Konverter PDF-bounding-box (y=0 ved bund) til CSS-position i en rendered side. */
function bboxToScreenStyle(
    bbox: ContractEvidenceBbox,
    vp: PdfViewportDimensions,
): React.CSSProperties {
    return { position: "absolute", ...evidenceBboxToViewportRect(bbox, vp), pointerEvents: "none" }
}

// norm() og buildNeedles importeret fra lib/resolveAnker.ts

function buildNeedles(quote: string): string[] {
    // Delegér til resolveAnker.buildNeedles (inkl. tal-prioritering og date-variants)
    const delegated = resolveNeedles(quote)
    const exact = norm(quote)
    const variants = [
        exact,
        exact.replace(/\s*&\s*/g, "&"),
        exact.replace(/\s*&\s*/g, " & "),
    ].filter(value => value.length >= 2)
    return [...new Set([...variants, ...delegated])]
}


async function findPageForQuote(pdfDoc: any, quote: string, numPages: number): Promise<number> {
    const needles = buildNeedles(quote)
    // For long passages, also try very short distinctive slices
    const q = norm(quote)
    if (q.length > 60) {
        needles.push(q.slice(0, 20))
        needles.push(q.slice(0, 15))
    }
    const uniqueNeedles = [...new Set(needles)].filter(n => n.length >= 3)
    for (let i = 1; i <= numPages; i++) {
        try {
            const page = await pdfDoc.getPage(i)
            const content = await page.getTextContent()
            const pageText = norm(content.items.map((item: any) => item.str).join(" "))
            if (uniqueNeedles.some((n) => pageText.includes(n))) return i
        } catch { /* skip */ }
    }
    return 0
}

// Inject persistent CSS for highlights — React cannot override these
function ensureHighlightCSS() {
    const id = "dfks-hl-css"
    if (document.getElementById(id)) return
    const style = document.createElement("style")
    style.id = id
    style.textContent = `
        .react-pdf__Page__textContent span[data-hl="match"] {
            background: rgba(253,224,71,0.55) !important;
            box-shadow: 0 0 0 1px rgba(202,138,4,0.45) !important;
        }
        .react-pdf__Page__textContent span[data-hl="active"] {
            background: rgba(250,204,21,0.65) !important;
            box-shadow: 0 0 0 2px rgba(202,138,4,0.65) !important;
        }
        .react-pdf__Page [data-exact-hl="active"] {
            position: absolute;
            z-index: 12;
            pointer-events: none;
            border: 2px solid rgba(202,138,4,0.75);
            border-radius: 2px;
            background: rgba(250,204,21,0.42);
        }
    `
    document.head.appendChild(style)
}

const DATE_MONTHS = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"]

function preciseTextPatterns(value: string) {
    const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
    const patterns = escaped ? [new RegExp(escaped, "iu")] : []
    const isoDate = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!isoDate) return patterns
    const [, year, rawMonth, rawDay] = isoDate
    const day = String(Number(rawDay))
    const month = String(Number(rawMonth))
    const monthName = DATE_MONTHS[Number(rawMonth) - 1]
    if (monthName) {
        patterns.unshift(new RegExp(`${day}\\.?\\s+${monthName}(?:\\s+${year})?`, "iu"))
    }
    patterns.unshift(new RegExp(`${day}\\s*[./-]\\s*0?${month}\\s*[./-]\\s*${year}`, "u"))
    return patterns
}

function renderPreciseTextOverlay(pageEl: Element, spans: HTMLElement[], focusText: string) {
    pageEl.querySelectorAll('[data-exact-hl="active"]').forEach(element => element.remove())
    const patterns = preciseTextPatterns(focusText)
    for (const span of spans) {
        const textNode = Array.from(span.childNodes).find(node => node.nodeType === Node.TEXT_NODE)
        const text = textNode?.textContent ?? ""
        if (!textNode || !text) continue
        for (const pattern of patterns) {
            const match = pattern.exec(text)
            if (!match || match.index == null) continue
            const range = document.createRange()
            range.setStart(textNode, match.index)
            range.setEnd(textNode, match.index + match[0].length)
            const pageRect = pageEl.getBoundingClientRect()
            const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
            if (!rects.length) continue
            const bounds = rects.reduce((result, rect) => ({
                left: Math.min(result.left, rect.left),
                top: Math.min(result.top, rect.top),
                right: Math.max(result.right, rect.right),
                bottom: Math.max(result.bottom, rect.bottom),
            }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
            const overlay = document.createElement("div")
            overlay.dataset.exactHl = "active"
            overlay.style.left = `${bounds.left - pageRect.left}px`
            overlay.style.top = `${bounds.top - pageRect.top}px`
            overlay.style.width = `${bounds.right - bounds.left}px`
            overlay.style.height = `${bounds.bottom - bounds.top}px`
            pageEl.appendChild(overlay)
            overlay.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })
            return true
        }
    }
    return false
}

function renderTextRangeOverlay(pageEl: Element, spans: HTMLElement[]) {
    pageEl.querySelectorAll('[data-exact-hl="active"]').forEach(element => element.remove())
    const pageRect = pageEl.getBoundingClientRect()
    const rects = spans.flatMap(span => Array.from(span.getClientRects())).filter(rect => rect.width > 0 && rect.height > 0)
    if (!rects.length) return false
    const bounds = rects.reduce((result, rect) => ({
        left: Math.min(result.left, rect.left),
        top: Math.min(result.top, rect.top),
        right: Math.max(result.right, rect.right),
        bottom: Math.max(result.bottom, rect.bottom),
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
    const overlay = document.createElement("div")
    overlay.dataset.exactHl = "active"
    overlay.style.left = `${bounds.left - pageRect.left}px`
    overlay.style.top = `${bounds.top - pageRect.top}px`
    overlay.style.width = `${bounds.right - bounds.left}px`
    overlay.style.height = `${bounds.bottom - bounds.top}px`
    pageEl.appendChild(overlay)
    overlay.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })
    return true
}

function applyHighlights(container: HTMLElement, highlights: string[], activeHighlight: string | null, sectionHighlights: string[] = [], preciseFocusText = "") {
    ensureHighlightCSS()

    container.querySelectorAll("span[data-hl]").forEach((el) => {
        el.removeAttribute("data-hl")
    })

    // Find text layer inside the current page element
    const pageEl = container.querySelector(".react-pdf__Page")
    const textLayer = pageEl?.querySelector(".react-pdf__Page__textContent")
    if (!pageEl || !textLayer) return
    const spans = Array.from(textLayer.querySelectorAll("span")) as HTMLElement[]
    if (!spans.length) return
    const preciseMatch = preciseFocusText ? renderPreciseTextOverlay(pageEl, spans, preciseFocusText) : false
    if (!preciseFocusText) pageEl.querySelectorAll('[data-exact-hl="active"]').forEach(element => element.remove())

    let normFull = ""
    const spanMap: { start: number; end: number; span: HTMLElement }[] = []
    spans.forEach((span) => {
        const t = span.textContent ?? ""
        if (!t) return
        const normed = norm(t)
        if (!normed) return
        // Don't add leading space if this span continues a number (starts with , or .)
        const needsSpace = normFull.length > 0 && !normed.startsWith(",") && !normed.startsWith(".")
        const offset = needsSpace ? 1 : 0
        spanMap.push({ start: normFull.length + offset, end: normFull.length + offset + normed.length, span })
        if (needsSpace) normFull += " "
        normFull += normed
    })

    // Post-process: fix numbers split across spans e.g. "1 7,6" → "17,6", "2 7" → "27"
    normFull = normFull.replace(/(\d) (\d)/g, "$1$2")


    // Active highlight candidates from || separated string
    const activeCandidates = activeHighlight
        ? activeHighlight.split("||").map(s => s.trim()).filter(Boolean)
        : []
    const resolvedActive = activeCandidates.find(c => {
        const needles = buildNeedles(c)
        return needles.some(n => normFull.includes(n))
    }) ?? activeCandidates[0] ?? null
    const normActive = resolvedActive ? norm(resolvedActive) : null

    // Inkluder altid active-kandidater i allHighlights — ellers kan de aldrig markeres som isActive
    const allHighlights = [
        ...highlights,
        ...sectionHighlights.flatMap(s => s.split("||").map(x => x.trim())),
        ...(!preciseMatch ? activeCandidates.filter(c => c.length >= 2) : []),
    ]

    allHighlights.forEach((quote) => {
        if (!quote || quote.length < 2) return
        const isSection = sectionHighlights.some(s => s.split("||").map(x => x.trim()).includes(quote))
        const isActive = normActive !== null && (
            norm(quote) === normActive ||
            activeCandidates.some(c => norm(quote) === norm(c))
        )
        const needles = buildNeedles(quote)

        for (const needle of needles) {
            const idx = normFull.indexOf(needle)
            if (idx === -1) continue

            const matchStart = idx
            const matchEnd = idx + needle.length

            if (isSection) {
                // Try the quote directly as needle first, then shorter slices
                const q = norm(quote)
                const sectionNeedles = [q, q.slice(0, 30), q.slice(0, 20), q.slice(0, 15), q.slice(0, 10)]
                let found = false
                for (const sn of sectionNeedles) {
                    if (sn.length < 2) continue
                    const snIdx = normFull.indexOf(sn)
                    if (snIdx === -1) continue
                    const snEnd = snIdx + sn.length
                    const matched = spanMap.filter(({ start, end }) => start < snEnd && end > snIdx)
                    if (!matched.length) continue
                    if (isActive) renderTextRangeOverlay(pageEl, matched.map(({ span }) => span))
                    else matched.forEach(({ span }) => span.setAttribute("data-hl", "match"))
                    found = true
                    break
                }
                if (!found) continue
            } else {
                // Only include spans whose start is within the needle range (trim trailing overlap)
                const matched = spanMap.filter(({ start, end }) => start < matchEnd && end > matchStart && start < matchEnd)
                // Remove last span if it starts after the needle ends (partial overlap)
                const trimmed = matched.filter(({ start }) => start < matchEnd)
                if (!trimmed.length) continue
                if (isActive) renderTextRangeOverlay(pageEl, trimmed.map(({ span }) => span))
                else trimmed.forEach(({ span }) => span.setAttribute("data-hl", "match"))
            }
            break
        }
    })
}

export default function PdfViewer({ url, highlights = [], sectionHighlights = [], activeHighlight = null, pageNavigationHint, activePage = null, layout, activeClauseId, activeEvidence = null, resetViewToken = 0 }: PdfViewerProps) {
    const [numPages, setNumPages] = useState(0)
    const [pageNumber, setPageNumber] = useState(1)
    const [scale, setScale] = useState(1.0)
    const [fitMode, setFitMode] = useState<"width" | "page" | "manual">("width")
    const [error, setError] = useState(false)
    const [pageRendered, setPageRendered] = useState(false)
    const [pdfDoc, setPdfDoc] = useState<any>(null)
    const [pageViewport, setPageViewport] = useState<PdfViewportDimensions | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const container = containerRef.current
        if (!container || !pdfDoc || fitMode === "manual") return

        let cancelled = false
        let animationFrame = 0
        const fitPage = async () => {
            const page = await pdfDoc.getPage(pageNumber)
            if (cancelled) return
            const viewport = page.getViewport({ scale: 1 })
            const widthScale = calculatePdfFitWidthScale(container.clientWidth, viewport.width)
            const heightScale = Math.min(1, Math.max(0.25, (container.clientHeight - 32) / viewport.height))
            const nextScale = fitMode === "page" ? Math.min(widthScale, heightScale) : widthScale
            setScale(current => Math.abs(current - nextScale) < 0.005 ? current : nextScale)
        }
        const scheduleFit = () => {
            cancelAnimationFrame(animationFrame)
            animationFrame = requestAnimationFrame(() => void fitPage())
        }

        scheduleFit()
        const observer = new ResizeObserver(scheduleFit)
        observer.observe(container)
        return () => {
            cancelled = true
            cancelAnimationFrame(animationFrame)
            observer.disconnect()
        }
    }, [fitMode, pageNumber, pdfDoc])

    const activeHighlightRef = useRef(activeHighlight)
    const highlightsRef = useRef(highlights)
    const sectionHighlightsRef = useRef(sectionHighlights)
    activeHighlightRef.current = activeHighlight
    highlightsRef.current = highlights
    sectionHighlightsRef.current = sectionHighlights

    // Den præcise tekstmarkering har førsteprioritet. Koordinatboksen fungerer
    // samtidig som fallback, hvis OCR-teksten er opdelt på en måde der ikke kan matches.
    const preciseFocusText = activeEvidence?.focusText?.trim() ?? ""
    const hasPreciseFocus = preciseFocusText.length >= 2 && preciseFocusText.length <= 64
    const legacyBbox = activeClauseId && layout
        ? layout.clauses.find(c => c.id === activeClauseId)?.pdfBbox
        : null
    const activeBbox: ContractEvidenceBbox | null = useMemo(() => activeEvidence?.bbox
        ?? (legacyBbox ? { ...legacyBbox, space: "pdf_bottom_left" } : null), [activeEvidence?.bbox, legacyBbox])
    const hasCoordinateBox = Boolean(activeBbox)
    // En verificeret koordinatboks er den autoritative markering. Tekstlaget
    // må ikke samtidig tegne ekstra bokse over de enkelte ord eller linjer.
    const effectiveActiveHighlight = hasCoordinateBox ? null : activeHighlight
    const effectivePreciseFocusText = hasCoordinateBox ? "" : preciseFocusText
    const effectiveSectionHighlights = useMemo(
        () => hasCoordinateBox ? [] : sectionHighlights,
        [hasCoordinateBox, sectionHighlights],
    )
    const effectiveActiveHighlightRef = useRef(effectiveActiveHighlight)
    const effectiveSectionHighlightsRef = useRef(effectiveSectionHighlights)
    effectiveActiveHighlightRef.current = effectiveActiveHighlight
    effectiveSectionHighlightsRef.current = effectiveSectionHighlights

    useEffect(() => {
        if (hasPreciseFocus && !hasCoordinateBox) {
            setFitMode("manual")
            setScale(current => Math.max(current, 1.6))
        }
    }, [activeHighlight, hasCoordinateBox, hasPreciseFocus, preciseFocusText])

    const previousResetToken = useRef(resetViewToken)
    useEffect(() => {
        if (resetViewToken === previousResetToken.current) return
        previousResetToken.current = resetViewToken
        setFitMode("page")
    }, [resetViewToken])

    const navigationRequest = useRef(0)
    useEffect(() => {
        const request = ++navigationRequest.current
        if (!activeHighlight || !pdfDoc || !numPages) return
        if (activePage && activePage >= 1 && activePage <= numPages) {
            if (activePage !== pageNumber) {
                setPageRendered(false)
                setPageNumber(activePage)
            } else if (containerRef.current) {
                applyHighlights(containerRef.current, highlightsRef.current, effectiveActiveHighlightRef.current, effectiveSectionHighlightsRef.current, effectivePreciseFocusText)
            }
            return
        }
        const navSource = pageNavigationHint ?? activeHighlight
        const candidates = navSource.split("||").map(s => s.trim()).filter(Boolean)
        const tryNext = async (idx: number): Promise<number> => {
            if (idx >= candidates.length) return 0
            const page = await findPageForQuote(pdfDoc, candidates[idx], numPages)
            return page > 0 ? page : tryNext(idx + 1)
        }
        tryNext(0).then((page) => {
            if (request !== navigationRequest.current) return
            const targetPage = page > 0 ? page : 1
            if (targetPage !== pageNumber) {
                setPageRendered(false)
                setPageNumber(targetPage)
            } else {
                if (containerRef.current) {
                    applyHighlights(containerRef.current, highlightsRef.current, effectiveActiveHighlightRef.current, effectiveSectionHighlightsRef.current, effectivePreciseFocusText)
                }
            }
        })
    }, [activeHighlight, activePage, pageNavigationHint, pdfDoc, numPages, hasCoordinateBox]) // eslint-disable-line

    const zoomedEvidence = useRef<string | null>(null)
    useEffect(() => {
        if (!activeBbox || !pageViewport || !containerRef.current || !activeEvidence) return
        const key = `${activeEvidence.fieldKey}:${activeEvidence.page ?? activeEvidence.clause?.page ?? pageNumber}:${JSON.stringify(activeBbox)}`
        if (zoomedEvidence.current === key) return
        const boxWidth = activeBbox.space === "normalized_top_left" ? activeBbox.width * pageViewport.pdfWidth : activeBbox.width
        const boxHeight = activeBbox.space === "normalized_top_left" ? activeBbox.height * pageViewport.pdfHeight : activeBbox.height
        const availableWidth = Math.max(200, containerRef.current.clientWidth * 0.82)
        const availableHeight = Math.max(160, containerRef.current.clientHeight * 0.62)
        const targetScale = Math.max(0.4, Math.min(2.2, availableWidth / Math.max(boxWidth, 1), availableHeight / Math.max(boxHeight, 1)))
        zoomedEvidence.current = key
        setFitMode("manual")
        setScale(targetScale)
    }, [activeBbox, activeEvidence, pageNumber, pageViewport])

    // Lag 5: naviger til klausulens side ved activeClauseId-skift
    useEffect(() => {
        if (!activeClauseId || !layout) return
        const clause = layout.clauses.find(c => c.id === activeClauseId)
        if (!clause) return
        const targetPage = clause.page ?? 1
        if (targetPage !== pageNumber) {
            setPageRendered(false)
            setPageNumber(targetPage)
        }
    }, [activeClauseId, layout]) // eslint-disable-line

    // Hent sidedimensioner fra PDF-viewporten ved den aktuelle skala.
    // Kører når pdfDoc skifter ELLER side/scale ændres — kræver IKKE pageRendered
    // (DOM-måling via offsetWidth var upålidelig og skabte race condition med pageRendered)
    useEffect(() => {
        setPageViewport(null) // ryd stale viewport straks — undgår hængende bokse ved sideskift
        if (!pdfDoc) return
        pdfDoc.getPage(pageNumber).then((page: any) => {
            const vp = page.getViewport({ scale: 1 })
            const newVp = {
                pdfWidth: vp.width,
                pdfHeight: vp.height,
                renderedWidth: vp.width * scale,
                renderedHeight: vp.height * scale,
            }
            setPageViewport(newVp)
        }).catch((error: unknown) => console.warn("PDF-siden kunne ikke måles:", error))
    }, [pdfDoc, pageNumber, scale])

    const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
        setNumPages(numPages); setError(false)
        pdfjs.getDocument(url).promise.then((doc) => setPdfDoc(doc)).catch(() => {})
    }, [url])
    const onDocumentLoadError = useCallback(() => setError(true), [])
    const onPageRenderSuccess = useCallback(() => {
        setTimeout(() => setPageRendered(true), 150)
    }, [])

    useEffect(() => {
        if (!containerRef.current || !pageRendered) return
        // hasCoordinateBox/effectiveActiveHighlight/effectiveSectionHighlights er
        // løftet til komponent-niveau ovenfor — samme beregning genbruges her.
        let attempts = 0
        let timer: ReturnType<typeof setTimeout>
        const tryApply = () => {
            if (!containerRef.current) return
            const textLayer = containerRef.current.querySelector(".react-pdf__Page__textContent")
            const spans = textLayer ? Array.from(textLayer.querySelectorAll("span")) as HTMLElement[] : []
            const hasPageContent = spans.length > 10
            if (!hasPageContent) {
                if (attempts++ < 15) { timer = setTimeout(tryApply, 200); return }
            }
            applyHighlights(containerRef.current, highlights, effectiveActiveHighlight, effectiveSectionHighlights, effectivePreciseFocusText)
        }
        timer = setTimeout(tryApply, 300)
        return () => clearTimeout(timer)
    }, [highlights, effectiveActiveHighlight, effectiveSectionHighlights, pageNumber, pageRendered, activeClauseId, layout, effectivePreciseFocusText])


    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground text-center">
                <div><p className="font-medium">Kunne ikke indlæse PDF</p><p className="mt-1 text-xs">{url}</p></div>
            </div>
        )
    }

    const Spinner = (
        <div className="flex items-center justify-center py-24">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
    )

    return (
        <div className="flex flex-col h-full" data-pdf-viewer>
            <div className="flex items-center gap-1 border-b px-2 py-1.5 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => { setPageNumber(p => Math.max(1, p - 1)); setPageRendered(false) }}
                    disabled={pageNumber <= 1}><ChevronLeft className="h-4 w-4" /></Button>
                <span className="text-xs tabular-nums text-muted-foreground min-w-[60px] text-center">{pageNumber} / {numPages || "–"}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => { setPageNumber(p => Math.min(numPages, p + 1)); setPageRendered(false) }}
                    disabled={pageNumber >= numPages}><ChevronRight className="h-4 w-4" /></Button>
                <div className="mx-1 h-4 w-px bg-border" />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setFitMode("manual"); setScale(s => Math.max(0.25, s - 0.2)) }}><ZoomOut className="h-3.5 w-3.5" /></Button>
                <span className="text-xs tabular-nums text-muted-foreground min-w-[40px] text-center">{Math.round(scale * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setFitMode("manual"); setScale(s => Math.min(2.5, s + 0.2)) }}><ZoomIn className="h-3.5 w-3.5" /></Button>
                <Button variant={fitMode === "width" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" title="Tilpas PDF til bredden" aria-label="Tilpas PDF til bredden" onClick={() => setFitMode("width")}><Maximize2 className="h-3.5 w-3.5" /></Button>
            </div>
            <div ref={containerRef} className="flex-1 overflow-auto bg-muted/30">
                <div className="flex justify-center p-4">
                    <Document file={url} onLoadSuccess={onDocumentLoadSuccess} onLoadError={onDocumentLoadError} loading={Spinner}>
                        <div style={{ position: "relative", display: "inline-block" }}>
                            <Page pageNumber={pageNumber} scale={scale} className="shadow-sm"
                                renderTextLayer={true} renderAnnotationLayer={false}
                                onRenderSuccess={onPageRenderSuccess} loading={Spinner} />
                            {/* Koordinatbaseret fallback — den aktive kilde markeres altid gult. */}
                            {pageViewport && activeBbox && contractEvidencePage(activeEvidence) === pageNumber && (() => {
                                const style = bboxToScreenStyle(activeBbox, pageViewport)
                                return (
                                    <div key={`${activeEvidence?.fieldKey ?? activeClauseId}-${pageNumber}`}
                                        ref={(el) => { if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }) }}
                                        style={{ ...style, background: "rgba(250,204,21,0.3)", border: "2px solid rgba(202,138,4,0.7)", borderRadius: 2, zIndex: 10 }}
                                        title="Kilde i kontrakten"
                                    />
                                )
                            })()}
                        </div>
                    </Document>
                </div>
            </div>
        </div>
    )
}
