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
import { useI18n } from "@/lib/i18n";

const TMDB_IMG     = "https://image.tmdb.org/t/p/w154";
const TMDB_IMG_W185 = "https://image.tmdb.org/t/p/w185";
const DFKS_ORG_ID  = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";
const ROLES        = ["Klipper", "Klipperansvarlig", "Assistent-klipper", "Instruktør", "Producent", "Fotograf", "Andet"];

type Work = { id: string; title: string; type: string; year: number | null; dfi_id: string | null; tmdb_id: number | null; poster_url: string | null; description: string | null };
type Assignment = { id: string; role: string | null; contract_id: string | null; episode_id: string | null; episodes: { episode_number: number; title?: string | null } | null; works: Work | null };
type OtherAssignment = { work_id: string; role: string | null; rettighedshavere: { full_name: string } | null };

type SortKey = "title" | "year" | "type" | "role" | "episode" | "coEditors" | "contract";

function typeLabel(t: string, locale: "da" | "en" = "da") {
  const key = t?.toLowerCase();
  const canonical: Record<string, "feature" | "series" | "documentary" | "docSeries" | "short" | "animation"> = {
    fiktion: "feature",
    film: "feature",
    movie: "feature",
    serie: "series",
    tv: "series",
    "tv-serie": "series",
    dokumentar: "documentary",
    documentary: "documentary",
    dokumentarserie: "docSeries",
    docseries: "docSeries",
    kort: "short",
    kortfilm: "short",
    short: "short",
    animation: "animation",
  };
  const labels = {
    da: { feature: "Feature", series: "TV-serie", documentary: "Dokumentar", docSeries: "Dokumentarserie", short: "Kortfilm", animation: "Animation" },
    en: { feature: "Feature", series: "TV series", documentary: "Documentary", docSeries: "Documentary series", short: "Short film", animation: "Animation" },
  };
  const type = canonical[key] ?? null;
  return type ? labels[locale][type] : t ?? (locale === "da" ? "Ukendt" : "Unknown");
}

function isSeriesType(t: string | null | undefined) {
  const label = typeLabel(t ?? "", "da").toLowerCase();
  return label === "tv-serie" || label === "dokumentarserie";
}

function formatEpisodeLabel(episodeNumber?: number | null, title?: string | null) {
  if (!episodeNumber) return "–";
  const season = Math.floor(episodeNumber / 1000);
  const episode = episodeNumber % 1000;
  if (season > 0 && episode > 0) return `S${season}E${episode}`;
  if (title?.trim()) return title;
  return `E${episodeNumber}`;
}

// Fælles select-stil
const selectCls = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400";

