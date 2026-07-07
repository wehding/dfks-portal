"use client";

import React, { useState } from "react";
import { Film, Plus, Search, X, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter, useSearchParams } from "next/navigation";
import { removeWorkAssignments } from "@/app/actions/member-works";
import { markWorkRequestCommentsRead } from "@/app/actions/work-management";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { DfiImportWizard } from "./components/DfiImportWizard";
import { AddWorkModal } from "./components/AddWorkModal";
import { EditWorkModal } from "./components/EditWorkModal";
import { ContextualHelp, HelpButton, type HelpTopic } from "@/components/help/contextual-help";

const TMDB_IMG     = "https://image.tmdb.org/t/p/w154";

type Work = {
  id: string;
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  episode_count: number | null;
  season_number?: number | null;
  episode_number?: number | null;
  genre: string | null;
  director: string | null;
  status: string | null;
  dfi_id: string | null;
  tmdb_id: number | string | null;
  poster_url: string | null;
  description: string | null;
  work_production_numbers?: WorkProductionNumber[];
  work_change_requests?: ChangeRequest[];
};
export type Assignment = { id: string; role: string | null; contract_id: string | null; episode_id: string | null; created_at?: string | null; episodes: { episode_number: number; title?: string | null } | null; works: Work | null };
export type OtherAssignment = { id: string; work_id: string; role: string | null; rights_holder_id?: string | null; rettighedshavere: { id?: string; full_name: string } | null };
type WorkProductionNumber = { tv_station: string | null; number: string | null };
export type BroadcasterLogo = { name: string; logo_path: string | null };
type SortKey = "date" | "title" | "year" | "type" | "role" | "episode" | "coEditors" | "contract";

type RequestComment = {
  id: string;
  author_role: "member" | "admin";
  message: string;
  created_at: string;
  member_read_at?: string | null;
  admin_read_at?: string | null;
};

type ChangeRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  source: string;
  admin_comment?: string | null;
  proposed_data?: Record<string, unknown>;
  work_change_request_comments?: RequestComment[];
};

type SortValue = string | number;

const MINE_VAERKER_HELP: HelpTopic[] = [
  {
    title: "Tilføj værk",
    body: "Brug søgning først, så systemet kan genbruge værker, der allerede findes. Hvis værket er en serie, kan du vælge præcis de afsnit, du har klippet, inden du sender oprettelsen.",
    tips: ["Lokale match kobler dig direkte på det eksisterende værk.", "DFI/TMDB-oprettelser og manuelle oprettelser kan kræve administratorgodkendelse."],
  },
  {
    title: "Importer fra DFI",
    body: "DFI-guiden finder dine krediteringer og frasorterer værker, der allerede er knyttet til dig. Lokale værker bliver koblet til dig uden at overskrive eksisterende data.",
  },
  {
    title: "Kontraktstatus",
    body: "Mangler kontrakt betyder, at systemet ikke kan se en godkendt kontrakt på værket endnu. Klik på mærket for at uploade en kontrakt direkte til værket.",
  },
  {
    title: "Rettelser og admin-kommentarer",
    body: "Når du retter værksdata, sendes ændringen til administrator. Klik på værket for at se status, kommentarer og hvilken type request kommentaren handler om.",
  },
];

