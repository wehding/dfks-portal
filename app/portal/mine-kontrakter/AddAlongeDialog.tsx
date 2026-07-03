"use client";

import React, { useCallback, useState } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { uploadMemberAttachment } from "@/app/actions/member-attachments";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Attachment = { id: string; type: string; title: string | null; pdf_url: string | null; created_at: string };

type Props = {
  contractId: string;
  onClose: () => void;
  onUploaded: (attachment: Attachment) => void;
};

export default function AddAlongeDialog({ contractId, onClose, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setTitle(prev => prev || f.name);
    setError(null);
  }, []);

  const handleSubmit = async () => {
    if (!file) return;
    setSaving(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    if (title.trim()) formData.append("title", title.trim());

    const res = await uploadMemberAttachment(contractId, formData);
    setSaving(false);
    if (!res.success || !res.attachment) {
      setError(res.error ?? "Kunne ikke uploade allongen");
      return;
    }
    toast.success("Allonge tilføjet");
    onUploaded(res.attachment);
  };

  return (
    <div
      className="fixed inset-0 bg-black/45 z-[60] flex items-center justify-center p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-7 flex flex-col gap-5">

        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Tilføj allonge</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
          className={`rounded-lg border-2 border-dashed p-7 text-center transition-colors ${isDragging ? "border-gray-400 bg-gray-50" : "border-gray-200 hover:border-gray-300"}`}
        >
          <Upload className="mx-auto h-7 w-7 text-gray-300 mb-2.5" />
          <p className="text-sm text-gray-500 mb-2">Træk fil hertil eller</p>
          <label className="cursor-pointer">
            <input type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <span className="text-sm font-medium px-4 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 transition-colors cursor-pointer">
              Vælg fil
            </span>
          </label>
          <p className="text-xs text-gray-400 mt-2">PDF, DOCX eller TXT</p>
        </div>

        {file && (
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
            </div>
            <button onClick={() => { setFile(null); setTitle(""); }} className="text-gray-400 hover:text-gray-600 shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {file && (
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-gray-500">Titel (valgfri)</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Fx Allonge — forlængelse" />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {file && (
          <Button onClick={handleSubmit} disabled={saving} className="w-full gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Tilføj
          </Button>
        )}
      </div>
    </div>
  );
}
