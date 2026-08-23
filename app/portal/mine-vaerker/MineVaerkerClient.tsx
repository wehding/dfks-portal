"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, Film, Plus, Search, X, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchMemberSeasonEditContext, fetchMemberSeasonEpisodes, fetchMemberSeriesEpisodeOptions, fetchMemberWorkDetail, fetchMemberWorkOverview, removeWorkAssignments, syncMemberEpisodeAssignments, updateMemberCoEditors } from "@/app/actions/member-works";
import { markWorkRequestCommentsRead } from "@/app/actions/work-management";
import { useI18n } from "@/lib/i18n";
import type { ManualWorkFormSeed } from "@/lib/manual-work";
import { LocalRightsHolderAutocomplete } from "@/components/works/local-rights-holder-autocomplete";
import { ResetFiltersButton } from "@/components/filters/reset-filters-button";
import { WORK_TYPES } from "@/lib/work-types";
import { ExpandableListTrigger, SummaryCard, SummaryGrid } from "@/components/responsive-data-view";
import { PortalPageHeader } from "@/components/portal/portal-page-header";
import { ListResultSummary } from "@/components/list-result-summary";
import { fetchMemberShareTaskTarget } from "@/app/actions/work-share-cases";
import { confirmNoCoeditors, fetchMemberCollaborationReviews, fetchMemberWorkReviewTasks } from "@/app/actions/work-collaboration-reviews";
import type { Contract } from "../mine-kontrakter/MineKontrakterClient";
import { resolveWorkEditorRelation } from "@/lib/work-editor-roles";
import type { MemberWorkReviewCoEditor, MemberWorkReviewTask } from "@/lib/member-work-review";
import { collaborationReviewIndicator } from "@/lib/work-collaboration-review";
import { memberOverviewItemsToAssignments } from "@/lib/member-work-overview";
import type { MemberOverviewItem } from "@/lib/member-work-overview";
import { ListReadinessMarker } from "@/components/performance/list-readiness-marker";
import { createClientId } from "@/lib/client-id";

const AddWorkModal = dynamic(() => import("./components/AddWorkModal").then(module => module.AddWorkModal), { ssr: false });
const EditWorkModal = dynamic(() => import("./components/EditWorkModal").then(module => module.EditWorkModal), { ssr: false });
const MineKontrakterClient = dynamic(() => import("../mine-kontrakter/MineKontrakterClient"), { ssr: false });

const TMDB_IMG     = "https://image.tmdb.org/t/p/w154";
const TAG_CLASS = "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4";
const REVIEW_ROLES = ["Klipper", "B-klipper", "Konceptuerende klipper"];

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
  episode_selection_status?: "pending" | "confirmed";
  episode_scope_id?: string | null;
  covers_whole_season?: boolean;
};
export type Assignment = { id: string; work_id?: string; rights_holder_id?: string | null; role: string | null; contract_id: string | null; episode_id: string | null; created_at?: string | null; episodes: { episode_number: number; title?: string | null } | null; works: Work | null };
export type OtherAssignment = { id: string; work_id: string; role: string | null; rights_holder_id?: string | null; rettighedshavere: { id?: string; full_name: string } | null; works?: Work | null };
type WorkProductionNumber = { tv_station: string | null; number: string | null };
export type BroadcasterLogo = { name: string; logo_path: string | null };
type SortKey = "date" | "title" | "year" | "type" | "role" | "episode" | "coEditors" | "contract";
type EditReturnContext = "list" | "review" | "contract";
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
type ReviewCoEditorDraft = {
  id: string;
  name: string;
  rightsHolderId: string | null;
  role: string;
};

type CollaborationReview = {
  id: string;
  work_id: string;
  status: "pending" | "solo_confirmed" | "coeditors_reported" | "disputed";
  currentCoeditorCount: number;
  works: {
    id: string;
    title: string;
    type: string | null;
    parent_work_id: string | null;
    season_number: number | null;
    episode_number: number | null;
  } | null;
};

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
    da: { feature: "Feature", series: "TV-serie", documentary: "Dokumentarfilm", docSeries: "Dokumentarserie", docudrama: "Dokudrama", short: "Kortfilm", animation: "Animation" },
    en: { feature: "Feature", series: "TV series", documentary: "Documentary", docSeries: "Documentary series", docudrama: "Docudrama", short: "Short film", animation: "Animation" },
  };
  const type = canonical[key] ?? null;
  return type ? labels[locale][type] : t ?? (locale === "da" ? "Ukendt" : "Unknown");
}

function displayRole(role: string | null | undefined, defaultRole = "Klipper", coeditorWord = "Medklipper") {
  return resolveWorkEditorRelation({
    view: "member",
    isSelf: true,
    editorCount: 1,
    storedRole: role,
    defaultRole,
    coeditorWord,
  }).combinedLabel;
}

function emptyReviewCoEditor(): ReviewCoEditorDraft {
  return { id: createClientId("review-co-editor"), name: "", rightsHolderId: null, role: "Klipper" };
}

function unknownReviewCoEditor(): ReviewCoEditorDraft {
  return { id: createClientId("review-co-editor-unknown"), name: "Ukendt medklipper", rightsHolderId: null, role: "Klipper" };
}