function typeLabel(t: string, locale: "da" | "en" = "da") {
  const key = t?.toLowerCase();
  const canonical: Record<string, "feature" | "series" | "documentary" | "docSeries" | "short" | "animation"> = {
    fiktion: "feature",
    spillefilm: "feature",
    film: "feature",
    movie: "feature",
    serie: "series",
    tv: "series",
    "tv-serie": "series",
    dokumentar: "documentary",
    dokumentarfilm: "documentary",
    documentary: "documentary",
    dokumentarserie: "docSeries",
    "dokumentar-serie": "docSeries",
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

function displayRole(role: string | null | undefined) {
  return role === "Hovedklipper" ? "Konceptuerende klipper" : role ?? "Klipper";
}

function requestKindLabel(request: ChangeRequest) {
  const kind = request.proposed_data?.kind;
  if (kind === "creation") return "Nyt værk";
  if (kind === "co_editors") return "Medklippere";
  if (kind === "message") return "Besked";
  return "Rettelse";
}

function requestStatusLabel(status: ChangeRequest["status"]) {
  if (status === "pending") return "Afventer";
  if (status === "approved") return "Godkendt";
  return "Afvist";
}

function adminRequestSummaries(work: Work | null) {
  return (work?.work_change_requests ?? [])
    .flatMap(request => {
      const comments = (request.work_change_request_comments ?? [])
        .filter(comment => comment.author_role === "admin")
        .map(comment => ({
          id: `${request.id}-${comment.id}`,
          kind: requestKindLabel(request),
          status: requestStatusLabel(request.status),
          message: comment.message,
          createdAt: comment.created_at,
        }));
      return comments.length ? comments : request.admin_comment ? [{
        id: request.id,
        kind: requestKindLabel(request),
        status: requestStatusLabel(request.status),
        message: request.admin_comment,
        createdAt: "",
      }] : [];
    })
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

function latestAdminComment(work: Work | null) {
  return adminRequestSummaries(work)[0]?.message ?? null;
}

function getWorkBroadcaster(work: Work | null) {
  return (work?.work_production_numbers ?? []).find(item => item.number === "broadcast/stream")?.tv_station ?? null;
}

function pendingRequestLabel(work: Work | null) {
  return (work?.work_change_requests ?? []).some(request => request.status === "pending") ? "Afventer admin" : null;
}

export default function MineVaerkerClient({
  initialAssignments, allAssignments, broadcasters, rightsHolderId, userName, dfiPersonId, contractedWorkIds,
}: {
  initialAssignments: Assignment[];
  allAssignments: OtherAssignment[];
  broadcasters: BroadcasterLogo[];
  rightsHolderId: string | null;
  userName: string;
  dfiPersonId: number | null;
  contractedWorkIds: string[];
}) {
  const { locale, t } = useI18n();
  const [assignments, setAssignments] = useState(initialAssignments);

  const broadcasterLogoMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const broadcaster of broadcasters) {
      if (broadcaster.name && broadcaster.logo_path) map[broadcaster.name] = broadcaster.logo_path;
    }
    return map;
  }, [broadcasters]);

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
  const [sortKey, setSortKey]   = useState<SortKey>("date");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg]           = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pageSize, setPageSize] = useState(20);

  // Dialoger og modaler
  const [isAdding, setIsAdding]             = useState(false);
  const [wizardOpen, setWizardOpen]         = useState(false);
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null);
  const [initialAddQuery, setInitialAddQuery] = useState("");

  const supabase = createClient();
  const router   = useRouter();
  const searchParams = useSearchParams();

  React.useEffect(() => {
    if (searchParams?.get("add") === "1") {
      setInitialAddQuery(searchParams?.get("q") ?? "");
      setIsAdding(true);
    }
  }, [searchParams]);

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
      let av: SortValue = "", bv: SortValue = "";
      if (sortKey === "date") { av = new Date(a.created_at ?? 0).getTime(); bv = new Date(b.created_at ?? 0).getTime(); }
      if (sortKey === "title") { av = wa?.title ?? ""; bv = wb?.title ?? ""; }
      if (sortKey === "year")  { av = wa?.year  ?? 0; bv = wb?.year  ?? 0; }
      if (sortKey === "type")  { av = typeLabel(wa?.type ?? "", locale); bv = typeLabel(wb?.type ?? "", locale); }
      if (sortKey === "role") { av = displayRole(a.role); bv = displayRole(b.role); }
      if (sortKey === "episode") {
        const sa = wa?.season_number ?? 0;
        const sb = wb?.season_number ?? 0;
        if (sa !== sb) {
          av = sa;
          bv = sb;
        } else {
          av = wa?.episode_number ?? 0;
          bv = wb?.episode_number ?? 0;
        }
      }
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
  const visibleAssignments = filtered.slice(0, pageSize);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "date" ? "desc" : "asc"); }
  };
  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const totalWorks  = assignments.length;
  const withContract = assignments.filter(a => contractedWorkIds.includes(a.works?.id ?? "")).length;
  const missingContract = Math.max(totalWorks - withContract, 0);



  const reloadAssignments = async () => {
    if (!rightsHolderId) return;
    const { data } = await supabase
      .from("work_assignments")
      .select("id, role, contract_id, episode_id, created_at, episodes(episode_number,title), works(id, title, type, year, duration_minutes, season_count, episode_count, genre, director, status, dfi_id, tmdb_id, poster_url, description, work_production_numbers(tv_station, number), work_change_requests(*, work_change_request_comments(*)))")
      .eq("rights_holder_id", rightsHolderId)
      .order("created_at", { ascending: false });
    if (data) setAssignments(data as unknown as Assignment[]);
  };

  const openEdit = (a: Assignment) => {
    setEditAssignment(a);
    void markRequestCommentsRead(a);
  };

  async function markRequestCommentsRead(a: Assignment) {
    const requests = a.works?.work_change_requests ?? [];
    const unreadRequestIds = requests
      .filter(r => (r.work_change_request_comments ?? []).some(c => c.author_role === "admin" && !c.member_read_at))
      .map(r => r.id);
    if (unreadRequestIds.length === 0) return;

    const now = new Date().toISOString();
    const patchAssignment = (item: Assignment): Assignment => {
      if (item.id !== a.id || !item.works) return item;
      return {
        ...item,
        works: {
          ...item.works,
          work_change_requests: (item.works.work_change_requests ?? []).map(r =>
            unreadRequestIds.includes(r.id)
              ? {
                  ...r,
                  work_change_request_comments: (r.work_change_request_comments ?? []).map(c =>
                    c.author_role === "admin" && !c.member_read_at ? { ...c, member_read_at: now } : c
                  ),
                }
              : r
          ),
        },
      };
    };
    setAssignments(prev => prev.map(patchAssignment));
    setEditAssignment(prev => (prev ? patchAssignment(prev) : prev));

    const results = await Promise.all(unreadRequestIds.map(id => markWorkRequestCommentsRead(id, "member")));
    if (results.some(r => r.success)) window.dispatchEvent(new CustomEvent("contracts-updated"));
  }

  const closeEdit = () => {
    setEditAssignment(null);
  };

  const openWizard = () => {
    setWizardOpen(true);
  };

  const handleDeleteSelected = async () => {
    if (!selected.length || !confirm(t("works.confirmRemove").replace("{count}", String(selected.length)))) return;
    try {
      const res = await removeWorkAssignments(selected, rightsHolderId ?? "");
      if (res.success) {
        setAssignments(prev => prev.filter(a => !selected.includes(a.id)));
        setSelected([]);
        setMsg({ type: "success", text: t("works.selectedRemoved") });
      } else {
        const errorText = res.errors.join(" ");
        setMsg({ type: "error", text: errorText });
        if (res.deletedIds.length) {
          setAssignments(prev => prev.filter(a => !res.deletedIds.includes(a.id)));
          setSelected(prev => prev.filter(id => !res.deletedIds.includes(id)));
        }
      }
    } catch (err: unknown) {
      setMsg({ type: "error", text: err instanceof Error ? err.message : t("common.genericError") });
    }
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
          <HelpButton onClick={() => setHelpOpen(true)} />
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
              className="h-9 w-full pl-8 pr-8 text-sm md:w-56"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-700"
                aria-label="Tøm søgefelt"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-500">
            Vis
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900">
              {[10, 20, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-2 lg:hidden">
            <Select value={sortKey} onValueChange={value => handleSort(value as typeof sortKey)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sorter efter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Tilføjet dato</SelectItem>
                <SelectItem value="title">Værktitel</SelectItem>
                <SelectItem value="year">Premiereår</SelectItem>
                <SelectItem value="type">Type</SelectItem>
                <SelectItem value="contract">Kontraktstatus</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} className="h-9 px-3">
              {sortKey === "date" ? (sortDir === "asc" ? "Ældst" : "Nyest") : sortKey === "contract" ? (sortDir === "asc" ? "Mangler" : "OK") : sortDir === "asc" ? "A-Z" : "Z-A"}
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
        ) : visibleAssignments.map(a => {
          const w = a.works;
          if (!w) return null;
          const posterSrc = w.poster_url
            ? (w.poster_url.startsWith("http") || w.poster_url.startsWith("data:image/") ? w.poster_url : `${TMDB_IMG}${w.poster_url}`)
            : null;
          const hasContract = contractedWorkIds.includes(w.id);
          const adminComment = latestAdminComment(w);
          const pendingLabel = pendingRequestLabel(w);
          const broadcaster = getWorkBroadcaster(w);
          const broadcasterLogo = broadcaster ? broadcasterLogoMap[broadcaster] : null;
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
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-sm text-gray-900 leading-snug">{w.title}</p>
                    {broadcasterLogo && (
                      <span className="inline-flex h-6 max-w-20 items-center rounded border border-gray-200 bg-white px-1.5 py-0.5" title={broadcaster ?? undefined}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={broadcasterLogo} alt={`${broadcaster} logo`} className="max-h-4 max-w-full object-contain" loading="lazy" />
                      </span>
                    )}
                  </div>
                  {w.description && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[260px]">{w.description}</p>}
                  {(pendingLabel || adminComment) && (
                    <p className="mt-1 max-w-[300px] truncate text-xs text-amber-700">
                      {pendingLabel ? `${pendingLabel}${adminComment ? ": " : ""}` : ""}
                      {adminComment}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-sm text-gray-500">{w.year ?? "–"}</div>
              <div className="text-sm text-gray-500">{typeLabel(w.type, locale)}</div>
              <div className="text-sm text-gray-500">{displayRole(a.role)}</div>
              <div className="text-sm text-gray-500">
                {w.season_number !== undefined && w.season_number !== null && w.episode_number !== undefined && w.episode_number !== null ? (
                  <span className="inline-flex items-center rounded bg-gray-100 border border-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                    S{String(w.season_number).padStart(2, "0")}E{String(w.episode_number).padStart(2, "0")}
                  </span>
                ) : w.episode_number !== undefined && w.episode_number !== null ? (
                  <span className="inline-flex items-center rounded bg-gray-100 border border-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                    E{String(w.episode_number).padStart(2, "0")}
                  </span>
                ) : (
                  "–"
                )}
              </div>
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
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-sm text-gray-900 leading-snug">{w.title}</p>
                        {broadcasterLogo && (
                          <span className="inline-flex h-6 max-w-20 items-center rounded border border-gray-200 bg-white px-1.5 py-0.5" title={broadcaster ?? undefined}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={broadcasterLogo} alt={`${broadcaster} logo`} className="max-h-4 max-w-full object-contain" loading="lazy" />
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{w.year ?? "–"} · {typeLabel(w.type, locale)}</p>
                      {(pendingLabel || adminComment) && (
                        <p className="mt-1 text-xs text-amber-700">
                          {pendingLabel ? `${pendingLabel}${adminComment ? ": " : ""}` : ""}
                          {adminComment}
                        </p>
                      )}
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
                      <p className="mt-0.5 text-gray-700">{displayRole(a.role)}</p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-400">{t("works.episodes")}</p>
                      <p className="mt-0.5 text-gray-700">
                        {w.season_number !== undefined && w.season_number !== null && w.episode_number !== undefined && w.episode_number !== null ? (
                          <span className="inline-flex items-center rounded bg-gray-100 border border-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700 font-mono">
                            S{String(w.season_number).padStart(2, "0")}E{String(w.episode_number).padStart(2, "0")}
                          </span>
                        ) : w.episode_number !== undefined && w.episode_number !== null ? (
                          <span className="inline-flex items-center rounded bg-gray-100 border border-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700 font-mono">
                            E{String(w.episode_number).padStart(2, "0")}
                          </span>
                        ) : (
                          "–"
                        )}
                      </p>
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
          {Math.min(filtered.length, pageSize)} {t("works.of")} {filtered.length} {t("works.worksLower")}
        </div>
      </div>

      {/* ── Tilføj-panel ──────────────────────────────────────────── */}
      <AddWorkModal
        isOpen={isAdding}
        onClose={() => setIsAdding(false)}
        rightsHolderId={rightsHolderId}
        onWorkAdded={(message, success) => setMsg({ type: success ? "success" : "error", text: message })}
        reloadAssignments={reloadAssignments}
        locale={locale}
        initialQuery={initialAddQuery}
      />

      {/* ── DFI-guiden ─────────────────────────────────────────────── */}
      <DfiImportWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        userName={userName}
        dfiPersonId={dfiPersonId}
        onImportComplete={(message, success) => {
          setMsg({ type: success ? "success" : "error", text: message });
          setWizardOpen(false);
        }}
        reloadAssignments={reloadAssignments}
      />

      {/* ── Redigér-panel ──────────────────────────────────────────── */}
      {editAssignment && (
        <EditWorkModal
          isOpen={!!editAssignment}
          onClose={closeEdit}
          assignment={editAssignment}
          allAssignments={allAssignments}
          onWorkUpdated={(message, success, updatedRole, targetId) => {
            setMsg({ type: success ? "success" : "error", text: message });
            if (success) {
              if (updatedRole && targetId) {
                setAssignments(prev => prev.map(a => a.id === targetId ? { ...a, role: updatedRole } : a));
              } else if (editAssignment?.works) {
                setAssignments(prev => prev.map(a => a.works?.id === editAssignment.works?.id ? {
                  ...a,
                  works: a.works ? { ...a.works, status: "til_godkendelse" } : a.works,
                } : a));
              }
              closeEdit();
            }
          }}
          locale={locale}
        />
      )}

      <ContextualHelp
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Hjælp til Mine værker"
        intro="Kort overblik over de vigtigste handlinger på siden."
        topics={MINE_VAERKER_HELP}
      />
    </div>
  );
}
