"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type LinkedRecord = {
  id: string;
  kind: "work" | "contract";
  title?: string | null;
};

export function LinkedRecordEditorDialog({
  record,
  onOpenChange,
}: {
  record: LinkedRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const label = record?.kind === "work" ? "værk" : "kontrakt";
  const src = record
    ? record.kind === "work"
      ? `/admin/vaerker?edit=${encodeURIComponent(record.id)}&embedded=1`
      : `/admin/kontrakter?edit=${encodeURIComponent(record.id)}&embedded=1`
    : undefined;

  const loading = Boolean(src && loadedSrc !== src);

  return (
    <Dialog open={Boolean(record)} onOpenChange={onOpenChange}>
      <DialogContent className="h-[92vh] max-w-[min(96vw,1200px)] overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Rediger {label}</DialogTitle>
          <DialogDescription>
            {record?.title ?? `Det valgte ${label}`} redigeres her, uden at du forlader listen.
          </DialogDescription>
        </DialogHeader>
        <div className="relative min-h-0 flex-1">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Indlæser {label}…
            </div>
          )}
          {src && (
            <iframe
              key={src}
              src={src}
              title={`Rediger ${label}`}
              className="h-full w-full border-0"
              onLoad={() => setLoadedSrc(src)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
