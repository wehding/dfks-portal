"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Film, Plus, Search, X, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchMemberSeasonEditContext, fetchMemberSeasonEpisodes, fetchMemberWorkDetail, fetchMemberWorkOverview, removeWorkAssignments } from "@/app/actions/member-works";
import { markWorkRequestCommentsRead } from "@/app/actions/work-management";
import { useI18n } from "@/lib/i18n";
import type { ManualWorkFormSeed } from "@/lib/manual-work";
import { AddWorkModal } from "./components/AddWorkModal";
import { EditWorkModal } from "./components/EditWorkModal";
import { ContextualHelp, HelpButton } from "@/components/help/contextual-help";
import { MINE_VAERKER_HELP } from "@/lib/portal-help";
import { ResetFiltersButton } from "@/components/filters/reset-filters-button";
import { WORK_TYPES } from "@/lib/work-types";

const TMDB_IMG     = "https://image.tmdb.org/t/p/w154";
const TAG_CLASS = "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4";

type Work = {
  id: string;
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  episode_count: number | null;
  parent_work_id?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  genre: string | null;
  director: string | null;
  production_companies?: string[] | null;
  status: string | null;
  dfi_id: string | null;
  tmdb_id: number | string | null;
  imdb_id?: string | null;
  field_sources?: Record<string, string> | null;
  poster_url: string | null;
  description: string | null;
  work_production_numbers?: WorkProductionNumber[];
  work_distributions?: Array<{ broadcaster_name?: string | null; broadcasters?: { name?: string | null } | null }>;
  work_change_requests?: ChangeRequest[];
  is_season_group?: boolean;
  group_key?: string;
  child_work_ids?: string[];
  child_assignment_ids?: string[];
  overview_contract_count?: number;
  overview_pending_count?: number;
  overview_unread_count?: number;
};
export type Assignment = { id: string; work_id?: string; rights_holder_id?: string | null; role: string | null; contract_id: string | null; episode_id: string | null; created_at?: string | null; episodes: { episode_number: number; title?: string | null } | null; works: Work | null };
export type OtherAssignment = { id: string; work_id: string; role: string | null; rights_holder_id?: string | null; rettighedshavere: { id?: string; full_name: string } | null; works?: Work | null };
type WorkProductionNumber = { tv_station: string | null; number: string | null };
export type BroadcasterLogo = { name: string; logo_path: string | null };
type SortKey = "date" | "title" | "year" | "type" | "role" | "episode" | "coEditors" | "contract";
const ADD_WORK_PREFILL_KEY = "dfks_add_work_prefill";

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

type MemberOverviewItem =
  | {
      kind: "work";
      work: Work & { assignment: Assignment; contract_count?: number; pending_count?: number; unread_count?: number };
      contractCount: number;
      pendingCount: number;
      unreadCount: number;
    }
  | {
      kind: "season";
      key: string;
      parentWorkId: string;
      seasonNumber: number;
      title: string;
      type: string;
      year: number | null;
      posterUrl: string | null;
      episodeCount: number;
      workIds: string[];
      assignmentIds: string[];
      contractCount: number;
      pendingCount: number;
      unreadCount: number;
      roleSummary: string | null;
      createdAt: string | null;
    };

