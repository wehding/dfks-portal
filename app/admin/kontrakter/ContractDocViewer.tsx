"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PdfViewer } from "@/components/pdf-viewer";

// Viser et kontraktdokument inline: PDF, billede (JPEG/PNG m.fl.) eller DOCX/DOC
// (udtrukket som tekst via mammoth). Typen afgøres af filstien (pdf_url).

export function ContractDocViewer({ url, filename }: { url: string | null; filename?: string | null }) {
    const [docxText, setDocxText] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const name = (filename ?? url ?? "").toLowerCase();
    const isPdf = /\.pdf(\?|$)/.test(name);
    const isImage = /\.(jpe?g|png|webp|gif|avif)(\?|$)/.test(name);
    const isDocx = !isPdf && !isImage && /\.(docx?|doc)(\?|$)/.test(name);

    useEffect(() => {
        setDocxText(null);
        if (!url || !isDocx) return;
        let active = true;
        setLoading(true);
        fetch(url)
            .then(r => r.arrayBuffer())
            .then(async buf => {
                const mammoth = await import("mammoth");
                const res = await mammoth.extractRawText({ arrayBuffer: buf });
                if (active) setDocxText(res.value);
            })
            .catch(e => console.error("[kontrakt] DOCX-visning fejlede:", e))
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [url, isDocx]);

    if (!url) {
        return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Henter dokument…</div>;
    }
    if (isPdf) return <PdfViewer url={url} />;
    if (isImage) {
        return (
            <div className="h-full overflow-auto bg-muted/30 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="Kontrakt" className="mx-auto w-full max-w-full" />
            </div>
        );
    }
    if (isDocx) {
        if (loading) {
            return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter dokument…</div>;
        }
        return <div className="h-full overflow-auto whitespace-pre-wrap bg-white p-4 text-sm">{docxText ?? "Kunne ikke vise dokumentet."}</div>;
    }
    // Fallback: lad browseren forsøge (PDF/billeder renderes, andet downloades).
    return <iframe src={url} className="h-full w-full" title="Kontrakt" />;
}