function reviewSharePercentOrNull(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
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
  initialAssignments, allAssignments: initialAllAssignments, broadcasters, rightsHolderId, contractedWorkIds, contracts, organisationShortName, defaultRoleLabel, coeditorWord, pageResult, initialQuery,
}: {
  initialAssignments: Assignment[];
  allAssignments: OtherAssignment[];
  broadcasters: BroadcasterLogo[];
  rightsHolderId: string | null;
  dfiPersonId: number | null;
  contractedWorkIds: string[];
  contracts: Contract[];
  organisationShortName: string;
  defaultRoleLabel: string;
  coeditorWord: string;
  pageResult: { page: number; pageSize: number; filteredCount: number; totalCount: number; hasNextPage: boolean };
  initialQuery: { search: string; workType: string; status: string; sortKey: string; sortDir: "asc" | "desc" };
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
      const relation = resolveWorkEditorRelation({
        view: "member",
        isSelf: false,
        editorCount: 2,
        storedRole: a.role,
        defaultRole: defaultRoleLabel,
        coeditorWord,
      });
      const displayName = `${name} (${relation.combinedLabel})`;
      if (!map[a.work_id]) map[a.work_id] = [];
      if (!map[a.work_id].includes(displayName)) map[a.work_id].push(displayName);
    }
    return map;
  }, [allAssignments, coeditorWord, defaultRoleLabel]);

  const [search, setSearch]     = useState(initialQuery.search);
  const [catFilter, setCatFilter] = useState(initialQuery.workType);
  const [statusFilter, setStatusFilter] = useState(initialQuery.status);
  const [sortKey, setSortKey]   = useState<SortKey>(initialQuery.sortKey as SortKey);
  const [sortDir, setSortDir]   = useState<"asc" | "desc">(initialQuery.sortDir);
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg]           = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pageSize, setPageSize] = useState(pageResult.pageSize);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [seriesEpisodes, setSeriesEpisodes] = useState<Record<string, Assignment[]>>({});
  const [loadingSeries, setLoadingSeries] = useState<Set<string>>(new Set());
  const [seriesErrors, setSeriesErrors] = useState<Record<string, string>>({});
  const [collaborationReviews, setCollaborationReviews] = useState<CollaborationReview[]>([]);
  const [reviewTasks, setReviewTasks] = useState<MemberWorkReviewTask[]>([]);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewTaskIndex, setReviewTaskIndex] = useState(0);
  const [reviewCompletedCount, setReviewCompletedCount] = useState(0);
  const [reviewRefreshDeferred, setReviewRefreshDeferred] = useState(false);
  const [reviewCoEditorDrafts, setReviewCoEditorDrafts] = useState<ReviewCoEditorDraft[]>([]);
  const [reviewSelfSharePercent, setReviewSelfSharePercent] = useState("");
  const [reviewEpisodeOptions, setReviewEpisodeOptions] = useState<Array<{ number: number; title: string }>>([]);
  const [reviewSelectedEpisodes, setReviewSelectedEpisodes] = useState<number[]>([]);
  const [reviewEpisodesLoading, setReviewEpisodesLoading] = useState(false);
  const [reviewEpisodesSaving, setReviewEpisodesSaving] = useState(false);
  const [reviewInlineFeedback, setReviewInlineFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [soloConflictTask, setSoloConflictTask] = useState<MemberWorkReviewTask | null>(null);
  const [resumeReviewAfterEdit, setResumeReviewAfterEdit] = useState(false);
  const [bulkSoloWorkIds, setBulkSoloWorkIds] = useState<string[]>([]);
  const [bulkSoloConfirmOpen, setBulkSoloConfirmOpen] = useState(false);
  const [collaborationSaving, setCollaborationSaving] = useState(false);
  const [collaborationFeedback, setCollaborationFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [contractChoices, setContractChoices] = useState<Contract[]>([]);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);

  // Dialoger og modaler
  const [isAdding, setIsAdding]             = useState(false);
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null);
  const [editScope, setEditScope] = useState<"work" | "season" | "episode">("work");
  const [editSeasonWorkIds, setEditSeasonWorkIds] = useState<string[]>([]);
  const [editEpisodeOptions, setEditEpisodeOptions] = useState<Array<{ number: number; title: string }>>([]);
  const [editEpisodeScope, setEditEpisodeScope] = useState<{ status: "pending" | "confirmed"; episode_numbers: number[]; covers_whole_season: boolean } | null>(null);
  const [editContextAssignments, setEditContextAssignments] = useState<OtherAssignment[]>([]);
  const [editReturnContext, setEditReturnContext] = useState<EditReturnContext>("list");
  const [initialAddQuery, setInitialAddQuery] = useState("");
  const [initialManualWork, setInitialManualWork] = useState<ManualWorkFormSeed | null>(null);
  const addParamHandledRef = React.useRef<string | null>(null);
  const requestParamHandledRef = React.useRef<string | null>(null);
  const episodeScopeParamHandledRef = React.useRef<string | null>(null);
  const shareTaskParamHandledRef = React.useRef<string | null>(null);

  const router   = useRouter();
  const searchParams = useSearchParams();
  const returnParam = searchParams?.get("returnTo") ?? searchParams?.get("from") ?? "";
  const inferredEditReturnContext: EditReturnContext = returnParam.toLowerCase().includes("kontrakt") ? "contract" : "list";

  React.useEffect(() => {
    if (!reviewDialogOpen) setAssignments(initialAssignments);
  }, [initialAssignments, reviewDialogOpen]);
  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      const setOrDelete = (key: string, value: string, fallback: string) => value === fallback ? params.delete(key) : params.set(key, value);
      setOrDelete("q", search.trim(), "");
      setOrDelete("type", catFilter, "all");
      setOrDelete("status", statusFilter, "all");
      setOrDelete("sort", sortKey, "date");
      setOrDelete("direction", sortDir, "desc");
      setOrDelete("pageSize", String(pageSize), "20");
      if (search !== initialQuery.search || catFilter !== initialQuery.workType || statusFilter !== initialQuery.status || sortKey !== initialQuery.sortKey || sortDir !== initialQuery.sortDir || pageSize !== pageResult.pageSize) params.delete("page");
      const next = params.toString();
      if (next !== (searchParams?.toString() ?? "")) router.replace(next ? `/portal/mine-vaerker?${next}` : "/portal/mine-vaerker", { scroll: false });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [catFilter, initialQuery, pageResult.pageSize, pageSize, router, search, searchParams, sortDir, sortKey, statusFilter]);

  const loadCollaborationReviews = React.useCallback(async () => {
    if (!rightsHolderId) return;
    const [reviewResult, taskResult] = await Promise.all([
      fetchMemberCollaborationReviews({ rightsHolderId }),
      fetchMemberWorkReviewTasks({ rightsHolderId }),
    ]);
    if (!reviewResult.success || !taskResult.success) {
      setMsg({ type: "error", text: (reviewResult.success ? taskResult.error : reviewResult.error) ?? "Gennemgangen kunne ikke indlæses." });
      return;
    }
    setCollaborationReviews(reviewResult.reviews as unknown as CollaborationReview[]);
    setReviewTasks(taskResult.tasks);
    setReviewTaskIndex(index => Math.min(index, Math.max(0, taskResult.tasks.length - 1)));
  }, [rightsHolderId]);

  const loadReviewTasksOnly = React.useCallback(async () => {
    if (!rightsHolderId) return false;
    const result = await fetchMemberWorkReviewTasks({ rightsHolderId });
    if (!result.success) {
      setReviewInlineFeedback({ type: "error", text: result.error ?? "Gennemgangen kunne ikke indlæses." });
      return false;
    }
    setReviewTasks(result.tasks);
    setReviewTaskIndex(0);
    setReviewRefreshDeferred(true);
    return true;
  }, [rightsHolderId]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => { void loadCollaborationReviews(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCollaborationReviews]);

  React.useEffect(() => {
    if (searchParams?.get("review") === "1" || searchParams?.get("collaborationReview") === "1") {
      setReviewCompletedCount(0);
      setReviewTaskIndex(0);
      setReviewDialogOpen(true);
      router.replace("/portal/mine-vaerker", { scroll: false });
    }
  }, [router, searchParams]);

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
      const missingEpisodes = isSeriesType(w.type) && w.episode_selection_status === "pending";
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
      if (sortKey === "role") { av = displayRole(a.role, defaultRoleLabel, coeditorWord); bv = displayRole(b.role, defaultRoleLabel, coeditorWord); }
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
  const collaborationReviewByWork = new Map(collaborationReviews.map(review => [review.work_id, review]));
  const disputedCollaborationReviews = collaborationReviews.filter(review => review.status === "disputed");

  const collaborationStatusBadge = (review?: CollaborationReview) => {
    if (!review) return null;
    const indicator = collaborationReviewIndicator(review.status);
    if (indicator === "confirm") return <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t("works.review.confirmCoeditor")}</Badge>;
    if (indicator === "dispute") return <Badge variant="outline" className="border-orange-400 bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200">{t("works.review.disputePending")}</Badge>;
    return null;
  };

  const flushDeferredReviewRefresh = React.useCallback(() => {
    setReviewRefreshDeferred(false);
    void loadCollaborationReviews();
    window.dispatchEvent(new CustomEvent("works-updated"));
  }, [loadCollaborationReviews]);

  const finishReviewTaskLocally = React.useCallback((taskKey: string) => {
    const hasRemainingTasks = reviewTasks.some(task => task.key !== taskKey);
    setReviewTasks(current => {
      const next = current.filter(task => task.key !== taskKey);
      setReviewTaskIndex(index => Math.min(index, Math.max(0, next.length - 1)));
      if (next.length === 0) {
        setReviewDialogOpen(false);
        setCollaborationFeedback({ type: "success", text: "Værksgennemgangen er færdig." });
      }
      return next;
    });
    setReviewCompletedCount(count => count + 1);
    setReviewCoEditorDrafts([]);
    setReviewSelfSharePercent("");
    setReviewInlineFeedback(null);
    if (hasRemainingTasks) setReviewRefreshDeferred(true);
    else flushDeferredReviewRefresh();
  }, [flushDeferredReviewRefresh, reviewTasks]);

  const confirmSelectedAsSolo = async (workIds: string[], options?: { fastReviewTaskKey?: string }) => {
    if (!rightsHolderId || !workIds.length) return;
    setCollaborationSaving(true);
    setCollaborationFeedback(null);
    try {
      const result = await confirmNoCoeditors({ rightsHolderId, workIds, source: workIds.length > 1 ? "member_bulk" : "member_editor" });
      if (!result.success) throw new Error(result.error);
      const feedback = {
        type: "success",
        text: result.disputed
          ? `${result.confirmed} værk${result.confirmed === 1 ? " er" : "er er"} registreret uden medklippere. ${result.disputed} kræver gennemgang hos DFKS, fordi andre klippere er registreret.`
          : `${result.confirmed} værk${result.confirmed === 1 ? " er" : "er er"} registreret uden medklippere.`,
      } as const;
      setCollaborationFeedback(feedback);
      setSelected([]);
      setBulkSoloWorkIds([]);
      setBulkSoloConfirmOpen(false);
      if (options?.fastReviewTaskKey) {
        finishReviewTaskLocally(options.fastReviewTaskKey);
      } else {
        const statusByWork = new Map(result.results.map(item => [item.workId, item.status]));
        setCollaborationReviews(current => current.map(review => {
          const status = statusByWork.get(review.work_id);
          return status ? { ...review, status } : review;
        }));
        setReviewCompletedCount(count => count + workIds.length);
        await loadCollaborationReviews();
        window.dispatchEvent(new CustomEvent("works-updated"));
      }
    } catch (error) {
      setCollaborationFeedback({ type: "error", text: error instanceof Error ? error.message : "Svarene kunne ikke gemmes." });
    } finally {
      setCollaborationSaving(false);
    }
  };
  const handleReviewSoloAction = (task: MemberWorkReviewTask) => {
    if (task.kind !== "coeditor_review") return;
    setReviewInlineFeedback(null);
    if (task.existingCoEditors.length > 0) {
      setSoloConflictTask(task);
      return;
    }
    void confirmSelectedAsSolo([task.workId], { fastReviewTaskKey: task.key });
  };

  const saveReviewCoEditors = async (task: MemberWorkReviewTask, options?: { closeAfterSave?: boolean }) => {
    if (task.kind !== "coeditor_review") return;
    if (!rightsHolderId) {
      setReviewInlineFeedback({ type: "error", text: "Din rettighedshaverprofil kunne ikke indlæses. Genindlæs siden og prøv igen." });
      return;
    }
    const filledDrafts = reviewCoEditorDrafts.filter(editor => editor.name.trim());
    const hasCoEditorContext = task.existingCoEditors.length > 0 || filledDrafts.length > 0;
    if (!hasCoEditorContext) {
      setReviewInlineFeedback({ type: "error", text: "Tilføj en medklipper eller vælg “Har klippet alene”." });
      return;
    }
    const ownShare = reviewSharePercentOrNull(reviewSelfSharePercent);
    if (ownShare === null) {
      setReviewInlineFeedback({ type: "error", text: "Angiv din egen vurderede arbejdsandel mellem 0 og 100 procent." });
      return;
    }
    setCollaborationSaving(true);
    setReviewInlineFeedback(null);
    try {
      const result = await updateMemberCoEditors({
        rightsHolderId,
        workId: task.workId,
        editScope: task.episodeNumber != null ? "episode" : "work",
        selfSharePercent: ownShare,
        changes: filledDrafts.map(editor => ({
          name: editor.name,
          rightsHolderId: editor.rightsHolderId,
          role: editor.role,
          action: "add",
        })),
      });
      if (!result.success) throw new Error(result.error ?? "Medklipperne kunne ikke gemmes.");
      setCollaborationFeedback({
        type: "success",
        text: result.requiresAdminReview
          ? `${result.requiresAdminReview} ukendt medklipper er sendt til kontrol hos DFKS. Din arbejdsandel er gemt.`
          : "Medklippere og din vurderede arbejdsandel er gemt.",
      });
      finishReviewTaskLocally(task.key);
      if (options?.closeAfterSave) {
        setReviewDialogOpen(false);
        void flushDeferredReviewRefresh();
      }
    } catch (error) {
      setReviewInlineFeedback({ type: "error", text: error instanceof Error ? error.message : "Medklipperne kunne ikke gemmes." });
    } finally {
      setCollaborationSaving(false);
    }
  };

  const removeExistingReviewCoEditor = async (
    task: Extract<MemberWorkReviewTask, { kind: "coeditor_review" }>,
    editor: MemberWorkReviewCoEditor,
  ) => {
    if (!rightsHolderId) return;
    setCollaborationSaving(true);
    setReviewInlineFeedback(null);
    try {
      const result = await updateMemberCoEditors({
        rightsHolderId,
        workId: task.workId,
        editScope: task.episodeNumber != null ? "episode" : "work",
        completeReview: false,
        changes: [{
          assignmentId: editor.assignmentId,
          rightsHolderId: editor.rightsHolderId,
          originalRightsHolderId: editor.rightsHolderId,
          role: editor.role ?? "Klipper",
          action: "remove",
        }],
      });
      if (!result.success) throw new Error(result.error ?? "Medklipperen kunne ikke fjernes.");
      setReviewTasks(current => current.map(item => item.key === task.key && item.kind === "coeditor_review"
        ? { ...item, existingCoEditors: item.existingCoEditors.filter(candidate => candidate.assignmentId !== editor.assignmentId) }
        : item));
      setReviewInlineFeedback({ type: "success", text: `${editor.name} er fjernet som medklipper.` });
      setReviewRefreshDeferred(true);
    } catch (error) {
      setReviewInlineFeedback({ type: "error", text: error instanceof Error ? error.message : "Medklipperen kunne ikke fjernes." });
    } finally {
      setCollaborationSaving(false);
    }
  };
  const visibleAssignments = filtered;
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

  const contractsForWork = (work: Work) => {
    const workIds = new Set([work.id, ...(work.child_work_ids ?? [])]);
    return contracts.filter(contract => contract.work_id && workIds.has(contract.work_id));
  };

  const openContractForWork = (work: Work) => {
    const matches = contractsForWork(work);
    if (matches.length === 0) {
      router.push(`/portal/mine-kontrakter?upload=true&workId=${work.id}&workTitle=${encodeURIComponent(work.title)}`);
      return;
    }
    if (matches.length === 1) {
      setEditingContractId(matches[0].id);
      return;
    }
    setContractChoices(matches);
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
              <div key={assignment.id} className={`${className} flex w-full items-start gap-2 border-t py-3 text-sm text-muted-foreground first:border-t-0 hover:bg-muted/70`}>
                <button type="button" onClick={() => openEdit(assignment)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                  <span className="inline-flex items-center rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-4 text-foreground">
                    {ep.season_number != null && ep.episode_number != null
                      ? `S${String(ep.season_number).padStart(2, "0")}E${String(ep.episode_number).padStart(2, "0")}`
                      : ep.episode_number != null
                        ? `E${String(ep.episode_number).padStart(2, "0")}`
                        : "-"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{ep.title}</span>
                    <span className="mt-1 block text-xs">Rolle: {displayRole(assignment.role, defaultRoleLabel, coeditorWord)}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">Medklippere: {coEditors.length ? coEditors.join(", ") : "–"} {collaborationStatusBadge(collaborationReviewByWork.get(ep.id))}</span>
                  </span>
                </button>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {(ep.overview_contract_count ?? 0) > 0 || contractedWorkIds.includes(ep.id) ? (
                    <button type="button" className="text-xs font-medium text-foreground" onClick={() => openContractForWork(ep)}>Kontrakt tilknyttet</button>
                  ) : (
                    <button type="button" className="text-xs font-medium text-amber-700 underline underline-offset-2" onClick={() => openContractForWork(ep)}>Mangler kontrakt</button>
                  )}
                  <button type="button" className="text-xs font-medium text-foreground" onClick={() => openEdit(assignment)}>Rediger</button>
                </span>
              </div>
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
    const overview = await fetchMemberWorkOverview({
      rightsHolderId,
      page: pageResult.page,
      pageSize,
      search,
      workType: catFilter,
      status: statusFilter,
      sortKey,
      sortDir,
    });
    if (overview.success) {
      setAssignments(memberOverviewItemsToAssignments(overview.items as unknown as MemberOverviewItem[]));
      setSeriesEpisodes({});
      setSeriesErrors({});
      setExpandedSeries(new Set());
      await loadCollaborationReviews();
    }
  };

  const openEdit = async (a: Assignment, returnContext: EditReturnContext = inferredEditReturnContext) => {
    setEditReturnContext(returnContext);
    setEditScope(a.works?.parent_work_id && a.works.episode_number != null ? "episode" : "work");
    setEditSeasonWorkIds([]);
    setEditEpisodeOptions([]);
    setEditEpisodeScope(null);
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

  React.useEffect(() => {
    const scopeId = searchParams?.get("episodeScope");
    if (!scopeId || episodeScopeParamHandledRef.current === scopeId) return;
    const assignment = assignments.find(item => item.works?.episode_scope_id === scopeId);
    if (!assignment?.works) return;
    episodeScopeParamHandledRef.current = scopeId;
    void openSeasonEdit(assignment.works);
    // openSeasonEdit intentionally uses the current assignment state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, searchParams]);

  const openSeasonEdit = async (work: Work, returnContext: EditReturnContext = inferredEditReturnContext) => {
    if (!rightsHolderId || !work.parent_work_id || work.season_number == null) return;
    setEditReturnContext(returnContext);
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
    setEditEpisodeScope((result.episodeScope ?? null) as { status: "pending" | "confirmed"; episode_numbers: number[]; covers_whole_season: boolean } | null);
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

  const beginSelectedSoloReview = () => {
    const selectedSet = new Set(selected);
    const selectedTasks = reviewTasks.filter(task => {
      if (task.kind === "coeditor_review") return selectedSet.has(task.assignmentId);
      const seasonAssignment = assignments.find(assignment =>
        assignment.works?.is_season_group
        && assignment.works.parent_work_id === task.seriesWorkId
        && assignment.works.season_number === task.seasonNumber
      );
      return seasonAssignment ? selectionIdsFor(seasonAssignment).some(id => selectedSet.has(id)) : false;
    });
    if (!selectedTasks.length) {
      setMsg({ type: "error", text: t("works.review.noOpenSelected") });
      return;
    }
    const episodeTask = selectedTasks.find(task => task.kind === "episode_selection");
    if (episodeTask) {
      setReviewTasks(current => [episodeTask, ...current.filter(task => task.key !== episodeTask.key)]);
      setReviewCompletedCount(0);
      setReviewTaskIndex(0);
      setReviewDialogOpen(true);
      return;
    }
    const workIds = selectedTasks.flatMap(task => task.kind === "coeditor_review" ? [task.workId] : []);
    setBulkSoloWorkIds([...new Set(workIds)]);
    setBulkSoloConfirmOpen(true);
  };

  React.useEffect(() => {
    const caseId = searchParams?.get("shareTask");
    if (!caseId || !rightsHolderId || shareTaskParamHandledRef.current === caseId) return;
    shareTaskParamHandledRef.current = caseId;
    void fetchMemberShareTaskTarget({ rightsHolderId, caseId }).then(result => {
      if (!result.success) {
        setMsg({ type: "error", text: result.error });
        return;
      }
      const target = result.target;
      const assignment = assignments.find(item => item.works?.id === target.work_id || item.works?.parent_work_id === target.work_id);
      if (!assignment?.works) {
        setMsg({ type: "error", text: "Værket til procentopgaven kunne ikke findes under Mine værker." });
        return;
      }
      if (target.season_number && (assignment.works.parent_work_id || assignment.works.id === target.work_id)) void openSeasonEdit({ ...assignment.works, parent_work_id: target.work_id, season_number: target.season_number });
      else void openEdit(assignment);
    });
    // Deep-link handling intentionally uses the current assignment state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, rightsHolderId, searchParams]);

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
    setEditEpisodeScope(null);
  };

  const closeEditFromCancel = () => {
    const returnContext = editReturnContext;
    closeEdit();
    setResumeReviewAfterEdit(false);
    setEditReturnContext("list");
    if (returnContext === "review") {
      setReviewDialogOpen(true);
    } else if (returnContext === "contract" && !editingContractId) {
      router.push("/portal/kontraktgennemgang");
    }
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

  const currentReviewTask = reviewTasks[reviewTaskIndex] ?? reviewTasks[0] ?? null;
  const currentReviewTaskKey = currentReviewTask?.key;
  const currentReviewTaskKind = currentReviewTask?.kind;
  const currentReviewOwnSharePercent = currentReviewTaskKind === "coeditor_review" ? currentReviewTask.ownSharePercent : null;
  const reviewTotal = reviewCompletedCount + reviewTasks.length;
  const reviewCurrent = reviewTotal > 0 ? Math.min(reviewCompletedCount + reviewTaskIndex + 1, reviewTotal) : 0;
  const moveReviewTask = (direction: -1 | 1) => {
    setReviewTaskIndex(index => {
      const total = reviewTasks.length;
      if (total <= 1) return index;
      return (index + direction + total) % total;
    });
  };
  const handleReviewDialogOpenChange = (open: boolean) => {
    if (open) {
      setReviewDialogOpen(true);
      return;
    }
    if (currentReviewTask?.kind === "coeditor_review") {
      const enteredShare = reviewSharePercentOrNull(reviewSelfSharePercent);
      const shareChanged = reviewSelfSharePercent.trim() !== "" && (enteredShare === null || enteredShare !== currentReviewOwnSharePercent);
      const hasDraftInput = reviewCoEditorDrafts.some(editor => editor.name.trim() || editor.rightsHolderId) || shareChanged;
      if (hasDraftInput) {
        void saveReviewCoEditors(currentReviewTask, { closeAfterSave: true });
        return;
      }
    }
    setReviewDialogOpen(false);
    if (reviewRefreshDeferred) flushDeferredReviewRefresh();
  };

  React.useEffect(() => {
    if (currentReviewTaskKind === "coeditor_review") {
      setReviewCoEditorDrafts([]);
      setReviewSelfSharePercent(currentReviewOwnSharePercent != null ? String(currentReviewOwnSharePercent).replace(".", ",") : "");
    } else {
      setReviewCoEditorDrafts([]);
      setReviewSelfSharePercent("");
    }
    setReviewInlineFeedback(null);
    setSoloConflictTask(null);
  }, [currentReviewTaskKey, currentReviewTaskKind, currentReviewOwnSharePercent]);

  React.useEffect(() => {
    if (currentReviewTask?.kind !== "episode_selection" || !rightsHolderId) {
      setReviewEpisodeOptions([]);
      setReviewSelectedEpisodes([]);
      return;
    }
    let active = true;
    setReviewEpisodesLoading(true);
    setReviewInlineFeedback(null);
    setReviewSelectedEpisodes(currentReviewTask.selectedEpisodeNumbers ?? []);
    void fetchMemberSeriesEpisodeOptions({
      rightsHolderId,
      workId: currentReviewTask.seriesWorkId,
      seasonNumber: currentReviewTask.seasonNumber,
    }).then(result => {
      if (!active) return;
      if (!result.success) throw new Error(result.error ?? "Afsnittene kunne ikke hentes.");
      setReviewEpisodeOptions(result.options ?? []);
      if (currentReviewTask.coversWholeSeason) setReviewSelectedEpisodes((result.options ?? []).map(option => option.number));
    }).catch(error => {
      if (active) setReviewInlineFeedback({ type: "error", text: error instanceof Error ? error.message : "Afsnittene kunne ikke hentes." });
    }).finally(() => {
      if (active) setReviewEpisodesLoading(false);
    });
    return () => { active = false; };
  }, [currentReviewTask, rightsHolderId]);

  const saveReviewEpisodes = async (
    task: Extract<MemberWorkReviewTask, { kind: "episode_selection" }>,
    action: "queue" | "solo" = "queue",
  ) => {
    if (!rightsHolderId || reviewSelectedEpisodes.length === 0) {
      setReviewInlineFeedback({ type: "error", text: "Vælg mindst ét afsnit." });
      return;
    }
    const commonCoEditors = reviewCoEditorDrafts.filter(editor => editor.name.trim());
    const ownShare = commonCoEditors.length > 0 ? reviewSharePercentOrNull(reviewSelfSharePercent) : null;
    if (commonCoEditors.length > 0 && ownShare === null) {
      setReviewInlineFeedback({ type: "error", text: "Angiv din egen vurderede arbejdsandel mellem 0 og 100 procent." });
      return;
    }
    setReviewEpisodesSaving(true);
    setReviewInlineFeedback(null);
    try {
      const seasonAssignment = assignments.find(assignment =>
        assignment.works?.is_season_group
        && assignment.works.parent_work_id === task.seriesWorkId
        && assignment.works.season_number === task.seasonNumber
      );
      const allSelected = reviewEpisodeOptions.length > 0 && reviewSelectedEpisodes.length === reviewEpisodeOptions.length;
      const result = await syncMemberEpisodeAssignments({
        rightsHolderId,
        workId: task.seriesWorkId,
        role: seasonAssignment?.role ?? defaultRoleLabel,
        selectedEpisodes: reviewSelectedEpisodes,
        seasonNumber: task.seasonNumber,
        coversWholeSeason: allSelected,
      });
      if (!result.success) throw new Error(result.error ?? "Afsnitsvalget kunne ikke gemmes.");
      let requiresAdminReview = 0;
      let soloConfirmed = 0;
      let soloDisputed = 0;
      if (action === "solo") {
        const selectedWorkIds = result.selectedWorkIds ?? [];
        if (!selectedWorkIds.length) throw new Error("De valgte afsnit kunne ikke findes.");
        const soloResult = await confirmNoCoeditors({
          rightsHolderId,
          workIds: selectedWorkIds,
          source: "member_bulk",
        });
        if (!soloResult.success) throw new Error(soloResult.error ?? "Afsnittene kunne ikke registreres som klippet alene.");
        soloConfirmed = soloResult.confirmed;
        soloDisputed = soloResult.disputed;
      } else if (commonCoEditors.length > 0) {
        const coEditorResult = await updateMemberCoEditors({
          rightsHolderId,
          workId: task.seriesWorkId,
          editScope: "season",
          seasonNumber: task.seasonNumber,
          episodeNumbers: reviewSelectedEpisodes,
          selfSharePercent: ownShare,
          changes: commonCoEditors.map(editor => ({
            name: editor.name,
            rightsHolderId: editor.rightsHolderId,
            role: editor.role,
            action: "add",
          })),
        });
        if (!coEditorResult.success) throw new Error(coEditorResult.error ?? "Medklipperne kunne ikke gemmes på afsnittene.");
        requiresAdminReview = coEditorResult.requiresAdminReview ?? 0;
      }
      await loadReviewTasksOnly();
      setReviewCompletedCount(0);
      setReviewDialogOpen(true);
      setCollaborationFeedback({
        type: "success",
        text: action === "solo"
          ? `${soloConfirmed} afsnit er registreret som klippet alene.${soloDisputed ? ` ${soloDisputed} afsnit kræver gennemgang hos DFKS, fordi andre klippere allerede er registreret.` : ""}`
          : commonCoEditors.length > 0
          ? `${reviewSelectedEpisodes.length} afsnit er gemt med de samme medklippere.${requiresAdminReview ? ` ${requiresAdminReview} ukendt navn er sendt til kontrol hos DFKS.` : ""}`
          : `${reviewSelectedEpisodes.length} afsnit er gemt og lagt i Gennemgå værk-køen.`,
      });
    } catch (error) {
      setReviewInlineFeedback({ type: "error", text: error instanceof Error ? error.message : "Afsnitsvalget kunne ikke gemmes." });
    } finally {
      setReviewEpisodesSaving(false);
    }
  };

  const openReviewSeasonSelector = async (task: Extract<MemberWorkReviewTask, { kind: "coeditor_review" }>) => {
    if (!rightsHolderId || !task.parentWorkId || task.seasonNumber == null) return;
    setReviewEpisodesLoading(true);
    setReviewInlineFeedback(null);
    try {
      const result = await fetchMemberSeasonEditContext({
        rightsHolderId,
        parentWorkId: task.parentWorkId,
        seasonNumber: task.seasonNumber,
      });
      if (!result.success) throw new Error(result.error ?? "Sæsonens afsnit kunne ikke hentes.");
      const options = result.options ?? [];
      const scope = result.episodeScope;
      const assignedEpisodeNumbers = (result.assignments as Array<{ works?: { episode_number?: number | null } | null }>)
        .map(assignment => assignment.works?.episode_number)
        .filter((number): number is number => number != null);
      const selectedEpisodeNumbers = scope?.covers_whole_season
        ? options.map(option => option.number)
        : scope?.episode_numbers?.length
          ? scope.episode_numbers
          : assignedEpisodeNumbers;
      const selectionTask: Extract<MemberWorkReviewTask, { kind: "episode_selection" }> = {
        key: `edit-episode-scope:${task.parentWorkId}:${task.seasonNumber}`,
        groupKey: task.groupKey,
        kind: "episode_selection",
        title: result.parentWork.title?.trim() || task.title,
        seriesWorkId: task.parentWorkId,
        seasonNumber: task.seasonNumber,
        episodeScopeId: scope?.id ?? `existing:${task.parentWorkId}:${task.seasonNumber}`,
        selectedEpisodeNumbers,
        coversWholeSeason: Boolean(scope?.covers_whole_season),
      };
      setReviewTasks(current => [selectionTask, ...current.filter(item => item.groupKey !== task.groupKey)]);
      setReviewTaskIndex(0);
    } catch (error) {
      setReviewInlineFeedback({ type: "error", text: error instanceof Error ? error.message : "Sæsonens afsnit kunne ikke hentes." });
    } finally {
      setReviewEpisodesLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <ListReadinessMarker route="member-works" stage="primary" />
      {assignments.length > 0 && <ListReadinessMarker route="member-works" stage="first-row" />}
      <ListReadinessMarker route="member-works" stage="secondary" />
      <ListReadinessMarker route="member-works" stage="complete" />

      {/* Header */}
      <PortalPageHeader
        title={t("works.title")}
        subtitle={t("works.registeredSubtitle")}
        actions={<Button onClick={() => setIsAdding(true)} className="w-full gap-2 sm:w-auto">
            <Plus className="h-4 w-4" /> {t("works.addWork")}
          </Button>}
      />

      {/* Statistik */}
      <SummaryGrid>
        <SummaryCard label={t("works.totalWorks")} value={totalWorks} />
        <SummaryCard label={t("works.withContract")} value={withContract} />
        <SummaryCard label={t("works.missingContract")} value={missingContract} />
      </SummaryGrid>

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

      {(reviewTasks.length > 0 || disputedCollaborationReviews.length > 0) && (
        <section className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 text-blue-950 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Users className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 className="font-semibold">{t("works.review.title")}</h2>
                <p className="mt-1 text-sm leading-relaxed">{t("works.review.description")}</p>
                <p className="mt-1 text-xs opacity-80">{reviewTasks.length} {t("works.review.remaining")}{disputedCollaborationReviews.length ? ` · ${disputedCollaborationReviews.length} ${t("works.review.awaitingDfks")}` : ""}</p>
              </div>
            </div>
            <Button type="button" disabled={!reviewTasks.length} onClick={() => { setReviewCompletedCount(0); setReviewTaskIndex(0); setReviewDialogOpen(true); }}>
              {t("works.review.start")}
            </Button>
          </div>
        </section>
      )}

      {collaborationFeedback && (
        <div className={`rounded-md px-3 py-2 text-sm ${collaborationFeedback.type === "success" ? "bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-200" : "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200"}`}>
          {collaborationFeedback.text}
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
                <Button size="sm" variant="outline" onClick={beginSelectedSoloReview} className="h-8 w-full text-xs sm:w-auto">
                  {t("works.review.soloAction")}
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
		              {[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
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

          <ListResultSummary filteredCount={pageResult.filteredCount} totalCount={pageResult.totalCount} selectedCount={selected.length} className="lg:col-span-full" />
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
          const needsEpisodeSelection = w.episode_selection_status === "pending";
          const isExpanded = expandedSeries.has(w.id);
          const children = seriesEpisodes[w.id] ?? [];
          const isLoadingChildren = loadingSeries.has(w.id);
          const directCollaborationReview = isSeriesParent ? undefined : collaborationReviewByWork.get(w.id);
          const seasonCollaborationReviews = isSeriesParent
            ? collaborationReviews.filter(review => review.works?.parent_work_id === w.parent_work_id && review.works?.season_number === w.season_number)
            : [];
          const seasonPendingReviews = seasonCollaborationReviews.filter(review => review.status === "pending").length;
          const seasonDisputedReviews = seasonCollaborationReviews.filter(review => review.status === "disputed").length;
          return (
            <React.Fragment key={a.id}>
            <div
              className="hidden items-center px-5 py-3 border-b hover:bg-muted/50 transition-colors lg:grid"
              style={{ gridTemplateColumns: "36px 2.5fr 0.5fr 1fr 0.7fr 0.7fr 1.5fr 0.5fr" }}
            >
              <input
                type="checkbox"
                checked={selectionIdsFor(a).length > 0 && selectionIdsFor(a).every(id => selected.includes(id))}
                onChange={() => toggleAssignmentSelection(a)}
                className="h-4 w-4 cursor-pointer"
                aria-label={`Vælg ${w.title}`}
              />

              {/* Poster + titel */}
              <div className="flex items-center gap-3">
                {isSeriesParent ? (
                  <span onClick={event => event.stopPropagation()}><ExpandableListTrigger expanded={isExpanded} onToggle={() => void toggleSeries(w)} label={isExpanded ? "Skjul afsnit" : "Vis afsnit"} /></span>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <button type="button" onClick={() => { if (isSeriesParent) void openSeasonEdit(w); else void openEdit(a); }} className="flex w-8 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={isSeriesParent ? `Rediger ${w.title} sæson ${w.season_number}` : `Rediger ${w.title}`}>
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
                    <button type="button" onClick={() => { if (isSeriesParent) void openSeasonEdit(w); else void openEdit(a); }} className="rounded text-left text-sm font-semibold leading-snug text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{w.title}{w.season_number != null ? ` - S${String(w.season_number).padStart(2, "0")}` : ""}</button>
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
              <div className="text-sm text-muted-foreground">{displayRole(a.role, defaultRoleLabel, coeditorWord)}</div>
              <div className="text-sm text-muted-foreground">
                {needsEpisodeSelection ? (
                  <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t("works.review.confirmEpisodes")}</Badge>
                ) : isSeriesParent ? (
                  <span className="inline-flex items-center rounded bg-muted border px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-foreground">
                    {w.season_number != null ? `S${String(w.season_number).padStart(2, "0")} ` : ""}({w.episode_count ?? 0} afsnit)
                  </span>
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
              <div className="flex min-w-0 flex-col items-start gap-1 text-xs text-muted-foreground" title={(coEditorMap[w.id] ?? []).join(", ")}>
                <span className="truncate">{(coEditorMap[w.id] ?? []).length > 0 ? coEditorMap[w.id].join(", ") : "–"}</span>
                {!isSeriesParent && collaborationStatusBadge(directCollaborationReview)}
                {isSeriesParent && !needsEpisodeSelection && seasonPendingReviews > 0 && <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t("works.review.confirmCoeditor")}</Badge>}
                {isSeriesParent && seasonDisputedReviews > 0 && <Badge variant="outline" className="border-orange-400 bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200">{t("works.review.disputePending")}</Badge>}
              </div>

              {/* Kontrakt-badge */}
              <button
                type="button"
                className="flex justify-end rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={e => { e.stopPropagation(); openContractForWork(w); }}
                aria-label={hasAllContracts ? `Åbn kontrakt for ${w.title}` : `Upload kontrakt til ${w.title}`}
              >
                {hasAllContracts ? (
                  <span className={`${TAG_CLASS} cursor-pointer`} style={{ backgroundColor: "#dcfce7", color: "#166534" }}>{t("works.contractOk")}</span>
                ) : isSeriesParent && hasContract ? (
                  <Badge variant="outline" className={`${TAG_CLASS} cursor-pointer border-blue-300 text-blue-700`}>Delvis</Badge>
                ) : (
                  <Badge variant="outline" className={`${TAG_CLASS} cursor-pointer border-amber-300 text-amber-600`}>{t("works.contractMissing")}</Badge>
                )}
              </button>
            </div>
            <div
              key={`${a.id}-mobile`}
              className="border-b px-4 py-4 transition-colors active:bg-muted/50 lg:hidden"
            >
              <div className="flex gap-3">
                <input type="checkbox" checked={selectionIdsFor(a).length > 0 && selectionIdsFor(a).every(id => selected.includes(id))} onChange={() => toggleAssignmentSelection(a)} className="mt-1 h-4 w-4 cursor-pointer" aria-label={`Vælg ${w.title}`} />
                <button type="button" onClick={() => { if (isSeriesParent) void openSeasonEdit(w); else void openEdit(a); }} className="flex w-10 shrink-0 items-start justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={isSeriesParent ? `Rediger ${w.title} sæson ${w.season_number}` : `Rediger ${w.title}`}>
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
                          <span onClick={event => event.stopPropagation()}><ExpandableListTrigger expanded={isExpanded} onToggle={() => void toggleSeries(w)} label={isExpanded ? "Skjul afsnit" : "Vis afsnit"} /></span>
                        )}
                        <button type="button" onClick={() => { if (isSeriesParent) void openSeasonEdit(w); else void openEdit(a); }} className="rounded text-left text-sm font-semibold leading-snug text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{w.title}{isSeriesParent && w.season_number != null ? ` · Sæson ${w.season_number}` : ""}</button>
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
                    <button
                      type="button"
                      className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={e => { e.stopPropagation(); openContractForWork(w); }}
                      aria-label={hasAllContracts ? `Åbn kontrakt for ${w.title}` : `Upload kontrakt til ${w.title}`}
                    >
                      {hasAllContracts ? (
                        <span className={`${TAG_CLASS} cursor-pointer`} style={{ backgroundColor: "#dcfce7", color: "#166534" }}>{t("works.contractOk")}</span>
                      ) : isSeriesParent && hasContract ? (
                        <Badge variant="outline" className={`${TAG_CLASS} cursor-pointer border-blue-300 text-blue-700`}>Delvis</Badge>
                      ) : (
                        <Badge variant="outline" className={`${TAG_CLASS} cursor-pointer border-amber-300 text-amber-600`}>{t("works.contractMissing")}</Badge>
                      )}
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="font-medium text-muted-foreground">Rolle</p>
                      <p className="mt-0.5 text-foreground">{displayRole(a.role, defaultRoleLabel, coeditorWord)}</p>
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">{t("works.episodes")}</p>
                      <p className="mt-0.5 text-foreground">
                        {needsEpisodeSelection ? (
                          <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t("works.review.confirmEpisodes")}</Badge>
                        ) : isSeriesParent ? (
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
                    <div className="mt-1 flex flex-wrap gap-1">
                      {!isSeriesParent && collaborationStatusBadge(directCollaborationReview)}
                      {isSeriesParent && !needsEpisodeSelection && seasonPendingReviews > 0 && <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t("works.review.confirmCoeditor")}</Badge>}
                      {isSeriesParent && seasonDisputedReviews > 0 && <Badge variant="outline" className="border-orange-400 bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200">{t("works.review.disputePending")}</Badge>}
                    </div>
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
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
          <span>Side {pageResult.page} af {Math.max(1, Math.ceil(pageResult.filteredCount / pageResult.pageSize))}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={pageResult.page <= 1} onClick={() => {
              const params = new URLSearchParams(searchParams?.toString() ?? "");
              params.set("page", String(Math.max(1, pageResult.page - 1)));
              router.replace(`/portal/mine-vaerker?${params.toString()}`, { scroll: false });
            }}>Forrige</Button>
            <Button type="button" variant="outline" size="sm" disabled={!pageResult.hasNextPage} onClick={() => {
              const params = new URLSearchParams(searchParams?.toString() ?? "");
              params.set("page", String(pageResult.page + 1));
              router.replace(`/portal/mine-vaerker?${params.toString()}`, { scroll: false });
            }}>Næste</Button>
          </div>
        </div>
      </div>

      <Dialog open={reviewDialogOpen && Boolean(currentReviewTask)} onOpenChange={handleReviewDialogOpenChange}>
        <DialogContent className="w-[min(560px,calc(100vw-2rem))] max-sm:top-4 max-sm:max-h-[calc(100dvh-2rem)] max-sm:translate-y-0 max-sm:overflow-y-auto">
          {currentReviewTask && (
            <>
              <DialogHeader className="pr-14">
                <div className="flex items-center justify-between gap-3">
                  <DialogTitle>{t("works.review.dialogTitle")}</DialogTitle>
                  <div className="flex shrink-0 items-center gap-1 rounded-md border bg-background px-1 py-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={reviewTasks.length <= 1}
                      onClick={() => moveReviewTask(-1)}
                      aria-label="Forrige værk"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-10 text-center text-xs text-muted-foreground">
                      {reviewCurrent} / {reviewTotal}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={reviewTasks.length <= 1}
                      onClick={() => moveReviewTask(1)}
                      aria-label="Næste værk"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <DialogDescription className="sr-only">Gennemgå dine serieafsnit og medklippere for det valgte værk.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="font-semibold">{currentReviewTask.title}</p>
                  {currentReviewTask.seasonNumber != null && currentReviewTask.kind === "coeditor_review" && currentReviewTask.parentWorkId ? (
                    <button
                      type="button"
                      className="mt-1 rounded text-left text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => void openReviewSeasonSelector(currentReviewTask)}
                    >
                      {t("works.season")} {currentReviewTask.seasonNumber}
                      {currentReviewTask.episodeNumber != null
                        ? ` · ${t("works.episode")} ${currentReviewTask.episodeNumber}`
                        : ""}
                      <span className="ml-2 font-medium text-foreground">· Vælg afsnit, du har klippet</span>
                    </button>
                  ) : currentReviewTask.seasonNumber != null ? (
                    <p className="mt-1 text-sm text-muted-foreground">{t("works.season")} {currentReviewTask.seasonNumber}</p>
                  ) : null}
                  {currentReviewTask.kind === "coeditor_review" && currentReviewTask.existingCoEditors.length > 0 && (
                    <div className="mt-3 space-y-2 border-t pt-3">
                      <p className="text-xs font-medium text-muted-foreground">Registrerede medklippere</p>
                      <div className="space-y-1.5">
                        {currentReviewTask.existingCoEditors.map(editor => (
                          <div key={editor.assignmentId} className="relative flex flex-wrap items-center justify-between gap-2 rounded-md bg-background px-3 py-2 pr-11 text-sm">
                            <span className="font-medium">{editor.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {displayRole(editor.role, defaultRoleLabel, coeditorWord)}
                              {editor.sharePercent != null ? ` · ${editor.sharePercent}%` : ""}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2"
                              disabled={collaborationSaving}
                              onClick={() => void removeExistingReviewCoEditor(currentReviewTask, editor)}
                              aria-label={`Fjern ${editor.name}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {currentReviewTask.kind === "episode_selection" ? (
                  <div className="space-y-4">
                    <p className="text-sm">{t("works.review.chooseEpisodesFirst")}</p>
                    {reviewEpisodesLoading ? (
                      <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">Henter sæsonens afsnit…</p>
                    ) : reviewEpisodeOptions.length > 0 ? (
                      <>
                        <div className="flex h-11 w-full items-center justify-between rounded-md border bg-background px-3 text-sm font-medium">
                          <span>{reviewSelectedEpisodes.length} af {reviewEpisodeOptions.length} afsnit valgt</span>
                        </div>
                        <div className="space-y-2 rounded-lg border bg-muted/20 p-2">
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="h-11 w-full"
                                onClick={() => setReviewSelectedEpisodes(reviewEpisodeOptions.map(option => option.number))}
                              >
                                Vælg alle
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-11 w-full"
                                onClick={() => setReviewSelectedEpisodes([])}
                              >
                                Fravælg alle
                              </Button>
                            </div>
                            <div className="grid max-h-[38dvh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                              {reviewEpisodeOptions.map(option => {
                                const checked = reviewSelectedEpisodes.includes(option.number);
                                return (
                                  <label key={option.number} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => setReviewSelectedEpisodes(current => checked
                                        ? current.filter(number => number !== option.number)
                                        : [...current, option.number].sort((left, right) => left - right))}
                                      className="h-4 w-4 shrink-0"
                                    />
                                    <span className="min-w-0"><strong>Afsnit {option.number}</strong>{option.title ? ` · ${option.title}` : ""}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="space-y-3 border-t pt-3">
                              <div>
                                <p className="text-sm font-medium">Medklippere på alle valgte afsnit</p>
                                <p className="mt-1 text-xs text-muted-foreground">Valgfrit. De medklippere, du tilføjer her, knyttes samlet til alle markerede afsnit.</p>
                              </div>
                              {reviewCoEditorDrafts.map(editor => (
                                <div key={editor.id} className="relative space-y-2 rounded-lg border bg-background p-3 pr-12">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-2 top-2 h-8 w-8"
                                    onClick={() => setReviewCoEditorDrafts(current => current.filter(item => item.id !== editor.id))}
                                    aria-label="Fjern fælles medklipper"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                  <Label>Medklipper</Label>
                                  <LocalRightsHolderAutocomplete
                                    value={editor.name}
                                    placeholder={t("works.namePlaceholder")}
                                    excludedIds={[
                                      rightsHolderId,
                                      ...reviewCoEditorDrafts.map(item => item.id === editor.id ? null : item.rightsHolderId),
                                    ]}
                                    onValueChange={value => setReviewCoEditorDrafts(current =>
                                      current.map(item => item.id === editor.id ? { ...item, name: value, rightsHolderId: null } : item)
                                    )}
                                    onSelect={holder => setReviewCoEditorDrafts(current =>
                                      current.map(item => item.id === editor.id ? { ...item, name: holder.full_name, rightsHolderId: holder.id } : item)
                                    )}
                                  />
                                  <select
                                    value={editor.role}
                                    onChange={event => setReviewCoEditorDrafts(current =>
                                      current.map(item => item.id === editor.id ? { ...item, role: event.target.value } : item)
                                    )}
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    aria-label="Den fælles medklippers rolle"
                                  >
                                    {REVIEW_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                                  </select>
                                  {!editor.rightsHolderId && editor.name.trim() && (
                                    <p className="text-xs text-muted-foreground">Navnet er ikke valgt fra databasen og sendes derfor til kontrol hos DFKS.</p>
                                  )}
                                </div>
                              ))}
                              {reviewCoEditorDrafts.length > 0 && (
                                <div className="space-y-1.5">
                                  <Label htmlFor="review-series-self-share">Din egen vurderede arbejdsandel på de valgte afsnit (%)</Label>
                                  <Input
                                    id="review-series-self-share"
                                    inputMode="decimal"
                                    value={reviewSelfSharePercent}
                                    onChange={event => setReviewSelfSharePercent(event.target.value)}
                                    placeholder="Fx 40"
                                  />
                                </div>
                              )}
                            </div>
                        </div>
                      </>
                    ) : (
                      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Der blev ikke fundet afsnit for sæsonen.</p>
                    )}
                    {reviewInlineFeedback && (
                      <div className={`rounded-md border px-3 py-2 text-sm ${reviewInlineFeedback.type === "error" ? "border-red-200 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200" : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200"}`}>
                        {reviewInlineFeedback.text}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm">{t("works.review.confirmQuestion")}</p>
                    {reviewCoEditorDrafts.length > 0 && (
                      <div className="space-y-2">
                        {reviewCoEditorDrafts.map(editor => (
                          <div key={editor.id} className="relative space-y-2 rounded-lg border bg-muted/20 p-3 pr-12">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-2 top-2 h-8 w-8"
                              onClick={() => setReviewCoEditorDrafts(current => current.filter(item => item.id !== editor.id))}
                              aria-label="Fjern medklipper"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                            <Label>Medklipper</Label>
                            <LocalRightsHolderAutocomplete
                              value={editor.name}
                              placeholder={t("works.namePlaceholder")}
                              excludedIds={[
                                rightsHolderId,
                                ...currentReviewTask.existingCoEditors.map(item => item.rightsHolderId),
                                ...reviewCoEditorDrafts.map(item => item.id === editor.id ? null : item.rightsHolderId),
                              ]}
                              onValueChange={value => {
                                setReviewCoEditorDrafts(current =>
                                  current.map(item => item.id === editor.id ? { ...item, name: value, rightsHolderId: null } : item)
                                );
                              }}
                              onSelect={holder => {
                                setReviewCoEditorDrafts(current =>
                                  current.map(item => item.id === editor.id ? { ...item, name: holder.full_name, rightsHolderId: holder.id } : item)
                                );
                              }}
                            />
                            <select
                              value={editor.role}
                              onChange={event => {
                                setReviewCoEditorDrafts(current =>
                                  current.map(item => item.id === editor.id ? { ...item, role: event.target.value } : item)
                                );
                              }}
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              aria-label="Medklipperens rolle"
                            >
                              {REVIEW_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                            </select>
                            {!editor.rightsHolderId && editor.name.trim() && (
                              <p className="text-xs text-muted-foreground">Navnet er ikke valgt fra databasen og sendes derfor til kontrol hos DFKS.</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {(currentReviewTask.existingCoEditors.length > 0 || reviewCoEditorDrafts.some(editor => editor.name.trim())) && (
                      <div className="space-y-1.5">
                        <Label htmlFor="review-self-share">Din egen vurderede arbejdsandel (%)</Label>
                        <Input
                          id="review-self-share"
                          inputMode="decimal"
                          value={reviewSelfSharePercent}
                          onChange={event => setReviewSelfSharePercent(event.target.value)}
                          placeholder="Fx 40"
                        />
                        <p className="text-xs text-muted-foreground">Skriv kun din egen andel. Procenten bliver først offentlig, når DFKS har afsluttet sagen.</p>
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full"
                      onClick={() => setReviewCoEditorDrafts(current => [...current, emptyReviewCoEditor()])}
                    >
                      {currentReviewTask.existingCoEditors.length > 0 ? "Tilføj yderligere medklippere" : t("works.review.addCoeditor")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full"
                      disabled={reviewCoEditorDrafts.some(editor => editor.name === "Ukendt medklipper")}
                      onClick={() => setReviewCoEditorDrafts(current => [...current, unknownReviewCoEditor()])}
                    >
                      Ukendt medklipper
                    </Button>
                    {reviewInlineFeedback && (
                      <div className={`rounded-md border px-3 py-2 text-sm ${reviewInlineFeedback.type === "error" ? "border-red-200 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200" : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200"}`}>
                        {reviewInlineFeedback.text}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <div className="flex w-full flex-col gap-2">
                  {currentReviewTask.kind === "episode_selection" ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-full"
                        disabled={reviewEpisodesLoading || reviewEpisodesSaving || reviewSelectedEpisodes.length === 0}
                        onClick={() => {
                          setReviewCoEditorDrafts(current => [...current, emptyReviewCoEditor()]);
                        }}
                      >
                        {reviewCoEditorDrafts.length > 0 ? "Tilføj yderligere medklippere" : "Tilføj medklipper"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-full"
                        disabled={reviewEpisodesLoading || reviewEpisodesSaving || reviewSelectedEpisodes.length === 0 || reviewCoEditorDrafts.some(editor => editor.name === "Ukendt medklipper")}
                        onClick={() => setReviewCoEditorDrafts(current => [...current, unknownReviewCoEditor()])}
                      >
                        Ukendt medklipper
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-full"
                        disabled={reviewEpisodesLoading || reviewEpisodesSaving || reviewSelectedEpisodes.length === 0 || reviewCoEditorDrafts.some(editor => editor.name.trim())}
                        onClick={() => void saveReviewEpisodes(currentReviewTask, "solo")}
                      >
                        Har klippet alene
                      </Button>
                      <Button
                        type="button"
                        className="h-11 w-full"
                        disabled={reviewEpisodesLoading || reviewEpisodesSaving || reviewSelectedEpisodes.length === 0}
                        onClick={() => void saveReviewEpisodes(currentReviewTask)}
                      >
                        {reviewEpisodesSaving ? "Gemmer…" : reviewCoEditorDrafts.some(editor => editor.name.trim()) ? "Gem afsnit og medklippere" : "Gem afsnitsvalg"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" variant="outline" className="h-11 w-full" disabled={collaborationSaving} onClick={() => handleReviewSoloAction(currentReviewTask)}>
                        {t("works.review.soloAction")}
                      </Button>
                      <Button type="button" className="h-11 w-full" disabled={collaborationSaving} onClick={() => void saveReviewCoEditors(currentReviewTask)}>Gem</Button>
                    </>
                  )}
                  <p className="pt-1 text-center text-xs text-muted-foreground">Du kan senere ændre dine valg under det enkelte værk.</p>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(soloConflictTask)} onOpenChange={open => { if (!open) setSoloConflictTask(null); }}>
        <DialogContent className="w-[min(480px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Send konflikt til DFKS?</DialogTitle>
            <DialogDescription>
              Der er allerede registreret en eller flere medklippere på værket. Hvis du bekræfter, at du har klippet alene, oprettes der en sag, som DFKS skal gennemgå.
            </DialogDescription>
          </DialogHeader>
          {soloConflictTask?.kind === "coeditor_review" && soloConflictTask.existingCoEditors.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">Registrerede medklippere</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {soloConflictTask.existingCoEditors.map(editor => (
                  <li key={editor.assignmentId}>{editor.name}</li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSoloConflictTask(null)}>Annuller</Button>
            <Button
              type="button"
              disabled={collaborationSaving || soloConflictTask?.kind !== "coeditor_review"}
              onClick={() => {
                const task = soloConflictTask;
                if (task?.kind !== "coeditor_review") return;
                setSoloConflictTask(null);
                void confirmSelectedAsSolo([task.workId], { fastReviewTaskKey: task.key });
              }}
            >
              Bekræft og send til DFKS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkSoloConfirmOpen} onOpenChange={setBulkSoloConfirmOpen}>
        <DialogContent className="w-[min(480px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{t("works.review.bulkSoloTitle")}</DialogTitle>
            <DialogDescription>{t("works.review.bulkSoloDescription").replace("{count}", String(bulkSoloWorkIds.length))}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkSoloConfirmOpen(false)}>{t("common.cancel")}</Button>
            <Button type="button" disabled={collaborationSaving} onClick={() => void confirmSelectedAsSolo(bulkSoloWorkIds)}>{t("works.review.confirmSolo")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contractChoices.length > 0} onOpenChange={open => { if (!open) setContractChoices([]); }}>
        <DialogContent className="w-[min(480px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Vælg kontrakt</DialogTitle>
            <DialogDescription>Der er flere kontrakter tilknyttet værket. Vælg den, du vil redigere.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {contractChoices.map(contract => (
              <button
                type="button"
                key={contract.id}
                className="w-full rounded-lg border px-3 py-3 text-left hover:bg-muted"
                onClick={() => { setContractChoices([]); setEditingContractId(contract.id); }}
              >
                <span className="block font-medium">{contract.working_title || contract.works?.title || "Kontrakt"}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {contract.season_number ? `Sæson ${contract.season_number}` : ""}
                  {contract.episode_numbers?.length ? `${contract.season_number ? " · " : ""}Afsnit ${contract.episode_numbers.join(", ")}` : ""}
                  {(contract.season_number || contract.episode_numbers?.length) ? " · " : ""}{contract.status}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {editingContractId && rightsHolderId && (
        <MineKontrakterClient
          initialContracts={contracts}
          rightsHolderId={rightsHolderId}
          myWorks={assignments.flatMap(assignment => assignment.works ? [{ id: assignment.works.id, title: assignment.works.title, year: assignment.works.year, type: assignment.works.type }] : [])}
          initialOpenContractId={editingContractId}
          editorOnly
          onEditorClose={() => setEditingContractId(null)}
        />
      )}

      {/* ── Tilføj-panel ──────────────────────────────────────────── */}
      {isAdding && (
        <AddWorkModal
          isOpen
          onClose={() => { setIsAdding(false); setInitialManualWork(null); }}
          rightsHolderId={rightsHolderId}
          onWorkAdded={(message, success) => setMsg({ type: success ? "success" : "error", text: message })}
          reloadAssignments={reloadAssignments}
          locale={locale}
          initialQuery={initialAddQuery}
          initialManualWork={initialManualWork}
        />
      )}

      {/* ── Redigér-panel ──────────────────────────────────────────── */}
      {editAssignment && (
        <EditWorkModal
          isOpen={!!editAssignment}
          onClose={closeEditFromCancel}
          assignment={editAssignment}
          allAssignments={editScope === "season" ? editContextAssignments : allAssignments}
          editScope={editScope}
          seasonWorkIds={editSeasonWorkIds}
          initialEpisodeOptions={editEpisodeOptions}
          initialEpisodeScope={editEpisodeScope}
          organisationShortName={organisationShortName}
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
              void loadCollaborationReviews().then(() => {
                if (resumeReviewAfterEdit) {
                  setReviewCompletedCount(count => count + 1);
                  setResumeReviewAfterEdit(false);
                  setReviewDialogOpen(true);
                }
              });
              setEditReturnContext("list");
              closeEdit();
            }
          }}
          locale={locale}
        />
      )}

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
