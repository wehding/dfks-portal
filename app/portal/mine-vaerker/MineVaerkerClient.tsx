"use client";

import React, { useState } from "react";
import {
  Film, Plus, Search, Loader2, X, RefreshCw, Trash2, Check,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { searchDFIFilms, getDFIFilmDetails, searchDFIPerson, getDFIPersonCredits, importApprovedDFIWorks } from "@/app/actions/dfi";
import { searchTMDB, getTMDBWorkDetails } from "@/app/actions/tmdb";
import { createClient } from "@/lib/supabase/client";

const TMDB_IMG = "https://image.tmdb.org/t/p/w154";
const TMDB_IMG_W185 = "https://image.tmdb.org/t/p/w185";
const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

type Work = { id: string; title: string; type: string; year: number | null; dfi_id: string | null; tmdb_id: number | null; poster_url: string | null; description: string | null };
type Assignment = { id: string; role: string | null; contract_id: string | null; episode_id: string | null; episodes: { episode_number: number } | null; works: Work | null };
type OtherAssignment = { work_id: string; role: string | null; rettighedshavere: { full_name: string } | null };

function typeLabel(t: string) {
  const m: Record<string, string> = { fiktion: "Feature", film: "Feature", serie: "TV-serie", dokumentar: "Dokumentar", kort: "Kortfilm", animation: "Animation", movie: "Feature", tv: "TV-serie", documentary: "Dokumentar", short: "Kortfilm" };
  return m[t?.toLowerCase()] ?? t ?? "Ukendt";
}

export default function MineVaerkerClient({
  initialAssignments, allAssignments, rightsHolderId, userName, dfiPersonId, contractedWorkIds,
}: {
  initialAssignments: Assignment[];
  allAssignments: OtherAssignment[];
  rightsHolderId: string | null;
  userName: string;
  dfiPersonId: number | null;
  contractedWorkIds: string[];
}) {
  const [assignments, setAssignments] = useState(initialAssignments);

  // Byg et map: work_id → medklippere (andre klippere på samme værk)
  const coEditorMap = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const a of allAssignments) {
      const name = a.rettighedshavere?.full_name;
      if (!name || !a.work_id) continue;
      if (!map[a.work_id]) map[a.work_id] = [];
      if (!map[a.work_id].includes(name)) map[a.work_id].push(name);
    }
    return map;
  }, [allAssignments]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("Alle");
  const [sortKey, setSortKey] = useState<"title" | "year" | "type">("year");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Tilføj-panel
  const [isAdding, setIsAdding] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [dfiResults, setDfiResults] = useState<any[]>([]);
  const [tmdbResults, setTmdbResults] = useState<any[]>([]);
  const [pickedResult, setPickedResult] = useState<any>(null);
  const [pickedSource, setPickedSource] = useState<"dfi" | "tmdb" | null>(null);
  const [addRole, setAddRole] = useState("Klipper");
  const [isSaving, setIsSaving] = useState(false);

  // DFI-guiden
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<"search" | "persons" | "credits">("search");
  const [wizardQuery, setWizardQuery] = useState(userName);
  const [wizardPersons, setWizardPersons] = useState<any[]>([]);
  const [wizardPerson, setWizardPerson] = useState<any>(null);
  const [wizardCredits, setWizardCredits] = useState<any[]>([]);
  const [wizardSelected, setWizardSelected] = useState<Record<number, boolean>>({});
  const [wizardSearching, setWizardSearching] = useState(false);
  const [wizardImporting, setWizardImporting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);

  // Redigér-panel
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null);
  const [editRole, setEditRole] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  // ── Filtrering & sortering ─────────────────────────────────
  const categories = ["Alle", "Feature", "TV-serie", "Dokumentar", "Kortfilm", "Animation"];

  const filtered = assignments
    .filter((a) => {
      const w = a.works;
      if (!w) return false;
      const t = search.toLowerCase();
      if (t && !w.title.toLowerCase().includes(t)) return false;
      if (catFilter !== "Alle" && typeLabel(w.type) !== catFilter) return false;
      return true;
    })
    .sort((a, b) => {
      const wa = a.works, wb = b.works;
      let av: any = "", bv: any = "";
      if (sortKey === "title") { av = wa?.title ?? ""; bv = wb?.title ?? ""; }
      if (sortKey === "year") { av = wa?.year ?? 0; bv = wb?.year ?? 0; }
      if (sortKey === "type") { av = typeLabel(wa?.type ?? ""); bv = typeLabel(wb?.type ?? ""); }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sortArrow = (key: typeof sortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const totalWorks = assignments.length;
  const withContract = assignments.filter(a => a.contract_id).length;
  const missingYear = assignments.filter(a => !a.works?.year).length;

  // ── Tilføj värk ───────────────────────────────────────────
  const handleSearch = async () => {
    if (!addQuery.trim()) return;
    setIsSearching(true);
    setDfiResults([]); setTmdbResults([]); setPickedResult(null); setPickedSource(null);
    const [dfi, tmdb] = await Promise.all([
      searchDFIFilms(addQuery).catch(() => ({ success: false, results: [] })),
      searchTMDB(addQuery).catch(() => []),
    ]);
    setDfiResults(((dfi as any).results ?? []).slice(0, 8));
    setTmdbResults((Array.isArray(tmdb) ? tmdb : []).slice(0, 8));
    setIsSearching(false);
  };

  const handleAddWork = async () => {
    if (!pickedResult || !pickedSource || !rightsHolderId) return;
    setIsSaving(true);
    try {
      let args: Record<string, any> = { p_org_id: DFKS_ORG_ID };

      if (pickedSource === "dfi") {
        const det = await getDFIFilmDetails(pickedResult.Id);
        const film = det.success ? (det as any).film : pickedResult;
        const combined = ((film.Category || "") + " " + (film.Type || "")).toLowerCase();
        const type = (combined.includes("dokumentar") && combined.includes("serie")) ? "serie"
          : combined.includes("dokumentar") ? "dokumentar"
          : (combined.includes("serie") || combined.includes("tv-")) ? "serie"
          : combined.includes("kort") ? "kortfilm" : "fiktion";
        args = { ...args, p_dfi_id: String(pickedResult.Id), p_title: film.Title || film.DanishTitle || "Ukendt", p_type: type, p_year: film.ProductionYear || film.ReleaseYear || null, p_description: film.Synopsis || null };
      } else {
        const det = await getTMDBWorkDetails(pickedResult.id, pickedResult.media_type || "movie");
        const d = det.success ? (det as any).details : pickedResult;
        const title = d.title || d.name || "Ukendt";
        const year = d.release_date ? parseInt(d.release_date.substring(0, 4)) : d.first_air_date ? parseInt(d.first_air_date.substring(0, 4)) : null;
        args = { ...args, p_tmdb_id: pickedResult.id, p_title: title, p_type: pickedResult.media_type === "tv" ? "serie" : "fiktion", p_year: year, p_description: d.overview || null, p_poster_url: d.poster_path ? `${TMDB_IMG_W185}${d.poster_path}` : null };
      }

      // Brug SECURITY DEFINER funktion — omgår RLS for works INSERT
      const { data: workId, error: fnErr } = await supabase.rpc("upsert_work_for_member", args);
      if (fnErr || !workId) throw new Error(fnErr?.message ?? "Kunne ikke oprette værk");

      // Tilknyt rettighedshaver — work_assignments har korrekt RLS
      await supabase.from("work_assignments").upsert(
        { work_id: workId, org_id: DFKS_ORG_ID, rights_holder_id: rightsHolderId, role: addRole },
        { onConflict: "work_id,rights_holder_id,role" }
      );

      // Hent frisk data
      const { data: fresh } = await supabase
        .from("work_assignments")
        .select("id, role, contract_id, episode_id, episodes(episode_number), works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)")
        .eq("work_id", workId)
        .eq("rights_holder_id", rightsHolderId)
        .single();
      if (fresh) setAssignments(prev => [fresh as unknown as Assignment, ...prev]);

      setMsg({ type: "success", text: "Værket er tilføjet." });
      setIsAdding(false);
      setAddQuery(""); setDfiResults([]); setTmdbResults([]); setPickedResult(null);
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Der opstod en fejl." });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Slet valgte ───────────────────────────────────────────
  const handleDeleteSelected = async () => {
    if (!selected.length || !confirm(`Fjern ${selected.length} valgte værk(er) fra din liste?`)) return;
    const { error } = await supabase.from("work_assignments").delete().in("id", selected).eq("rights_holder_id", rightsHolderId ?? "");
    if (!error) {
      setAssignments(prev => prev.filter(a => !selected.includes(a.id)));
      setSelected([]);
      setMsg({ type: "success", text: "Valgte værker fjernet." });
    }
  };

  // ── Redigér ───────────────────────────────────────────────
  const openEdit = (a: Assignment) => { setEditAssignment(a); setEditRole(a.role ?? "Klipper"); };

  const handleSaveEdit = async () => {
    if (!editAssignment) return;
    setIsSavingEdit(true);
    const { error } = await supabase.from("work_assignments").update({ role: editRole }).eq("id", editAssignment.id);
    if (!error) {
      setAssignments(prev => prev.map(a => a.id === editAssignment.id ? { ...a, role: editRole } : a));
      setMsg({ type: "success", text: "Gemt." });
    }
    setIsSavingEdit(false);
    setEditAssignment(null);
  };

  // ── DFI-guiden ────────────────────────────────────────────
  const openWizard = () => {
    setWizardQuery(userName); setWizardPersons([]); setWizardPerson(null);
    setWizardCredits([]); setWizardSelected({}); setWizardError(null);
    if (dfiPersonId) { setWizardStep("credits"); loadWizardCredits(dfiPersonId); }
    else setWizardStep("search");
    setWizardOpen(true);
  };

  const loadWizardCredits = async (personId: number) => {
    setWizardSearching(true); setWizardError(null);
    const res = await getDFIPersonCredits(personId);
    if (res.success && res.credits) {
      const unique = (res.credits as any[]).filter((c, i, arr) => arr.findIndex(x => x.Id === c.Id) === i);
      setWizardCredits(unique);
      const sel: Record<number, boolean> = {};
      unique.forEach((c: any) => { sel[c.Id] = true; });
      setWizardSelected(sel);
    } else {
      setWizardError(res.error ?? "Kunne ikke hente krediteringer.");
    }
    setWizardSearching(false);
  };

  const handleWizardSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wizardQuery.trim()) return;
    setWizardSearching(true); setWizardError(null);
    const res = await searchDFIPerson(undefined, undefined, wizardQuery);
    if (res.success && res.results?.length) {
      if (res.results.length === 1) { setWizardPerson(res.results[0]); setWizardStep("credits"); loadWizardCredits(res.results[0].Id); }
      else { setWizardPersons(res.results); setWizardStep("persons"); }
    } else {
      setWizardError(res.error ?? `Ingen personer fundet med "${wizardQuery}".`);
    }
    setWizardSearching(false);
  };

  const handleWizardImport = async () => {
    const approved = wizardCredits.filter(c => wizardSelected[c.Id]);
    if (!approved.length) { alert("Vælg mindst ét værk."); return; }
    const personId = wizardPerson?.Id ?? dfiPersonId;
    if (!personId) return;
    setWizardImporting(true); setWizardError(null);
    const res = await importApprovedDFIWorks(personId, approved);
    if (res.success) {
      setMsg({ type: "success", text: `${res.importedCount} værker importeret fra DFI.` });
      setWizardOpen(false);
      // Genindlæs assignments
      if (rightsHolderId) {
        const { data } = await supabase.from("work_assignments").select("id, role, contract_id, works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)").eq("rights_holder_id", rightsHolderId).order("created_at", { ascending: false });
        if (data) setAssignments(data as unknown as Assignment[]);
      }
    } else {
      setWizardError(res.errors?.join(", ") ?? "Import fejlede.");
    }
    setWizardImporting(false);
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", padding: "0 4px" }}>

      {/* Brødkrumme + header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, margin: "0 0 6px", color: "var(--on-surface)" }}>Mine Værker</h1>
          <p style={{ color: "var(--on-surface-variant)", margin: 0, fontSize: "14px" }}>
            Dine registrerede film- og serieproduktioner og tilhørende rettigheder.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={openWizard} style={{ padding: "10px 18px", borderRadius: "6px", border: "1px solid var(--outline-variant)", backgroundColor: "var(--surface-container-lowest)", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--on-surface)" }}>
            <RefreshCw size={15} /> Importer fra DFI
          </button>
          <button onClick={() => setIsAdding(true)} style={{ padding: "10px 18px", borderRadius: "6px", border: "none", backgroundColor: "var(--on-surface)", color: "var(--surface)", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
            <Plus size={15} /> Tilføj værk
          </button>
        </div>
      </div>

      {/* Statistik-kort */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        {[
          { label: "Total værker", value: totalWorks },
          { label: "Med kontrakt", value: withContract },
          { label: "Mangler årstal", value: missingYear },
        ].map(s => (
          <div key={s.label} style={{ backgroundColor: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "8px", padding: "20px 24px" }}>
            <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--on-surface-variant)", marginBottom: "8px" }}>{s.label}</div>
            <div style={{ fontSize: "32px", fontWeight: 800, color: "var(--on-surface)" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Statusbesked */}
      {msg && (
        <div style={{ padding: "12px 16px", borderRadius: "6px", fontSize: "14px", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: msg.type === "success" ? "#E6F4EA" : "#FCE8E6", color: msg.type === "success" ? "#137333" : "#C5221F" }}>
          {msg.text}
          <button onClick={() => setMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}><X size={14} /></button>
        </div>
      )}

      {/* Tabel-container */}
      <div style={{ backgroundColor: "var(--surface-container-lowest)", borderRadius: "8px", border: "1px solid var(--outline-variant)", overflow: "hidden" }}>

        {/* Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid var(--outline-variant)", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {selected.length > 0 ? (
              <>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#ba1a1a" }}>{selected.length} valgt</span>
                <button onClick={handleDeleteSelected} style={{ padding: "5px 14px", borderRadius: "4px", border: "none", backgroundColor: "#ba1a1a", color: "white", fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
                  <Trash2 size={13} /> Fjern valgte
                </button>
                <button onClick={() => setSelected([])} style={{ padding: "5px 12px", borderRadius: "4px", border: "1px solid var(--outline-variant)", backgroundColor: "transparent", fontSize: "12px", cursor: "pointer", color: "var(--on-surface-variant)" }}>Annuller</button>
              </>
            ) : (
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="w-[160px] h-8 text-sm">
                  <SelectValue placeholder="Alle kategorier" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--on-surface-variant)" }} />
            <input type="text" placeholder="Søg i værker..." value={search} onChange={e => setSearch(e.target.value)} style={{ padding: "7px 12px 7px 30px", borderRadius: "6px", border: "1px solid var(--outline-variant)", fontSize: "13px", width: "220px", backgroundColor: "var(--surface-container-low)", color: "var(--on-surface)" }} />
          </div>
        </div>

        {/* Tabel-header */}
        <div style={{ display: "grid", gridTemplateColumns: "36px 2.5fr 0.5fr 1fr 0.7fr 0.7fr 1.5fr 0.5fr", padding: "12px 20px", borderBottom: "1px solid var(--outline-variant)", fontSize: "13px", fontWeight: 500, color: "var(--on-surface-variant)", userSelect: "none" }}>
          <input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={() => setSelected(selected.length === filtered.length ? [] : filtered.map(a => a.id))} style={{ cursor: "pointer", width: "15px", height: "15px" }} />
          <div onClick={() => handleSort("title")} style={{ cursor: "pointer" }}>Værktitel{sortArrow("title")}</div>
          <div onClick={() => handleSort("year")} style={{ cursor: "pointer" }}>År{sortArrow("year")}</div>
          <div onClick={() => handleSort("type")} style={{ cursor: "pointer" }}>Type{sortArrow("type")}</div>
          <div>Rolle</div>
          <div>Afsnit</div>
          <div>Medklippere</div>
          <div style={{ textAlign: "right" }}>Kontrakt</div>
        </div>

        {/* Tabel-rækker */}
        {filtered.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--on-surface-variant)" }}>
            <Film size={40} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
            <p style={{ margin: 0 }}>{assignments.length === 0 ? "Ingen værker endnu. Klik 'Tilføj værk' for at starte." : "Ingen resultater for denne søgning."}</p>
          </div>
        ) : (
          filtered.map(a => {
            const w = a.works;
            if (!w) return null;
            const posterSrc = w.poster_url ? (w.poster_url.startsWith("http") ? w.poster_url : `${TMDB_IMG}${w.poster_url}`) : null;
            return (
              <div key={a.id} onClick={() => openEdit(a)} style={{ display: "grid", gridTemplateColumns: "36px 2.5fr 0.5fr 1fr 0.7fr 0.7fr 1.5fr 0.5fr", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--outline-variant)", cursor: "pointer", transition: "background-color 0.15s" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--surface-container-low)")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <div onClick={e => { e.stopPropagation(); setSelected(prev => prev.includes(a.id) ? prev.filter(i => i !== a.id) : [...prev, a.id]); }}>
                  <input type="checkbox" checked={selected.includes(a.id)} onChange={() => {}} style={{ cursor: "pointer", width: "15px", height: "15px" }} />
                </div>
                {/* Plakat + titel */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "32px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {posterSrc ? (
                      <div style={{ width: "32px", height: "44px", borderRadius: "3px", overflow: "hidden", flexShrink: 0, position: "relative" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={posterSrc} alt={w.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
                      </div>
                    ) : (
                      <Film size={16} color="var(--outline)" />
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "14px", lineHeight: 1.3, color: "var(--on-surface)" }}>{w.title}</div>
                    {w.description && <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "280px" }}>{w.description}</div>}
                  </div>
                </div>
                {/* År */}
                <div style={{ fontSize: "13px", color: "var(--on-surface-variant)" }}>{w.year ?? "–"}</div>
                {/* Type */}
                <div style={{ fontSize: "13px", color: "var(--on-surface-variant)" }}>{typeLabel(w.type)}</div>
                {/* Rolle */}
                <div style={{ fontSize: "13px", color: "var(--on-surface-variant)" }}>{a.role ?? "–"}</div>
                {/* Afsnit */}
                <div style={{ fontSize: "13px", color: "var(--on-surface-variant)" }}>
                  {a.episodes?.episode_number ? `E${a.episodes.episode_number}` : "–"}
                </div>
                {/* Medklippere */}
                <div style={{ fontSize: "12px", color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={(coEditorMap[w.id] ?? []).join(", ")}>
                  {(coEditorMap[w.id] ?? []).length > 0 ? coEditorMap[w.id].join(", ") : "–"}
                </div>
                {/* Kontrakt */}
                <div style={{ textAlign: "right" }} onClick={e => { e.stopPropagation(); router.push(contractedWorkIds.includes(w.id) ? `/portal/mine-kontrakter` : `/portal/mine-kontrakter?upload=true&workId=${w.id}&workTitle=${encodeURIComponent(w.title)}`); }}>
                  {contractedWorkIds.includes(w.id) ? (
                    <span style={{ fontSize: "12px", fontWeight: 600, padding: "3px 10px", borderRadius: "99px", backgroundColor: "#dcfce7", color: "#166534", cursor: "pointer" }}>OK</span>
                  ) : (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 cursor-pointer">Mangler</Badge>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Footer */}
        <div style={{ padding: "12px 20px", fontSize: "12px", color: "var(--on-surface-variant)", borderTop: filtered.length > 0 ? "1px solid var(--outline-variant)" : undefined }}>
          {filtered.length} af {assignments.length} værker
        </div>
      </div>

      {/* ── Tilføj-panel ───────────────────────────────────── */}
      {isAdding && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={e => { if (e.target === e.currentTarget) setIsAdding(false); }}>
          <div style={{ backgroundColor: "var(--background, white)", borderRadius: "12px", width: "100%", maxWidth: "720px", maxHeight: "90vh", overflowY: "auto", padding: "28px 24px", border: "1px solid var(--outline-variant)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
              <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--on-surface)" }}>Tilføj Værk</h2>
              <button onClick={() => setIsAdding(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>

            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
              <input type="text" placeholder="Søg titel i DFI og TMDB..." value={addQuery} onChange={e => setAddQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSearch(); }} className="stitch-input" style={{ flex: 1, padding: "9px 12px", fontSize: "14px" }} />
              <button onClick={handleSearch} disabled={isSearching} className="stitch-btn-secondary" style={{ padding: "9px 16px", display: "flex", gap: "6px", alignItems: "center" }}>
                {isSearching ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={15} />} Søg
              </button>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "5px", color: "var(--on-surface-variant)", letterSpacing: "0.05em" }}>DIN ROLLE</label>
              <select value={addRole} onChange={e => setAddRole(e.target.value)} className="stitch-input" style={{ padding: "9px 12px", fontSize: "14px", width: "100%" }}>
                {["Klipper", "Klipperansvarlig", "Assistent-klipper", "Instruktør", "Producent", "Fotograf", "Andet"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {(dfiResults.length > 0 || tmdbResults.length > 0) && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
                <div>
                  <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--on-surface-variant)", letterSpacing: "0.06em", marginBottom: "8px" }}>DFI ({dfiResults.length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    {dfiResults.map((f: any) => {
                      const isSel = pickedResult?.Id === f.Id && pickedSource === "dfi";
                      return (
                        <button key={f.Id} onClick={() => { setPickedResult(f); setPickedSource("dfi"); }} style={{ textAlign: "left", padding: "9px 12px", borderRadius: "6px", border: `1px solid ${isSel ? "var(--primary)" : "var(--outline-variant)"}`, backgroundColor: isSel ? "var(--primary-container)" : "var(--surface-container-low)", cursor: "pointer", width: "100%" }}>
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--on-surface)" }}>{f.Title}</div>
                          <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginTop: "2px" }}>{f.ProductionYear || f.ReleaseYear} · {f.Category}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--on-surface-variant)", letterSpacing: "0.06em", marginBottom: "8px" }}>TMDB ({tmdbResults.length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    {tmdbResults.map((item: any) => {
                      const isSel = pickedResult?.id === item.id && pickedSource === "tmdb";
                      const title = item.title || item.name;
                      const year = item.release_date?.substring(0, 4) || item.first_air_date?.substring(0, 4);
                      return (
                        <button key={item.id} onClick={() => { setPickedResult(item); setPickedSource("tmdb"); }} style={{ textAlign: "left", padding: "9px 12px", borderRadius: "6px", border: `1px solid ${isSel ? "var(--primary)" : "var(--outline-variant)"}`, backgroundColor: isSel ? "var(--primary-container)" : "var(--surface-container-low)", cursor: "pointer", width: "100%", display: "flex", gap: "10px", alignItems: "center" }}>
                          {item.poster_path && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`${TMDB_IMG_W185}${item.poster_path}`} alt={title} style={{ width: "30px", height: "44px", objectFit: "cover", borderRadius: "3px", flexShrink: 0 }} />
                          )}
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--on-surface)" }}>{title}</div>
                            <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginTop: "2px" }}>{year} · {item.media_type === "tv" ? "TV-serie" : "Film"}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {pickedResult && (
              <div style={{ borderTop: "1px solid var(--outline-variant)", paddingTop: "16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "13px", color: "var(--on-surface-variant)" }}>
                  Valgt: <strong style={{ color: "var(--primary)" }}>{pickedResult.Title || pickedResult.title || pickedResult.name}</strong>
                </span>
                <button onClick={handleAddWork} disabled={isSaving} className="stitch-btn-primary" style={{ padding: "10px 22px", display: "flex", gap: "6px", alignItems: "center" }}>
                  {isSaving ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={15} />}
                  {isSaving ? "Tilføjer..." : "Tilføj til mine værker"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DFI-guiden ─────────────────────────────────────── */}
      {wizardOpen && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={e => { if (e.target === e.currentTarget) setWizardOpen(false); }}>
          <div style={{ backgroundColor: "var(--background, white)", borderRadius: "12px", width: "100%", maxWidth: "560px", maxHeight: "85vh", overflowY: "auto", padding: "28px 24px", border: "1px solid var(--outline-variant)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
              <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--on-surface)" }}>Importer fra DFI</h2>
              <button onClick={() => setWizardOpen(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>

            {wizardStep === "search" && (
              <form onSubmit={handleWizardSearch}>
                <p style={{ fontSize: "14px", color: "var(--on-surface-variant)", marginBottom: "16px" }}>Søg dit navn i DFI Filmdatabasen for at importere alle dine krediteringer.</p>
                <div style={{ display: "flex", gap: "10px" }}>
                  <input value={wizardQuery} onChange={e => setWizardQuery(e.target.value)} className="stitch-input" style={{ flex: 1, padding: "9px 12px", fontSize: "14px" }} placeholder="Fornavn Efternavn" />
                  <button type="submit" disabled={wizardSearching} className="stitch-btn-primary" style={{ padding: "9px 18px", display: "flex", gap: "6px", alignItems: "center" }}>
                    {wizardSearching ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={15} />} Søg
                  </button>
                </div>
                {wizardError && <div style={{ marginTop: "12px", padding: "10px 14px", backgroundColor: "var(--error-container)", color: "var(--on-error-container)", borderRadius: "6px", fontSize: "13px" }}>{wizardError}</div>}
              </form>
            )}

            {wizardStep === "persons" && (
              <div>
                <p style={{ fontSize: "14px", color: "var(--on-surface-variant)", marginBottom: "14px" }}>Fandt {wizardPersons.length} personer. Vælg dig selv:</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {wizardPersons.map(p => (
                    <button key={p.Id} onClick={() => { setWizardPerson(p); setWizardStep("credits"); loadWizardCredits(p.Id); }} style={{ textAlign: "left", padding: "12px 16px", borderRadius: "6px", border: "1px solid var(--outline-variant)", backgroundColor: "var(--surface-container-low)", cursor: "pointer" }}>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--on-surface)" }}>{p.Name || `${p.FirstName} ${p.LastName}`}</div>
                      {p.BirthYear && <div style={{ fontSize: "12px", color: "var(--on-surface-variant)" }}>f. {p.BirthYear}</div>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {wizardStep === "credits" && (
              <div>
                {wizardSearching ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 0", gap: "12px" }}>
                    <Loader2 size={32} style={{ animation: "spin 1s linear infinite", color: "var(--primary)" }} />
                    <span style={{ color: "var(--on-surface-variant)", fontSize: "14px" }}>Henter krediteringer fra DFI...</span>
                  </div>
                ) : wizardError ? (
                  <div style={{ padding: "12px 14px", backgroundColor: "var(--error-container)", color: "var(--on-error-container)", borderRadius: "6px", fontSize: "13px" }}>{wizardError}</div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <p style={{ fontSize: "14px", color: "var(--on-surface-variant)", margin: 0 }}>Fandt {wizardCredits.length} titler. Vælg dem du vil importere:</p>
                      <button onClick={() => { const all = Object.values(wizardSelected).every(v => v); const s: Record<number, boolean> = {}; wizardCredits.forEach(c => { s[c.Id] = !all; }); setWizardSelected(s); }} className="stitch-btn-secondary" style={{ padding: "4px 10px", fontSize: "11px", minHeight: "auto" }}>
                        {Object.values(wizardSelected).every(v => v) ? "Fravælg alle" : "Vælg alle"}
                      </button>
                    </div>
                    <div style={{ maxHeight: "320px", overflowY: "auto", border: "1px solid var(--outline-variant)", borderRadius: "8px", backgroundColor: "var(--surface-container-low)" }}>
                      {wizardCredits.map((c, i) => (
                        <label key={`${c.Id}-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "11px 14px", borderBottom: "1px solid var(--outline-variant)", cursor: "pointer", backgroundColor: wizardSelected[c.Id] ? "var(--surface-container-high)" : "transparent" }}>
                          <input type="checkbox" checked={wizardSelected[c.Id] || false} onChange={e => setWizardSelected(prev => ({ ...prev, [c.Id]: e.target.checked }))} style={{ marginTop: "3px", width: "15px", height: "15px", accentColor: "var(--primary)" }} />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--on-surface)" }}>{c.Title} {c.ReleaseYear ? `(${c.ReleaseYear})` : ""}</div>
                            <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                              <span style={{ color: "var(--tertiary)", fontWeight: 600 }}>{c.Description || c.Type}</span> · {c.Category}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                      <button onClick={handleWizardImport} disabled={wizardImporting} className="stitch-btn-primary" style={{ padding: "11px 24px", display: "flex", gap: "8px", alignItems: "center" }}>
                        {wizardImporting ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={15} />}
                        {wizardImporting ? "Importerer..." : `Importer ${Object.values(wizardSelected).filter(Boolean).length} værker`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Redigér-panel ──────────────────────────────────── */}
      {editAssignment && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={e => { if (e.target === e.currentTarget) setEditAssignment(null); }}>
          <div style={{ backgroundColor: "var(--background, white)", borderRadius: "12px", width: "100%", maxWidth: "440px", padding: "28px 24px", border: "1px solid var(--outline-variant)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ fontSize: "17px", fontWeight: 700, margin: 0, color: "var(--on-surface)" }}>{editAssignment.works?.title}</h2>
              <button onClick={() => setEditAssignment(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "5px", color: "var(--on-surface-variant)", letterSpacing: "0.05em" }}>DIN ROLLE</label>
              <select value={editRole} onChange={e => setEditRole(e.target.value)} className="stitch-input" style={{ padding: "9px 12px", fontSize: "14px", width: "100%" }}>
                {["Klipper", "Klipperansvarlig", "Assistent-klipper", "Instruktør", "Producent", "Fotograf", "Andet"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button onClick={() => setEditAssignment(null)} className="stitch-btn-secondary" style={{ padding: "9px 18px" }}>Annuller</button>
              <button onClick={handleSaveEdit} disabled={isSavingEdit} className="stitch-btn-primary" style={{ padding: "9px 22px", display: "flex", gap: "6px", alignItems: "center" }}>
                {isSavingEdit ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : null} Gem
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
