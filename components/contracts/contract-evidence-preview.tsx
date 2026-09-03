"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFPageProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { evidenceBboxToViewportRect, type ContractFieldEvidence } from "@/lib/contract-workbench";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type PageDimensions = { width: number; height: number };

export function ContractEvidencePreview({
  url,
  evidence,
  label,
  onOpenDocument,
}: {
  url: string | null;
  evidence: ContractFieldEvidence | null;
  label: string;
  onOpenDocument: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageDimensions, setPageDimensions] = useState<PageDimensions | null>(null);
  const [failed, setFailed] = useState(false);
  const evidencePage = evidence?.clause?.page ?? evidence?.page ?? null;
  const page = evidencePage ?? 1;
  const pageLabel = evidencePage ? `side ${evidencePage}` : "side ukendt";
  const bbox = useMemo(() => evidence?.bbox
    ?? (evidence?.clause?.pdfBbox ? { ...evidence.clause.pdfBbox, space: "pdf_bottom_left" as const } : null), [evidence]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => setContainerWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const crop = useMemo(() => {
    if (!bbox || !pageDimensions || !containerWidth) return null;
    const horizontalPadding = 24;
    const verticalPadding = 24;
    const scale = Math.max(0.75, Math.min(2.2, (containerWidth - horizontalPadding * 2) / Math.max(bbox.width, 1)));
    const renderedWidth = pageDimensions.width * scale;
    const renderedHeight = pageDimensions.height * scale;
    const rect = evidenceBboxToViewportRect(bbox, {
      pdfWidth: pageDimensions.width,
      pdfHeight: pageDimensions.height,
      renderedWidth,
      renderedHeight,
    });
    const left = Math.max(0, Math.min(renderedWidth - containerWidth, rect.left - horizontalPadding));
    const top = Math.max(0, rect.top - verticalPadding);
    const height = Math.max(112, Math.min(250, rect.height + verticalPadding * 2));
    return { scale, renderedWidth, renderedHeight, rect, left, top, height };
  }, [bbox, containerWidth, pageDimensions]);

  if (!evidence?.quote) {
    return <div className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">Ingen kilde</div>;
  }

  if (!url || !bbox || failed) {
    return <button type="button" className="w-full rounded-md border bg-muted/20 p-4 text-left" onClick={onOpenDocument}>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><FileText className="h-4 w-4" />{label} · {pageLabel}</div>
      <blockquote className="line-clamp-5 text-sm leading-relaxed">{evidence.quote}</blockquote>
      {url && <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium">Åbn hele kontrakten <ExternalLink className="h-3.5 w-3.5" /></span>}
    </button>;
  }

  return <div data-testid="contract-evidence-preview" className="space-y-2">
    <button type="button" className="block w-full overflow-hidden rounded-md border bg-muted/30 text-left" onClick={onOpenDocument} aria-label={`Åbn hele kontrakten ved kilden til ${label}`}>
      <div ref={containerRef} className="relative w-full overflow-hidden" style={{ height: crop?.height ?? 160 }}>
        <Document file={url} onLoadError={() => setFailed(true)} loading={<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Henter kildeudsnit…</div>}>
          <div className="absolute" style={{ left: -(crop?.left ?? 0), top: -(crop?.top ?? 0) }}>
            <Page
              pageNumber={page}
              scale={crop?.scale ?? 1}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onLoadSuccess={(pdfPage: PDFPageProxy) => {
                const viewport = pdfPage.getViewport({ scale: 1 });
                setPageDimensions({ width: viewport.width, height: viewport.height });
              }}
            />
            {crop && <div
              className="pointer-events-none absolute rounded-sm border-2 border-amber-600 bg-yellow-300/35"
              style={{ left: crop.rect.left, top: crop.rect.top, width: crop.rect.width, height: crop.rect.height }}
            />}
          </div>
        </Document>
      </div>
      <div className="flex items-center justify-between border-t bg-background px-3 py-2 text-xs">
        <span className="text-muted-foreground">Side {page}</span>
        <span className="inline-flex items-center gap-1 font-medium">Åbn hele kontrakten <ExternalLink className="h-3.5 w-3.5" /></span>
      </div>
    </button>
    <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{evidence.quote}</p>
    <Button type="button" variant="outline" className="w-full" onClick={onOpenDocument}>Åbn hele kontrakten</Button>
  </div>;
}
