"use client"

import { useState, useCallback, useEffect } from "react"
import {
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    Maximize2,
} from "lucide-react"
import { Button } from "@/components/ui/button"

interface PdfViewerProps {
    url: string
}

export default function PdfViewer({ url }: PdfViewerProps) {
    const [numPages, setNumPages] = useState(0)
    const [pageNumber, setPageNumber] = useState(1)
    const [scale, setScale] = useState(1.0)
    const [error, setError] = useState(false)
    const [ready, setReady] = useState(false)
    const [Document, setDocument] = useState<any>(null)
    const [Page, setPage] = useState<any>(null)

    // Dynamically import react-pdf to avoid SSR issues
    // and patch URL.parse before the library loads
    useEffect(() => {
        // Polyfill URL.parse for older react-pdf internals
        if (typeof window !== "undefined" && !URL.parse) {
            ;(URL as any).parse = (val: string, base?: string) => {
                try {
                    return new URL(val, base)
                } catch {
                    return null
                }
            }
        }

        import("react-pdf").then(({ Document: Doc, Page: Pg, pdfjs }) => {
            // Use bundled worker from public folder
            pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
            setDocument(() => Doc)
            setPage(() => Pg)
            setReady(true)
        })
    }, [])

    const onDocumentLoadSuccess = useCallback(
        ({ numPages }: { numPages: number }) => {
            setNumPages(numPages)
            setPageNumber(1)
            setError(false)
        },
        []
    )

    const onDocumentLoadError = useCallback((err: any) => {
        console.error("PDF load error:", err)
        setError(true)
    }, [])

    const prevPage = () => setPageNumber((p) => Math.max(1, p - 1))
    const nextPage = () => setPageNumber((p) => Math.min(numPages, p + 1))
    const zoomIn = () => setScale((s) => Math.min(2.5, s + 0.2))
    const zoomOut = () => setScale((s) => Math.max(0.4, s - 0.2))
    const resetZoom = () => setScale(1.0)

    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                <div>
                    <p className="font-medium">Kunne ikke indlæse PDF</p>
                    <p className="mt-1 text-xs opacity-60">{url}</p>
                </div>
            </div>
        )
    }

    if (!ready || !Document || !Page) {
        return (
            <div className="flex flex-1 items-center justify-center py-24">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
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
            {/* Toolbar */}
            <div className="flex items-center gap-1 border-b px-2 py-1.5 shrink-0">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={prevPage}
                    disabled={pageNumber <= 1}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground min-w-[60px] text-center">
                    {pageNumber} / {numPages || "–"}
                </span>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={nextPage}
                    disabled={pageNumber >= numPages}
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>

                <div className="mx-1 h-4 w-px bg-border" />

                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomOut}>
                    <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground min-w-[40px] text-center">
                    {Math.round(scale * 100)}%
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomIn}>
                    <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetZoom}>
                    <Maximize2 className="h-3.5 w-3.5" />
                </Button>
            </div>

            {/* PDF render area */}
            <div className="flex-1 overflow-auto bg-muted/30">
                <div className="flex justify-center p-4">
                    <Document
                        file={url}
                        onLoadSuccess={onDocumentLoadSuccess}
                        onLoadError={onDocumentLoadError}
                        loading={Spinner}
                    >
                        <Page
                            pageNumber={pageNumber}
                            scale={scale}
                            className="shadow-sm"
                            loading={Spinner}
                            renderAnnotationLayer={false}
                            renderTextLayer={false}
                        />
                    </Document>
                </div>
            </div>
        </div>
    )
}
