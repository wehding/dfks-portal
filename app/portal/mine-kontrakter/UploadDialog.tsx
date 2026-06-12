"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Upload, X, Loader2, CheckCircle2, Sparkles, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { saveUploadedContract } from "@/app/actions/member-contracts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BUCKET = "kontrakter";
const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

const ROLES = ["Klipper", "Film Editor", "Klippeassistent", "Dramaturg", "Klipper/Instruktør"];
const SERIES_CATEGORIES = ["tvSeries", "docSeries", "tvEntertainment", "reality", "sport"];
const CATEGORY_LABELS: Record<string, string> = {
  feature: "Spillefilm", short: "Kortfilm", tvSeries: "TV-serie",
  documentary: "Dokumentar", docSeries: "Dokumentarserie",
  tvEntertainment: "TV-underholdning", reality: "Reality", sport: "Sport",
};

type Props = {
  onClose: () => void;
  onUploaded: (contract: any) => void;
  workId?: string;
  workTitle?: string;
};

export default function UploadDialog({ onClose, onUploaded, workId, workTitle }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [screening, setScreening] = useState(false);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState(workTitle ?? "");
  const [category, setCategory] = useState("");
  const [creditedRoles, setCreditedRoles] = useState<string[]>(["Klipper"]);
  const [episodeCredits, setEpisodeCredits] = useState<{ number: number; role: string }[]>([{ number: 1, role: "Klipper" }]);
  const [duration, setDuration] = useState("");
  const [premiereDate, setPremiereDate] = useState("");
  const [saving, setSaving] = useState(false);

  const isSeries = SERIES_CATEGORIES.includes(category);

  // Hent varighed og kreditering fra det kendte værk
  useEffect(() => {
    if (!workId) return;
    (async () => {
      const supabase = createClient();

      const { data: work } = await supabase
        .from("works")
        .select("duration_minutes")
        .eq("id", workId)
        .single();
      if (work?.duration_minutes) {
        setDuration(String(work.duration_minutes));
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: rh } = await supabase
          .from("rettighedshavere")
          .select("id")
          .eq("user_id", user.id)
          .single();
        if (rh) {
          const { data: assignment } = await supabase
            .from("work_assignments")
            .select("role")
            .eq("work_id", workId)
            .eq("rights_holder_id", rh.id)
            .single();
          if (assignment?.role) {
            setCreditedRoles([assignment.role]);
          }
        }
      }
    })();
  }, [workId]);

  const handleFile = useCallback((f: File) => {
    const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!allowed.includes(f.type)) { toast.error("Kun PDF og DOCX understøttes"); return; }
    setFile(f);
    if (f.type === "application/pdf") setPdfUrl(URL.createObjectURL(f));
    else setPdfUrl(null);
  }, []);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setScreening(true);
    setAiFields(new Set());
    (async () => {
      try {
        const { extractTextFromFile, screenPortalContract } = await import("@/lib/ai");
        const { maskPersonalData } = await import("@/lib/mask-text");
        const rawText = await extractTextFromFile(file);
        const text = maskPersonalData(rawText);
        if (cancelled) return;
        const result = await screenPortalContract(text, ROLES);
        if (cancelled) return;
        const filled = new Set<string>();
        if (result.title && !workTitle) { setTitle(result.title); filled.add("title"); }
        if (result.category && CATEGORY_LABELS[result.category]) { setCategory(result.category); filled.add("category"); }
        if (result.creditedRole) {
          const match = ROLES.find(r => r.toLowerCase() === result.creditedRole!.toLowerCase());
          if (match) { setCreditedRoles([match]); filled.add("creditedRole"); }
        }
        if (result.premiereDate) { setPremiereDate(result.premiereDate); filled.add("premiereDate"); }
        if (result.duration && result.duration > 0) { setDuration(String(result.duration)); filled.add("duration"); }
        setAiFields(filled);
        if (filled.size > 0) toast.success(`${filled.size} felt${filled.size > 1 ? "er" : ""} udfyldt automatisk — kontrollér og ret`);
      } catch (e: any) {
        if (!cancelled) toast.error(`Screening fejlede: ${e.message}`);
      } finally {
        if (!cancelled) setScreening(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  const canSubmit = !!file && !!title && !screening && !saving &&
    (isSeries ? episodeCredits.some(e => e.role) : creditedRoles.some(Boolean));

  const handleSubmit = async () => {
    if (!file || !title) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Ikke logget ind"); setSaving(false); return; }

      const { data: orgRow } = await supabase.from("org_affiliations").select("org_id").eq("rights_holder_id",
        (await supabase.from("rettighedshavere").select("id").eq("user_id", user.id).single()).data?.id ?? ""
      ).single();
      const orgId = orgRow?.org_id ?? DFKS_ORG_ID;

      const { data: rhRow } = await supabase.from("rettighedshavere").select("id, full_name").eq("user_id", user.id).single();
      if (!rhRow) { toast.error("Ingen rettighedshaver-profil"); setSaving(false); return; }

      const filePath = `${orgId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: storageErr } = await supabase.storage.from(BUCKET).upload(filePath, file, { contentType: file.type });
      if (storageErr) { toast.error("Upload fejlede: " + storageErr.message); setSaving(false); return; }

      const roles = isSeries
        ? [...new Set(episodeCredits.filter(e => e.role).map(e => e.role))]
        : creditedRoles.filter(Boolean);

      const res = await saveUploadedContract({
        filePath, orgId, rhId: rhRow.id, memberName: rhRow.full_name,
        workTitle: title.trim(), workId,
        category, roles,
        duration: duration ? Number(duration) : undefined,
        premiereDate: premiereDate || undefined,
        episodes: isSeries ? episodeCredits.filter(e => e.role) : undefined,
      });

      if (!res.success) { toast.error(res.error ?? "Kunne ikke gemme kontrakten"); setSaving(false); return; }
      toast.success("Kontrakt indsendt til DFKS");
      onUploaded(res.contract);
    } catch (e: any) {
      toast.error(e.message ?? "Fejl ved upload");
    } finally {
      setSaving(false);
    }
  };

  // Fælles select-stil (shadcn Select er overkill her — native select er tilstrækkeligt)
  const selectCls = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400";

  return (
    <div
      className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-white rounded-xl border border-gray-200 flex overflow-hidden max-h-[92vh] w-full transition-all duration-300 ${pdfUrl ? "max-w-4xl" : "max-w-lg"}`}>

        {/* PDF preview */}
        {pdfUrl && (
          <div className="flex-1 bg-gray-100 border-r border-gray-200 min-w-0">
            <iframe src={`${pdfUrl}#navpanes=0`} className="w-full h-full border-0" title="Forhåndsvisning" />
          </div>
        )}

        {/* Formular */}
        <div className={`${pdfUrl ? "w-[420px]" : "w-full"} p-7 overflow-y-auto shrink-0 flex flex-col gap-5`}>

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Upload kontrakt</h2>
              {workTitle && (
                <p className="text-sm text-gray-500 mt-0.5">
                  til <strong className="text-gray-900">{workTitle}</strong>
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
            className={`rounded-lg border-2 border-dashed p-7 text-center transition-colors ${isDragging ? "border-gray-400 bg-gray-50" : "border-gray-200 hover:border-gray-300"}`}
          >
            <Upload className="mx-auto h-7 w-7 text-gray-300 mb-2.5" />
            <p className="text-sm text-gray-500 mb-2">Træk fil hertil eller</p>
            <label className="cursor-pointer">
              <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <span className="text-sm font-medium px-4 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 transition-colors cursor-pointer">
                Vælg fil
              </span>
            </label>
            <p className="text-xs text-gray-400 mt-2">PDF eller DOCX</p>
          </div>

          {/* Fil + screening-status */}
          {file && (
            <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3">
              {screening
                ? <Loader2 className="h-4 w-4 shrink-0 text-purple-600 animate-spin" />
                : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                {screening && (
                  <p className="text-xs text-purple-600 mt-0.5 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> Screener med Claude AI...
                  </p>
                )}
              </div>
              {!screening && (
                <button
                  onClick={() => { setFile(null); setPdfUrl(null); setTitle(workTitle ?? ""); setCategory(""); setCreditedRoles(["Klipper"]); setDuration(""); setPremiereDate(""); setAiFields(new Set()); }}
                  className="text-gray-400 hover:text-gray-600 shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {/* Formularfelter */}
          {file && !screening && (
            <div className="flex flex-col gap-4">

              {/* Titel */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
                  Produktionstitel
                  {aiFields.has("title") && <Sparkles className="h-3 w-3 text-purple-500" />}
                </Label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Filmens eller seriens titel"
                  className={aiFields.has("title") ? "bg-purple-50" : ""}
                />
              </div>

              {/* Kategori */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
                  Kategori
                  {aiFields.has("category") && <Sparkles className="h-3 w-3 text-purple-500" />}
                </Label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className={`${selectCls} ${aiFields.has("category") ? "bg-purple-50" : ""}`}
                >
                  <option value="">—</option>
                  {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {/* Kreditering */}
              {!isSeries ? (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
                    Krediteret funktion
                    {aiFields.has("creditedRole") && <Sparkles className="h-3 w-3 text-purple-500" />}
                  </Label>
                  {creditedRoles.map((role, idx) => (
                    <div key={idx} className="flex gap-2 mb-1.5">
                      <select
                        value={role}
                        onChange={e => setCreditedRoles(prev => prev.map((r, i) => i === idx ? e.target.value : r))}
                        className={`${selectCls} flex-1`}
                      >
                        <option value="">—</option>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      {creditedRoles.length > 1 && (
                        <button
                          onClick={() => setCreditedRoles(prev => prev.filter((_, i) => i !== idx))}
                          className="px-2.5 rounded-md border border-gray-300 text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setCreditedRoles(prev => [...prev, ""])}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> Tilføj kreditering
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-gray-500">Afsnit og kreditering</Label>
                    <button
                      onClick={() => setEpisodeCredits(prev => [...prev, { number: (prev.at(-1)?.number ?? 0) + 1, role: prev.at(-1)?.role ?? "Klipper" }])}
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-gray-300 hover:bg-gray-50"
                    >
                      <Plus className="h-3 w-3" /> Tilføj afsnit
                    </button>
                  </div>
                  {episodeCredits.map((ec, idx) => (
                    <div key={idx} className="grid gap-1.5 mb-1.5 items-center" style={{ gridTemplateColumns: "52px 1fr 32px" }}>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">#</span>
                        <input
                          type="number" value={ec.number} min={1}
                          onChange={e => setEpisodeCredits(prev => prev.map((x, i) => i === idx ? { ...x, number: parseInt(e.target.value) || 1 } : x))}
                          className="w-full pl-5 pr-2 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                        />
                      </div>
                      <select
                        value={ec.role}
                        onChange={e => setEpisodeCredits(prev => prev.map((x, i) => i === idx ? { ...x, role: e.target.value } : x))}
                        className={selectCls}
                      >
                        <option value="">—</option>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button
                        onClick={() => setEpisodeCredits(prev => prev.filter((_, i) => i !== idx))}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Varighed / premieredato */}
              {!isSeries && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
                      Varighed (min)
                      {aiFields.has("duration") && <Sparkles className="h-3 w-3 text-purple-500" />}
                    </Label>
                    <Input
                      type="number" value={duration}
                      onChange={e => setDuration(e.target.value)}
                      placeholder="90"
                      className={aiFields.has("duration") ? "bg-purple-50" : ""}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
                      Premieredato
                      {aiFields.has("premiereDate") && <Sparkles className="h-3 w-3 text-purple-500" />}
                    </Label>
                    <Input
                      type="date" value={premiereDate}
                      onChange={e => setPremiereDate(e.target.value)}
                      className={aiFields.has("premiereDate") ? "bg-purple-50" : ""}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Upload-knap */}
          {file && !screening && (
            <div className="flex flex-col gap-2.5">
              {saving && (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploader og gemmer kontrakt...
                  </p>
                  <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-900 rounded-full" style={{ animation: "upload-progress 8s ease-out forwards" }} />
                  </div>
                  <style>{`@keyframes upload-progress{0%{width:0%}40%{width:55%}80%{width:85%}95%{width:93%}}`}</style>
                </div>
              )}
              <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full gap-2">
                <Upload className="h-4 w-4" /> Indsend til DFKS
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
