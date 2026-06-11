"use client";

import React, { useState, useEffect } from "react";
import { FileText, Upload, X, Loader2, AlertCircle, Trash2, Search } from "lucide-react";
import { uploadMemberContract, deleteMemberContract, getContractSignedUrl } from "@/app/actions/member-contracts";
import { useSearchParams } from "next/navigation";

type Validation = { svod: boolean | null; copydan: boolean | null; royalty: boolean | null } | null;
type Contract = {
  id: string;
  type: string | null;
  overenskomst: string | null;
  status: string;
  contract_date: string | null;
  start_date: string | null;
  end_date: string | null;
  pdf_url: string | null;
  created_at: string | null;
  works: { id: string; title: string; year: number | null } | null;
  employers: { id: string; name: string } | null;
  contract_validations: Validation[] | Validation;
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    kladde:    { label: "Afventer validering", color: "#92400e", bg: "#fef3c7" },
    valideret: { label: "Godkendt",            color: "#166534", bg: "#dcfce7" },
    arkiveret: { label: "Arkiveret",           color: "#71717a", bg: "#f4f4f5" },
  };
  const s = map[status] ?? { label: status, color: "#71717a", bg: "#f4f4f5" };
  return <span style={{ fontSize: "12px", fontWeight: 600, padding: "3px 10px", borderRadius: "99px", backgroundColor: s.bg, color: s.color }}>{s.label}</span>;
}

function overenskomstLabel(o: string | null) {
  const map: Record<string, string> = { "de4-fiktion": "De4 Fiktion", "de4-dokumentar": "De4 Dok.", faf: "FAF", "faf-dokumentar": "FAF Dok.", ingen: "Ingen" };
  return o ? (map[o] ?? o) : "–";
}

