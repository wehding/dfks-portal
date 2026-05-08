"use client"

import { useState, useCallback } from "react"
import { Upload, CheckCircle2, FileText, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"

interface UploadContractDialogProps {
    open: boolean
    onClose: () => void
    productionTitle: string
    onUploaded: (productionId: string, file: File) => void
    productionId: string
}

export function UploadContractDialog({
    open,
    onClose,
    productionTitle,
    onUploaded,
    productionId,
}: UploadContractDialogProps) {
    const [file, setFile] = useState<File | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const [uploading, setUploading] = useState(false)

    const handleFile = useCallback((f: File) => {
        if (f.type !== "application/pdf") {
            toast.error("Kun PDF-filer er tilladt")
            return
        }
        setFile(f)
    }, [])

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            setIsDragging(false)
            if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0])
        },
        [handleFile]
    )

    const handleSubmit = async () => {
        if (!file) return
        setUploading(true)
        // TODO: upload til storage / database
        await new Promise((r) => setTimeout(r, 800)) // simulér upload
        onUploaded(productionId, file)
        toast.success("Kontrakt uploadet — afventer godkendelse")
        setFile(null)
        setUploading(false)
        onClose()
    }

    const handleClose = () => {
        if (uploading) return
        setFile(null)
        onClose()
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Upload kontrakt</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Produktion */}
                    <div className="rounded-md border bg-muted/40 px-4 py-3">
                        <p className="text-xs text-muted-foreground">Værk</p>
                        <p className="mt-0.5 text-sm font-medium">{productionTitle}</p>
                    </div>

                    {/* Drop zone */}
                    {!file ? (
                        <div
                            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                                isDragging
                                    ? "border-foreground/50 bg-muted/50"
                                    : "border-muted-foreground/20"
                            }`}
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                        >
                            <Upload className="mx-auto h-8 w-8 text-muted-foreground/40" />
                            <p className="mt-3 text-sm">Træk og slip din PDF her</p>
                            <p className="mt-1 text-xs text-muted-foreground">eller</p>
                            <label className="mt-3 inline-block cursor-pointer">
                                <input
                                    type="file"
                                    accept=".pdf"
                                    className="hidden"
                                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                                />
                                <span className="rounded-md border px-4 py-2 text-sm hover:bg-muted transition-colors">
                                    Vælg PDF
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-muted-foreground">Maks 25MB · Kun PDF</p>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
                            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {(file.size / 1024 / 1024).toFixed(1)} MB
                                </p>
                            </div>
                            <button
                                onClick={() => setFile(null)}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                        Kontrakten sendes til DFKS til godkendelse. Du får besked når den er behandlet.
                    </p>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={uploading}>
                        Annuller
                    </Button>
                    <Button onClick={handleSubmit} disabled={!file || uploading}>
                        {uploading ? (
                            <>Uploader...</>
                        ) : (
                            <>
                                <Upload className="h-3.5 w-3.5 mr-1.5" />
                                Upload kontrakt
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
