"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Upload, X, Loader2, CheckCircle2, Sparkles, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { saveUploadedContract } from "@/app/actions/member-contracts";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BUCKET = "kontrakter";
const MAX_FILES = 15;

const ROLES = ["Klipper", "Film Editor", "Klippeassistent", "Dramaturg", "Klipper/Instruktør"];
const SERIES_CATEGORIES = ["tvSeries", "docSeries", "tvEntertainment", "reality", "sport"];
const CATEGORY_LABELS: Record<string, string> = {
  feature: "Spillefilm", short: "Kortfilm", tvSeries: "TV-serie",
  documentary: "Dokumentar", docSeries: "Dokumentarserie",
  tvEntertainment: "TV-underholdning", reality: "Reality", sport: "Sport",
};

type Props = {
  onClose: () => void;
  onUploaded: (contracts: UploadedContract[]) => void;
  workId?: string;
  workTitle?: string;
  myWorks?: MyWork[];
};

type MyWork = { id: string; title: string; year: number | null; type?: string };

type UploadedContract = {
  id: string;
  type: string | null;
  status: string;
  pdf_url: string | null;
  created_at: string | null;
  working_title?: string | null;
  work_id?: string | null;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Ukendt fejl";
}

export default function UploadDialog({ onClose, onUploaded, workId, workTitle, myWorks = [] }: Props) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [screening, setScreening] = useState(false);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState(workTitle ?? "");
  const [selectedWorkId, setSelectedWorkId] = useState(workId ?? "");
  const [workSearch, setWorkSearch] = useState(workTitle ?? "");
  const [category, setCategory] = useState("");
  const [creditedRoles, setCreditedRoles] = useState<string[]>(["Klipper"]);
  const [episodeCredits, setEpisodeCredits] = useState<{ number: number; role: string }[]>([{ number: 1, role: "Klipper" }]);
  const [duration, setDuration] = useState("");
  const [premiereDate, setPremiereDate] = useState("");
  const [saving, setSaving] = useState(false);

  const file = files[0] ?? null;
  const isBatchUpload = files.length > 1;
  const isSeries = SERIES_CATEGORIES.includes(category);
  const selectedWork = selectedWorkId
    ? myWorks.find(w => w.id === selectedWorkId) ?? { id: selectedWorkId, title: workTitle ?? title, year: null }
    : null;
  const filteredWorks = myWorks.filter(w => !workSearch || w.title.toLowerCase().includes(workSearch.toLowerCase()));

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

  const handleFiles = useCallback((incoming: File[]) => {
    const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    const valid = incoming.filter(f => allowed.includes(f.type) || /\.(pdf|doc|docx)$/i.test(f.name));
    const rejected = incoming.length - valid.length;

    if (rejected > 0) toast.error("Kun PDF og DOCX understøttes");
    if (valid.length === 0) return;

    const limited = valid.slice(0, MAX_FILES);
    if (valid.length > MAX_FILES) toast.error(`Du kan højst vælge ${MAX_FILES} kontrakter ad gangen`);

    setFiles(limited);
    const first = limited[0];
    if (first.type === "application/pdf" || /\.pdf$/i.test(first.name)) setPdfUrl(URL.createObjectURL(first));
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
        if (result.title && !workTitle) {
          setTitle(result.title);
          setWorkSearch(prev => prev || result.title || "");
          filled.add("title");
        }
        if (result.category && CATEGORY_LABELS[result.category]) { setCategory(result.category); filled.add("category"); }
        if (result.creditedRole) {
          const match = ROLES.find(r => r.toLowerCase() === result.creditedRole!.toLowerCase());
          if (match) { setCreditedRoles([match]); filled.add("creditedRole"); }
        }
        if (result.premiereDate) { setPremiereDate(result.premiereDate); filled.add("premiereDate"); }
        if (result.duration && result.duration > 0) { setDuration(String(result.duration)); filled.add("duration"); }
        setAiFields(filled);
        if (filled.size > 0) toast.success(`${filled.size} felt${filled.size > 1 ? "er" : ""} udfyldt automatisk — kontrollér og ret`);
      } catch (e: unknown) {
        if (!cancelled) toast.error(`Screening fejlede: ${errorText(e)}`);
      } finally {
        if (!cancelled) setScreening(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file, workTitle]);

  const canSubmit = files.length > 0 && !!title && !screening && !saving &&
    (isSeries ? episodeCredits.some(e => e.role) : creditedRoles.some(Boolean));

  function goToAddWork() {
    const params = new URLSearchParams({ add: "1" });
    const query = workSearch.trim() || title.trim();
    if (query) params.set("q", query);
    onClose();
    router.push(`/portal/mine-vaerker?${params.toString()}`);
  }

  const saveContracts = async () => {
    if (files.length === 0 || !title) return null;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Ikke logget ind"); return null; }

      const { data: orgRole } = await supabase.from("user_org_roles").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
      const orgId = orgRole?.org_id;
      if (!orgId) { toast.error("Din bruger er ikke knyttet til en organisation"); return null; }

      const { data: rhRow } = await supabase.from("rettighedshavere").select("id, full_name").eq("user_id", user.id).single();
      if (!rhRow) { toast.error("Ingen rettighedshaver-profil"); return null; }

      const roles = isSeries
        ? [...new Set(episodeCredits.filter(e => e.role).map(e => e.role))]
        : creditedRoles.filter(Boolean);

      const savedContracts: UploadedContract[] = [];

      for (const [index, selectedFile] of files.entries()) {
        const filePath = `${orgId}/${Date.now()}_${index}_${selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: storageErr } = await supabase.storage.from(BUCKET).upload(filePath, selectedFile, { contentType: selectedFile.type });
        if (storageErr) { toast.error(`Upload fejlede for ${selectedFile.name}: ${storageErr.message}`); return null; }

        const res = await saveUploadedContract({
          filePath, orgId, rhId: rhRow.id, memberName: rhRow.full_name,
          workTitle: isBatchUpload ? title.trim() : selectedWork?.title ?? title.trim(),
          workId: isBatchUpload ? undefined : selectedWorkId || undefined,
          category, roles,
          duration: duration ? Number(duration) : undefined,
          premiereDate: premiereDate || undefined,
          episodes: isSeries ? episodeCredits.filter(e => e.role) : undefined,
        });

        if (!res.success) { toast.error(res.error ?? `Kunne ikke gemme ${selectedFile.name}`); return null; }
        savedContracts.push(res.contract);
      }

      return savedContracts;
    } catch (e: unknown) {
      toast.error(errorText(e) || "Fejl ved upload");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    const savedContracts = await saveContracts();
    if (!savedContracts) return;
    toast.success(files.length === 1 ? "Kontrakt indsendt til DFKS" : `${files.length} kontrakter indsendt til DFKS`);
    onUploaded(savedContracts);
  };

  const handleSaveAndAddWork = async () => {
    const savedContracts: UploadedContract[] | null = files.length > 0 ? await saveContracts() : [];
    if (!savedContracts) return;
    if (savedContracts.length > 0) {
      toast.success(savedContracts.length === 1 ? "Kontrakt gemt og sendt til AI-gennemlæsning" : `${savedContracts.length} kontrakter gemt og sendt til AI-gennemlæsning`);
      onUploaded(savedContracts);
    }
    goToAddWork();
  };

  // Fælles select-stil (shadcn Select er overkill her — native select er tilstrækkeligt)
  const selectCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div
      className="fixed inset-0 bg-black/45 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`flex max-h-[96svh] w-full overflow-hidden rounded-t-xl border bg-background text-foreground shadow-lg transition-all duration-300 sm:max-h-[92vh] sm:rounded-xl ${pdfUrl ? "max-w-4xl" : "max-w-lg"}`}>

        {/* PDF preview */}
        {pdfUrl && (
          <div className="hidden flex-1 bg-muted border-r min-w-0 md:block">
            <iframe src={`${pdfUrl}#navpanes=0`} className="w-full h-full border-0" title="Forhåndsvisning" />
          </div>
        )}

        {/* Formular */}
        <div className={`${pdfUrl ? "w-full md:w-[420px]" : "w-full"} flex shrink-0 flex-col gap-5 overflow-y-auto p-4 sm:p-7`}>

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Upload kontrakt</h2>
              <p className="text-sm text-muted-foreground mt-1">Du kan godt uploade flere kontrakter ad gangen.</p>
              {workTitle && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  til <strong className="text-foreground">{workTitle}</strong>
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          {pdfUrl && (
            <Button type="button" variant="outline" onClick={() => window.open(pdfUrl, "_blank", "noopener,noreferrer")} className="md:hidden">
              Åbn forhåndsvisning
            </Button>
          )}

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); handleFiles(Array.from(e.dataTransfer.files)); }}
            className={`rounded-lg border-2 border-dashed p-7 text-center transition-colors ${isDragging ? "border-primary/60 bg-primary/10" : "border-border hover:border-muted-foreground/40"}`}
          >
            <Upload className="mx-auto h-7 w-7 text-muted-foreground/50 mb-2.5" />
            <p className="text-sm text-muted-foreground mb-2">Træk fil hertil eller</p>
            <label className="cursor-pointer">
              <input type="file" accept=".pdf,.doc,.docx" multiple className="hidden" onChange={e => e.target.files && handleFiles(Array.from(e.target.files))} />
              <span className="text-sm font-medium px-4 py-1.5 rounded-md border hover:bg-muted transition-colors cursor-pointer">
                Vælg filer
              </span>
            </label>
            <p className="text-xs text-muted-foreground mt-2">PDF eller DOCX. Maks. {MAX_FILES} filer.</p>
          </div>

          {/* Fil + screening-status */}
          {files.length > 0 && (
            <div className="rounded-lg border bg-muted/40 px-3.5 py-3">
              <div className="flex items-center gap-3">
                {screening
                  ? <Loader2 className="h-4 w-4 shrink-0 text-purple-600 animate-spin" />
                  : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{file?.name}</p>
                  {isBatchUpload && <p className="text-xs text-muted-foreground mt-0.5">Kontrakt 1 af {files.length} - systemet forsøger automatisk at koble alle kontrakterne til værker</p>}
                  {screening && (
                    <p className="text-xs text-purple-600 mt-0.5 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Screener første kontrakt med Claude AI...
                    </p>
                  )}
                </div>
                {!screening && (
                  <button
                    onClick={() => { setFiles([]); setPdfUrl(null); setTitle(workTitle ?? ""); setSelectedWorkId(workId ?? ""); setWorkSearch(workTitle ?? ""); setCategory(""); setCreditedRoles(["Klipper"]); setDuration(""); setPremiereDate(""); setAiFields(new Set()); }}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {files.length > 1 && (
                <div className="mt-2 max-h-24 overflow-y-auto border-t pt-2">
                  {files.slice(1).map(extraFile => (
                    <p key={`${extraFile.name}-${extraFile.size}`} className="truncate text-xs text-muted-foreground">
                      {extraFile.name}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Formularfelter */}
          {file && !screening && (
            <div className="flex flex-col gap-4">

              {isBatchUpload && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                  Systemet forsøger automatisk at koble kontrakterne til dine eksisterende værker. Du skal selv kontrollere, at hver kontrakt er knyttet til det rigtige værk. Kontrakter uden korrekt værktilknytning kan ikke bruges til rettighedsfordeling og udløser derfor ikke rettighedspenge.
                </div>
              )}

              {/* Titel */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
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

              {/* Værkskobling */}
              {!isBatchUpload && (
              <div className="space-y-2 rounded-lg border bg-muted/40 px-3 py-3">
                <Label className="text-sm font-medium text-muted-foreground">
                  Koblet værk
                </Label>
                {selectedWork ? (
                  <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{selectedWork.title}</p>
                      {selectedWork.year && <p className="text-xs text-muted-foreground">{selectedWork.year}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedWorkId("")}
                      className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                      <Input
                        placeholder="Søg i dine værker..."
                        value={workSearch}
                        onChange={e => setWorkSearch(e.target.value)}
                        className="h-8 pl-7 text-sm bg-background"
                      />
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={handleSaveAndAddWork} disabled={saving || (files.length > 0 && !canSubmit)} className="w-full">
                      {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      Tilføj værk
                    </Button>
                    <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
                      {filteredWorks.map(w => (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => { setSelectedWorkId(w.id); setWorkSearch(""); setTitle(w.title); }}
                          className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                        >
                          <span className="font-medium text-foreground">{w.title}</span>
                          <span className="text-xs text-muted-foreground">{w.year ?? ""}</span>
                        </button>
                      ))}
                      {filteredWorks.length === 0 && (
                        <p className="px-2 py-1.5 text-sm italic text-muted-foreground">Ingen værker fundet</p>
                      )}
                    </div>
                  </>
                )}
              </div>
              )}

              {/* Kategori */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
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
                          className="px-2.5 rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
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
                    <Label className="text-sm font-medium text-muted-foreground">Afsnit og kreditering</Label>
                    <button
                      onClick={() => setEpisodeCredits(prev => [...prev, { number: (prev.at(-1)?.number ?? 0) + 1, role: prev.at(-1)?.role ?? "Klipper" }])}
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border hover:bg-muted"
                    >
                      <Plus className="h-3 w-3" /> Tilføj afsnit
                    </button>
                  </div>
                  {episodeCredits.map((ec, idx) => (
                    <div key={idx} className="grid gap-1.5 mb-1.5 items-center" style={{ gridTemplateColumns: "52px 1fr 32px" }}>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">#</span>
                        <input
                          type="number" value={ec.number} min={1}
                          onChange={e => setEpisodeCredits(prev => prev.map((x, i) => i === idx ? { ...x, number: parseInt(e.target.value) || 1 } : x))}
                          className="w-full pl-5 pr-2 py-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Varighed / premieredato */}
              {!isSeries && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
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
                    <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
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
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploader og gemmer {files.length === 1 ? "kontrakt" : `${files.length} kontrakter`}...
                  </p>
                  <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ animation: "upload-progress 8s ease-out forwards" }} />
                  </div>
                  <style>{`@keyframes upload-progress{0%{width:0%}40%{width:55%}80%{width:85%}95%{width:93%}}`}</style>
                </div>
              )}
              <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full gap-2">
                <Upload className="h-4 w-4" /> {isBatchUpload ? "Indsend kontrakter" : "Indsend til DFKS"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
