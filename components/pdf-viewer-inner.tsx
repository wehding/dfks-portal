"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { norm, buildNeedles as resolveNeedles } from "@/lib/resolveAnker"
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
    sectionEndMarkers?: string[]
    activeHighlight?: string | null
    pageNavigationHint?: string
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
        .react-pdf__Page__textContent span[data-hl="true"] {
            background: rgba(253,224,71,0.45) !important;
        }
        .react-pdf__Page__textContent span[data-hl="active"] {
            background: rgba(34,197,94,0.4) !important;
            box-shadow: 0 0 0 1px rgba(22,163,74,0.5) !important;
        }
    `
    document.head.appendChild(style)
}

function applyHighlights(container: HTMLElement, highlights: string[], activeHighlight: string | null, sectionHighlights: string[] = [], sectionEndMarkers: string[] = []) {
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
    spans.forEach((span, i) => {
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

    const allHighlights = [...highlights, ...sectionHighlights.flatMap(s => s.split("||").map(x => x.trim()))]

    if (sectionHighlights.length > 0) {
        const terms = allHighlights.map(q => norm(q)).filter(Boolean)
        console.log("[hl] normFull (200):", normFull.slice(0, 200))
        console.log("[hl] søger efter:", terms.slice(0, 5))
        console.log("[hl] fundet:", terms.filter(t => normFull.includes(t)))
        console.log("[hl] spans:", spans.length, "| activeHighlight:", activeHighlight?.slice(0, 40))
    }

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

            let matchStart = idx
            let matchEnd = idx + needle.length

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
                        span.setAttribute("data-hl", isActive ? "active" : "true")
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
                    span.setAttribute("data-hl", isActive ? "active" : "true")
                })
                if (isActive && trimmed[0]) {
                    trimmed[0].span.scrollIntoView({ behavior: "smooth", block: "center" })
                }
            }
            break
        }
    })
}

export default function PdfViewer({ url, highlights = [], sectionHighlights = [], sectionEndMarkers = [], activeHighlight = null, pageNavigationHint }: PdfViewerProps) {
    const [numPages, setNumPages] = useState(0)
    const [pageNumber, setPageNumber] = useState(1)
    const [scale, setScale] = useState(1.0)
    const [error, setError] = useState(false)
    const [pageRendered, setPageRendered] = useState(false)
    const [pdfDoc, setPdfDoc] = useState<any>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const activeHighlightRef = useRef(activeHighlight)
    const highlightsRef = useRef(highlights)
    const sectionHighlightsRef = useRef(sectionHighlights)
    const sectionEndMarkersRef = useRef(sectionEndMarkers)
    activeHighlightRef.current = activeHighlight
    highlightsRef.current = highlights
    sectionHighlightsRef.current = sectionHighlights
    sectionEndMarkersRef.current = sectionEndMarkers

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
                    applyHighlights(containerRef.current, highlightsRef.current, activeHighlightRef.current, sectionHighlightsRef.current, sectionEndMarkersRef.current)
                }
            }
        })
    }, [activeHighlight, pageNavigationHint, pdfDoc, numPages]) // eslint-disable-line

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
        let attempts = 0
        let timer: ReturnType<typeof setTimeout>
        const tryApply = () => {
            if (!containerRef.current) return
            const textLayer = containerRef.current.querySelector(".react-pdf__Page__textContent")
            const spans = textLayer ? Array.from(textLayer.querySelectorAll("span")) as HTMLElement[] : []
            // Build a quick normFull to check if this is the right page
            let testNorm = ""
            spans.slice(0, 20).forEach(sp => { testNorm += (sp.textContent ?? "").toLowerCase() + " " })
            // If any regular highlight is on this page, OR no highlights exist, proceed
            const hasPageContent = spans.length > 10
            if (!hasPageContent) {
                if (attempts++ < 15) { timer = setTimeout(tryApply, 200); return }
            }
            // Log all page elements
            const allPages = containerRef.current?.querySelectorAll(".react-pdf__Page")
            applyHighlights(containerRef.current, highlights, activeHighlight, sectionHighlights, sectionEndMarkers)
        }
        timer = setTimeout(tryApply, 300)
        return () => clearTimeout(timer)
    }, [highlights, sectionHighlights, sectionEndMarkers, activeHighlight, pageNumber, pageRendered])

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
                {highlights.filter(Boolean).length > 0 && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded border bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800">
                        {highlights.filter(Boolean).length} markeringer
                    </span>
                )}
            </div>
            <div ref={containerRef} className="flex-1 overflow-auto bg-muted/30">
                <div className="flex justify-center p-4">
                    <Document file={url} onLoadSuccess={onDocumentLoadSuccess} onLoadError={onDocumentLoadError} loading={Spinner}>
                        <Page pageNumber={pageNumber} scale={scale} className="shadow-sm"
                            renderTextLayer={true} renderAnnotationLayer={false}
                            onRenderSuccess={onPageRenderSuccess} loading={Spinner} />
                    </Document>
                </div>
            </div>
        </div>
    )
}