// Modal-wrapper
function Modal({ onClose, maxWidth = "max-w-xl", children }: { onClose: () => void; maxWidth?: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bg-white rounded-xl border border-gray-200 w-full ${maxWidth} max-h-[90vh] overflow-y-auto p-4 sm:p-7`}>
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
  const { locale, t } = useI18n();
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
  const [catFilter, setCatFilter] = useState("all");
  const [sortKey, setSortKey]   = useState<SortKey>("year");
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
  const [addSeason, setAddSeason]     = useState("");
  const [addEpisode, setAddEpisode]   = useState("");
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

  const categories = [
    { value: "all", da: "Alle", en: "All" },
    { value: "Feature", da: "Feature", en: "Feature" },
    { value: "TV-serie", da: "TV-serie", en: "TV series" },
    { value: "Dokumentar", da: "Dokumentar", en: "Documentary" },
    { value: "Dokumentarserie", da: "Dokumentarserie", en: "Documentary series" },
    { value: "Kortfilm", da: "Kortfilm", en: "Short film" },
    { value: "Animation", da: "Animation", en: "Animation" },
  ];

  const filtered = assignments
    .filter(a => {
      const w = a.works;
      if (!w) return false;
      const t = search.toLowerCase();
      if (t && !w.title.toLowerCase().includes(t)) return false;
      if (catFilter !== "all" && typeLabel(w.type, "da") !== catFilter) return false;
      return true;
    })
    .sort((a, b) => {
      const wa = a.works, wb = b.works;
      let av: any = "", bv: any = "";
      if (sortKey === "title") { av = wa?.title ?? ""; bv = wb?.title ?? ""; }
      if (sortKey === "year")  { av = wa?.year  ?? 0; bv = wb?.year  ?? 0; }
      if (sortKey === "type")  { av = typeLabel(wa?.type ?? "", locale); bv = typeLabel(wb?.type ?? "", locale); }
      if (sortKey === "role") { av = a.role ?? ""; bv = b.role ?? ""; }
      if (sortKey === "episode") { av = a.episodes?.episode_number ?? 0; bv = b.episodes?.episode_number ?? 0; }
      if (sortKey === "coEditors") { av = (coEditorMap[wa?.id ?? ""] ?? []).join(", "); bv = (coEditorMap[wb?.id ?? ""] ?? []).join(", "); }
      if (sortKey === "contract") { av = contractedWorkIds.includes(wa?.id ?? "") ? 1 : 0; bv = contractedWorkIds.includes(wb?.id ?? "") ? 1 : 0; }
      if (typeof av === "string" || typeof bv === "string") {
        const result = String(av).localeCompare(String(bv), locale === "da" ? "da-DK" : "en", { numeric: true, sensitivity: "base" });
        return sortDir === "asc" ? result : -result;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ?  1 : -1;
      return 0;
    });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const totalWorks  = assignments.length;
  const withContract = assignments.filter(a => contractedWorkIds.includes(a.works?.id ?? "")).length;
  const missingContract = Math.max(totalWorks - withContract, 0);

  const selectedType = pickedSource === "dfi"
    ? (() => {
        const combined = `${pickedResult?.Category ?? ""} ${pickedResult?.Type ?? ""}`.toLowerCase();
        if (combined.includes("dokumentar") && combined.includes("serie")) return "dokumentarserie";
        if (combined.includes("serie") || combined.includes("tv-")) return "serie";
        return "";
      })()
    : pickedSource === "tmdb" && pickedResult?.media_type === "tv" ? "serie" : "";
  const showSeriesFields = isSeriesType(selectedType);

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
      if (fnErr || !workId) throw new Error(fnErr?.message ?? t("works.createFailed"));
      let episodeId: string | null = null;
      if (showSeriesFields && addEpisode.trim()) {
        const season = Number.parseInt(addSeason, 10);
        const episode = Number.parseInt(addEpisode, 10);
        if (Number.isFinite(episode) && episode > 0) {
          const storedEpisodeNumber = Number.isFinite(season) && season > 0 ? season * 1000 + episode : episode;
          const { data: ep, error: epErr } = await supabase
            .from("episodes")
            .upsert(
              {
                work_id: workId,
                episode_number: storedEpisodeNumber,
                title: Number.isFinite(season) && season > 0 ? `S${season}E${episode}` : `E${episode}`,
              },
              { onConflict: "work_id,episode_number" }
            )
            .select("id")
            .single();
          if (epErr) throw new Error(epErr.message);
          episodeId = ep?.id ?? null;
        }
      }
      const assignmentPayload = { work_id: workId, episode_id: episodeId, org_id: DFKS_ORG_ID, rights_holder_id: rightsHolderId, role: addRole };
      if (episodeId) {
        await supabase.from("work_assignments").insert(assignmentPayload);
      } else {
        await supabase.from("work_assignments").upsert(
          assignmentPayload,
          { onConflict: "work_id,rights_holder_id,role" }
        );
      }
      const { data: fresh } = await supabase
        .from("work_assignments")
        .select("id, role, contract_id, episode_id, episodes(episode_number,title), works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)")
        .eq("work_id", workId).eq("rights_holder_id", rightsHolderId).order("created_at", { ascending: false }).limit(1).single();
      if (fresh) setAssignments(prev => [fresh as unknown as Assignment, ...prev]);
      setMsg({ type: "success", text: t("works.added") });
      setIsAdding(false);
      setAddQuery(""); setDfiResults([]); setTmdbResults([]); setPickedResult(null); setAddSeason(""); setAddEpisode("");
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || t("common.genericError") });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selected.length || !confirm(t("works.confirmRemove").replace("{count}", String(selected.length)))) return;
    const { error } = await supabase.from("work_assignments").delete().in("id", selected).eq("rights_holder_id", rightsHolderId ?? "");
    if (!error) {
      setAssignments(prev => prev.filter(a => !selected.includes(a.id)));
      setSelected([]);
      setMsg({ type: "success", text: t("works.selectedRemoved") });
    }
  };

  const openEdit = (a: Assignment) => { setEditAssignment(a); setEditRole(a.role ?? "Klipper"); };

  const handleSaveEdit = async () => {
    if (!editAssignment) return;
    setIsSavingEdit(true);
    const { error } = await supabase.from("work_assignments").update({ role: editRole }).eq("id", editAssignment.id);
    if (!error) {
      setAssignments(prev => prev.map(a => a.id === editAssignment.id ? { ...a, role: editRole } : a));
      setMsg({ type: "success", text: t("common.saved") });
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
    if (!approved.length) { alert(t("works.chooseAtLeastOne")); return; }
    const personId = wizardPerson?.Id ?? dfiPersonId;
    if (!personId) return;
    setWizardImporting(true); setWizardError(null);
    const res = await importApprovedDFIWorks(personId, approved);
    if (res.success) {
      setMsg({ type: "success", text: t("works.importedFromDfi").replace("{count}", String(res.importedCount)) });
      setWizardOpen(false);
      if (rightsHolderId) {
        const { data } = await supabase.from("work_assignments").select("id, role, contract_id, episode_id, episodes(episode_number,title), works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)").eq("rights_holder_id", rightsHolderId).order("created_at", { ascending: false });
        if (data) setAssignments(data as unknown as Assignment[]);
      }
    } else {
      setWizardError(res.errors?.join(", ") ?? t("works.importFailed"));
    }
    setWizardImporting(false);
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">{t("works.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("works.registeredSubtitle")}</p>
        </div>
        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <Button variant="outline" onClick={openWizard} className="w-full gap-2 sm:w-auto">
            <RefreshCw className="h-4 w-4" /> {t("works.importFromDfi")}
          </Button>
          <Button onClick={() => setIsAdding(true)} className="w-full gap-2 sm:w-auto">
            <Plus className="h-4 w-4" /> {t("works.addWork")}
          </Button>
        </div>
      </div>

      {/* Statistik */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {[
          { label: t("works.totalWorks"),  value: totalWorks },
          { label: t("works.withContract"),  value: withContract },
          { label: t("works.missingContract"), value: missingContract },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-4 py-4 sm:px-6 sm:py-5">
            <p className="text-sm font-medium text-gray-500 mb-1">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900 sm:text-3xl">{s.value}</p>
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
        <div className="flex flex-col px-4 py-3.5 border-b border-gray-100 gap-3 sm:px-5 md:flex-row md:items-center md:justify-between">
          <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:flex-wrap md:w-auto md:items-center">
            {selected.length > 0 ? (
              <>
                <span className="text-sm font-semibold text-red-700">{selected.length} {t("works.selected")}</span>
                <Button size="sm" variant="destructive" onClick={handleDeleteSelected} className="h-8 w-full gap-1.5 text-xs sm:w-auto">
                  <Trash2 className="h-3.5 w-3.5" /> {t("works.removeSelected")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSelected([])} className="h-8 w-full text-xs sm:w-auto">{t("common.cancel")}</Button>
              </>
            ) : (
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="h-9 w-full text-sm sm:w-[160px]"><SelectValue placeholder={t("works.allCategories")} /></SelectTrigger>
                <SelectContent>
                  {categories.map(cat => <SelectItem key={cat.value} value={cat.value}>{locale === "da" ? cat.da : cat.en}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="relative w-full md:w-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              placeholder={t("works.searchPlaceholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 w-full pl-8 text-sm md:w-56"
            />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 lg:hidden">
            <Select value={sortKey} onValueChange={value => handleSort(value as typeof sortKey)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sorter efter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="title">Værktitel</SelectItem>
                <SelectItem value="year">År</SelectItem>
                <SelectItem value="type">Type</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} className="h-9 px-3">
              {sortDir === "asc" ? "A-Z" : "Z-A"}
            </Button>
          </div>
        </div>

        {/* Kolonnehoveder */}
        <div
          className="hidden px-5 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-500 select-none lg:grid"
          style={{ gridTemplateColumns: "36px 2.5fr 0.5fr 1fr 0.7fr 0.7fr 1.5fr 0.5fr" }}
        >
          <input
            type="checkbox"
            checked={selected.length === filtered.length && filtered.length > 0}
            onChange={() => setSelected(selected.length === filtered.length ? [] : filtered.map(a => a.id))}
            className="cursor-pointer w-4 h-4"
          />
          <div onClick={() => handleSort("title")} className="cursor-pointer hover:text-gray-700">{t("works.workTitle")}{sortArrow("title")}</div>
          <div onClick={() => handleSort("year")}  className="cursor-pointer hover:text-gray-700">{t("works.year")}{sortArrow("year")}</div>
          <div onClick={() => handleSort("type")}  className="cursor-pointer hover:text-gray-700">{t("works.type")}{sortArrow("type")}</div>
          <div onClick={() => handleSort("role")} className="cursor-pointer hover:text-gray-700">{t("works.role")}{sortArrow("role")}</div>
          <div onClick={() => handleSort("episode")} className="cursor-pointer hover:text-gray-700">{t("works.episodes")}{sortArrow("episode")}</div>
          <div onClick={() => handleSort("coEditors")} className="cursor-pointer hover:text-gray-700">{t("works.coEditors")}{sortArrow("coEditors")}</div>
          <div onClick={() => handleSort("contract")} className="text-right cursor-pointer hover:text-gray-700">{t("works.contract")}{sortArrow("contract")}</div>
        </div>

        {/* Rækker */}
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            <Film className="mx-auto h-10 w-10 text-gray-300 mb-3" />
            <p>{assignments.length === 0 ? t("works.emptyHint") : t("works.noSearchResults")}</p>
          </div>
        ) : filtered.map(a => {
          const w = a.works;
          if (!w) return null;
          const posterSrc = w.poster_url ? (w.poster_url.startsWith("http") ? w.poster_url : `${TMDB_IMG}${w.poster_url}`) : null;
          const hasContract = contractedWorkIds.includes(w.id);
          return (
            <React.Fragment key={a.id}>
            <div
              onClick={() => openEdit(a)}
              className="hidden items-center px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors lg:grid"
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
              <div className="text-sm text-gray-500">{typeLabel(w.type, locale)}</div>
              <div className="text-sm text-gray-500">{a.role ?? "–"}</div>
              <div className="text-sm text-gray-500">{formatEpisodeLabel(a.episodes?.episode_number, a.episodes?.title)}</div>
              <div className="text-xs text-gray-500 truncate" title={(coEditorMap[w.id] ?? []).join(", ")}>
                {(coEditorMap[w.id] ?? []).length > 0 ? coEditorMap[w.id].join(", ") : "–"}
              </div>

              {/* Kontrakt-badge */}
              <div
                className="flex justify-end"
                onClick={e => { e.stopPropagation(); router.push(hasContract ? `/portal/mine-kontrakter` : `/portal/mine-kontrakter?upload=true&workId=${w.id}&workTitle=${encodeURIComponent(w.title)}`); }}
              >
                {hasContract ? (
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full cursor-pointer" style={{ backgroundColor: "#dcfce7", color: "#166534" }}>{t("works.contractOk")}</span>
                ) : (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 cursor-pointer">{t("works.contractMissing")}</Badge>
                )}
              </div>
            </div>
            <div
              key={`${a.id}-mobile`}
              onClick={() => openEdit(a)}
              className="border-b border-gray-100 px-4 py-4 transition-colors active:bg-gray-50 lg:hidden"
            >
              <div className="flex gap-3">
                <div onClick={e => { e.stopPropagation(); setSelected(prev => prev.includes(a.id) ? prev.filter(i => i !== a.id) : [...prev, a.id]); }} className="pt-1">
                  <input type="checkbox" checked={selected.includes(a.id)} onChange={() => {}} className="cursor-pointer w-4 h-4" />
                </div>
                <div className="w-10 shrink-0 flex items-start justify-center">
                  {posterSrc ? (
                    <div className="h-14 w-10 overflow-hidden rounded">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={posterSrc} alt={w.title} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ) : (
                    <div className="flex h-14 w-10 items-center justify-center rounded bg-gray-50">
                      <Film className="h-4 w-4 text-gray-300" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-gray-900 leading-snug">{w.title}</p>
                      <p className="mt-1 text-xs text-gray-500">{w.year ?? "–"} · {typeLabel(w.type, locale)}</p>
                    </div>
                    <div
                      className="shrink-0"
                      onClick={e => { e.stopPropagation(); router.push(hasContract ? `/portal/mine-kontrakter` : `/portal/mine-kontrakter?upload=true&workId=${w.id}&workTitle=${encodeURIComponent(w.title)}`); }}
                    >
                      {hasContract ? (
                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full cursor-pointer" style={{ backgroundColor: "#dcfce7", color: "#166534" }}>{t("works.contractOk")}</span>
                      ) : (
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 cursor-pointer">{t("works.contractMissing")}</Badge>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="font-medium text-gray-400">Rolle</p>
                      <p className="mt-0.5 text-gray-700">{a.role ?? "–"}</p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-400">{t("works.episodes")}</p>
                      <p className="mt-0.5 text-gray-700">{formatEpisodeLabel(a.episodes?.episode_number, a.episodes?.title)}</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="font-medium text-xs text-gray-400">{t("works.coEditors")}</p>
                    <p className="mt-0.5 text-xs text-gray-700 line-clamp-2">
                      {(coEditorMap[w.id] ?? []).length > 0 ? coEditorMap[w.id].join(", ") : "–"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            </React.Fragment>
          );
        })}

        {/* Footer */}
        <div className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
          {filtered.length} {t("works.of")} {assignments.length} {t("works.worksLower")}
        </div>
      </div>

      {/* ── Tilføj-panel ──────────────────────────────────────────── */}
      {isAdding && (
        <Modal onClose={() => setIsAdding(false)} maxWidth="max-w-2xl">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-gray-900">{t("works.addWork")}</h2>
            <button onClick={() => setIsAdding(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>

          <div className="flex flex-col gap-2 mb-4 sm:flex-row">
            <Input
              placeholder={t("works.addSearchPlaceholder")}
              value={addQuery}
              onChange={e => setAddQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
            />
            <Button variant="outline" onClick={handleSearch} disabled={isSearching} className="w-full gap-1.5 shrink-0 sm:w-auto">
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {t("common.searchButton")}
            </Button>
          </div>

          <div className="mb-4 space-y-1.5">
            <Label className="text-sm font-medium text-gray-500">{t("works.yourRole")}</Label>
            <select value={addRole} onChange={e => setAddRole(e.target.value)} className={selectCls}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {showSeriesFields && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-gray-500">{t("works.season")}</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="1"
                  value={addSeason}
                  onChange={e => setAddSeason(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-gray-500">{t("works.episode")}</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="1"
                  value={addEpisode}
                  onChange={e => setAddEpisode(e.target.value)}
                />
              </div>
            </div>
          )}

          {(dfiResults.length > 0 || tmdbResults.length > 0) && (
            <div className="grid grid-cols-1 gap-5 mb-4 sm:grid-cols-2">
              {[
                { label: `DFI (${dfiResults.length})`, items: dfiResults, getKey: (f: any) => f.Id, isSelected: (f: any) => pickedResult?.Id === f.Id && pickedSource === "dfi", onSelect: (f: any) => { setPickedResult(f); setPickedSource("dfi"); }, getTitle: (f: any) => f.Title, getMeta: (f: any) => `${f.ProductionYear || f.ReleaseYear} · ${f.Category}`, getPoster: () => null },
                { label: `TMDB (${tmdbResults.length})`, items: tmdbResults, getKey: (i: any) => i.id, isSelected: (i: any) => pickedResult?.id === i.id && pickedSource === "tmdb", onSelect: (i: any) => { setPickedResult(i); setPickedSource("tmdb"); }, getTitle: (i: any) => i.title || i.name, getMeta: (i: any) => `${i.release_date?.substring(0, 4) || i.first_air_date?.substring(0, 4)} · ${i.media_type === "tv" ? typeLabel("serie", locale) : typeLabel("film", locale)}`, getPoster: (i: any) => i.poster_path ? `${TMDB_IMG_W185}${i.poster_path}` : null },
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
            <div className="pt-4 border-t border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-500">
                {t("works.chosen")}: <strong className="text-gray-900">{pickedResult.Title || pickedResult.title || pickedResult.name}</strong>
              </p>
              <Button onClick={handleAddWork} disabled={isSaving} className="w-full gap-2 sm:w-auto">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {isSaving ? t("works.adding") : t("works.addToMyWorks")}
              </Button>
            </div>
          )}
        </Modal>
      )}

      {/* ── DFI-guiden ─────────────────────────────────────────────── */}
      {wizardOpen && (
        <Modal onClose={() => setWizardOpen(false)} maxWidth="max-w-lg">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-gray-900">{t("works.importFromDfi")}</h2>
            <button onClick={() => setWizardOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>

          {wizardStep === "search" && (
            <form onSubmit={handleWizardSearch} className="space-y-4">
              <p className="text-sm text-gray-500">{t("works.dfiIntro")}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={wizardQuery} onChange={e => setWizardQuery(e.target.value)} placeholder={t("works.namePlaceholder")} />
                <Button type="submit" disabled={wizardSearching} className="w-full gap-1.5 shrink-0 sm:w-auto">
                  {wizardSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {t("common.searchButton")}
                </Button>
              </div>
              {wizardError && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{wizardError}</div>}
            </form>
          )}

          {wizardStep === "persons" && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">{t("works.foundPersons").replace("{count}", String(wizardPersons.length))}</p>
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
                  <p className="text-sm text-gray-500">{t("works.loadingCredits")}</p>
                </div>
              ) : wizardError ? (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{wizardError}</div>
              ) : (
                <>
                  <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-gray-500">{t("works.foundTitles").replace("{count}", String(wizardCredits.length))}</p>
                    <button
                      onClick={() => { const all = Object.values(wizardSelected).every(v => v); const s: Record<number, boolean> = {}; wizardCredits.forEach(c => { s[c.Id] = !all; }); setWizardSelected(s); }}
                      className="w-full text-xs px-2.5 py-1 rounded-md border border-gray-300 hover:bg-gray-50 text-gray-600 sm:w-auto"
                    >
                      {Object.values(wizardSelected).every(v => v) ? t("works.deselectAll") : t("works.selectAll")}
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
                    <Button onClick={handleWizardImport} disabled={wizardImporting} className="w-full gap-2 sm:w-auto">
                      {wizardImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {wizardImporting ? t("works.importing") : t("works.importCount").replace("{count}", String(Object.values(wizardSelected).filter(Boolean).length))}
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
            <Label className="text-sm font-medium text-gray-500">{t("works.yourRole")}</Label>
            <select value={editRole} onChange={e => setEditRole(e.target.value)} className={selectCls}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setEditAssignment(null)}>{t("common.cancel")}</Button>
            <Button onClick={handleSaveEdit} disabled={isSavingEdit} className="gap-2">
              {isSavingEdit && <Loader2 className="h-4 w-4 animate-spin" />} {t("common.save")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