function getValidation(c: Contract): Validation {
  const v = c.contract_validations;
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

export default function MineKontrakterClient({ initialContracts }: { initialContracts: Contract[] }) {
  const [contracts, setContracts] = useState(initialContracts);
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("upload") === "true") setIsUploading(true);
  }, [searchParams]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const total = contracts.length;
  const godkendte = contracts.filter(c => c.status === "valideret").length;
  const afventer = contracts.filter(c => c.status === "kladde").length;

  const filtered = contracts.filter(c => {
    if (!search) return true;
    const t = search.toLowerCase();
    return (
      (c.works?.title ?? "").toLowerCase().includes(t) ||
      (c.employers?.name ?? "").toLowerCase().includes(t) ||
      (c.overenskomst ?? "").toLowerCase().includes(t)
    );
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setUploadFile(file);
    setUploadError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    setIsAnalyzing(true);
    setUploadError(null);

    const fd = new FormData();
    fd.append("file", uploadFile);
    const res = await uploadMemberContract(fd);

    if (res.success) {
      closeUpload();
      window.location.reload();
    } else {
      setUploadError(res.error ?? "Der opstod en fejl");
      setIsAnalyzing(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Er du sikker på at du vil slette denne kontrakt?")) return;
    const res = await deleteMemberContract(id);
    if (res.success) {
      setContracts(prev => prev.filter(c => c.id !== id));
      setSelectedContract(null);
      setMsg({ type: "success", text: "Kontrakt slettet." });
    } else {
      setMsg({ type: "error", text: res.error ?? "Kunne ikke slette" });
    }
  }

  async function openContract(contract: Contract) {
    setSelectedContract(contract);
    setViewUrl(null);
    if (!contract.pdf_url) return;
    setViewLoading(true);
    const res = await getContractSignedUrl(contract.pdf_url);
    setViewUrl(res.url ?? null);
    setViewLoading(false);
  }

  function closeUpload() {
    setIsUploading(false);
    setUploadFile(null);
    setUploadError(null);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setIsAnalyzing(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.05em", color: "var(--on-surface-variant)", marginBottom: "8px", textTransform: "uppercase" }}>
            DFKS &gt; <span style={{ color: "var(--on-surface)" }}>MINE KONTRAKTER</span>
          </div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, margin: "0 0 6px", color: "var(--on-surface)" }}>Mine Kontrakter</h1>
          <p style={{ color: "var(--on-surface-variant)", margin: 0, fontSize: "14px" }}>Upload dine kontrakter — DFKS validerer dem herefter.</p>
        </div>
        <button onClick={() => setIsUploading(true)} style={{ padding: "10px 18px", borderRadius: "6px", border: "none", backgroundColor: "var(--on-surface)", color: "var(--surface, white)", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
          <Upload size={15} /> Upload kontrakt
        </button>
      </div>

      {/* Statistik */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        {[
          { label: "TOTAL", value: total, color: "var(--on-surface)" },
          { label: "GODKENDTE", value: godkendte, color: "#16a34a" },
          { label: "AFVENTER VALIDERING", value: afventer, color: "#d97706" },
        ].map(s => (
          <div key={s.label} style={{ backgroundColor: "var(--background, white)", border: "1px solid var(--outline-variant)", borderRadius: "8px", padding: "20px 24px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--on-surface-variant)", marginBottom: "8px" }}>{s.label}</div>
            <div style={{ fontSize: "32px", fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {msg && (
        <div style={{ padding: "12px 16px", borderRadius: "6px", fontSize: "14px", display: "flex", justifyContent: "space-between", backgroundColor: msg.type === "success" ? "#E6F4EA" : "#FCE8E6", color: msg.type === "success" ? "#137333" : "#C5221F" }}>
          {msg.text}
          <button onClick={() => setMsg(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={14} /></button>
        </div>
      )}

      {/* Tabel */}
      <div style={{ backgroundColor: "var(--background, white)", border: "1px solid var(--outline-variant)", borderRadius: "8px", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--outline-variant)" }}>
          <div style={{ position: "relative", maxWidth: "300px" }}>
            <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--on-surface-variant)" }} />
            <input type="text" placeholder="Søg i kontrakter..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: "100%", padding: "7px 12px 7px 30px", borderRadius: "6px", border: "1px solid var(--outline-variant)", fontSize: "13px", backgroundColor: "var(--surface-container-low, #f8f8f8)", color: "var(--on-surface)" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr 0.8fr 40px", padding: "12px 20px", borderBottom: "1px solid var(--outline-variant)", fontSize: "11px", fontWeight: 700, color: "var(--on-surface-variant)", letterSpacing: "0.05em" }}>
          <div>VÆRK</div><div>PRODUCENT</div><div>OVERENSKOMST</div><div>RETTIGHEDER</div><div>STATUS</div><div />
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--on-surface-variant)" }}>
            <FileText size={40} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
            <p style={{ margin: 0 }}>{contracts.length === 0 ? "Ingen kontrakter endnu. Klik 'Upload kontrakt' for at starte." : "Ingen resultater."}</p>
          </div>
        ) : filtered.map(c => {
          const val = getValidation(c);
          return (
            <div key={c.id} onClick={() => openContract(c)} style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr 0.8fr 40px", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid var(--outline-variant)", cursor: "pointer", fontSize: "14px" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--surface-container-low, #f8f8f8)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <div>
                <div style={{ fontWeight: 600, color: "var(--on-surface)" }}>{c.works?.title ?? "Ikke koblet til værk"}</div>
                {c.contract_date && <div style={{ fontSize: "12px", color: "var(--on-surface-variant)" }}>{c.contract_date.substring(0, 10)}</div>}
              </div>
              <div style={{ fontSize: "13px", color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.employers?.name ?? "–"}
              </div>
              <div style={{ fontSize: "13px", color: "var(--on-surface-variant)" }}>{overenskomstLabel(c.overenskomst)}</div>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {val ? (
                  <>
                    <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "99px", fontWeight: 600, backgroundColor: val.svod ? "#18181b" : "#f4f4f5", color: val.svod ? "white" : "#71717a" }}>SVOD {val.svod ? "✓" : "✗"}</span>
                    <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "99px", fontWeight: 600, backgroundColor: val.copydan ? "#18181b" : "#f4f4f5", color: val.copydan ? "white" : "#71717a" }}>Copydan {val.copydan ? "✓" : "✗"}</span>
                  </>
                ) : <span style={{ fontSize: "12px", color: "var(--on-surface-variant)", fontStyle: "italic" }}>Afventer</span>}
              </div>
              <div>{statusBadge(c.status)}</div>
              <div onClick={e => { e.stopPropagation(); handleDelete(c.id); }} style={{ cursor: "pointer", color: "var(--on-surface-variant)", display: "flex", justifyContent: "center" }}>
                <Trash2 size={15} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Upload-panel */}
      {isUploading && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={e => { if (e.target === e.currentTarget) closeUpload(); }}>
          <div style={{ backgroundColor: "var(--background, white)", borderRadius: "12px", width: "100%", maxWidth: uploadFile ? "860px" : "480px", maxHeight: "90vh", display: "flex", overflow: "hidden", border: "1px solid var(--outline-variant)", transition: "max-width 0.3s" }}>
            {previewUrl && (
              <div style={{ flex: 1, backgroundColor: "#f0f2f5", borderRight: "1px solid var(--outline-variant)" }}>
                {uploadFile?.type === "application/pdf"
                  ? <iframe src={`${previewUrl}#navpanes=0`} style={{ width: "100%", height: "100%", border: "none" }} title="Forhåndsvisning" />
                  : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: "12px", color: "var(--on-surface-variant)" }}><FileText size={40} style={{ opacity: 0.4 }} /><span style={{ fontSize: "13px" }}>Forhåndsvisning ikke tilgængelig</span></div>
                }
              </div>
            )}
            <div style={{ width: uploadFile ? "400px" : "100%", padding: "28px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--on-surface)" }}>Upload Kontrakt</h2>
                <button onClick={closeUpload} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
              </div>
              <p style={{ fontSize: "14px", color: "var(--on-surface-variant)", margin: 0 }}>
                Upload som PDF eller DOCX. Claude analyserer automatisk — DFKS validerer herefter.
              </p>
              <form onSubmit={handleUploadSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <input type="file" accept=".pdf,.docx,.txt" onChange={handleFileChange} disabled={isAnalyzing} style={{ border: "1px solid var(--outline-variant)", padding: "14px", borderRadius: "8px", fontSize: "13px" }} />
                {isAnalyzing && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", color: "var(--on-surface-variant)" }}>
                      <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "var(--primary, #000)" }} />
                      Uploader og analyserer med Claude AI...
                    </div>
                    <div style={{ width: "100%", height: "4px", backgroundColor: "var(--surface-container-high, #e4e4e4)", borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ height: "100%", backgroundColor: "var(--on-surface, #000)", animation: "ai-progress 30s ease-out forwards", borderRadius: "2px" }} />
                    </div>
                    <style>{`@keyframes ai-progress{0%{width:0%}30%{width:40%}70%{width:75%}95%{width:92%}}`}</style>
                  </div>
                )}
                {uploadError && (
                  <div style={{ padding: "12px 14px", backgroundColor: "#FCE8E6", color: "#C5221F", borderRadius: "8px", fontSize: "13px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />{uploadError}
                  </div>
                )}
                <button type="submit" disabled={!uploadFile || isAnalyzing} style={{ backgroundColor: "var(--on-surface, #000)", color: "var(--surface, white)", padding: "12px 24px", borderRadius: "6px", border: "none", fontWeight: 600, cursor: (!uploadFile || isAnalyzing) ? "not-allowed" : "pointer", opacity: (!uploadFile || isAnalyzing) ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  {isAnalyzing ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Analyserer...</> : <><Upload size={15} /> Upload og analysér</>}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Kontrakt-visning */}
      {selectedContract && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={e => { if (e.target === e.currentTarget) setSelectedContract(null); }}>
          <div style={{ backgroundColor: "var(--background, white)", borderRadius: "12px", width: "100%", maxWidth: viewUrl ? "1100px" : "480px", maxHeight: "90vh", display: "flex", overflow: "hidden", border: "1px solid var(--outline-variant)" }}>
            {viewUrl && (
              <div style={{ flex: 1, backgroundColor: "#f0f2f5" }}>
                <iframe src={`${viewUrl}#navpanes=0`} style={{ width: "100%", height: "100%", border: "none" }} title="Kontrakt" />
              </div>
            )}
            <div style={{ width: viewUrl ? "360px" : "100%", padding: "28px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: "17px", fontWeight: 700, margin: 0, color: "var(--on-surface)" }}>
                  {selectedContract.works?.title ?? "Kontrakt"}
                </h2>
                <button onClick={() => setSelectedContract(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
              </div>
              {viewLoading && <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--on-surface-variant)", fontSize: "13px" }}><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Henter dokument...</div>}
              {statusBadge(selectedContract.status)}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  { label: "Producent", value: selectedContract.employers?.name },
                  { label: "Overenskomst", value: overenskomstLabel(selectedContract.overenskomst) },
                  { label: "Kontrakttype", value: selectedContract.type },
                  { label: "Kontraktdato", value: selectedContract.contract_date?.substring(0, 10) },
                  { label: "Startdato", value: selectedContract.start_date?.substring(0, 10) },
                  { label: "Slutdato", value: selectedContract.end_date?.substring(0, 10) },
                ].filter(r => r.value).map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", backgroundColor: "var(--surface-container-low, #f8f8f8)", borderRadius: "6px", fontSize: "13px" }}>
                    <span style={{ color: "var(--on-surface-variant)" }}>{row.label}</span>
                    <span style={{ fontWeight: 600, color: "var(--on-surface)" }}>{row.value}</span>
                  </div>
                ))}
              </div>
              {(() => {
                const val = getValidation(selectedContract);
                return val ? (
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--on-surface-variant)", letterSpacing: "0.05em", marginBottom: "8px" }}>RETTIGHEDER</div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {[{ key: "svod", label: "SVOD" }, { key: "copydan", label: "Copydan" }, { key: "royalty", label: "Royalty" }].map(r => {
                        const has = (val as any)[r.key] === true;
                        return <span key={r.key} style={{ fontSize: "12px", padding: "3px 10px", borderRadius: "99px", fontWeight: 600, backgroundColor: has ? "#18181b" : "#f4f4f5", color: has ? "white" : "#71717a" }}>{r.label} {has ? "✓" : "✗"}</span>;
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "12px", backgroundColor: "#fef3c7", borderRadius: "8px", fontSize: "13px", color: "#92400e" }}>
                    Afventer validering af DFKS — rettigheder vises når kontrakten er godkendt.
                  </div>
                );
              })()}
              <button onClick={() => handleDelete(selectedContract.id)} style={{ marginTop: "auto", padding: "10px", borderRadius: "6px", border: "1px solid #fecaca", backgroundColor: "transparent", color: "#dc2626", fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                <Trash2 size={14} /> Slet kontrakt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
