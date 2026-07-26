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
}: {
  record: LinkedRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const label = record?.kind === "work" ? "værk" : "kontrakt";
  const close = () => onOpenChange(false);

  return (
    <Dialog open={Boolean(record)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] max-w-none flex-col overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:max-w-[min(96vw,1040px)] sm:rounded-lg">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><EditorKindIcon kind={record?.kind ?? "contract"} />Rediger {label}</DialogTitle>
          <DialogDescription>
            {record?.title ?? `Det valgte ${label}`} redigeres her, uden at du forlader listen.
          </DialogDescription>
        </DialogHeader>
        {record?.kind === "work" && <SharedWorkEditor key={record.id} workId={record.id} onClose={close} />}
        {record?.kind === "contract" && <SharedContractEditor key={record.id} contractId={record.id} onClose={close} />}
      </DialogContent>
    </Dialog>
  );
}
