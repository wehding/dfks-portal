"use client"

/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { useState, useCallback, useEffect, useRef } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { norm, buildNeedles as resolveNeedles } from "@/lib/resolveAnker"
import type { ContractLayout } from "@/lib/contract-layout"
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
    // Lag 5: koordinatbaseret highlight
    layout?: ContractLayout | null
    activeClauseId?: string | null
}

type PageViewport = { pdfWidth: number; pdfHeight: number; renderedWidth: number; renderedHeight: number }

/** Konverter PDF-bounding-box (y=0 ved bund) til CSS-position i en rendered side. */
function bboxToScreenStyle(
    bbox: { x: number; y: number; width: number; height: number },
    vp: PageViewport,
): React.CSSProperties {
    const scaleX = vp.renderedWidth / vp.pdfWidth
    const scaleY = vp.renderedHeight / vp.pdfHeight
    const left = bbox.x * scaleX
    const top = vp.renderedHeight - (bbox.y + bbox.height) * scaleY
    const width = bbox.width * scaleX
    const height = bbox.height * scaleY
    return { position: "absolute", left, top, width, height, pointerEvents: "none" }
}

// norm() og buildNeedles importeret fra lib/resolveAnker.ts

function buildNeedles(quote: string): string[] {
    // Delegér til resolveAnker.buildNeedles (inkl. tal-prioritering og date-variants)
    return resolveNeedles(quote)
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
            background: rgba(74,222,128,0.55) !important;
            box-shadow: 0 0 0 1px rgba(21,128,61,0.55) !important;
        }
    `
    document.head.appendChild(style)
}

function applyHighlights(container: HTMLElement, highlights: string[], activeHighlight: string | null, sectionHighlights: string[] = []) {
    ensureHighlightCSS()

    container.querySelectorAll("span[data-hl]").forEach((el) => {
        el.removeAttribute("data-hl")
    })

    // Find text layer inside the current page element
    const pageEl = container.querySelector(".react-pdf__Page")
    const textLayer = pageEl?.querySelector(".react-pdf__Page__textContent")
    if (!textLayer) return
    const spans = Array.from(textLayer.querySelectorAll("span")) as HTMLElement[]
    if (!spans.length) return

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
        ...activeCandidates.filter(c => c.length >= 2),
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
                    matched.forEach(({ span }) => {
                        span.setAttribute("data-hl", isActive ? "active" : "match")
                    })
                    if (isActive && matched[0]) {
                        matched[0].span.scrollIntoView({ behavior: "smooth", block: "center" })
                    }
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
                trimmed.forEach(({ span }) => {
                    span.setAttribute("data-hl", isActive ? "active" : "match")
                })
                if (isActive && trimmed[0]) {
                    trimmed[0].span.scrollIntoView({ behavior: "smooth", block: "center" })
                }
            }
            break
        }
    })
}

export default function PdfViewer({ url, highlights = [], sectionHighlights = [], activeHighlight = null, pageNavigationHint, layout, activeClauseId }: PdfViewerProps) {
    const [numPages, setNumPages] = useState(0)
    const [pageNumber, setPageNumber] = useState(1)
    const [scale, setScale] = useState(1.0)
    const [error, setError] = useState(false)
    const [pageRendered, setPageRendered] = useState(false)
    const [pdfDoc, setPdfDoc] = useState<any>(null)
    const [pageViewport, setPageViewport] = useState<PageViewport | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const activeHighlightRef = useRef(activeHighlight)
    const highlightsRef = useRef(highlights)
    const sectionHighlightsRef = useRef(sectionHighlights)
    activeHighlightRef.current = activeHighlight
    highlightsRef.current = highlights
    sectionHighlightsRef.current = sectionHighlights

    useEffect(() => {
        if (!activeHighlight || !pdfDoc || !numPages) return
        const navSource = pageNavigationHint ?? activeHighlight
        const candidates = navSource.split("||").map(s => s.trim()).filter(Boolean)
        const tryNext = async (idx: number): Promise<number> => {
            if (idx >= candidates.length) return 0
            const page = await findPageForQuote(pdfDoc, candidates[idx], numPages)
            return page > 0 ? page : tryNext(idx + 1)
        }
        tryNext(0).then((page) => {
            const targetPage = page > 0 ? page : 1
            if (targetPage !== pageNumber) {
                setPageRendered(false)
                setPageNumber(targetPage)
            } else {
                if (containerRef.current) {
                    applyHighlights(containerRef.current, highlightsRef.current, activeHighlightRef.current, sectionHighlightsRef.current)
                }
            }
        })
    }, [activeHighlight, pageNavigationHint, pdfDoc, numPages]) // eslint-disable-line

    // Lag 5: naviger til klausulens side ved activeClauseId-skift
    useEffect(() => {
        if (!activeClauseId || !layout) return
        const clause = layout.clauses.find(c => c.id === activeClauseId)
        // [LAG5-C] Trin 3: findes klausulen og har den pdfBbox?
        console.log(`[LAG5-C] activeClauseId=${activeClauseId}, fundet=${!!clause}, pdfBbox=${clause?.pdfBbox ? JSON.stringify(clause.pdfBbox) : "MANGLER"}, pageViewport=${pageViewport ? `${pageViewport.renderedWidth}x${pageViewport.renderedHeight}` : "NULL"}`)
        if (!clause) return
        const targetPage = clause.page ?? 1
        if (targetPage !== pageNumber) {
            setPageRendered(false)
            setPageNumber(targetPage)
        }
    }, [activeClauseId, layout]) // eslint-disable-line

    // Lag 5: hent sidedimensioner fra pdfDoc via PDF-viewport * scale (ingen DOM-måling)
    // Kører når pdfDoc skifter ELLER side/scale ændres — kræver IKKE pageRendered
    // (DOM-måling via offsetWidth var upålidelig og skabte race condition med pageRendered)
    useEffect(() => {
        if (!pdfDoc) return
        pdfDoc.getPage(pageNumber).then((page: any) => {
            const vp = page.getViewport({ scale: 1 })
            const newVp = {
                pdfWidth: vp.width,
                pdfHeight: vp.height,
                renderedWidth: vp.width * scale,
                renderedHeight: vp.height * scale,
            }
            console.log(`[LAG5-D] pageViewport sat: ${newVp.renderedWidth.toFixed(0)}x${newVp.renderedHeight.toFixed(0)}px (PDF: ${newVp.pdfWidth}x${newVp.pdfHeight}pt, scale=${scale})`)
            setPageViewport(newVp)
        }).catch((e: unknown) => console.warn("[LAG5-D] getPage fejl:", e))
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
        // Lag 5 og tekst-søgning er gensidigt udelukkende:
        // hvis koordinat-boksen dækker det aktive felt, undertrykkes den grønne ord-markering.
        const hasCoordinateBox = !!(
            activeClauseId && layout &&
            layout.clauses.find(c => c.id === activeClauseId && c.page === pageNumber)?.pdfBbox
        )
        const effectiveActiveHighlight = hasCoordinateBox ? null : activeHighlight
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
            applyHighlights(containerRef.current, highlights, effectiveActiveHighlight, sectionHighlights)
        }
        timer = setTimeout(tryApply, 300)
        return () => clearTimeout(timer)
    }, [highlights, sectionHighlights, activeHighlight, pageNumber, pageRendered, activeClauseId, layout])


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
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-1 border-b px-2 py-1.5 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => { setPageNumber(p => Math.max(1, p - 1)); setPageRendered(false) }}
                    disabled={pageNumber <= 1}><ChevronLeft className="h-4 w-4" /></Button>
                <span className="text-xs tabular-nums text-muted-foreground min-w-[60px] text-center">{pageNumber} / {numPages || "–"}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => { setPageNumber(p => Math.min(numPages, p + 1)); setPageRendered(false) }}
                    disabled={pageNumber >= numPages}><ChevronRight className="h-4 w-4" /></Button>
                <div className="mx-1 h-4 w-px bg-border" />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setScale(s => Math.max(0.4, s - 0.2))}><ZoomOut className="h-3.5 w-3.5" /></Button>
                <span className="text-xs tabular-nums text-muted-foreground min-w-[40px] text-center">{Math.round(scale * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setScale(s => Math.min(2.5, s + 0.2))}><ZoomIn className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setScale(1.0)}><Maximize2 className="h-3.5 w-3.5" /></Button>
                {activeHighlight && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded border bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800">
                        Aktiv kilde markeres med gul
                    </span>
                )}
            </div>
            <div ref={containerRef} className="flex-1 overflow-auto bg-muted/30">
                <div className="flex justify-center p-4">
                    <Document file={url} onLoadSuccess={onDocumentLoadSuccess} onLoadError={onDocumentLoadError} loading={Spinner}>
                        <div style={{ position: "relative", display: "inline-block" }}>
                            <Page pageNumber={pageNumber} scale={scale} className="shadow-sm"
                                renderTextLayer={true} renderAnnotationLayer={false}
                                onRenderSuccess={onPageRenderSuccess} loading={Spinner} />
                            {/* Lag 5: koordinatbaseret overlay for activeClauseId */}
                            {(() => {
                                if (!activeClauseId || !layout || !pageViewport) return null
                                const clause = layout.clauses.find(c => c.id === activeClauseId && c.page === pageNumber)
                                if (!clause?.pdfBbox) return null
                                const style = bboxToScreenStyle(clause.pdfBbox, pageViewport)
                                return (
                                    <div
                                        ref={(el) => { if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }) }}
                                        style={{ ...style, background: "rgba(234,179,8,0.25)", border: "2px solid rgba(234,179,8,0.8)", borderRadius: 2, zIndex: 10 }}
                                        title={`Klausul ${activeClauseId}`}
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
