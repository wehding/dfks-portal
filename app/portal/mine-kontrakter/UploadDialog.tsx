"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Upload, X, Loader2, CheckCircle2, Sparkles, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

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
};

export default function UploadDialog({ onClose, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // AI screening
  const [screening, setScreening] = useState(false);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());

  // Form felter
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [creditedRoles, setCreditedRoles] = useState<string[]>(["Klipper"]);
  const [episodeCredits, setEpisodeCredits] = useState<{ number: number; role: string }[]>([{ number: 1, role: "Klipper" }]);
  const [duration, setDuration] = useState("");
  const [premiereDate, setPremiereDate] = useState("");

  // Gemme
  const [saving, setSaving] = useState(false);

  const isSeries = SERIES_CATEGORIES.includes(category);

  const handleFile = useCallback((f: File) => {
    const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!allowed.includes(f.type)) { toast.error("Kun PDF og DOCX understøttes"); return; }
    setFile(f);
    if (f.type === "application/pdf") setPdfUrl(URL.createObjectURL(f));
    else setPdfUrl(null);
  }, []);

  // Auto-screen ved filvalg
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setScreening(true);
    setAiFields(new Set());

    (async () => {
      try {
        const { extractTextFromFile, screenPortalContract } = await import("@/lib/ai");
        const text = await extractTextFromFile(file);
        if (cancelled) return;
        const result = await screenPortalContract(text, ROLES);
        if (cancelled) return;
        const filled = new Set<string>();
        if (result.title) { setTitle(result.title); filled.add("title"); }
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

      const { data: rhRow } = await supabase.from("rettighedshavere").select("id").eq("user_id", user.id).single();
      if (!rhRow) { toast.error("Ingen rettighedshaver-profil"); setSaving(false); return; }

      const filePath = `${orgId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: storageErr } = await supabase.storage.from(BUCKET).upload(filePath, file, { contentType: file.type });
      if (storageErr) { toast.error("Upload fejlede: " + storageErr.message); setSaving(false); return; }

      const roles = isSeries
        ? [...new Set(episodeCredits.filter(e => e.role).map(e => e.role))]
        : creditedRoles.filter(Boolean);

      const { data: saved, error: dbErr } = await supabase.from("contracts").insert({
        org_id: orgId,
        rights_holder_id: rhRow.id,
        type: "a-løn",
        status: "kladde",
        pdf_url: filePath,
      }).select().single();

      if (dbErr || !saved) { toast.error("Kunne ikke gemme kontrakten"); setSaving(false); return; }

      await supabase.from("contract_validations").insert({
        contract_id: saved.id,
        org_id: orgId,
        notes: JSON.stringify({
          workTitle: title.trim(),
          productionType: category || undefined,
          creditedRoles: roles,
          duration: duration ? Number(duration) : undefined,
          premiereDate: premiereDate || undefined,
          episodes: isSeries ? episodeCredits.filter(e => e.role) : undefined,
          submittedByMember: true,
        }),
      });

      toast.success("Kontrakt indsendt til DFKS");
      onUploaded(saved);
    } catch (e: any) {
      toast.error(e.message ?? "Fejl ved upload");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ backgroundColor: "var(--background, white)", borderRadius: "12px", width: "100%", maxWidth: pdfUrl ? "1000px" : "560px", maxHeight: "92vh", display: "flex", overflow: "hidden", border: "1px solid var(--outline-variant)", transition: "max-width 0.3s ease" }}>

        {/* PDF preview */}
        {pdfUrl && (
          <div style={{ flex: 1, backgroundColor: "#f0f2f5", borderRight: "1px solid var(--outline-variant)", minWidth: 0 }}>
            <iframe src={`${pdfUrl}#navpanes=0`} style={{ width: "100%", height: "100%", border: "none" }} title="Forhåndsvisning" />
          </div>
        )}

        {/* Formular */}
        <div style={{ width: pdfUrl ? "420px" : "100%", padding: "28px", overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column", gap: "18px" }}>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--on-surface)" }}>Upload Kontrakt</h2>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
            style={{ border: `2px dashed ${isDragging ? "var(--on-surface)" : "var(--outline-variant)"}`, borderRadius: "10px", padding: "28px", textAlign: "center", backgroundColor: isDragging ? "var(--surface-container-low)" : "transparent", transition: "all 0.2s" }}
          >
            <Upload size={28} style={{ margin: "0 auto 10px", color: "var(--on-surface-variant)", opacity: 0.5 }} />
            <p style={{ fontSize: "14px", color: "var(--on-surface-variant)", margin: "0 0 8px" }}>Træk fil hertil eller</p>
            <label style={{ cursor: "pointer" }}>
              <input type="file" accept=".pdf,.doc,.docx" style={{ display: "none" }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <span style={{ padding: "7px 18px", borderRadius: "6px", border: "1px solid var(--outline-variant)", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>Vælg fil</span>
            </label>
            <p style={{ fontSize: "12px", color: "var(--on-surface-variant)", margin: "8px 0 0" }}>PDF eller DOCX</p>
          </div>

          {/* Fil + screening-status */}
          {file && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", border: "1px solid var(--outline-variant)", borderRadius: "8px", backgroundColor: "var(--surface-container-low, #f8f8f8)" }}>
              {screening
                ? <Loader2 size={16} style={{ flexShrink: 0, color: "#9333ea", animation: "spin 1s linear infinite" }} />
                : <CheckCircle2 size={16} style={{ flexShrink: 0, color: "#16a34a" }} />
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                {screening && <div style={{ fontSize: "12px", color: "#9333ea", marginTop: "2px", display: "flex", alignItems: "center", gap: "4px" }}><Sparkles size={11} /> Screener med Claude AI...</div>}
              </div>
              {!screening && (
                <button onClick={() => { setFile(null); setPdfUrl(null); setTitle(""); setCategory(""); setCreditedRoles(["Klipper"]); setDuration(""); setPremiereDate(""); setAiFields(new Set()); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)" }}><X size={15} /></button>
              )}
            </div>
          )}

          {/* Formularfelter — vises efter screening */}
          {file && !screening && (
            <>
              {/* Titel */}
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "var(--on-surface-variant)", letterSpacing: "0.04em" }}>
                  PRODUKTIONSTITEL {aiFields.has("title") && <Sparkles size={11} style={{ color: "#9333ea" }} />}
                </label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Filmens eller seriens titel" style={{ width: "100%", padding: "9px 12px", borderRadius: "6px", border: "1px solid var(--outline-variant)", fontSize: "14px", backgroundColor: aiFields.has("title") ? "#faf5ff" : "transparent", color: "var(--on-surface)", boxSizing: "border-box" }} />
              </div>

              {/* Kategori */}
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "var(--on-surface-variant)", letterSpacing: "0.04em" }}>
                  KATEGORI {aiFields.has("category") && <Sparkles size={11} style={{ color: "#9333ea" }} />}
                </label>
                <select value={category} onChange={e => setCategory(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: "6px", border: "1px solid var(--outline-variant)", fontSize: "14px", backgroundColor: aiFields.has("category") ? "#faf5ff" : "var(--background, white)", color: "var(--on-surface)" }}>
                  <option value="">—</option>
                  {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {/* Kreditering */}
              {!isSeries ? (
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "var(--on-surface-variant)", letterSpacing: "0.04em" }}>
                    KREDITERET FUNKTION {aiFields.has("creditedRole") && <Sparkles size={11} style={{ color: "#9333ea" }} />}
                  </label>
                  {creditedRoles.map((role, idx) => (
                    <div key={idx} style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
                      <select value={role} onChange={e => setCreditedRoles(prev => prev.map((r, i) => i === idx ? e.target.value : r))} style={{ flex: 1, padding: "9px 12px", borderRadius: "6px", border: "1px solid var(--outline-variant)", fontSize: "14px", backgroundColor: "var(--background, white)", color: "var(--on-surface)" }}>
                        <option value="">—</option>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      {creditedRoles.length > 1 && (
                        <button onClick={() => setCreditedRoles(prev => prev.filter((_, i) => i !== idx))} style={{ padding: "0 10px", border: "1px solid var(--outline-variant)", borderRadius: "6px", background: "none", cursor: "pointer", color: "var(--on-surface-variant)" }}><X size={14} /></button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setCreditedRoles(prev => [...prev, ""])} style={{ display: "flex", alignItems: "center", gap: "4px", background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "var(--on-surface-variant)", padding: "4px 0" }}>
                    <Plus size={13} /> Tilføj kreditering
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--on-surface-variant)", letterSpacing: "0.04em" }}>AFSNIT & KREDITERING</label>
                    <button onClick={() => setEpisodeCredits(prev => [...prev, { number: (prev.at(-1)?.number ?? 0) + 1, role: prev.at(-1)?.role ?? "Klipper" }])} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", border: "1px solid var(--outline-variant)", borderRadius: "6px", background: "none", cursor: "pointer", fontSize: "12px" }}>
                      <Plus size={12} /> Tilføj afsnit
                    </button>
                  </div>
                  {episodeCredits.map((ec, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "52px 1fr 32px", gap: "6px", marginBottom: "6px", alignItems: "center" }}>
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", fontSize: "11px", color: "var(--on-surface-variant)" }}>#</span>
                        <input type="number" value={ec.number} min={1} onChange={e => setEpisodeCredits(prev => prev.map((x, i) => i === idx ? { ...x, number: parseInt(e.target.value) || 1 } : x))} style={{ width: "100%", padding: "8px 4px 8px 20px", borderRadius: "6px", border: "1px solid var(--outline-variant)", fontSize: "13px", boxSizing: "border-box" }} />
                      </div>
                      <select value={ec.role} onChange={e => setEpisodeCredits(prev => prev.map((x, i) => i === idx ? { ...x, role: e.target.value } : x))} style={{ padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--outline-variant)", fontSize: "13px", backgroundColor: "var(--background, white)", color: "var(--on-surface)" }}>
                        <option value="">—</option>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button onClick={() => setEpisodeCredits(prev => prev.filter((_, i) => i !== idx))} style={{ padding: "0", border: "none", background: "none", cursor: "pointer", color: "var(--on-surface-variant)" }}><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Varighed / premieredato */}
              {!isSeries && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "var(--on-surface-variant)", letterSpacing: "0.04em" }}>
                      VARIGHED (MIN) {aiFields.has("duration") && <Sparkles size={11} style={{ color: "#9333ea" }} />}
                    </label>
                    <input type="number" value={duration} onChange={e => setDuration(e.target.value)} placeholder="90" style={{ width: "100%", padding: "9px 12px", borderRadius: "6px", border: "1px solid var(--outline-variant)", fontSize: "14px", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "var(--on-surface-variant)", letterSpacing: "0.04em" }}>
                      PREMIEREDATO {aiFields.has("premiereDate") && <Sparkles size={11} style={{ color: "#9333ea" }} />}
                    </label>
                    <input type="date" value={premiereDate} onChange={e => setPremiereDate(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: "6px", border: "1px solid var(--outline-variant)", fontSize: "14px", boxSizing: "border-box" }} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Gem-knap med progressbar */}
          {file && !screening && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {saving && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--on-surface-variant)" }}>
                    <Loader2 size={14} style={{ animation: "spin 1s linear infinite", color: "var(--primary, #000)" }} />
                    Uploader og gemmer kontrakt...
                  </div>
                  <div style={{ width: "100%", height: "4px", backgroundColor: "var(--surface-container-high, #e4e4e4)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ height: "100%", backgroundColor: "var(--on-surface, #000)", animation: "upload-progress 8s ease-out forwards", borderRadius: "2px" }} />
                  </div>
                  <style>{`@keyframes upload-progress{0%{width:0%}40%{width:55%}80%{width:85%}95%{width:93%}}`}</style>
                </div>
              )}
              <button onClick={handleSubmit} disabled={!canSubmit} style={{ padding: "12px 24px", borderRadius: "6px", border: "none", backgroundColor: canSubmit ? "var(--on-surface, #000)" : "var(--surface-container-high, #e4e4e4)", color: canSubmit ? "var(--surface, white)" : "var(--on-surface-variant)", fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "14px" }}>
                <Upload size={15} /> Indsend til DFKS
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
