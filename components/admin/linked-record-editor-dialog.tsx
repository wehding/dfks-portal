"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditorKindIcon, SharedContractEditor, SharedWorkEditor } from "@/components/admin/shared-record-editors";

type LinkedRecord = {
  id: string;
  kind: "work" | "contract";
  title?: string | null;
};

export function LinkedRecordEditorDialog({
  record,
  onOpenChange,
  onSaved,
}: {
  record: LinkedRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const label = record?.kind === "work" ? "værk" : "kontrakt";
  const close = () => onOpenChange(false);
  const width = record?.kind === "work"
    ? "sm:w-[min(1360px,calc(100vw-2rem))] sm:!max-w-none"
    : "sm:w-full sm:max-w-4xl lg:max-w-[1180px]";

  return (
    <Dialog open={Boolean(record)} onOpenChange={onOpenChange}>
      <DialogContent className={`flex h-[100dvh] max-h-[100dvh] max-w-none flex-col overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:rounded-lg ${width}`}>
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><EditorKindIcon kind={record?.kind ?? "contract"} />Rediger {label}</DialogTitle>
          <DialogDescription>
            {record?.title ?? `Det valgte ${label}`} redigeres her, uden at du forlader listen.
          </DialogDescription>
        </DialogHeader>
        {record?.kind === "work" && <SharedWorkEditor key={record.id} workId={record.id} onClose={close} onSaved={onSaved} />}
        {record?.kind === "contract" && <SharedContractEditor key={record.id} contractId={record.id} onClose={close} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}
