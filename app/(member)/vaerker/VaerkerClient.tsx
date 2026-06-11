"use client";

import React, { useState, useTransition } from "react";
import { Film, Plus, Search, Loader2, X, Check } from "lucide-react";
import { searchDFIFilms, getDFIFilmDetails } from "@/app/actions/dfi";
import { searchTMDB, getTMDBWorkDetails } from "@/app/actions/tmdb";
import { createClient } from "@/lib/supabase/client";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w185";
const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

type WorkAssignment = {
  id: string;
  role: string | null;
  works: {
    id: string;
    title: string;
    type: string;
    year: number | null;
    dfi_id: string | null;
    tmdb_id: number | null;
    poster_url: string | null;
    description: string | null;
  } | null;
};

export default function VaerkerClient({
  initialAssignments,
  rightsHolderId,
}: {
  initialAssignments: WorkAssignment[];
  rightsHolderId: string | null;
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [dfiResults, setDfiResults] = useState<any[]>([]);
  const [tmdbResults, setTmdbResults] = useState<any[]>([]);
  const [selectedResult, setSelectedResult] = useState<any>(null);
  const [selectedSource, setSelectedSource] = useState<"dfi" | "tmdb" | null>(null);
  const [role, setRole] = useState("Klipper");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setDfiResults([]);
    setTmdbResults([]);
    setSelectedResult(null);
    setSelectedSource(null);

    const [dfi, tmdb] = await Promise.all([
      searchDFIFilms(searchQuery).catch(() => ({ success: false, results: [] })),
      searchTMDB(searchQuery).catch(() => []),
    ]);

    setDfiResults((dfi as any).results?.slice(0, 8) ?? []);
    setTmdbResults((Array.isArray(tmdb) ? tmdb : []).slice(0, 8));
    setIsSearching(false);
  };

  const handleSelectDFI = async (film: any) => {
    setSelectedResult(film);
    setSelectedSource("dfi");
  };

  const handleSelectTMDB = async (item: any) => {
    setSelectedResult(item);
    setSelectedSource("tmdb");
  };

  const handleAddWork = async () => {
    if (!selectedResult || !selectedSource || !rightsHolderId) return;
    setIsSaving(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) { setIsSaving(false); return; }

    // Hent org_id
    const { data: orgRole } = await supabase
      .from("user_org_roles")
      .select("org_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const orgId = orgRole?.org_id ?? DFKS_ORG_ID;

    try {
      let workId: string | null = null;

      if (selectedSource === "dfi") {
        // Hent detaljer og opret/find
        const detailsRes = await getDFIFilmDetails(selectedResult.Id);
        const film = detailsRes.success ? (detailsRes as any).film : selectedResult;

        const dfiId = String(selectedResult.Id);
        const { data: existing } = await supabase
          .from("works")
          .select("id")
          .eq("dfi_id", dfiId)
          .maybeSingle();

        if (existing) {
          workId = existing.id;
        } else {
          const combined = ((film.Category || "") + " " + (film.Type || "")).toLowerCase();
          const workType = (combined.includes("dokumentar") && combined.includes("serie")) ? "serie"
            : combined.includes("dokumentar") ? "dokumentar"
            : (combined.includes("serie") || combined.includes("tv-")) ? "serie"
            : combined.includes("kort") ? "kortfilm"
            : "fiktion";
          const { data: newWork, error } = await supabase
            .from("works")
            .insert({
              org_id: orgId,
              dfi_id: dfiId,
              title: film.Title || film.DanishTitle || selectedResult.Title || "Ukendt titel",
              type: workType,
              year: film.ProductionYear || film.ReleaseYear || selectedResult.ProductionYear || null,
              description: film.Synopsis || null,
            })
            .select("id")
            .single();
          if (error || !newWork) throw new Error(error?.message ?? "Kunne ikke oprette værk");
          workId = newWork.id;
        }
      } else {
        // TMDB
        const tmdbId = selectedResult.id;
        const mediaType = selectedResult.media_type || "movie";
        const { data: existing } = await supabase
          .from("works")
          .select("id")
          .eq("tmdb_id", tmdbId)
          .maybeSingle();

        if (existing) {
          workId = existing.id;
        } else {
          const details = await getTMDBWorkDetails(tmdbId, mediaType);
          const d = details.success ? (details as any).details : selectedResult;
          const title = d.title || d.name || selectedResult.title || selectedResult.name || "Ukendt titel";
          const year = d.release_date
            ? parseInt(d.release_date.substring(0, 4))
            : d.first_air_date
              ? parseInt(d.first_air_date.substring(0, 4))
              : null;
          const poster = d.poster_path ? `${TMDB_IMAGE_BASE}${d.poster_path}` : null;
          const workType = mediaType === "tv" ? "serie" : "fiktion";
          const { data: newWork, error } = await supabase
            .from("works")
            .insert({
              org_id: orgId,
              tmdb_id: tmdbId,
              title,
              type: workType,
              year,
              description: d.overview || null,
              poster_url: poster,
            })
            .select("id")
            .single();
          if (error || !newWork) throw new Error(error?.message ?? "Kunne ikke oprette værk");
          workId = newWork.id;
        }
      }

      // Tilknyt rettighedshaver
      const { error: assignErr } = await supabase
        .from("work_assignments")
        .upsert(
          { work_id: workId, org_id: orgId, rights_holder_id: rightsHolderId, role },
          { onConflict: "work_id,rights_holder_id,role" }
        );
      if (assignErr) throw new Error(assignErr.message);

      // Opdater lokal liste
      const { data: newAssignment } = await supabase
        .from("work_assignments")
        .select("*, works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)")
        .eq("work_id", workId!)
        .eq("rights_holder_id", rightsHolderId)
        .single();

      if (newAssignment) {
        setAssignments((prev) => [newAssignment as WorkAssignment, ...prev]);
      }

      setMessage({ type: "success", text: "Værket er tilføjet til din liste." });
      setIsAddOpen(false);
      setSearchQuery("");
      setDfiResults([]);
      setTmdbResults([]);
      setSelectedResult(null);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Der opstod en fejl." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ padding: "32px 24px", maxWidth: "900px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 800, margin: 0, color: "var(--on-surface)" }}>Mine Værker</h1>
          <p style={{ fontSize: "14px", color: "var(--on-surface-variant)", margin: "4px 0 0" }}>
            Film og serier du har medvirket til at skabe
          </p>
        </div>
        <button
          onClick={() => setIsAddOpen(true)}
          className="stitch-btn-primary"
          style={{ display: "flex", gap: "8px", alignItems: "center", padding: "10px 18px" }}
        >
          <Plus size={16} /> Tilføj værk
        </button>
      </div>

      {/* Statusbesked */}
      {message && (
        <div style={{
          padding: "12px 16px", marginBottom: "16px", borderRadius: "var(--radius-default)", fontSize: "14px",
          backgroundColor: message.type === "success" ? "var(--tertiary-container)" : "var(--error-container)",
          color: message.type === "success" ? "var(--on-tertiary-container)" : "var(--on-error-container)",
          border: `1px solid ${message.type === "success" ? "var(--tertiary)" : "var(--error)"}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          {message.text}
          <button onClick={() => setMessage(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Værksliste */}
      {assignments.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "60px 24px",
          backgroundColor: "var(--surface-container)",
          borderRadius: "var(--radius-lg)", border: "1px dashed var(--outline)",
        }}>
          <Film size={48} style={{ color: "var(--on-surface-variant)", marginBottom: "16px" }} />
          <h3 style={{ fontSize: "18px", fontWeight: 700, margin: "0 0 8px", color: "var(--on-surface)" }}>
            Ingen værker endnu
          </h3>
          <p style={{ color: "var(--on-surface-variant)", fontSize: "14px", margin: "0 0 20px" }}>
            Tilføj film og serier du har arbejdet på.
          </p>
          <button
            onClick={() => setIsAddOpen(true)}
            className="stitch-btn-primary"
            style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}
          >
            <Plus size={16} /> Tilføj dit første værk
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
          {assignments.map((a) => {
            const w = a.works;
            if (!w) return null;
            return (
              <div key={a.id} style={{
                backgroundColor: "var(--surface-container-lowest)",
                border: "1px solid var(--outline-variant)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
              }}>
                <div style={{
                  width: "100%", aspectRatio: "2/3",
                  backgroundColor: "var(--surface-container-high)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative", overflow: "hidden",
                }}>
                  {w.poster_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={w.poster_url.startsWith("http") ? w.poster_url : `${TMDB_IMAGE_BASE}${w.poster_url}`}
                      alt={w.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <Film size={40} style={{ color: "var(--on-surface-variant)" }} />
                  )}
                </div>
                <div style={{ padding: "12px" }}>
                  <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--on-surface)", marginBottom: "4px", lineHeight: 1.3 }}>
                    {w.title}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--on-surface-variant)", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {w.year && <span>{w.year}</span>}
                    {w.year && w.type && <span>·</span>}
                    {w.type && <span style={{ textTransform: "capitalize" }}>{w.type}</span>}
                  </div>
                  {a.role && (
                    <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 600, color: "var(--primary)", backgroundColor: "var(--primary-container)", padding: "2px 8px", borderRadius: "99px", display: "inline-block" }}>
                      {a.role}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tilføj värk — slide-over */}
      {isAddOpen && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)",
          zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center",
        }} onClick={(e) => { if (e.target === e.currentTarget) setIsAddOpen(false); }}>
          <div style={{
            backgroundColor: "var(--surface-container-lowest)",
            borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
            width: "100%", maxWidth: "720px",
            maxHeight: "90vh", overflowY: "auto",
            padding: "32px 24px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "var(--on-surface)" }}>
                Tilføj Værk
              </h2>
              <button onClick={() => setIsAddOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
                <X size={20} />
              </button>
            </div>

            {/* Søgefelt */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <input
                type="text"
                placeholder="Søg titel i DFI og TMDB..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                className="stitch-input"
                style={{ flex: 1, padding: "10px 12px", fontSize: "14px" }}
              />
              <button
                onClick={handleSearch}
                disabled={isSearching}
                className="stitch-btn-secondary"
                style={{ padding: "10px 16px", display: "flex", gap: "6px", alignItems: "center" }}
              >
                {isSearching ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={16} />}
                Søg
              </button>
            </div>

            {/* Rolle */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "var(--on-surface-variant)", letterSpacing: "0.04em" }}>
                DIN ROLLE
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="stitch-input"
                style={{ padding: "10px 12px", fontSize: "14px", width: "100%" }}
              >
                {["Klipper", "Klipperansvarlig", "Assistent-klipper", "Instruktør", "Producent", "Fotograf", "Andet"].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* Søgeresultater */}
            {(dfiResults.length > 0 || tmdbResults.length > 0) && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
                {/* DFI */}
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--on-surface-variant)", letterSpacing: "0.06em", marginBottom: "10px" }}>
                    DFI FILMDATABASE ({dfiResults.length})
                  </div>
                  {dfiResults.length === 0 ? (
                    <div style={{ fontSize: "13px", color: "var(--on-surface-variant)", fontStyle: "italic" }}>Ingen resultater</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {dfiResults.map((film: any) => (
                        <button
                          key={film.Id}
                          onClick={() => handleSelectDFI(film)}
                          style={{
                            textAlign: "left", padding: "10px 12px",
                            borderRadius: "var(--radius-default)",
                            border: `1px solid ${selectedResult?.Id === film.Id && selectedSource === "dfi" ? "var(--primary)" : "var(--outline-variant)"}`,
                            backgroundColor: selectedResult?.Id === film.Id && selectedSource === "dfi" ? "var(--primary-container)" : "var(--surface-container-low)",
                            cursor: "pointer", width: "100%",
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--on-surface)" }}>
                            {film.Title}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                            {film.ProductionYear || film.ReleaseYear} · {film.Category}
                          </div>
                          {selectedResult?.Id === film.Id && selectedSource === "dfi" && (
                            <Check size={14} style={{ color: "var(--primary)", float: "right", marginTop: "-16px" }} />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* TMDB */}
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--on-surface-variant)", letterSpacing: "0.06em", marginBottom: "10px" }}>
                    TMDB ({tmdbResults.length})
                  </div>
                  {tmdbResults.length === 0 ? (
                    <div style={{ fontSize: "13px", color: "var(--on-surface-variant)", fontStyle: "italic" }}>Ingen resultater</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {tmdbResults.map((item: any) => {
                        const title = item.title || item.name;
                        const year = item.release_date
                          ? item.release_date.substring(0, 4)
                          : item.first_air_date?.substring(0, 4);
                        const isSelected = selectedResult?.id === item.id && selectedSource === "tmdb";
                        return (
                          <button
                            key={item.id}
                            onClick={() => handleSelectTMDB(item)}
                            style={{
                              textAlign: "left", padding: "10px 12px",
                              borderRadius: "var(--radius-default)",
                              border: `1px solid ${isSelected ? "var(--primary)" : "var(--outline-variant)"}`,
                              backgroundColor: isSelected ? "var(--primary-container)" : "var(--surface-container-low)",
                              cursor: "pointer", width: "100%",
                              display: "flex", gap: "10px", alignItems: "flex-start",
                            }}
                          >
                            {item.poster_path && (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={`${TMDB_IMAGE_BASE}${item.poster_path}`}
                                alt={title}
                                style={{ width: "36px", height: "54px", objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                              />
                            )}
                            <div>
                              <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--on-surface)" }}>{title}</div>
                              <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                                {year} · {item.media_type === "tv" ? "TV-serie" : "Film"}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Gem-knap */}
            {selectedResult && (
              <div style={{ borderTop: "1px solid var(--outline-variant)", paddingTop: "20px" }}>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--on-surface)", marginBottom: "12px" }}>
                  Valgt: <span style={{ color: "var(--primary)" }}>
                    {selectedResult.Title || selectedResult.title || selectedResult.name}
                  </span>{" "}
                  <span style={{ fontSize: "11px", color: "var(--on-surface-variant)", fontWeight: 400 }}>
                    ({selectedSource === "dfi" ? "DFI" : "TMDB"})
                  </span>
                </div>
                <button
                  onClick={handleAddWork}
                  disabled={isSaving}
                  className="stitch-btn-primary"
                  style={{ padding: "12px 24px", display: "flex", gap: "8px", alignItems: "center" }}
                >
                  {isSaving ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={16} />}
                  {isSaving ? "Tilføjer..." : "Tilføj til mine værker"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
