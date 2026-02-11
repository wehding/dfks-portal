"use client"

import { useState, useCallback } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import {
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    Maximize2,
} from "lucide-react"
import { Button } from "@/components/ui/button"

import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"

interface PdfViewerProps {
    url: string
}

export function PdfViewer({ url }: PdfViewerProps) {
    const [numPages, setNumPages] = useState(0)
    const [pageNumber, setPageNumber] = useState(1)
    const [scale, setScale] = useState(1.0)
    const [error, setError] = useState(false)

    const onDocumentLoadSuccess = useCallback(
        ({ numPages }: { numPages: number }) => {
            setNumPages(numPages)
            setError(false)
        },
        []
    )

    const onDocumentLoadError = useCallback(() => {
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
                    <p className="mt-1 text-xs">{url}</p>
                </div>
            </div>
        )
    }

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

                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={zoomOut}
                >
                    <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground min-w-[40px] text-center">
                    {Math.round(scale * 100)}%
                </span>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={zoomIn}
                >
                    <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={resetZoom}
                >
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
                        loading={
                            <div className="flex items-center justify-center py-24">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                            </div>
                        }
                    >
                        <Page
                            pageNumber={pageNumber}
                            scale={scale}
                            className="shadow-sm"
                            loading={
                                <div className="flex items-center justify-center py-24">
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                                </div>
                            }
                        />
                    </Document>
                </div>
            </div>
        </div>
    )
}