export function memberOverviewItemsToAssignments(items: MemberOverviewItem[]): Assignment[] {
  return items.map(item => {
    if (item.kind === "work") {
      return {
        ...item.work.assignment,
        works: item.work.assignment.works ? {
          ...item.work.assignment.works,
          overview_contract_count: item.contractCount,
          overview_pending_count: item.pendingCount,
          overview_unread_count: item.unreadCount,
        } : null,
      };
    }
    return {
      id: item.key,
      role: item.roleSummary,
      contract_id: null,
      episode_id: null,
      created_at: item.createdAt,
      episodes: null,
      works: {
        id: item.key,
        title: item.title,
        type: item.type,
        year: item.year,
        duration_minutes: null,
        episode_count: item.episodeCount,
        parent_work_id: item.parentWorkId,
        season_number: item.seasonNumber,
        episode_number: null,
        genre: null,
        director: null,
        production_companies: null,
        status: item.pendingCount > 0 ? "til_godkendelse" : "aktiv",
        dfi_id: null,
        tmdb_id: null,
        poster_url: item.posterUrl,
        description: null,
        is_season_group: true,
        group_key: item.key,
        child_work_ids: item.workIds,
        child_assignment_ids: item.assignmentIds,
        overview_contract_count: item.contractCount,
        overview_pending_count: item.pendingCount,
        overview_unread_count: item.unreadCount,
      },
    };
  });
}
function typeLabel(t: string, locale: "da" | "en" = "da") {
  const key = t?.toLowerCase();
  const canonical: Record<string, "feature" | "series" | "documentary" | "docSeries" | "docudrama" | "short" | "animation"> = {
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
    dokudrama: "docudrama",
    kort: "short",
    kortfilm: "short",
    short: "short",
    animation: "animation",
  };
  const labels = {
    da: { feature: "Feature", series: "TV-serie", documentary: "Dokumentar", docSeries: "Dokumentarserie", docudrama: "Dokudrama", short: "Kortfilm", animation: "Animation" },
    en: { feature: "Feature", series: "TV series", documentary: "Documentary", docSeries: "Documentary series", docudrama: "Docudrama", short: "Short film", animation: "Animation" },
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
  const distributions = (work?.work_distributions ?? []).map(item => item.broadcasters?.name ?? item.broadcaster_name).filter(Boolean);
  if (distributions.length > 0) return distributions.join(", ");
  return (work?.work_production_numbers ?? []).find(item => item.number === "broadcast/stream")?.tv_station ?? null;
}

function pendingRequestLabel(work: Work | null) {
  return (work?.overview_pending_count ?? 0) > 0 || (work?.work_change_requests ?? []).some(request => request.status === "pending") ? "Afventer admin" : null;
}

function isSeriesType(type: string | null | undefined) {
  const label = typeLabel(type ?? "", "da");
  return label === "TV-serie" || label === "Dokumentarserie";
}

export default function MineVaerkerClient({
  initialAssignments, allAssignments: initialAllAssignments, broadcasters, rightsHolderId, contractedWorkIds,
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
  const [allAssignments, setAllAssignments] = useState(initialAllAssignments);

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
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey]   = useState<SortKey>("date");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg]           = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [seriesEpisodes, setSeriesEpisodes] = useState<Record<string, Assignment[]>>({});
  const [loadingSeries, setLoadingSeries] = useState<Set<string>>(new Set());
  const [seriesErrors, setSeriesErrors] = useState<Record<string, string>>({});

  // Dialoger og modaler
  const [isAdding, setIsAdding]             = useState(false);
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null);
  const [editScope, setEditScope] = useState<"work" | "season" | "episode">("work");
  const [editSeasonWorkIds, setEditSeasonWorkIds] = useState<string[]>([]);
  const [editEpisodeOptions, setEditEpisodeOptions] = useState<Array<{ number: number; title: string }>>([]);
  const [editContextAssignments, setEditContextAssignments] = useState<OtherAssignment[]>([]);
  const [initialAddQuery, setInitialAddQuery] = useState("");
  const [initialManualWork, setInitialManualWork] = useState<ManualWorkFormSeed | null>(null);
  const addParamHandledRef = React.useRef<string | null>(null);
  const requestParamHandledRef = React.useRef<string | null>(null);

  const router   = useRouter();
  const searchParams = useSearchParams();

  React.useEffect(() => {
    if (searchParams?.get("add") === "1") {
      const key = searchParams.toString();
      if (addParamHandledRef.current === key) return;
      addParamHandledRef.current = key;
      let prefill: ManualWorkFormSeed | null = null;
      if (typeof window !== "undefined") {
        const raw = window.sessionStorage.getItem(ADD_WORK_PREFILL_KEY);
        if (raw) {
          try {
            prefill = JSON.parse(raw) as ManualWorkFormSeed;
          } catch {
            prefill = null;
          }
          window.sessionStorage.removeItem(ADD_WORK_PREFILL_KEY);
        }
      }
      setInitialManualWork(prefill);
      setInitialAddQuery(searchParams?.get("q") ?? "");
      setIsAdding(true);
    }
  }, [searchParams]);

  const filtered = assignments
    .filter(a => {
      const w = a.works;
      if (!w) return false;
      const t = search.toLowerCase();
      if (t && !w.title.toLowerCase().includes(t)) return false;
      if (catFilter !== "all" && w.type !== catFilter) return false;
      const requests = w.work_change_requests ?? [];
      const hasUnread = (w.overview_unread_count ?? 0) > 0 || requests.some(request => (request.work_change_request_comments ?? []).some(comment => comment.author_role === "admin" && !comment.member_read_at));
      const hasPending = (w.overview_pending_count ?? 0) > 0 || requests.some(request => request.status === "pending") || w.status === "til_godkendelse";
      const hasRejected = requests.some(request => request.status === "rejected");
      const hasContract = (w.overview_contract_count ?? 0) > 0 || contractedWorkIds.includes(w.id);
      const missingData = !w.year || !w.type || !w.title?.trim();
      const missingEpisodes = isSeriesType(w.type) && !w.episode_count;
      if (statusFilter === "messages" && !hasUnread) return false;
      if (statusFilter === "pending" && !hasPending) return false;
      if (statusFilter === "rejected" && !hasRejected) return false;
      if (statusFilter === "missingContract" && hasContract) return false;
      if (statusFilter === "hasContract" && !hasContract) return false;
      if (statusFilter === "missingData" && !missingData) return false;
      if (statusFilter === "missingEpisodes" && !missingEpisodes) return false;
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
  const selectionIdsFor = (assignment: Assignment) => assignment.works?.is_season_group
    ? assignment.works.child_assignment_ids ?? []
    : [assignment.id];
  const filteredSelectionIds = [...new Set(filtered.flatMap(selectionIdsFor))];
  const allFilteredSelected = filteredSelectionIds.length > 0 && filteredSelectionIds.every(id => selected.includes(id));
  const toggleAssignmentSelection = (assignment: Assignment) => {
    const ids = selectionIdsFor(assignment);
    const allSelected = ids.length > 0 && ids.every(id => selected.includes(id));
    setSelected(prev => allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  };

  const renderSeriesEpisodes = (work: Work, children: Assignment[], isLoadingChildren: boolean, className = "px-14") => (
    <div className="border-b bg-muted/40">
      {isLoadingChildren ? (
        <div className={`${className} py-3 text-xs text-muted-foreground`}>Henter afsnit...</div>
      ) : seriesErrors[work.id] ? (
        <div className={`${className} py-3 text-xs text-destructive`}>
          {seriesErrors[work.id]}
          <Button size="sm" variant="outline" className="ml-2" onClick={() => void loadMemberSeason(work, true)}>Prøv igen</Button>
        </div>
      ) : children.length === 0 ? (
        <div className={`${className} py-3 text-xs text-muted-foreground`}>Ingen af dine afsnit er registreret endnu</div>
      ) : (
        children.map(assignment => {
          const ep = assignment.works;
          if (!ep) return null;
          const coEditors = coEditorMap[ep.id] ?? [];
          return (
              <button
                type="button"
                key={assignment.id}
                onClick={() => openEdit(assignment)}
                className={`${className} flex w-full items-start gap-2 border-t py-3 text-left text-sm text-muted-foreground first:border-t-0 hover:bg-muted/70`}
              >
                <span className="inline-flex items-center rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-4 text-foreground">
                  {ep.season_number != null && ep.episode_number != null
                    ? `S${String(ep.season_number).padStart(2, "0")}E${String(ep.episode_number).padStart(2, "0")}`
                    : ep.episode_number != null
                      ? `E${String(ep.episode_number).padStart(2, "0")}`
                      : "-"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{ep.title}</span>
                  <span className="mt-1 block text-xs">Rolle: {displayRole(assignment.role)} · Medklippere: {coEditors.length ? coEditors.join(", ") : "–"}</span>
                  <span className="mt-0.5 block text-xs">{(ep.overview_contract_count ?? 0) > 0 || contractedWorkIds.includes(ep.id) ? "Kontrakt tilknyttet" : "Mangler kontrakt"}</span>
                </span>
                <span className="text-xs font-medium text-foreground">Rediger</span>
              </button>
          );
        })
      )}
    </div>
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "date" ? "desc" : "asc"); }
  };
  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const loadMemberSeason = async (work: Work, force = false) => {
    const workId = work.id;
    if ((!force && seriesEpisodes[workId]) || loadingSeries.has(workId) || !rightsHolderId || !work.parent_work_id || work.season_number == null) return;

    setLoadingSeries(prev => new Set(prev).add(workId));
    setSeriesErrors(prev => { const next = { ...prev }; delete next[workId]; return next; });
    const result = await fetchMemberSeasonEpisodes({ rightsHolderId, parentWorkId: work.parent_work_id, seasonNumber: work.season_number });
    if (result.success) {
      const episodes = result.assignments as unknown as Assignment[];
      setSeriesEpisodes(prev => ({ ...prev, [workId]: episodes }));
      const incoming = result.allAssignments as unknown as OtherAssignment[];
      const episodeIds = new Set(episodes.map(item => item.works?.id).filter(Boolean));
      setAllAssignments(prev => [...prev.filter(item => !episodeIds.has(item.work_id)), ...incoming]);
    } else {
      const error = result.error ?? "Kunne ikke hente sæsonens afsnit.";
      setSeriesErrors(prev => ({ ...prev, [workId]: error }));
      setMsg({ type: "error", text: error });
    }
    setLoadingSeries(prev => {
      const next = new Set(prev);
      next.delete(workId);
      return next;
    });
  };

  const toggleSeries = (work: Work) => {
    const workId = work.id;
    const isOpen = expandedSeries.has(workId);
    setExpandedSeries(prev => {
      const next = new Set(prev);
      if (isOpen) next.delete(workId); else next.add(workId);
      return next;
    });
    if (!isOpen) void loadMemberSeason(work);
  };

  const totalWorks = assignments.reduce((sum, assignment) => sum + (assignment.works?.is_season_group ? assignment.works.episode_count ?? 0 : 1), 0);
  const withContract = assignments.reduce((sum, assignment) => sum + (assignment.works?.is_season_group ? assignment.works.overview_contract_count ?? 0 : contractedWorkIds.includes(assignment.works?.id ?? "") ? 1 : 0), 0);
  const missingContract = Math.max(totalWorks - withContract, 0);



  const reloadAssignments = async () => {
    if (!rightsHolderId) return;
    const overview = await fetchMemberWorkOverview({ rightsHolderId });
    if (overview.success) {
      setAssignments(memberOverviewItemsToAssignments(overview.items as unknown as MemberOverviewItem[]));
      setSeriesEpisodes({});
      setSeriesErrors({});
      setExpandedSeries(new Set());
    }
  };

  const openEdit = async (a: Assignment) => {
    setEditScope(a.works?.parent_work_id && a.works.episode_number != null ? "episode" : "work");
    setEditSeasonWorkIds([]);
    setEditEpisodeOptions([]);
    setEditContextAssignments([]);
    setEditAssignment(a);
    if (!rightsHolderId) return;
    const res = await fetchMemberWorkDetail({ rightsHolderId, assignmentId: a.id });
    if (res.success && res.assignment) {
      const detailed = res.assignment as unknown as Assignment;
      setAssignments(prev => prev.map(item => item.id === a.id ? detailed : item));
      setEditAssignment(detailed);
      setAllAssignments(prev => {
        const incoming = (res.coEditors ?? []) as unknown as OtherAssignment[];
        const retained = prev.filter(item => item.work_id !== detailed.works?.id);
        return [...retained, ...incoming];
      });
      void markRequestCommentsRead(detailed);
    } else {
      setMsg({ type: "error", text: res.error ?? "Kunne ikke hente værkdetaljer." });
    }
  };

  React.useEffect(() => {
    const requestId = searchParams?.get("request");
    if (!requestId || requestParamHandledRef.current === requestId) return;
    const assignment = assignments.find(item => (item.works?.work_change_requests ?? []).some(request => request.id === requestId));
    if (!assignment) return;
    requestParamHandledRef.current = requestId;
    void openEdit(assignment);
    // openEdit intentionally uses the current assignment state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, searchParams]);

  const openSeasonEdit = async (work: Work) => {
    if (!rightsHolderId || !work.parent_work_id || work.season_number == null) return;
    const result = await fetchMemberSeasonEditContext({
      rightsHolderId,
      parentWorkId: work.parent_work_id,
      seasonNumber: work.season_number,
    });
    if (!result.success || !result.parentWork || !result.representativeAssignment) {
      setMsg({ type: "error", text: result.error ?? "Sæsonen kunne ikke åbnes." });
      return;
    }
    const ownAssignments = result.assignments as unknown as Assignment[];
    const representative = result.representativeAssignment as unknown as Assignment;
    const parentWork = result.parentWork as unknown as Work;
    const seasonAssignments = result.allAssignments as unknown as OtherAssignment[];
    setEditScope("season");
    setEditSeasonWorkIds([...new Set(seasonAssignments.map(item => item.work_id).filter((id): id is string => Boolean(id)))]);
    setEditEpisodeOptions((result.options ?? []) as Array<{ number: number; title: string }>);
    setEditContextAssignments([
      ...ownAssignments.map(item => ({
        id: item.id,
        work_id: item.works?.id ?? "",
        role: item.role,
        rights_holder_id: item.rights_holder_id ?? rightsHolderId,
        rettighedshavere: null,
        works: item.works,
      })),
      ...seasonAssignments,
    ]);
    setEditAssignment({
      ...representative,
      work_id: representative.works?.id,
      rights_holder_id: rightsHolderId,
      works: { ...parentWork, season_number: work.season_number },
    });
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
    setEditContextAssignments([]);
  };

  const handleDeleteSelected = async () => {
    if (!selected.length) return;
    setRemoveConfirmOpen(true);
  };

  const confirmDeleteSelected = async () => {
    if (!selected.length) return;
    const ids = [...selected];
    setRemoveConfirmOpen(false);
    try {
      const res = await removeWorkAssignments(ids, rightsHolderId ?? "");
      if (res.success) {
        setAssignments(prev => prev.filter(a => !ids.includes(a.id)));
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
          <h1 className="hidden text-2xl font-bold text-foreground sm:block">{t("works.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("works.registeredSubtitle")}</p>
        </div>
        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <HelpButton onClick={() => setHelpOpen(true)} />
          <Button onClick={() => setIsAdding(true)} className="w-full gap-2 sm:w-auto">
            <Plus className="h-4 w-4" /> {t("works.addWork")}
          </Button>
        </div>
      </div>

      {/* Statistik */}
      <div className="hidden gap-3 sm:grid sm:grid-cols-3 sm:gap-4">
        {[
          { label: t("works.totalWorks"),  value: totalWorks },
          { label: t("works.withContract"),  value: withContract },
          { label: t("works.missingContract"), value: missingContract },
        ].map(s => (
          <div key={s.label} className="rounded-lg border bg-card px-4 py-4 text-card-foreground sm:px-6 sm:py-5">
            <p className="text-sm font-medium text-muted-foreground mb-1">{s.label}</p>
            <p className="text-2xl font-bold text-foreground sm:text-3xl">{s.value}</p>
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
      <div className="rounded-lg border bg-card text-card-foreground overflow-hidden">

        {/* Toolbar */}
        <div className="flex flex-col px-4 py-3.5 border-b gap-3 sm:px-5 md:flex-row md:items-center md:justify-between">
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
              <>
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder={t("works.searchPlaceholder")}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-9 w-full pl-8 pr-8 text-sm"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border text-muted-foreground hover:text-foreground"
                    aria-label="Tøm søgefelt"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="h-9 w-full text-sm sm:w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Type</SelectItem>
                  {WORK_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-full text-sm sm:w-[210px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle statusser</SelectItem>
                  <SelectItem value="messages">Nye beskeder fra DFKS</SelectItem>
                  <SelectItem value="pending">Afventer godkendelse</SelectItem>
                  <SelectItem value="rejected">Afvist rettelse</SelectItem>
                  <SelectItem value="missingContract">Mangler kontrakt</SelectItem>
                  <SelectItem value="hasContract">Har kontrakt</SelectItem>
                  <SelectItem value="missingData">Mangler værksdata</SelectItem>
                  <SelectItem value="missingEpisodes">Serie mangler afsnit</SelectItem>
                </SelectContent>
              </Select>
              </>
            )}
          </div>
          <ResetFiltersButton
            active={Boolean(search || catFilter !== "all" || statusFilter !== "all")}
            onReset={() => { setSearch(""); setCatFilter("all"); setStatusFilter("all"); setSelected([]); setPageSize(20); }}
          />
	          <label className="flex items-center gap-2 text-sm text-muted-foreground">
	            Vis
	            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
	              {[10, 20, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
	            </select>
	          </label>
	          {filtered.length > 0 && (
	            <Button
	              type="button"
	              variant="outline"
	              className="w-full sm:w-auto lg:hidden"
	              onClick={() => setSelected(allFilteredSelected ? [] : filteredSelectionIds)}
	            >
	              {allFilteredSelected ? "Fravælg alle" : "Vælg alle"}
	              {selected.length > 0 ? ` (${selected.length})` : ""}
	            </Button>
	          )}
	          <div className="grid grid-cols-[1fr_auto] gap-2 lg:hidden">
            <Select value={sortKey} onValueChange={value => setSortKey(value as SortKey)}>
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
          className="hidden px-5 py-2.5 border-b text-sm font-medium text-muted-foreground select-none lg:grid"
          style={{ gridTemplateColumns: "36px 2.5fr 0.5fr 1fr 0.7fr 0.7fr 1.5fr 0.5fr" }}
        >
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={() => setSelected(allFilteredSelected ? [] : filteredSelectionIds)}
            className="cursor-pointer w-4 h-4"
          />
          <button type="button" onClick={() => handleSort("title")} className="text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("works.workTitle")}{sortArrow("title")}</button>
          <button type="button" onClick={() => handleSort("year")} className="text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("works.year")}{sortArrow("year")}</button>
          <button type="button" onClick={() => handleSort("type")} className="text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("works.type")}{sortArrow("type")}</button>
          <button type="button" onClick={() => handleSort("role")} className="text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("works.role")}{sortArrow("role")}</button>
          <button type="button" onClick={() => handleSort("episode")} className="text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("works.episodes")}{sortArrow("episode")}</button>
          <button type="button" onClick={() => handleSort("coEditors")} className="text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("works.coEditors")}{sortArrow("coEditors")}</button>
          <button type="button" onClick={() => handleSort("contract")} className="text-right hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("works.contract")}{sortArrow("contract")}</button>
        </div>

        {/* Rækker */}
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Film className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p>{assignments.length === 0 ? t("works.emptyHint") : t("works.noSearchResults")}</p>
          </div>
        ) : visibleAssignments.map(a => {
          const w = a.works;
          if (!w) return null;
          const posterSrc = w.poster_url
            ? (w.poster_url.startsWith("http") || w.poster_url.startsWith("data:image/") ? w.poster_url : `${TMDB_IMG}${w.poster_url}`)
            : null;
          const contractCount = w.is_season_group ? w.overview_contract_count ?? 0 : contractedWorkIds.includes(w.id) ? 1 : 0;
          const hasContract = contractCount > 0;
          const hasAllContracts = w.is_season_group ? contractCount >= (w.episode_count ?? 0) && (w.episode_count ?? 0) > 0 : hasContract;
          const adminComment = latestAdminComment(w);
          const pendingLabel = pendingRequestLabel(w);
          const broadcaster = getWorkBroadcaster(w);
          const broadcasterLogo = broadcaster ? broadcasterLogoMap[broadcaster] : null;
          const isSeriesParent = Boolean(w.is_season_group);
          const isExpanded = expandedSeries.has(w.id);
          const children = seriesEpisodes[w.id] ?? [];
          const isLoadingChildren = loadingSeries.has(w.id);
          return (
            <React.Fragment key={a.id}>
            <div
              onClick={() => { if (!isSeriesParent) void openEdit(a); }}
              className="hidden items-center px-5 py-3 border-b hover:bg-muted/50 transition-colors lg:grid"
              style={{ gridTemplateColumns: "36px 2.5fr 0.5fr 1fr 0.7fr 0.7fr 1.5fr 0.5fr" }}
            >
              <div onClick={e => { e.stopPropagation(); toggleAssignmentSelection(a); }}>
                <input type="checkbox" checked={selectionIdsFor(a).length > 0 && selectionIdsFor(a).every(id => selected.includes(id))} onChange={() => {}} className="cursor-pointer w-4 h-4" />
              </div>

              {/* Poster + titel */}
              <div className="flex items-center gap-3">
                {isSeriesParent ? (
                  <button
                    type="button"
                    onClick={event => { event.stopPropagation(); void toggleSeries(w); }}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={isExpanded ? "Skjul afsnit" : "Vis afsnit"}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <button type="button" onClick={event => { if (isSeriesParent) { event.stopPropagation(); void openSeasonEdit(w); } }} className="w-8 shrink-0 flex items-center justify-center" aria-label={isSeriesParent ? `Rediger ${w.title} sæson ${w.season_number}` : undefined}>
                  {posterSrc ? (
                    <div className="w-8 h-11 rounded overflow-hidden shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={posterSrc} alt={w.title} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  ) : (
                    <Film className="h-4 w-4 text-muted-foreground/50" />
                  )}
                </button>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={event => { if (isSeriesParent) { event.stopPropagation(); void openSeasonEdit(w); } }} className="text-left font-semibold text-sm text-foreground leading-snug hover:underline">{w.title}{isSeriesParent && w.season_number != null ? ` · Sæson ${w.season_number}` : ""}</button>
                    {broadcasterLogo && (
                      <span className="inline-flex h-6 max-w-20 items-center rounded border bg-background px-1.5 py-0.5" title={broadcaster ?? undefined}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={broadcasterLogo} alt={`${broadcaster} logo`} className="max-h-4 max-w-full object-contain" loading="lazy" />
                      </span>
                    )}
                  </div>
                  {w.description && <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[260px]">{w.description}</p>}
                  {(pendingLabel || adminComment) && (
                    <p className="mt-1 max-w-[300px] truncate text-xs text-amber-700">
                      {pendingLabel ? `${pendingLabel}${adminComment ? ": " : ""}` : ""}
                      {adminComment}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-sm text-muted-foreground">{w.year ?? "–"}</div>
              <div className="text-sm text-muted-foreground">{typeLabel(w.type, locale)}</div>
              <div className="text-sm text-muted-foreground">{displayRole(a.role)}</div>
              <div className="text-sm text-muted-foreground">
                {isSeriesParent ? (
                  <span>{w.episode_count ?? 0} afsnit</span>
                ) : w.season_number !== undefined && w.season_number !== null && w.episode_number !== undefined && w.episode_number !== null ? (
                  <span className="inline-flex items-center rounded bg-muted border px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-foreground">
                    S{String(w.season_number).padStart(2, "0")}E{String(w.episode_number).padStart(2, "0")}
                  </span>
                ) : w.episode_number !== undefined && w.episode_number !== null ? (
                  <span className="inline-flex items-center rounded bg-muted border px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-foreground">
                    E{String(w.episode_number).padStart(2, "0")}
                  </span>
                ) : (
                  "–"
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate" title={(coEditorMap[w.id] ?? []).join(", ")}>
                {(coEditorMap[w.id] ?? []).length > 0 ? coEditorMap[w.id].join(", ") : "–"}
              </div>

              {/* Kontrakt-badge */}
              <div
                className="flex justify-end"
                onClick={e => { e.stopPropagation(); router.push(isSeriesParent || hasContract ? `/portal/mine-kontrakter` : `/portal/mine-kontrakter?upload=true&workId=${w.id}&workTitle=${encodeURIComponent(w.title)}`); }}
              >
                {hasAllContracts ? (
                  <span className={`${TAG_CLASS} cursor-pointer`} style={{ backgroundColor: "#dcfce7", color: "#166534" }}>{t("works.contractOk")}</span>
                ) : isSeriesParent && hasContract ? (
                  <Badge variant="outline" className={`${TAG_CLASS} cursor-pointer border-blue-300 text-blue-700`}>Delvis</Badge>
                ) : (
                  <Badge variant="outline" className={`${TAG_CLASS} cursor-pointer border-amber-300 text-amber-600`}>{t("works.contractMissing")}</Badge>
                )}
              </div>
            </div>
            <div
              key={`${a.id}-mobile`}
              onClick={() => { if (!isSeriesParent) void openEdit(a); }}
              className="border-b px-4 py-4 transition-colors active:bg-muted/50 lg:hidden"
            >
              <div className="flex gap-3">
                <div onClick={e => { e.stopPropagation(); toggleAssignmentSelection(a); }} className="pt-1">
                  <input type="checkbox" checked={selectionIdsFor(a).length > 0 && selectionIdsFor(a).every(id => selected.includes(id))} onChange={() => {}} className="cursor-pointer w-4 h-4" />
                </div>
                <button type="button" onClick={event => { if (isSeriesParent) { event.stopPropagation(); void openSeasonEdit(w); } }} className="w-10 shrink-0 flex items-start justify-center" aria-label={isSeriesParent ? `Rediger ${w.title} sæson ${w.season_number}` : undefined}>
                  {posterSrc ? (
                    <div className="h-14 w-10 overflow-hidden rounded">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={posterSrc} alt={w.title} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ) : (
                    <div className="flex h-14 w-10 items-center justify-center rounded bg-muted">
                      <Film className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {isSeriesParent && (
                          <button
                            type="button"
                            onClick={event => { event.stopPropagation(); void toggleSeries(w); }}
                            className="shrink-0 text-gray-400 hover:text-gray-700"
                            aria-label={isExpanded ? "Skjul afsnit" : "Vis afsnit"}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        )}
                        <button type="button" onClick={event => { if (isSeriesParent) { event.stopPropagation(); void openSeasonEdit(w); } }} className="text-left font-semibold text-sm text-foreground leading-snug hover:underline">{w.title}{isSeriesParent && w.season_number != null ? ` · Sæson ${w.season_number}` : ""}</button>
                        {broadcasterLogo && (
                          <span className="inline-flex h-6 max-w-20 items-center rounded border bg-background px-1.5 py-0.5" title={broadcaster ?? undefined}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={broadcasterLogo} alt={`${broadcaster} logo`} className="max-h-4 max-w-full object-contain" loading="lazy" />
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{w.year ?? "–"} · {typeLabel(w.type, locale)}</p>
                      {(pendingLabel || adminComment) && (
                        <p className="mt-1 text-xs text-amber-700">
                          {pendingLabel ? `${pendingLabel}${adminComment ? ": " : ""}` : ""}
                          {adminComment}
                        </p>
                      )}
                    </div>
                    <div
                      className="shrink-0"
                      onClick={e => { e.stopPropagation(); router.push(isSeriesParent || hasContract ? `/portal/mine-kontrakter` : `/portal/mine-kontrakter?upload=true&workId=${w.id}&workTitle=${encodeURIComponent(w.title)}`); }}
                    >
                      {hasAllContracts ? (
                        <span className={`${TAG_CLASS} cursor-pointer`} style={{ backgroundColor: "#dcfce7", color: "#166534" }}>{t("works.contractOk")}</span>
                      ) : isSeriesParent && hasContract ? (
                        <Badge variant="outline" className={`${TAG_CLASS} cursor-pointer border-blue-300 text-blue-700`}>Delvis</Badge>
                      ) : (
                        <Badge variant="outline" className={`${TAG_CLASS} cursor-pointer border-amber-300 text-amber-600`}>{t("works.contractMissing")}</Badge>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="font-medium text-muted-foreground">Rolle</p>
                      <p className="mt-0.5 text-foreground">{displayRole(a.role)}</p>
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">{t("works.episodes")}</p>
                      <p className="mt-0.5 text-foreground">
                        {isSeriesParent ? (
                          <span>{w.episode_count ?? 0} afsnit</span>
                        ) : w.season_number !== undefined && w.season_number !== null && w.episode_number !== undefined && w.episode_number !== null ? (
                          <span className="inline-flex items-center rounded bg-muted border px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-foreground font-mono">
                            S{String(w.season_number).padStart(2, "0")}E{String(w.episode_number).padStart(2, "0")}
                          </span>
                        ) : w.episode_number !== undefined && w.episode_number !== null ? (
                          <span className="inline-flex items-center rounded bg-muted border px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-foreground font-mono">
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
            {isSeriesParent && isExpanded && (
              <>
                <div className="hidden lg:block">
                  {renderSeriesEpisodes(w, children, isLoadingChildren)}
                </div>
                <div className="lg:hidden">
                  {renderSeriesEpisodes(w, children, isLoadingChildren, "px-8")}
                </div>
              </>
            )}
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
        onClose={() => { setIsAdding(false); setInitialManualWork(null); }}
        rightsHolderId={rightsHolderId}
        onWorkAdded={(message, success) => setMsg({ type: success ? "success" : "error", text: message })}
        reloadAssignments={reloadAssignments}
        locale={locale}
        initialQuery={initialAddQuery}
        initialManualWork={initialManualWork}
      />

      {/* ── Redigér-panel ──────────────────────────────────────────── */}
      {editAssignment && (
        <EditWorkModal
          isOpen={!!editAssignment}
          onClose={closeEdit}
          assignment={editAssignment}
          allAssignments={editScope === "season" ? editContextAssignments : allAssignments}
          editScope={editScope}
          seasonWorkIds={editSeasonWorkIds}
          initialEpisodeOptions={editEpisodeOptions}
          onWorkUpdated={(message, success, updatedRole, targetId) => {
            setMsg({ type: success ? "success" : "error", text: message });
            if (success) {
              // Rollerettelse afspejles med det samme. En data-/medklipper-rettelse
              // ændrer IKKE værkets status — værket forbliver "godkendt", og kun
              // ændringsanmodningen er pending (bekræftes via toast-beskeden).
              if (updatedRole && targetId) {
                setAssignments(prev => prev.map(a => a.id === targetId ? { ...a, role: updatedRole } : a));
                setSeriesEpisodes(prev => Object.fromEntries(Object.entries(prev).map(([key, rows]) => [
                  key,
                  rows.map(a => a.id === targetId ? { ...a, role: updatedRole } : a),
                ])));
              }
              const editedWork = editAssignment.works;
              const seasonGroup = editedWork?.parent_work_id && editedWork.season_number != null
                ? assignments.find(a => a.works?.is_season_group && a.works.parent_work_id === editedWork.parent_work_id && a.works.season_number === editedWork.season_number)?.works
                : null;
              if (seasonGroup) void loadMemberSeason(seasonGroup, true);
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
        intro="Sådan finder, tilføjer og retter du de værker, du har arbejdet på."
        topics={MINE_VAERKER_HELP}
        storageKey="dfks-help-mine-vaerker-v3"
      />

      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fjern valgte værker?</DialogTitle>
            <DialogDescription>
              {t("works.confirmRemove").replace("{count}", String(selected.length))}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveConfirmOpen(false)}>
              Annuller
            </Button>
            <Button variant="destructive" onClick={confirmDeleteSelected}>
              Fjern {selected.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
