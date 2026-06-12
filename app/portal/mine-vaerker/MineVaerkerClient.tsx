"use client";

import React, { useState } from "react";
import { Film, Plus, Search, Loader2, X, RefreshCw, Trash2, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { searchDFIFilms, getDFIFilmDetails, searchDFIPerson, getDFIPersonCredits, importApprovedDFIWorks } from "@/app/actions/dfi";
import { searchTMDB, getTMDBWorkDetails } from "@/app/actions/tmdb";
import { createClient } from "@/lib/supabase/client";

const TMDB_IMG     = "https://image.tmdb.org/t/p/w154";
const TMDB_IMG_W185 = "https://image.tmdb.org/t/p/w185";
const DFKS_ORG_ID  = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";
const ROLES        = ["Klipper", "Klipperansvarlig", "Assistent-klipper", "Instruktør", "Producent", "Fotograf", "Andet"];

type Work = { id: string; title: string; type: string; year: number | null; dfi_id: string | null; tmdb_id: number | null; poster_url: string | null; description: string | null };
type Assignment = { id: string; role: string | null; contract_id: string | null; episode_id: string | null; episodes: { episode_number: number } | null; works: Work | null };
type OtherAssignment = { work_id: string; role: string | null; rettighedshavere: { full_name: string } | null };

function typeLabel(t: string) {
  const m: Record<string, string> = { fiktion: "Feature", film: "Feature", serie: "TV-serie", dokumentar: "Dokumentar", kort: "Kortfilm", animation: "Animation", movie: "Feature", tv: "TV-serie", documentary: "Dokumentar", short: "Kortfilm" };
  return m[t?.toLowerCase()] ?? t ?? "Ukendt";
}

// Fælles select-stil
const selectCls = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400";

// Modal-wrapper
function Modal({ onClose, maxWidth = "max-w-xl", children }: { onClose: () => void; maxWidth?: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bg-white rounded-xl border border-gray-200 w-full ${maxWidth} max-h-[90vh] overflow-y-auto p-7`}>
        {children}
      </div>
    </div>
  );
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

  const [search, setSearch]     = useState("");
  const [catFilter, setCatFilter] = useState("Alle");
  const [sortKey, setSortKey]   = useState<"title" | "year" | "type">("year");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg]           = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Tilføj-panel
  const [isAdding, setIsAdding]       = useState(false);
  const [addQuery, setAddQuery]       = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [dfiResults, setDfiResults]   = useState<any[]>([]);
  const [tmdbResults, setTmdbResults] = useState<any[]>([]);
  const [pickedResult, setPickedResult] = useState<any>(null);
  const [pickedSource, setPickedSource] = useState<"dfi" | "tmdb" | null>(null);
  const [addRole, setAddRole]         = useState("Klipper");
  const [isSaving, setIsSaving]       = useState(false);

  // DFI-guiden
  const [wizardOpen, setWizardOpen]         = useState(false);
  const [wizardStep, setWizardStep]         = useState<"search" | "persons" | "credits">("search");
  const [wizardQuery, setWizardQuery]       = useState(userName);
  const [wizardPersons, setWizardPersons]   = useState<any[]>([]);
  const [wizardPerson, setWizardPerson]     = useState<any>(null);
  const [wizardCredits, setWizardCredits]   = useState<any[]>([]);
  const [wizardSelected, setWizardSelected] = useState<Record<number, boolean>>({});
  const [wizardSearching, setWizardSearching] = useState(false);
  const [wizardImporting, setWizardImporting] = useState(false);
  const [wizardError, setWizardError]       = useState<string | null>(null);

  // Redigér-panel
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null);
  const [editRole, setEditRole]             = useState("");
  const [isSavingEdit, setIsSavingEdit]     = useState(false);

  const supabase = createClient();
  const router   = useRouter();

  const categories = ["Alle", "Feature", "TV-serie", "Dokumentar", "Kortfilm", "Animation"];

  const filtered = assignments
    .filter(a => {
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
      if (sortKey === "year")  { av = wa?.year  ?? 0; bv = wb?.year  ?? 0; }
      if (sortKey === "type")  { av = typeLabel(wa?.type ?? ""); bv = typeLabel(wb?.type ?? ""); }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ?  1 : -1;
      return 0;
    });

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sortArrow = (key: typeof sortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const totalWorks  = assignments.length;
  const withContract = assignments.filter(a => contractedWorkIds.includes(a.works?.id ?? "")).length;
  const missingYear  = assignments.filter(a => !a.works?.year).length;

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
        const det  = await getDFIFilmDetails(pickedResult.Id);
        const film = det.success ? (det as any).film : pickedResult;
        const combined = ((film.Category || "") + " " + (film.Type || "")).toLowerCase();
        const type = (combined.includes("dokumentar") && combined.includes("serie")) ? "serie"
          : combined.includes("dokumentar") ? "dokumentar"
          : (combined.includes("serie") || combined.includes("tv-")) ? "serie"
          : combined.includes("kort") ? "kortfilm" : "fiktion";
        args = { ...args, p_dfi_id: String(pickedResult.Id), p_title: film.Title || film.DanishTitle || "Ukendt", p_type: type, p_year: film.ProductionYear || film.ReleaseYear || null, p_description: film.Synopsis || null };
      } else {
        const det = await getTMDBWorkDetails(pickedResult.id, pickedResult.media_type || "movie");
        const d   = det.success ? (det as any).details : pickedResult;
        const title = d.title || d.name || "Ukendt";
        const year  = d.release_date ? parseInt(d.release_date.substring(0, 4)) : d.first_air_date ? parseInt(d.first_air_date.substring(0, 4)) : null;
        args = { ...args, p_tmdb_id: pickedResult.id, p_title: title, p_type: pickedResult.media_type === "tv" ? "serie" : "fiktion", p_year: year, p_description: d.overview || null, p_poster_url: d.poster_path ? `${TMDB_IMG_W185}${d.poster_path}` : null };
      }
      const { data: workId, error: fnErr } = await supabase.rpc("upsert_work_for_member", args);
      if (fnErr || !workId) throw new Error(fnErr?.message ?? "Kunne ikke oprette værk");
      await supabase.from("work_assignments").upsert(
        { work_id: workId, org_id: DFKS_ORG_ID, rights_holder_id: rightsHolderId, role: addRole },
        { onConflict: "work_id,rights_holder_id,role" }
      );
      const { data: fresh } = await supabase
        .from("work_assignments")
        .select("id, role, contract_id, episode_id, episodes(episode_number), works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)")
        .eq("work_id", workId).eq("rights_holder_id", rightsHolderId).single();
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

  const handleDeleteSelected = async () => {
    if (!selected.length || !confirm(`Fjern ${selected.length} valgte værk(er) fra din liste?`)) return;
    const { error } = await supabase.from("work_assignments").delete().in("id", selected).eq("rights_holder_id", rightsHolderId ?? "");
    if (!error) {
      setAssignments(prev => prev.filter(a => !selected.includes(a.id)));
      setSelected([]);
      setMsg({ type: "success", text: "Valgte værker fjernet." });
    }
  };

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
      if (rightsHolderId) {
        const { data } = await supabase.from("work_assignments").select("id, role, contract_id, works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)").eq("rights_holder_id", rightsHolderId).order("created_at", { ascending: false });
        if (data) setAssignments(data as unknown as Assignment[]);
      }
    } else {
      setWizardError(res.errors?.join(", ") ?? "Import fejlede.");
    }
    setWizardImporting(false);
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mine Værker</h1>
          <p className="text-sm text-gray-500 mt-1">Dine registrerede film- og serieproduktioner og tilhørende rettigheder.</p>
        </div>
        <div className="flex gap-2.5">
          <Button variant="outline" onClick={openWizard} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Importer fra DFI
          </Button>
          <Button onClick={() => setIsAdding(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Tilføj værk
          </Button>
        </div>
      </div>

      {/* Statistik */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total værker",  value: totalWorks },
          { label: "Med kontrakt",  value: withContract },
          { label: "Mangler årstal",value: missingYear },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-6 py-5">
            <p className="text-sm font-medium text-gray-500 mb-1">{s.label}</p>
            <p className="text-3xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toast */}
      {msg && (
        <div className={`flex items-center justify-between rounded-lg px-4 py-3 text-sm ${
          msg.type === "success" ? "bg-[#E6F4EA] text-[#137333]" : "bg-[#FCE8E6] text-[#C5221F]"
        }`}>
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-4 text-current opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Tabel */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 flex-wrap">
            {selected.length > 0 ? (
              <>
                <span className="text-sm font-semibold text-red-700">{selected.length} valgt</span>
                <Button size="sm" variant="destructive" onClick={handleDeleteSelected} className="gap-1.5 h-7 text-xs">
                  <Trash2 className="h-3.5 w-3.5" /> Fjern valgte
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSelected([])} className="h-7 text-xs">Annuller</Button>
              </>
            ) : (
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="w-[160px] h-8 text-sm"><SelectValue placeholder="Alle kategorier" /></SelectTrigger>
                <SelectContent>
                  {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              placeholder="Søg i værker..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm w-56"
            />
          </div>
        </div>

        {/* Kolonnehoveder */}
        <div
          className="grid px-5 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-500 select-none"
          style={{ gridTemplateColumns: "36px 2.5fr 0.5fr 1fr 0.7fr 0.7fr 1.5fr 0.5fr" }}
        >
          <input
            type="checkbox"
            checked={selected.length === filtered.length && filtered.length > 0}
            onChange={() => setSelected(selected.length === filtered.length ? [] : filtered.map(a => a.id))}
            className="cursor-pointer w-4 h-4"
          />
          <div onClick={() => handleSort("title")} className="cursor-pointer hover:text-gray-700">Værktitel{sortArrow("title")}</div>
          <div onClick={() => handleSort("year")}  className="cursor-pointer hover:text-gray-700">År{sortArrow("year")}</div>
          <div onClick={() => handleSort("type")}  className="cursor-pointer hover:text-gray-700">Type{sortArrow("type")}</div>
          <div>Rolle</div>
          <div>Afsnit</div>
          <div>Medklippere</div>
          <div className="text-right">Kontrakt</div>
        </div>

        {/* Rækker */}
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            <Film className="mx-auto h-10 w-10 text-gray-300 mb-3" />
            <p>{assignments.length === 0 ? "Ingen værker endnu. Klik 'Tilføj værk' for at starte." : "Ingen resultater for denne søgning."}</p>
          </div>
        ) : filtered.map(a => {
          const w = a.works;
          if (!w) return null;
          const posterSrc = w.poster_url ? (w.poster_url.startsWith("http") ? w.poster_url : `${TMDB_IMG}${w.poster_url}`) : null;
          const hasContract = contractedWorkIds.includes(w.id);
          return (
            <div
              key={a.id}
              onClick={() => openEdit(a)}
              className="grid items-center px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
              style={{ gridTemplateColumns: "36px 2.5fr 0.5fr 1fr 0.7fr 0.7fr 1.5fr 0.5fr" }}
            >
              <div onClick={e => { e.stopPropagation(); setSelected(prev => prev.includes(a.id) ? prev.filter(i => i !== a.id) : [...prev, a.id]); }}>
                <input type="checkbox" checked={selected.includes(a.id)} onChange={() => {}} className="cursor-pointer w-4 h-4" />
              </div>

              {/* Poster + titel */}
              <div className="flex items-center gap-3">
                <div className="w-8 shrink-0 flex items-center justify-center">
                  {posterSrc ? (
                    <div className="w-8 h-11 rounded overflow-hidden shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={posterSrc} alt={w.title} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  ) : (
                    <Film className="h-4 w-4 text-gray-300" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-sm text-gray-900 leading-snug">{w.title}</p>
                  {w.description && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[260px]">{w.description}</p>}
                </div>
              </div>

              <div className="text-sm text-gray-500">{w.year ?? "–"}</div>
              <div className="text-sm text-gray-500">{typeLabel(w.type)}</div>
              <div className="text-sm text-gray-500">{a.role ?? "–"}</div>
              <div className="text-sm text-gray-500">{a.episodes?.episode_number ? `E${a.episodes.episode_number}` : "–"}</div>
              <div className="text-xs text-gray-500 truncate" title={(coEditorMap[w.id] ?? []).join(", ")}>
                {(coEditorMap[w.id] ?? []).length > 0 ? coEditorMap[w.id].join(", ") : "–"}
              </div>

              {/* Kontrakt-badge */}
              <div
                className="flex justify-end"
                onClick={e => { e.stopPropagation(); router.push(hasContract ? `/portal/mine-kontrakter` : `/portal/mine-kontrakter?upload=true&workId=${w.id}&workTitle=${encodeURIComponent(w.title)}`); }}
              >
                {hasContract ? (
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full cursor-pointer" style={{ backgroundColor: "#dcfce7", color: "#166534" }}>OK</span>
                ) : (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 cursor-pointer">Mangler</Badge>
                )}
              </div>
            </div>
          );
        })}

        {/* Footer */}
        <div className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
          {filtered.length} af {assignments.length} værker
        </div>
      </div>

      {/* ── Tilføj-panel ──────────────────────────────────────────── */}
      {isAdding && (
        <Modal onClose={() => setIsAdding(false)} maxWidth="max-w-2xl">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-gray-900">Tilføj Værk</h2>
            <button onClick={() => setIsAdding(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>

          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Søg titel i DFI og TMDB..."
              value={addQuery}
              onChange={e => setAddQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
            />
            <Button variant="outline" onClick={handleSearch} disabled={isSearching} className="gap-1.5 shrink-0">
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Søg
            </Button>
          </div>

          <div className="mb-4 space-y-1.5">
            <Label className="text-sm font-medium text-gray-500">Din rolle</Label>
            <select value={addRole} onChange={e => setAddRole(e.target.value)} className={selectCls}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {(dfiResults.length > 0 || tmdbResults.length > 0) && (
            <div className="grid grid-cols-2 gap-5 mb-4">
              {[
                { label: `DFI (${dfiResults.length})`, items: dfiResults, getKey: (f: any) => f.Id, isSelected: (f: any) => pickedResult?.Id === f.Id && pickedSource === "dfi", onSelect: (f: any) => { setPickedResult(f); setPickedSource("dfi"); }, getTitle: (f: any) => f.Title, getMeta: (f: any) => `${f.ProductionYear || f.ReleaseYear} · ${f.Category}`, getPoster: (_: any) => null },
                { label: `TMDB (${tmdbResults.length})`, items: tmdbResults, getKey: (i: any) => i.id, isSelected: (i: any) => pickedResult?.id === i.id && pickedSource === "tmdb", onSelect: (i: any) => { setPickedResult(i); setPickedSource("tmdb"); }, getTitle: (i: any) => i.title || i.name, getMeta: (i: any) => `${i.release_date?.substring(0, 4) || i.first_air_date?.substring(0, 4)} · ${i.media_type === "tv" ? "TV-serie" : "Film"}`, getPoster: (i: any) => i.poster_path ? `${TMDB_IMG_W185}${i.poster_path}` : null },
              ].map(col => (
                <div key={col.label}>
                  <p className="text-xs font-medium text-gray-500 mb-2">{col.label}</p>
                  <div className="flex flex-col gap-1.5">
                    {col.items.map((item: any) => {
                      const sel = col.isSelected(item);
                      const poster = col.getPoster(item);
                      return (
                        <button
                          key={col.getKey(item)}
                          onClick={() => col.onSelect(item)}
                          className={`text-left px-3 py-2.5 rounded-md border text-sm transition-colors flex gap-2.5 items-start w-full ${sel ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:bg-gray-50"}`}
                        >
                          {poster && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={poster} alt={col.getTitle(item)} className="w-7 h-10 object-cover rounded shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">{col.getTitle(item)}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{col.getMeta(item)}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {pickedResult && (
            <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Valgt: <strong className="text-gray-900">{pickedResult.Title || pickedResult.title || pickedResult.name}</strong>
              </p>
              <Button onClick={handleAddWork} disabled={isSaving} className="gap-2">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {isSaving ? "Tilføjer..." : "Tilføj til mine værker"}
              </Button>
            </div>
          )}
        </Modal>
      )}

      {/* ── DFI-guiden ─────────────────────────────────────────────── */}
      {wizardOpen && (
        <Modal onClose={() => setWizardOpen(false)} maxWidth="max-w-lg">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-gray-900">Importer fra DFI</h2>
            <button onClick={() => setWizardOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>

          {wizardStep === "search" && (
            <form onSubmit={handleWizardSearch} className="space-y-4">
              <p className="text-sm text-gray-500">Søg dit navn i DFI Filmdatabasen for at importere alle dine krediteringer.</p>
              <div className="flex gap-2">
                <Input value={wizardQuery} onChange={e => setWizardQuery(e.target.value)} placeholder="Fornavn Efternavn" />
                <Button type="submit" disabled={wizardSearching} className="gap-1.5 shrink-0">
                  {wizardSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Søg
                </Button>
              </div>
              {wizardError && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{wizardError}</div>}
            </form>
          )}

          {wizardStep === "persons" && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">Fandt {wizardPersons.length} personer. Vælg dig selv:</p>
              {wizardPersons.map(p => (
                <button
                  key={p.Id}
                  onClick={() => { setWizardPerson(p); setWizardStep("credits"); loadWizardCredits(p.Id); }}
                  className="w-full text-left px-4 py-3 rounded-md border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <p className="font-medium text-gray-900">{p.Name || `${p.FirstName} ${p.LastName}`}</p>
                  {p.BirthYear && <p className="text-xs text-gray-500">f. {p.BirthYear}</p>}
                </button>
              ))}
            </div>
          )}

          {wizardStep === "credits" && (
            <div>
              {wizardSearching ? (
                <div className="flex flex-col items-center py-10 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                  <p className="text-sm text-gray-500">Henter krediteringer fra DFI...</p>
                </div>
              ) : wizardError ? (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{wizardError}</div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-gray-500">Fandt {wizardCredits.length} titler. Vælg dem du vil importere:</p>
                    <button
                      onClick={() => { const all = Object.values(wizardSelected).every(v => v); const s: Record<number, boolean> = {}; wizardCredits.forEach(c => { s[c.Id] = !all; }); setWizardSelected(s); }}
                      className="text-xs px-2.5 py-1 rounded-md border border-gray-300 hover:bg-gray-50 text-gray-600"
                    >
                      {Object.values(wizardSelected).every(v => v) ? "Fravælg alle" : "Vælg alle"}
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {wizardCredits.map((c, i) => (
                      <label
                        key={`${c.Id}-${i}`}
                        className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${wizardSelected[c.Id] ? "bg-gray-50" : "hover:bg-gray-50"}`}
                      >
                        <input
                          type="checkbox"
                          checked={wizardSelected[c.Id] || false}
                          onChange={e => setWizardSelected(prev => ({ ...prev, [c.Id]: e.target.checked }))}
                          className="mt-0.5 w-4 h-4 accent-gray-900"
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{c.Title} {c.ReleaseYear ? `(${c.ReleaseYear})` : ""}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            <span className="font-medium">{c.Description || c.Type}</span> · {c.Category}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end mt-4">
                    <Button onClick={handleWizardImport} disabled={wizardImporting} className="gap-2">
                      {wizardImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {wizardImporting ? "Importerer..." : `Importer ${Object.values(wizardSelected).filter(Boolean).length} værker`}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ── Redigér-panel ──────────────────────────────────────────── */}
      {editAssignment && (
        <Modal onClose={() => setEditAssignment(null)} maxWidth="max-w-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-900">{editAssignment.works?.title}</h2>
            <button onClick={() => setEditAssignment(null)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-1.5 mb-6">
            <Label className="text-sm font-medium text-gray-500">Din rolle</Label>
            <select value={editRole} onChange={e => setEditRole(e.target.value)} className={selectCls}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={() => setEditAssignment(null)}>Annuller</Button>
            <Button onClick={handleSaveEdit} disabled={isSavingEdit} className="gap-2">
              {isSavingEdit && <Loader2 className="h-4 w-4 animate-spin" />} Gem
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
