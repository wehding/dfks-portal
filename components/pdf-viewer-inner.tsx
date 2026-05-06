"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
    activeHighlight?: string | null
}

function norm(s: string): string {
    return s
        .toLowerCase()
        .replace(/\u00a0/g, " ")
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u2212/g, "-")
        .replace(/[\u201c\u201d\u2018\u2019]/g, '"')
        .replace(/\u2009/g, " ")
        .replace(/\u202f/g, " ")
        .replace(/,-/g, ",")
        // Strip blank-field underscores (PDF forms: __14.637____________)
        .replace(/_+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function buildNeedles(quote: string): string[] {
    const q = norm(quote)
    const needles: string[] = []

    // 1. Full normalised quote in slices (most specific first)
    if (q.length >= 5)  needles.push(q.slice(0, 60))
    if (q.length >= 20) needles.push(q.slice(0, 40))
    if (q.length >= 10) needles.push(q.slice(0, 25))

    // 2. For every number in the quote, generate format variants generically
    const numRe = /(\d[\d.]*)(,(\d+))?/g
    let m: RegExpExecArray | null
    while ((m = numRe.exec(q)) !== null) {
        const intPart = m[1]
        const decPart = m[3]
        const fullMatch = m[0]
        const plainInt = intPart.replace(/\./g, "")

        if (decPart !== undefined) {
            // Already Danish decimal (comma): "11,6"
            needles.push(fullMatch)
            const withUnit = q.slice(m.index, m.index + fullMatch.length + 10).trimEnd()
            needles.push(withUnit.slice(0, 15))
            needles.push(intPart + "." + decPart)
        } else if (intPart.includes(".")) {
            const dotParts = intPart.split(".")
            const isDecimal = dotParts[0].length <= 2 && dotParts[dotParts.length - 1].length <= 2
            if (isDecimal) {
                // Small number with dot = decimal separator: "11.6" → "11,6"
                const danish = intPart.replace(".", ",")
                needles.push(danish)
                const withUnit = q.slice(m.index, m.index + intPart.length + 10).trimEnd()
                needles.push(withUnit.replace(".", ",").slice(0, 15))
            } else {
                // Dot-thousands: "14.637"
                needles.push(intPart)
                needles.push(intPart + ",-")
                needles.push(plainInt)
            }
        } else if (plainInt.length >= 2) {
            // Plain integer
            const n = parseInt(plainInt, 10)
            if (!isNaN(n)) {
                const daThousands = n.toLocaleString("da-DK")
                needles.push(daThousands)
                needles.push(daThousands + ",-")
                needles.push(plainInt)
            }
        }
    }

    // 3. ISO date → Danish date formats
    const dateMatch = q.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (dateMatch) {
        const months = ["","januar","februar","marts","april","maj","juni","juli",
                        "august","september","oktober","november","december"]
        const day   = parseInt(dateMatch[3], 10)
        const month = parseInt(dateMatch[2], 10)
        const year  = dateMatch[1]
        needles.push(`${day}. ${months[month]}`)
        needles.push(`${day}. ${months[month]} ${year}`)
        needles.push(`${String(day).padStart(2,"0")}.${String(month).padStart(2,"0")}.${year}`)
        needles.push(`${day}/${month}/${year}`)
    }

    return [...new Set(needles)].filter((n) => n.length >= 2)
}

async function findPageForQuote(pdfDoc: any, quote: string, numPages: number): Promise<number> {
    const needles = buildNeedles(quote)
    for (let i = 1; i <= numPages; i++) {
        try {
            const page = await pdfDoc.getPage(i)
            const content = await page.getTextContent()
            const pageText = norm(content.items.map((item: any) => item.str).join(" "))
            if (needles.some((n) => pageText.includes(n))) return i
        } catch { /* skip */ }
    }
    return 1
}

// Inject persistent CSS for highlights — React cannot override these
function ensureHighlightCSS() {
    const id = "dfks-hl-css"
    if (document.getElementById(id)) return
    const style = document.createElement("style")
    style.id = id
    style.textContent = `
        .react-pdf__Page__textContent span[data-hl="true"] {
            background: rgba(253,224,71,0.55) !important;
            border-radius: 2px !important;
        }
        .react-pdf__Page__textContent span[data-hl="active"] {
            background: rgba(34,197,94,0.45) !important;
            border-radius: 2px !important;
            outline: 2px solid #16a34a !important;
        }
    `
    document.head.appendChild(style)
}

function applyHighlights(container: HTMLElement, highlights: string[], activeHighlight: string | null) {
    ensureHighlightCSS()

    container.querySelectorAll("span[data-hl]").forEach((el) => {
        el.removeAttribute("data-hl")
    })

    const textLayer = container.querySelector(".react-pdf__Page__textContent")
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
        spanMap.push({ start: normFull.length, end: normFull.length + normed.length, span })
        normFull += normed + " "
    })

    const normActive = activeHighlight ? norm(activeHighlight) : null

    highlights.forEach((quote) => {
        if (!quote || quote.length < 3) return
        const isActive = normActive !== null && norm(quote) === normActive
        const needles = buildNeedles(quote)

        for (const needle of needles) {
            const idx = normFull.indexOf(needle)
            if (idx === -1) continue
            const matchEnd = idx + needle.length
            const matched = spanMap.filter(({ start, end }) => start < matchEnd && end > idx)
            if (!matched.length) continue
            matched.forEach(({ span }) => {
                span.setAttribute("data-hl", isActive ? "active" : "true")
            })
            if (isActive && matched[0]) {
                matched[0].span.scrollIntoView({ behavior: "smooth", block: "center" })
            }
            break
        }
    })
}

export default function PdfViewer({ url, highlights = [], activeHighlight = null }: PdfViewerProps) {
    const [numPages, setNumPages] = useState(0)
    const [pageNumber, setPageNumber] = useState(1)
    const [scale, setScale] = useState(1.0)
    const [error, setError] = useState(false)
    const [pageRendered, setPageRendered] = useState(false)
    const [pdfDoc, setPdfDoc] = useState<any>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const activeHighlightRef = useRef(activeHighlight)
    const highlightsRef = useRef(highlights)
    activeHighlightRef.current = activeHighlight
    highlightsRef.current = highlights

    useEffect(() => {
        if (!activeHighlight || !pdfDoc || !numPages) return
        findPageForQuote(pdfDoc, activeHighlight, numPages).then((page) => {
            if (page !== pageNumber) {
                setPageRendered(false)
                setPageNumber(page)
            } else {
                // Same page — manually re-trigger highlights
                if (containerRef.current) {
                    applyHighlights(containerRef.current, highlightsRef.current, activeHighlightRef.current)
                }
            }
        })
    }, [activeHighlight]) // eslint-disable-line

    useEffect(() => {
        if (!containerRef.current || !pageRendered) return
        let attempts = 0
        let timer: ReturnType<typeof setTimeout>
        const tryApply = () => {
            if (!containerRef.current) return
            const textLayer = containerRef.current.querySelector(".react-pdf__Page__textContent")
            const spans = textLayer?.querySelectorAll("span")
            if (!spans || spans.length === 0) {
                // Text layer not ready yet — retry up to 5 times
                if (attempts++ < 5) timer = setTimeout(tryApply, 300)
                return
            }
            applyHighlights(containerRef.current, highlights, activeHighlight)
        }
        timer = setTimeout(tryApply, 400)
        return () => clearTimeout(timer)
    }, [highlights, activeHighlight, pageNumber, pageRendered])

    const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
        setNumPages(numPages); setError(false)
        pdfjs.getDocument(url).promise.then((doc) => setPdfDoc(doc)).catch(() => {})
    }, [url])
    const onDocumentLoadError = useCallback(() => setError(true), [])
    const onPageRenderSuccess = useCallback(() => setPageRendered(true), [])

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
