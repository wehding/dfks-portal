"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Film,
  GitMerge,
  Loader2,
  Plus,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveAdminWorks,
  approveAdminWorks,
  createAdminWork,
  fetchAdminBroadcasters,
  fetchAdminRightsHolders,
  fetchAdminWorksForReview,
  mergeAdminWorks,
  reviewWorkDataCorrection,
  updateAdminWorkData,
} from "@/app/actions/work-management";
import { getDFIFilmDetails, searchDFIFilms } from "@/app/actions/dfi";
import { getTMDBWorkDetails, searchTMDB } from "@/app/actions/tmdb";
import { extractDfiPosterUrl, mapDfiWorkType, type DfiMetadata, type DfiWorkType } from "@/lib/dfi-metadata";

const TMDB_IMG_W185 = "https://image.tmdb.org/t/p/w185";

const WORK_TYPES = [
  { value: "kortfilm", label: "Kortfilm" },
  { value: "spillefilm", label: "Spillefilm" },
  { value: "tv-serie", label: "Tv-serie" },
  { value: "dokumentar-serie", label: "Dokumentar-serie" },
  { value: "dokumentarfilm", label: "Dokumentarfilm" },
];

const WORK_TYPE_VALUES = WORK_TYPES.map(type => type.value) as DfiWorkType[];

const CREDIT_ROLES = ["B-klipper", "Klipper", "Konceptuerende klipper"];
const BROADCASTERS = [
  "DR",
  "DR2",
  "TV 2",
  "TV 3",
  "SVT",
  "NRK",
  "ARD",
  "ZDF",
  "HBO",
  "Netflix",
  "TV2 Play",
  "Amazon Prime",
  "DR Ramasjang",
  "TV 2 Charlie",
  "TV 2 News",
  "TV3",
  "TV3+",
  "Kanal 4",
  "Kanal 5",
];
const NO_BROADCASTER = "__none__";
const BROADCAST_STREAM_NUMBER = "broadcast/stream";

function dfiText(metadata: DfiMetadata | null | undefined, key: string) {
  const value = metadata?.[key];
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

function dfiListText(metadata: DfiMetadata | null | undefined, key: string) {
  const value = metadata?.[key];
  if (Array.isArray(value)) return value.map(item => String(item)).join(", ");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function dfiRecord(metadata: DfiMetadata | null | undefined, key: string) {
  const value = metadata?.[key];
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function dfiArray(metadata: DfiMetadata | null | undefined, key: string) {
  const value = metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function workTypeFallback(value: string | null | undefined): DfiWorkType {
  return WORK_TYPE_VALUES.includes(value as DfiWorkType) ? value as DfiWorkType : "spillefilm";
}

type SortKey = "title" | "type" | "year" | "data" | "broadcaster" | "status";
type SortDir = "asc" | "desc";

type CommentRow = {
  id: string;
  author_role: "member" | "admin";
  message: string;
  created_at: string;
};

type ChangeRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  source: string;
  old_data: Record<string, unknown>;
  proposed_data: Record<string, unknown>;
  created_at: string;
  rettighedshavere?: { full_name?: string | null } | null;
  work_change_request_comments?: CommentRow[];
};

type ContractLink = {
  id: string;
  type: string | null;
  status: string | null;
  created_at: string | null;
  rettighedshavere?: { full_name?: string | null } | null;
};

type RightsHolder = {
  id: string;
  full_name: string;
};

type WorkAssignment = {
  id: string;
  role: string | null;
  share_percent: number | null;
  rettighedshavere?: RightsHolder | null;
};

type WorkProductionNumber = {
  id: string;
  tv_station: string;
  number: string | null;
};

type WorkRow = {
  id: string;
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  episode_count: number | null;
  genre: string | null;
  status: string;
  dfi_id: string | null;
  tmdb_id: string | number | null;
  description: string | null;
  poster_url: string | null;
  dfi_metadata?: DfiMetadata | null;
  work_change_requests?: ChangeRequest[];
  contracts?: ContractLink[];
  work_assignments?: WorkAssignment[];
  work_production_numbers?: WorkProductionNumber[];
};

type WorkForm = {
  title: string;
  type: string;
  year: string;
  duration_minutes: string;
  episode_count: string;
  genre: string;
  description: string;
  dfi_id: string;
  tmdb_id: string;
  poster_url: string;
  status: string;
  broadcaster: string;
  dfi_metadata?: DfiMetadata | null;
};

type AddWorkForm = {
  title: string;
  type: string;
  year: string;
  duration_minutes: string;
  episode_count: string;
  genre: string;
  rightsHolderId: string;
  role: string;
  sharePercent: string;
  broadcaster: string;
};

type AssignmentDraft = {
  id?: string;
  rightsHolderId?: string;
  role: string;
  sharePercent: string;
};

type SearchResult = Record<string, unknown>;
type AdminCreateWorkData = {
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  episode_count: number | null;
  genre: string | null;
  description: null;
  dfi_id: string | null;
  tmdb_id: number | null;
  poster_url: string | null;
  dfi_metadata: DfiMetadata | null;
};

const STATUS_LABELS: Record<string, string> = {
  til_godkendelse: "Til godkendelse",
  godkendt: "Godkendt",
  aktiv: "Godkendt",
  afsluttet: "Afsluttet",
  arkiveret: "Arkiveret",
};

const STATUS_CLASS: Record<string, string> = {
  til_godkendelse: "border-amber-300 bg-amber-50 text-amber-700",
  godkendt: "border-green-300 bg-green-50 text-green-700",
  aktiv: "border-green-300 bg-green-50 text-green-700",
  afsluttet: "border-slate-300 bg-slate-50 text-slate-700",
  arkiveret: "border-gray-300 bg-gray-50 text-gray-700",
};

const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: "Afventer",
  approved: "Godkendt",
  rejected: "Afvist",
};

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function hasPendingRequest(work: WorkRow) {
  return (work.work_change_requests ?? []).some(request => request.status === "pending");
}

function displayStatus(work: WorkRow) {
  if (hasPendingRequest(work) || work.status === "til_godkendelse") return "til_godkendelse";
  if (work.status === "aktiv") return "godkendt";
  return work.status;
}

function statusSortValue(work: WorkRow) {
  const status = displayStatus(work);
  const rank: Record<string, number> = {
    til_godkendelse: 0,
    godkendt: 1,
    aktiv: 1,
    afsluttet: 2,
    arkiveret: 3,
  };
  return `${rank[status] ?? 9}-${STATUS_LABELS[status] ?? status}`;
}

function requestKindLabel(request: ChangeRequest) {
  const proposed = request.proposed_data ?? {};
  if (proposed.kind === "creation") return "Oprettelse";
  if (proposed.kind === "co_editors") return "Medklippere";
  if (proposed.kind === "correction") return "Rettelse";
  return request.source;
}

function requestStatusLabel(status: string) {
  return REQUEST_STATUS_LABELS[status] ?? status;
}

function displayCreditRole(role: string | null | undefined) {
  return role === "Hovedklipper" ? "Konceptuerende klipper" : role ?? "Klipper";
}

const FIELD_LABELS: Record<string, string> = {
  title: "Titel",
  type: "Type",
  year: "År",
  duration_minutes: "Varighed",
  episode_count: "Afsnit",
  genre: "Genre",
  description: "Beskrivelse",
  dfi_id: "DFI-id",
  tmdb_id: "TMDB-id",
  poster_url: "Poster-url",
  status: "Status",
  memberRole: "Medlemsrolle",
};

const DIFF_KEYS = [
  "title",
  "type",
  "year",
  "duration_minutes",
  "episode_count",
  "genre",
  "dfi_id",
  "tmdb_id",
  "poster_url",
];

function requestSummary(request: ChangeRequest) {
  const proposed = request.proposed_data ?? {};
  const coEditors = Array.isArray(proposed.coEditors) ? proposed.coEditors as { name?: string; role?: string; sharePercent?: number | null; share_percent?: number | null; action?: string }[] : [];
  const localMatches = Array.isArray(proposed.localMatches) ? proposed.localMatches as { title?: string; year?: number | null }[] : [];
  return {
    kind: requestKindLabel(request),
    override: Boolean(proposed.overrideLocalMatch),
    coEditors,
    localMatches,
  };
}

function formatDiffValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "boolean") return value ? "Ja" : "Nej";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function comparableValue(value: unknown) {
  return value === undefined || value === "" ? null : value;
}

function requestDiffRows(request: ChangeRequest) {
  const oldData = request.old_data ?? {};
  const proposed = request.proposed_data ?? {};
  const workData = typeof proposed.workData === "object" && proposed.workData ? proposed.workData as Record<string, unknown> : proposed;

  return DIFF_KEYS
    .filter(key => Object.prototype.hasOwnProperty.call(workData, key))
    .map(key => ({ key, oldValue: oldData[key], newValue: workData[key] }))
    .filter(row => comparableValue(row.oldValue) !== comparableValue(row.newValue));
}

function requestDiffMap(request: ChangeRequest | null | undefined) {
  return Object.fromEntries((request ? requestDiffRows(request) : []).map(row => [row.key, row]));
}

function importDiffRows(current: WorkForm, next: Partial<WorkForm>) {
  return Object.entries(next)
    .map(([key, newValue]) => ({ key, oldValue: current[key as keyof WorkForm], newValue }))
    .filter(row => comparableValue(row.oldValue) !== comparableValue(row.newValue));
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|en|et|den|det)\b/g, " ")
    .replace(/[^a-z0-9æøå\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string) {
  const aTokens = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap++;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function getWorkBroadcaster(work: WorkRow) {
  return (work.work_production_numbers ?? []).find(item => item.number === BROADCAST_STREAM_NUMBER)?.tv_station
    ?? (work.work_production_numbers ?? [])[0]?.tv_station
    ?? null;
}

function posterSrc(posterUrl: string | null | undefined) {
  if (!posterUrl) return null;
  return posterUrl.startsWith("http") ? posterUrl : `${TMDB_IMG_W185}${posterUrl}`;
}

function toForm(work: WorkRow): WorkForm {
  return {
    title: work.title ?? "",
    type: work.type ?? "",
    year: work.year?.toString() ?? "",
    duration_minutes: work.duration_minutes?.toString() ?? "",
    episode_count: work.episode_count?.toString() ?? "",
    genre: work.genre ?? "",
    description: work.description ?? "",
    dfi_id: work.dfi_id ?? "",
    tmdb_id: work.tmdb_id?.toString() ?? "",
    poster_url: work.poster_url ?? "",
    status: displayStatus(work),
    broadcaster: getWorkBroadcaster(work) ?? NO_BROADCASTER,
    dfi_metadata: work.dfi_metadata ?? null,
  };
}

function nullableNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resultYear(item: SearchResult) {
  const dateYear = textValue(item.release_date).substring(0, 4) || textValue(item.first_air_date).substring(0, 4);
  const year = Number(item.ProductionYear || item.ReleaseYear || dateYear || 0);
  return Number.isFinite(year) ? year : 0;
}

function newestFirst<T extends SearchResult>(items: T[]) {
  return [...items].sort((a, b) => resultYear(b) - resultYear(a));
}

function notifyWorksUpdated() {
  window.dispatchEvent(new Event("works-updated"));
}

function workTypeLabel(value: string | null | undefined) {
  return WORK_TYPES.find(type => type.value === value)?.label ?? value ?? "-";
}

function defaultAddForm(): AddWorkForm {
  return {
    title: "",
    type: "spillefilm",
    year: "",
    duration_minutes: "",
    episode_count: "",
    genre: "",
    rightsHolderId: "",
    role: "Klipper",
    sharePercent: "",
    broadcaster: NO_BROADCASTER,
  };
}

export default function VaerksadministrationPage() {
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [rightsHolders, setRightsHolders] = useState<RightsHolder[]>([]);
  const [broadcasterOptions, setBroadcasterOptions] = useState<string[]>(BROADCASTERS);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<WorkRow | null>(null);
  const [editForm, setEditForm] = useState<WorkForm | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [adminComment, setAdminComment] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editingDeleteOpen, setEditingDeleteOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addForm, setAddForm] = useState<AddWorkForm>(defaultAddForm);
  const [addSource, setAddSource] = useState<"manual" | "local" | "dfi" | "tmdb">("manual");
  const [localResults, setLocalResults] = useState<SearchResult[]>([]);
  const [dfiResults, setDfiResults] = useState<SearchResult[]>([]);
  const [tmdbResults, setTmdbResults] = useState<SearchResult[]>([]);
  const [pickedResult, setPickedResult] = useState<SearchResult | null>(null);
  const [pickedSource, setPickedSource] = useState<"local" | "dfi" | "tmdb" | null>(null);
  const [isSearchingAdd, setIsSearchingAdd] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, AssignmentDraft>>({});
  const [newAssignment, setNewAssignment] = useState<AssignmentDraft>({ rightsHolderId: "", role: "Klipper", sharePercent: "" });
  const [importPreview, setImportPreview] = useState<{ source: "DFI" | "TMDB"; rows: { key: string; oldValue: unknown; newValue: unknown }[] } | null>(null);
  const [editLookupQuery, setEditLookupQuery] = useState("");
  const [editDfiResults, setEditDfiResults] = useState<SearchResult[]>([]);
  const [editTmdbResults, setEditTmdbResults] = useState<SearchResult[]>([]);
  const [isSearchingEdit, setIsSearchingEdit] = useState(false);
  const [masterId, setMasterId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchAdminWorksForReview();
      if (res.success) setWorks(res.works as WorkRow[]);

      try {
        const rightsRes = await fetchAdminRightsHolders();
        if (rightsRes.success) setRightsHolders(rightsRes.rightsHolders as RightsHolder[]);
      } catch (rightsErr: unknown) {
        setRightsHolders([]);
        setNotice(errorMessage(rightsErr, "Kunne ikke hente rettighedshavere, men værkerne er indlæst."));
      }
      try {
        const broadcastersRes = await fetchAdminBroadcasters();
        if (broadcastersRes.success && broadcastersRes.broadcasters.length > 0) {
          setBroadcasterOptions(broadcastersRes.broadcasters);
        }
      } catch (broadcastersErr: unknown) {
        setNotice(errorMessage(broadcastersErr, "Kunne ikke hente broadcaster-listen fra databasen."));
      }
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke hente værker."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = [...works];
    if (filterStatus !== "all") list = list.filter(work => displayStatus(work) === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(work =>
        work.title?.toLowerCase().includes(q) ||
        work.type?.toLowerCase().includes(q) ||
        String(work.year ?? "").includes(q) ||
        work.dfi_id?.toLowerCase().includes(q) ||
        String(work.tmdb_id ?? "").includes(q) ||
        (getWorkBroadcaster(work) ?? "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "year") return ((a.year ?? 0) - (b.year ?? 0)) * direction;

      const values: Record<Exclude<SortKey, "year">, [string, string]> = {
        title: [a.title ?? "", b.title ?? ""],
        type: [workTypeLabel(a.type), workTypeLabel(b.type)],
        data: [
          `${a.dfi_id ?? ""} ${a.tmdb_id ?? ""} ${a.duration_minutes ?? ""} ${a.episode_count ?? ""} ${a.genre ?? ""}`,
          `${b.dfi_id ?? ""} ${b.tmdb_id ?? ""} ${b.duration_minutes ?? ""} ${b.episode_count ?? ""} ${b.genre ?? ""}`,
        ],
        broadcaster: [getWorkBroadcaster(a) ?? "", getWorkBroadcaster(b) ?? ""],
        status: [statusSortValue(a), statusSortValue(b)],
      };
      const [left, right] = values[sortKey];
      return left.localeCompare(right, "da-DK", { numeric: true, sensitivity: "base" }) * direction;
    });
    return list;
  }, [works, filterStatus, search, sortKey, sortDir]);

  const stats = useMemo(() => {
    const activeWorks = works.filter(work => displayStatus(work) !== "arkiveret");
    const withContract = activeWorks.filter(work => (work.contracts ?? []).length > 0).length;
    return {
      total: activeWorks.length,
      withContract,
      missingContract: Math.max(activeWorks.length - withContract, 0),
    };
  }, [works]);

  const selectedWorks = useMemo(
    () => works.filter(work => selectedIds.includes(work.id)),
    [works, selectedIds]
  );

  const selectedContracts = useMemo(
    () => selectedWorks.flatMap(work => (work.contracts ?? []).map(contract => ({ work, contract }))),
    [selectedWorks]
  );

  const duplicateGroups = useMemo(() => {
    const candidates = works.filter(work => displayStatus(work) !== "arkiveret");
    const groups: WorkRow[][] = [];
    const used = new Set<string>();

    for (const work of candidates) {
      if (used.has(work.id)) continue;
      const matches = candidates.filter(other => {
        if (other.id === work.id) return false;
        const sameTitle = normalizeTitle(work.title) === normalizeTitle(other.title);
        const yearsClose = work.year && other.year ? Math.abs(work.year - other.year) <= 1 : true;
        return sameTitle || (yearsClose && similarity(work.title, other.title) >= 0.65);
      });
      if (matches.length) {
        const group = [work, ...matches].filter(item => !used.has(item.id));
        if (group.length > 1) {
          group.forEach(item => used.add(item.id));
          groups.push(group);
        }
      }
    }
    return groups;
  }, [works]);

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(existing => existing !== id) : [...prev, id]);
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every(work => selectedIds.includes(work.id));

  const toggleAllFiltered = () => {
    const filteredIds = filtered.map(work => work.id);
    setSelectedIds(prev => allFilteredSelected
      ? prev.filter(id => !filteredIds.includes(id))
      : [...new Set([...prev, ...filteredIds])]
    );
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const sortMark = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : "";

  const openEdit = (work: WorkRow) => {
    const pendingRequest = (work.work_change_requests ?? []).find(request => request.status === "pending") ?? null;
    setEditing(work);
    setEditForm(toForm(work));
    setAssignmentDrafts(Object.fromEntries((work.work_assignments ?? []).map(assignment => [
      assignment.id,
      {
        id: assignment.id,
        rightsHolderId: assignment.rettighedshavere?.id,
        role: displayCreditRole(assignment.role),
        sharePercent: assignment.share_percent === null || assignment.share_percent === undefined ? "" : String(assignment.share_percent),
      },
    ])));
    setNewAssignment({ rightsHolderId: "", role: "Klipper", sharePercent: "" });
    setActiveRequestId(pendingRequest?.id ?? null);
    setAdminComment("");
    setImportPreview(null);
    setEditLookupQuery(work.title ?? "");
    setEditDfiResults([]);
    setEditTmdbResults([]);
  };

  const updateDfiMetaField = (key: string, value: unknown) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const currentMeta = prev.dfi_metadata || {};
      return {
        ...prev,
        dfi_metadata: {
          ...currentMeta,
          [key]: value
        }
      };
    });
  };

  const handleSaveWork = async () => {
    if (!editing || !editForm) return;
    setSaving(true);
    try {
      await updateAdminWorkData({
        workId: editing.id,
        data: {
          title: editForm.title,
          type: editForm.type,
          year: nullableNumber(editForm.year),
          duration_minutes: nullableNumber(editForm.duration_minutes),
          episode_count: nullableNumber(editForm.episode_count),
          genre: editForm.genre || null,
          description: editForm.description || null,
          dfi_id: editForm.dfi_id || null,
          tmdb_id: nullableNumber(editForm.tmdb_id),
          poster_url: editForm.poster_url || null,
          status: editForm.status,
          dfi_metadata: editForm.dfi_metadata || null,
        },
        broadcaster: editForm.broadcaster === NO_BROADCASTER ? null : editForm.broadcaster,
        assignments: [
          ...Object.values(assignmentDrafts).map(assignment => ({
            id: assignment.id,
            role: assignment.role,
            sharePercent: nullableNumber(assignment.sharePercent),
          })),
          ...(newAssignment.rightsHolderId ? [{
            rightsHolderId: newAssignment.rightsHolderId,
            role: newAssignment.role,
            sharePercent: nullableNumber(newAssignment.sharePercent),
          }] : []),
        ],
      });
      setNotice("Værket er gemt.");
      setEditing(null);
      setEditForm(null);
      setActiveRequestId(null);
      setImportPreview(null);
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke gemme værket."));
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async (decision: "approved" | "rejected") => {
    if (!activeRequestId) return;
    const reviewedRequestId = activeRequestId;
    const editingWorkId = editing?.id;
    setSaving(true);
    try {
      await reviewWorkDataCorrection({ requestId: reviewedRequestId, decision, comment: adminComment });
      setNotice(decision === "approved" ? "Rettelsen er godkendt." : "Rettelsen er afvist.");
      setAdminComment("");
      const res = await fetchAdminWorksForReview();
      if (res.success) {
        const freshWorks = res.works as WorkRow[];
        setWorks(freshWorks);
        const updatedEditing = freshWorks.find(work => work.id === editingWorkId) ?? null;
        if (updatedEditing) {
          setEditing(updatedEditing);
          setEditForm(form => form ? { ...form, status: displayStatus(updatedEditing) } : form);
        }
      }
      setActiveRequestId(null);
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke behandle rettelsen."));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    setSaving(true);
    try {
      await archiveAdminWorks({ workIds: selectedIds });
      setNotice(`${selectedIds.length} værk(er) er arkiveret.`);
      setArchiveOpen(false);
      setSelectedIds([]);
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke arkivere værker."));
    } finally {
      setSaving(false);
    }
  };

  const handleApproveSelected = async () => {
    setSaving(true);
    try {
      await approveAdminWorks({ workIds: selectedIds });
      setNotice(`${selectedIds.length} værk(er) er godkendt.`);
      setSelectedIds([]);
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke godkende værker."));
    } finally {
      setSaving(false);
    }
  };

  const handleSetEditingStatus = async (status: "godkendt" | "arkiveret") => {
    if (!editing || !editForm) return;
    setSaving(true);
    try {
      await updateAdminWorkData({
        workId: editing.id,
        data: {
          title: editForm.title,
          type: editForm.type,
          year: nullableNumber(editForm.year),
          duration_minutes: nullableNumber(editForm.duration_minutes),
          episode_count: nullableNumber(editForm.episode_count),
          genre: editForm.genre || null,
          description: editForm.description || null,
          dfi_id: editForm.dfi_id || null,
          tmdb_id: nullableNumber(editForm.tmdb_id),
          poster_url: editForm.poster_url || null,
          status,
        },
        broadcaster: editForm.broadcaster === NO_BROADCASTER ? null : editForm.broadcaster,
      });
      setNotice(status === "godkendt" ? "Værket er godkendt." : "Værket er slettet.");
      setEditForm({ ...editForm, status });
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke ændre status."));
    } finally {
      setSaving(false);
    }
  };

  const handleMerge = async () => {
    if (!masterId) {
      setNotice("Vælg et hovedværk til fletning.");
      return;
    }
    setSaving(true);
    try {
      await mergeAdminWorks({ masterWorkId: masterId, duplicateWorkIds: selectedIds.filter(id => id !== masterId) });
      setNotice("Dubletterne er flettet, og relationer er flyttet til hovedværket.");
      setMergeOpen(false);
      setDuplicatesOpen(false);
      setMasterId("");
      setSelectedIds([]);
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke flette dubletter."));
    } finally {
      setSaving(false);
    }
  };

  const handleAddSearch = async () => {
    if (!addQuery.trim()) return;
    setIsSearchingAdd(true);
    setLocalResults([]);
    setDfiResults([]);
    setTmdbResults([]);
    setPickedResult(null);
    setPickedSource(null);
    const normalizedQuery = addQuery.trim().toLowerCase();
    const localMatches = works
      .filter(work =>
        work.title?.toLowerCase().includes(normalizedQuery) ||
        String(work.year ?? "").includes(normalizedQuery) ||
        work.dfi_id?.toLowerCase().includes(normalizedQuery) ||
        String(work.tmdb_id ?? "").includes(normalizedQuery)
      )
      .slice(0, 8)
      .map(work => ({ ...work }));
    setLocalResults(localMatches);
    if (localMatches.length > 0) {
      const first = localMatches[0];
      setPickedResult(first);
      setPickedSource("local");
      setAddSource("local");
      setAddForm(form => ({
        ...form,
        title: textValue(first.title),
        type: textValue(first.type) || form.type,
        year: first.year ? String(first.year) : "",
        duration_minutes: first.duration_minutes ? String(first.duration_minutes) : "",
        episode_count: first.episode_count ? String(first.episode_count) : "",
        genre: textValue(first.genre),
      }));
    }
    try {
      const [dfi, tmdb] = await Promise.all([
        searchDFIFilms(addQuery).catch(() => ({ success: false, results: [] })),
        searchTMDB(addQuery).catch(() => []),
      ]);
      const dfiPayload = dfi as { results?: SearchResult[] };
      setDfiResults(newestFirst(dfiPayload.results ?? []).slice(0, 8));
      setTmdbResults(newestFirst(Array.isArray(tmdb) ? tmdb as SearchResult[] : []).slice(0, 8));
    } finally {
      setIsSearchingAdd(false);
    }
  };

  const handleEditSearch = async () => {
    if (!editLookupQuery.trim()) return;
    setIsSearchingEdit(true);
    setEditDfiResults([]);
    setEditTmdbResults([]);
    try {
      const [dfi, tmdb] = await Promise.all([
        searchDFIFilms(editLookupQuery).catch(() => ({ success: false, results: [] })),
        searchTMDB(editLookupQuery).catch(() => []),
      ]);
      const dfiPayload = dfi as { results?: SearchResult[] };
      setEditDfiResults(newestFirst(dfiPayload.results ?? []).slice(0, 8));
      setEditTmdbResults(newestFirst(Array.isArray(tmdb) ? tmdb as SearchResult[] : []).slice(0, 8));
    } finally {
      setIsSearchingEdit(false);
    }
  };

  const applyDfiToEdit = async (result: SearchResult) => {
    if (!editForm) return;

    setSaving(true);
    try {
      const details = await getDFIFilmDetails(Number(result.Id));
      const film = (details.success ? (details as { film?: SearchResult }).film : result) ?? result;
      const type = mapDfiWorkType(film.Category, film.Type, workTypeFallback(editForm.type));
      const nextValues: Partial<WorkForm> = {
        title: textValue(film.Title) || textValue(film.DanishTitle) || editForm.title,
        type,
        year: film.ProductionYear || film.ReleaseYear ? String(film.ProductionYear || film.ReleaseYear) : editForm.year,
        dfi_id: String(result.Id),
        poster_url: extractDfiPosterUrl(film) ?? editForm.poster_url,
      };
      setImportPreview({ source: "DFI", rows: importDiffRows(editForm, nextValues) });
      setEditForm({
        ...editForm,
        ...nextValues,
      });
      setNotice("DFI-data er hentet ind i redigeringsformularen. Husk at gemme værket.");
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke hente DFI-data."));
    } finally {
      setSaving(false);
    }
  };

  const applyTmdbToEdit = async (result: SearchResult) => {
    if (!editForm) return;
    setSaving(true);
    try {
      const details = await getTMDBWorkDetails(Number(result.id), textValue(result.media_type) || "movie");
      const work = (details.success ? (details as { details?: SearchResult }).details : result) ?? result;
      const releaseDate = textValue(work.release_date);
      const firstAirDate = textValue(work.first_air_date);
      const nextValues: Partial<WorkForm> = {
        title: textValue(work.title) || textValue(work.name) || editForm.title,
        type: result.media_type === "tv" ? "tv-serie" : editForm.type,
        year: releaseDate ? releaseDate.substring(0, 4) : firstAirDate ? firstAirDate.substring(0, 4) : editForm.year,
        tmdb_id: String(result.id),
        poster_url: textValue(work.poster_path) ? `${TMDB_IMG_W185}${textValue(work.poster_path)}` : editForm.poster_url,
      };
      setImportPreview({ source: "TMDB", rows: importDiffRows(editForm, nextValues) });
      setEditForm({
        ...editForm,
        ...nextValues,
      });
      setNotice("TMDB-data er hentet ind i redigeringsformularen. Husk at gemme værket.");
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke hente TMDB-data."));
    } finally {
      setSaving(false);
    }
  };

  const pickLocalResult = (result: SearchResult) => {
    setPickedResult(result);
    setPickedSource("local");
    setAddSource("local");
    setAddForm(form => ({
      ...form,
      title: textValue(result.title),
      type: textValue(result.type) || form.type,
      year: result.year ? String(result.year) : "",
      duration_minutes: result.duration_minutes ? String(result.duration_minutes) : "",
      episode_count: result.episode_count ? String(result.episode_count) : "",
      genre: textValue(result.genre),
    }));
  };

  const pickDfiResult = (result: SearchResult) => {
    setPickedResult(result);
    setPickedSource("dfi");
    setAddSource("dfi");
    const type = mapDfiWorkType(result.Category, result.Type);
    setAddForm(form => ({
      ...form,
      title: textValue(result.Title) || textValue(result.DanishTitle),
      type,
      year: result.ProductionYear || result.ReleaseYear ? String(result.ProductionYear || result.ReleaseYear) : "",
    }));
  };

  const pickTmdbResult = (result: SearchResult) => {
    setPickedResult(result);
    setPickedSource("tmdb");
    setAddSource("tmdb");
    const releaseDate = textValue(result.release_date);
    const firstAirDate = textValue(result.first_air_date);
    const year = releaseDate.substring(0, 4) || firstAirDate.substring(0, 4) || "";
    setAddForm(form => ({
      ...form,
      title: textValue(result.title) || textValue(result.name),
      type: result.media_type === "tv" ? "tv-serie" : "spillefilm",
      year,
    }));
  };

  const handleCreateWork = async () => {
    setSaving(true);
    try {
      let data: AdminCreateWorkData = {
        title: addForm.title,
        type: addForm.type,
        year: nullableNumber(addForm.year),
        duration_minutes: nullableNumber(addForm.duration_minutes),
        episode_count: nullableNumber(addForm.episode_count),
        genre: addForm.genre || null,
        description: null,
        dfi_id: null as string | null,
        tmdb_id: null as number | null,
        poster_url: null as string | null,
        dfi_metadata: null,
      };

      if (pickedSource === "dfi" && pickedResult) {
        const details = await getDFIFilmDetails(Number(pickedResult.Id));
        const film = (details.success ? (details as { film?: SearchResult }).film : pickedResult) ?? pickedResult;
        data = {
          ...data,
          title: textValue(film.Title) || textValue(film.DanishTitle) || data.title,
          year: numberValue(film.ProductionYear) || numberValue(film.ReleaseYear) || data.year,
          dfi_id: String(pickedResult.Id),
          poster_url: extractDfiPosterUrl(film),
          dfi_metadata: film as DfiMetadata,
        };
      }

      if (pickedSource === "tmdb" && pickedResult) {
        const details = await getTMDBWorkDetails(Number(pickedResult.id), textValue(pickedResult.media_type) || "movie");
        const work = (details.success ? (details as { details?: SearchResult }).details : pickedResult) ?? pickedResult;
        const releaseDate = textValue(work.release_date);
        const firstAirDate = textValue(work.first_air_date);
        data = {
          ...data,
          title: textValue(work.title) || textValue(work.name) || data.title,
          year: releaseDate ? Number.parseInt(releaseDate.substring(0, 4), 10) : firstAirDate ? Number.parseInt(firstAirDate.substring(0, 4), 10) : data.year,
          tmdb_id: Number(pickedResult.id),
          poster_url: textValue(work.poster_path) ? `${TMDB_IMG_W185}${textValue(work.poster_path)}` : null,
        };
      }

      await createAdminWork({
        workId: pickedSource === "local" && pickedResult ? textValue(pickedResult.id) : null,
        data,
        rightsHolderId: addForm.rightsHolderId || null,
        role: addForm.role || null,
        sharePercent: nullableNumber(addForm.sharePercent),
        broadcaster: addForm.broadcaster === NO_BROADCASTER ? null : addForm.broadcaster,
      });
      setNotice("Værket er tilføjet.");
      setAddOpen(false);
      setAddQuery("");
      setAddForm(defaultAddForm());
      setAddSource("manual");
      setPickedResult(null);
      setPickedSource(null);
      setLocalResults([]);
      setDfiResults([]);
      setTmdbResults([]);
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke tilføje værket."));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Henter værker...</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Værksadministration"
        subtitle={`${filtered.length} af ${works.length} værker`}
        actions={
          <Button className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Tilføj værk
          </Button>
        }
      />

      {notice && (
        <div className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-muted-foreground">Luk</button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Total værker", value: stats.total },
          { label: "Med kontrakt tilknyttet", value: stats.withContract },
          { label: "Mangler kontrakt", value: stats.missingContract },
        ].map(item => (
          <div key={item.label} className="rounded-lg border bg-background px-5 py-4">
            <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
            <p className="mt-1 text-3xl font-semibold">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Søg titel, DFI-id, TMDB-id, type..." className="w-[320px] pl-8" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status</SelectItem>
            <SelectItem value="til_godkendelse">Til godkendelse</SelectItem>
            <SelectItem value="godkendt">Godkendt</SelectItem>
            <SelectItem value="arkiveret">Arkiveret</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" className="gap-2" onClick={() => setDuplicatesOpen(true)}>
          <Search className="h-4 w-4" />
          Find dubletter
        </Button>
        <Button variant="outline" className="gap-2" onClick={handleApproveSelected} disabled={saving || selectedIds.length === 0}>
          <CheckCircle2 className="h-4 w-4" />
          Godkend valgte
        </Button>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3">
          <span className="text-sm font-medium">{selectedIds.length} valgt</span>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setArchiveOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Slet / arkiver
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => { setMasterId(selectedIds[0] ?? ""); setMergeOpen(true); }} disabled={selectedIds.length < 2}>
            <GitMerge className="h-4 w-4" />
            Flet dubletter
          </Button>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} className="h-4 w-4" aria-label="Vælg alle værker" />
              </TableHead>
              <TableHead><SortButton label="Værk" activeMark={sortMark("title")} onClick={() => handleSort("title")} /></TableHead>
              <TableHead><SortButton label="Type" activeMark={sortMark("type")} onClick={() => handleSort("type")} /></TableHead>
              <TableHead><SortButton label="År" activeMark={sortMark("year")} onClick={() => handleSort("year")} /></TableHead>
              <TableHead><SortButton label="Data" activeMark={sortMark("data")} onClick={() => handleSort("data")} /></TableHead>
              <TableHead><SortButton label="Broadcast/stream" activeMark={sortMark("broadcaster")} onClick={() => handleSort("broadcaster")} /></TableHead>
              <TableHead><SortButton label="Status" activeMark={sortMark("status")} onClick={() => handleSort("status")} /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Ingen værker matcher søgningen</TableCell></TableRow>
            ) : filtered.map(work => {
              const status = displayStatus(work);
              const broadcaster = getWorkBroadcaster(work);
              const poster = posterSrc(work.poster_url);
              const pendingCount = (work.work_change_requests ?? []).filter(request => request.status === "pending").length;
              return (
                <TableRow key={work.id} className={pendingCount ? "bg-amber-50/45" : undefined}>
                  <TableCell>
                    <input type="checkbox" checked={selectedIds.includes(work.id)} onChange={() => toggleSelected(work.id)} className="h-4 w-4" aria-label={`Vælg ${work.title}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                        {poster ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={poster} alt={work.title} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <Film className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={() => openEdit(work)} className="text-left font-medium underline-offset-4 hover:underline">{work.title}</button>
                          {pendingCount > 0 && (
                            <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
                              {pendingCount} pending request{pendingCount === 1 ? "" : "s"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{work.description ? work.description.slice(0, 90) : "Ingen beskrivelse"}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{workTypeLabel(work.type)}</TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">{work.year ?? "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>DFI: {work.dfi_id ?? "-"} · TMDB: {work.tmdb_id ?? "-"}</div>
                    <div>Varighed: {work.duration_minutes ?? "-"} · Afsnit: {work.episode_count ?? "-"} · Genre: {work.genre ?? "-"}</div>
                    <div>Kontrakter: {work.contracts?.length ?? 0} · Poster: {work.poster_url ? "ja" : "nej"}</div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{broadcaster ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_CLASS[status] ?? ""}>
                      {status === "til_godkendelse" ? <Clock className="mr-1 h-3 w-3" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                      {STATUS_LABELS[status] ?? status}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={open => { if (!open) { setEditing(null); setEditForm(null); setActiveRequestId(null); setImportPreview(null); setAdminComment(""); setEditingDeleteOpen(false); } }}>
        <DialogContent className="max-h-[92vh] w-[min(1360px,calc(100vw-2rem))] !max-w-none sm:!max-w-none overflow-y-auto overflow-x-hidden">
          <DialogHeader><DialogTitle>Rediger værk</DialogTitle></DialogHeader>
          {editing && editForm && (
            (() => {
              const requests = editing.work_change_requests ?? [];
              const pendingRequests = requests.filter(request => request.status === "pending");
              const activeRequest = requests.find(request => request.id === activeRequestId)
                ?? pendingRequests[0]
                ?? null;
              const activeDiffMap = requestDiffMap(activeRequest);
              const summary = activeRequest ? requestSummary(activeRequest) : null;
              return (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 rounded-md border px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Status</span>
                  <Badge variant="outline" className={STATUS_CLASS[editForm.status] ?? ""}>
                    {STATUS_LABELS[editForm.status] ?? editForm.status}
                  </Badge>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" variant="destructive" onClick={() => setEditingDeleteOpen(true)} disabled={saving}>
                    Slet værk
                  </Button>
                  <Button type="button" onClick={handleSaveWork} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Gem værk
                  </Button>
                  <Button type="button" variant="outline" onClick={() => { setEditing(null); setEditForm(null); setActiveRequestId(null); setImportPreview(null); setAdminComment(""); }}>
                    Annuller
                  </Button>
                </div>
              </div>
              <InfoPanel title="Kommentarer og requests">
                {requests.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ingen brugerkommentarer.</p>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                    <div className="space-y-2">
                      {requests.map(request => (
                        <button
                          key={request.id}
                          type="button"
                          onClick={() => { setActiveRequestId(request.id); setAdminComment(""); }}
                          className={`w-full rounded-md border px-3 py-2 text-left text-sm ${activeRequest?.id === request.id ? "border-foreground bg-muted" : "hover:bg-muted"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{requestKindLabel(request)}</span>
                            <Badge variant="secondary">{requestStatusLabel(request.status)}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {request.rettighedshavere?.full_name ?? "Ukendt bruger"} · {new Date(request.created_at).toLocaleDateString("da-DK")}
                          </div>
                        </button>
                      ))}
                    </div>
                    {activeRequest && summary && (
                      <div className="space-y-3 rounded-md border px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <div>
                            <p className="font-medium">{activeRequest.rettighedshavere?.full_name ?? "Ukendt bruger"}</p>
                            <p className="text-xs text-muted-foreground">{activeRequest.source} · {new Date(activeRequest.created_at).toLocaleString("da-DK")}</p>
                          </div>
                          <Badge variant="outline">{requestKindLabel(activeRequest)}</Badge>
                        </div>
                        {requestDiffRows(activeRequest).length > 0 && (
                          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            {requestDiffRows(activeRequest).length} feltændring{requestDiffRows(activeRequest).length === 1 ? "" : "er"} er markeret i Værksdata nedenfor.
                          </p>
                        )}
                        {summary.coEditors.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Medklipperforslag</p>
                            {summary.coEditors.map((editor, index) => (
                              <div key={`${editor.name}-${index}`} className="grid gap-2 rounded-md border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_140px_80px]">
                                <div>{editor.name ?? "Ukendt"}</div>
                                <div>{displayCreditRole(editor.role)}</div>
                                <div>{editor.sharePercent ?? editor.share_percent ?? "-"}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {(activeRequest.work_change_request_comments ?? []).length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Kommentartråd</p>
                            {(activeRequest.work_change_request_comments ?? []).map(comment => (
                              <div key={comment.id} className="rounded bg-muted px-2 py-1 text-sm">
                                <div className="text-xs text-muted-foreground">{comment.author_role === "admin" ? "Admin" : "Bruger"} · {new Date(comment.created_at).toLocaleString("da-DK")}</div>
                                <div>{comment.message}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {activeRequest.status !== "approved" && (
                          <div className="space-y-3">
                            <Field label="Svar til bruger">
                              <Textarea value={adminComment} onChange={e => setAdminComment(e.target.value)} />
                            </Field>
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" onClick={() => handleReview("rejected")} disabled={saving}>
                                <XCircle className="mr-2 h-4 w-4" />
                                Afvis
                              </Button>
                              <Button onClick={() => handleReview("approved")} disabled={saving}>
                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Godkend
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </InfoPanel>
              <div className="space-y-4">
                <InfoPanel title="Værksdata">
                  {activeRequest && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Viser foreslåede ændringer fra <span className="font-medium">{activeRequest.rettighedshavere?.full_name ?? "ukendt bruger"}</span>.
                      Felter med ændringer er markeret herunder.
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <DiffField diff={activeDiffMap.title}>
                      <Field label="Titel"><Input value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.type}>
                      <Field label="Type">
                      <Select value={editForm.type} onValueChange={type => setEditForm({ ...editForm, type })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WORK_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      </Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.year}>
                      <Field label="År"><Input value={editForm.year} onChange={e => setEditForm({ ...editForm, year: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.duration_minutes}>
                      <Field label="Varighed"><Input value={editForm.duration_minutes} onChange={e => setEditForm({ ...editForm, duration_minutes: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.episode_count}>
                      <Field label="Afsnit"><Input value={editForm.episode_count} onChange={e => setEditForm({ ...editForm, episode_count: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.genre}>
                      <Field label="Genre"><Input value={editForm.genre} onChange={e => setEditForm({ ...editForm, genre: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.dfi_id}>
                      <Field label="DFI-id"><Input value={editForm.dfi_id} onChange={e => setEditForm({ ...editForm, dfi_id: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.tmdb_id}>
                      <Field label="TMDB-id"><Input value={editForm.tmdb_id} onChange={e => setEditForm({ ...editForm, tmdb_id: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.poster_url}>
                      <Field label="Poster-url"><Input value={editForm.poster_url} onChange={e => setEditForm({ ...editForm, poster_url: e.target.value })} /></Field>
                    </DiffField>
                    <Field label="Broadcast/stream">
                      <Select value={editForm.broadcaster} onValueChange={broadcaster => setEditForm({ ...editForm, broadcaster })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_BROADCASTER}>Ingen</SelectItem>
                          {broadcasterOptions.map(broadcaster => <SelectItem key={broadcaster} value={broadcaster}>{broadcaster}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>

                    {editForm.dfi_id && !editForm.dfi_metadata && (
                      <div className="col-span-full mt-2 rounded border border-dashed p-3 flex items-center justify-between text-sm bg-muted/40">
                        <span className="text-muted-foreground">Der er ikke hentet udvidet DFI metadata for dette værk.</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const res = await getDFIFilmDetails(Number(editForm.dfi_id));
                              if (res.success && res.film) {
                                setEditForm({ ...editForm, dfi_metadata: res.film });
                                setNotice("DFI metadata hentet.");
                              } else {
                                setNotice("Kunne ikke hente DFI metadata.");
                              }
                            } catch {
                              setNotice("Fejl ved hentning af DFI data.");
                            } finally {
                              setSaving(false);
                            }
                          }}
                          disabled={saving}
                        >
                          Hent DFI data
                        </Button>
                      </div>
                    )}

                    {editForm.dfi_metadata && (
                      <>
                        <Field label="Original Titel (DFI)">
                          <Input
                            value={dfiText(editForm.dfi_metadata, "OriginalTitle")}
                            onChange={e => updateDfiMetaField("OriginalTitle", e.target.value)}
                          />
                        </Field>
                        <Field label="Alternative Titler (kommasepareret)">
                          <Input
                            value={dfiListText(editForm.dfi_metadata, "AltTitle")}
                            onChange={e =>
                              updateDfiMetaField(
                                "AltTitle",
                                e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean)
                              )
                            }
                          />
                        </Field>
                        <Field label="Udgivelsesår Slut (DFI)">
                          <Input
                            type="number"
                            value={dfiText(editForm.dfi_metadata, "ReleaseYearEnd")}
                            onChange={e => updateDfiMetaField("ReleaseYearEnd", parseInt(e.target.value) || null)}
                          />
                        </Field>
                        <Field label="Spilletid (DFI minutter)">
                          <Input
                            type="number"
                            value={dfiText(editForm.dfi_metadata, "LengthInMin")}
                            onChange={e => updateDfiMetaField("LengthInMin", parseInt(e.target.value) || null)}
                          />
                        </Field>
                        <Field label="Genre (DFI)">
                          <Input
                            value={dfiText(editForm.dfi_metadata, "Genre")}
                            onChange={e => updateDfiMetaField("Genre", e.target.value)}
                          />
                        </Field>
                      </>
                    )}
                  </div>

                  {editForm.dfi_metadata && (
                    <div className="mt-5 space-y-4 border-t pt-4">
                      {/* Checkboxes for fil status */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">DFI fil-tilgængelighed</Label>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 text-sm">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!editForm.dfi_metadata.HasPoster}
                              onChange={e => updateDfiMetaField("HasPoster", e.target.checked)}
                              className="h-4 w-4"
                            />
                            <span>Has Poster</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!editForm.dfi_metadata.HasStills}
                              onChange={e => updateDfiMetaField("HasStills", e.target.checked)}
                              className="h-4 w-4"
                            />
                            <span>Has Stills</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!editForm.dfi_metadata.HasVideo}
                              onChange={e => updateDfiMetaField("HasVideo", e.target.checked)}
                              className="h-4 w-4"
                            />
                            <span>Has Video</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!editForm.dfi_metadata.HasManus}
                              onChange={e => updateDfiMetaField("HasManus", e.target.checked)}
                              className="h-4 w-4"
                            />
                            <span>Has Manus</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!editForm.dfi_metadata.HasAdditionalData}
                              onChange={e => updateDfiMetaField("HasAdditionalData", e.target.checked)}
                              className="h-4 w-4"
                            />
                            <span>Has Add. Data</span>
                          </label>
                        </div>
                      </div>

                      {/* Parent / Children seriehierarki */}
                      {(dfiRecord(editForm.dfi_metadata, "Parent") || dfiArray(editForm.dfi_metadata, "Children").length > 0) && (
                        <div className="grid gap-4 sm:grid-cols-2 text-sm bg-muted/40 rounded border p-3 mt-3">
                          {dfiRecord(editForm.dfi_metadata, "Parent") && (
                            <div>
                              <p className="font-semibold text-muted-foreground">Tilhører serien (Parent)</p>
                              <p className="mt-0.5 font-medium">
                                {String(dfiRecord(editForm.dfi_metadata, "Parent")?.Title || "Ukendt serie")} (DFI ID:{" "}
                                {String(dfiRecord(editForm.dfi_metadata, "Parent")?.Id || "-")})
                              </p>
                            </div>
                          )}
                          {dfiArray(editForm.dfi_metadata, "Children").length > 0 && (
                            <div>
                              <p className="font-semibold text-muted-foreground">Underværker (Children afsnit)</p>
                              <p className="mt-0.5 font-medium">
                                Serie med {dfiArray(editForm.dfi_metadata, "Children").length} registrerede afsnit hos DFI.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </InfoPanel>
                <InfoPanel title="Rettighedshavere">
                  {(editing.work_assignments ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Ingen rettighedshavere er koblet til værket.</p>
                  ) : (
                    <div className="space-y-3">
                      {(editing.work_assignments ?? []).map(assignment => (
                        <div key={assignment.id} className="grid gap-3 rounded-md border px-3 py-3 sm:grid-cols-[minmax(0,1fr)_180px_140px] sm:items-center">
                          <div>
                            <p className="text-sm font-medium">{assignment.rettighedshavere?.full_name ?? "Ukendt rettighedshaver"}</p>
                            <p className="text-xs text-muted-foreground">Kreditering på værket</p>
                          </div>
                          <Select
                            value={assignmentDrafts[assignment.id]?.role ?? displayCreditRole(assignment.role)}
                            onValueChange={role => setAssignmentDrafts(prev => ({
                              ...prev,
                              [assignment.id]: { ...(prev[assignment.id] ?? { id: assignment.id, sharePercent: "" }), role },
                            }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CREDIT_ROLES.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Input
                            inputMode="numeric"
                            maxLength={3}
                            className="w-20"
                            placeholder="%"
                            value={assignmentDrafts[assignment.id]?.sharePercent ?? ""}
                            onChange={e => setAssignmentDrafts(prev => ({
                              ...prev,
                              [assignment.id]: { ...(prev[assignment.id] ?? { id: assignment.id, role: displayCreditRole(assignment.role) }), sharePercent: e.target.value },
                            }))}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid gap-3 rounded-md border border-dashed px-3 py-3 lg:grid-cols-[minmax(240px,1fr)_180px_140px] lg:items-end">
                    <Field label="Tilføj rettighedshaver">
                      <Select value={newAssignment.rightsHolderId ?? ""} onValueChange={rightsHolderId => setNewAssignment(prev => ({ ...prev, rightsHolderId }))}>
                        <SelectTrigger><SelectValue placeholder="Vælg eksisterende rettighedshaver" /></SelectTrigger>
                        <SelectContent>
                          {rightsHolders
                            .filter(rightsHolder => !(editing.work_assignments ?? []).some(assignment => assignment.rettighedshavere?.id === rightsHolder.id))
                            .map(rightsHolder => (
                              <SelectItem key={rightsHolder.id} value={rightsHolder.id}>{rightsHolder.full_name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Kreditering">
                      <Select value={newAssignment.role} onValueChange={role => setNewAssignment(prev => ({ ...prev, role }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CREDIT_ROLES.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Andel %">
                      <Input inputMode="numeric" maxLength={3} className="w-20" value={newAssignment.sharePercent} onChange={e => setNewAssignment(prev => ({ ...prev, sharePercent: e.target.value }))} />
                    </Field>
                  </div>
                </InfoPanel>
              </div>
              <InfoPanel title="Tilknyttede kontrakter">
                {(editing.contracts ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ingen kontrakter tilknyttet.</p>
                ) : (editing.contracts ?? []).map(contract => (
                  <div key={contract.id} className="rounded border px-3 py-2 text-sm">
                    <div className="font-medium">{contract.rettighedshavere?.full_name ?? "Ukendt medlem"}</div>
                    <div className="text-xs text-muted-foreground">{contract.type ?? "Kontrakt"} · {contract.status ?? "ukendt status"}</div>
                  </div>
                ))}
              </InfoPanel>
              <InfoPanel title="Hent data fra DFI eller TMDB">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="Søg titel i DFI og TMDB..."
                    value={editLookupQuery}
                    onChange={e => setEditLookupQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleEditSearch(); }}
                  />
                  <Button variant="outline" onClick={handleEditSearch} disabled={isSearchingEdit} className="gap-2">
                    {isSearchingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Søg
                  </Button>
                </div>
                {(editDfiResults.length > 0 || editTmdbResults.length > 0) && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <SearchColumn
                      title={`DFI (${editDfiResults.length})`}
                      items={editDfiResults}
                      selected={null}
                      getKey={item => String(item.Id)}
                      getTitle={item => textValue(item.Title) || textValue(item.DanishTitle) || "Ukendt"}
                      getMeta={item => `${item.ProductionYear || item.ReleaseYear || "-"} · ${textValue(item.Category)}`}
                      onSelect={applyDfiToEdit}
                    />
                    <SearchColumn
                      title={`TMDB (${editTmdbResults.length})`}
                      items={editTmdbResults}
                      selected={null}
                      getKey={item => String(item.id)}
                      getTitle={item => textValue(item.title) || textValue(item.name) || "Ukendt"}
                      getMeta={item => `${textValue(item.release_date).substring(0, 4) || textValue(item.first_air_date).substring(0, 4) || "-"} · ${item.media_type === "tv" ? "Tv-serie" : "Spillefilm"}`}
                      getPoster={item => textValue(item.poster_path) ? `${TMDB_IMG_W185}${textValue(item.poster_path)}` : null}
                      onSelect={applyTmdbToEdit}
                    />
                  </div>
                )}
                {importPreview && (
                  <DiffPanel
                    title={`${importPreview.source}-import ændrer ${importPreview.rows.length} felt${importPreview.rows.length === 1 ? "" : "er"}`}
                    rows={importPreview.rows}
                    emptyText="Importen ændrer ingen eksisterende felter."
                  />
                )}
              </InfoPanel>
            </div>
              );
            })()
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editingDeleteOpen} onOpenChange={setEditingDeleteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Slet værk</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Værket bliver arkiveret
              </div>
              <p>
                Du er ved at slette “{editing?.title ?? "værket"}”. Der er {editing?.contracts?.length ?? 0} kontrakt{(editing?.contracts?.length ?? 0) === 1 ? "" : "er"} tilknyttet værket.
              </p>
            </div>
            <p className="text-muted-foreground">
              Værket slettes ikke permanent. Det får status arkiveret og kan ses igen ved at vælge statusfilteret Arkiveret.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDeleteOpen(false)}>Annuller</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setEditingDeleteOpen(false);
                await handleSetEditingStatus("arkiveret");
              }}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Slet værk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={open => { setAddOpen(open); if (!open) { setPickedResult(null); setPickedSource(null); setLocalResults([]); } }}>
        <DialogContent className="max-h-[92vh] sm:max-w-5xl md:max-w-5xl lg:max-w-5xl xl:max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>Tilføj værk</DialogTitle></DialogHeader>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <InfoPanel title="Søg i lokal database, DFI og TMDB">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="Søg titel i lokal database, DFI og TMDB..."
                    value={addQuery}
                    onChange={e => setAddQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddSearch(); }}
                  />
                  <Button variant="outline" onClick={handleAddSearch} disabled={isSearchingAdd} className="gap-2">
                    {isSearchingAdd ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Søg
                  </Button>
                </div>
                {localResults.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-medium">Titlen findes allerede i databasen.</p>
                        <p className="mt-1 text-xs">Vælg det lokale værk, hvis det er samme titel. Hvis du vælger DFI eller TMDB i stedet, kan der opstå dubletter.</p>
                      </div>
                    </div>
                  </div>
                )}
                {(localResults.length > 0 || dfiResults.length > 0 || tmdbResults.length > 0) && (
                  <div className="grid gap-4 md:grid-cols-3">
                    <SearchColumn
                      title={`Lokal database (${localResults.length})`}
                      items={localResults}
                      selected={pickedSource === "local" ? pickedResult : null}
                      getKey={item => String(item.id)}
                      getTitle={item => textValue(item.title) || "Ukendt"}
                      getMeta={item => `${item.year || "-"} · ${textValue(item.type) || "-"}`}
                      getPoster={item => posterSrc(textValue(item.poster_url))}
                      onSelect={pickLocalResult}
                    />
                    <SearchColumn
                      title={`DFI (${dfiResults.length})`}
                      items={dfiResults}
                      selected={pickedSource === "dfi" ? pickedResult : null}
                      getKey={item => String(item.Id)}
                      getTitle={item => textValue(item.Title) || textValue(item.DanishTitle) || "Ukendt"}
                      getMeta={item => `${item.ProductionYear || item.ReleaseYear || "-"} · ${textValue(item.Category)}`}
                      onSelect={pickDfiResult}
                    />
                    <SearchColumn
                      title={`TMDB (${tmdbResults.length})`}
                      items={tmdbResults}
                      selected={pickedSource === "tmdb" ? pickedResult : null}
                      getKey={item => String(item.id)}
                      getTitle={item => textValue(item.title) || textValue(item.name) || "Ukendt"}
                      getMeta={item => `${textValue(item.release_date).substring(0, 4) || textValue(item.first_air_date).substring(0, 4) || "-"} · ${item.media_type === "tv" ? "Tv-serie" : "Spillefilm"}`}
                      getPoster={item => textValue(item.poster_path) ? `${TMDB_IMG_W185}${textValue(item.poster_path)}` : null}
                      onSelect={pickTmdbResult}
                    />
                  </div>
                )}
              </InfoPanel>

              <InfoPanel title="Manuel oprettelse eller valgte data">
                <div className="mb-2 flex gap-2">
                  <Button type="button" size="sm" variant={addSource === "manual" ? "default" : "outline"} onClick={() => { setAddSource("manual"); setPickedResult(null); setPickedSource(null); }}>
                    Manuel
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => { setAddForm(defaultAddForm()); setPickedResult(null); setPickedSource(null); setAddSource("manual"); }}>
                    Ryd
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Titel"><Input value={addForm.title} onChange={e => setAddForm({ ...addForm, title: e.target.value })} /></Field>
                  <Field label="Type">
                    <Select value={addForm.type} onValueChange={type => setAddForm({ ...addForm, type })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WORK_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="År"><Input value={addForm.year} onChange={e => setAddForm({ ...addForm, year: e.target.value })} /></Field>
                  <Field label="Varighed"><Input value={addForm.duration_minutes} onChange={e => setAddForm({ ...addForm, duration_minutes: e.target.value })} /></Field>
                  <Field label="Afsnit"><Input value={addForm.episode_count} onChange={e => setAddForm({ ...addForm, episode_count: e.target.value })} /></Field>
                  <Field label="Genre"><Input value={addForm.genre} onChange={e => setAddForm({ ...addForm, genre: e.target.value })} /></Field>
                  <Field label="Broadcast/stream">
                    <Select value={addForm.broadcaster} onValueChange={broadcaster => setAddForm({ ...addForm, broadcaster })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_BROADCASTER}>Ingen</SelectItem>
                        {broadcasterOptions.map(broadcaster => <SelectItem key={broadcaster} value={broadcaster}>{broadcaster}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </InfoPanel>
            </div>
            <div className="space-y-4">
              <InfoPanel title="Rettighedshaver og kreditering">
                <Field label="Rettighedshaver">
                  <Select value={addForm.rightsHolderId} onValueChange={rightsHolderId => setAddForm({ ...addForm, rightsHolderId })}>
                    <SelectTrigger><SelectValue placeholder="Vælg rettighedshaver" /></SelectTrigger>
                    <SelectContent>
                      {rightsHolders.map(rightsHolder => (
                        <SelectItem key={rightsHolder.id} value={rightsHolder.id}>{rightsHolder.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Kreditering">
                  <Select value={addForm.role} onValueChange={role => setAddForm({ ...addForm, role })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CREDIT_ROLES.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Andel %">
                  <Input inputMode="numeric" maxLength={3} className="w-20" value={addForm.sharePercent} onChange={e => setAddForm({ ...addForm, sharePercent: e.target.value })} />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Manuel oprettelse gemmer ikke poster-url. Poster hentes fra DFI eller TMDB og indtastes ikke manuelt.
                </p>
              </InfoPanel>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Annuller</Button>
            <Button onClick={handleCreateWork} disabled={saving || !addForm.title.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Tilføj værk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="sm:max-w-2xl md:max-w-2xl lg:max-w-2xl">
          <DialogHeader><DialogTitle>Arkiver valgte værker</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {selectedContracts.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  Der er kontrakter tilknyttet valgte værker
                </div>
                <div className="max-h-52 space-y-2 overflow-auto">
                  {selectedContracts.map(({ work, contract }) => (
                    <div key={`${work.id}-${contract.id}`} className="rounded bg-white/70 px-2 py-1">
                      {work.title}: {contract.rettighedshavere?.full_name ?? "Ukendt medlem"} · {contract.type ?? "kontrakt"} · {contract.status ?? "ukendt status"}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Værkerne slettes ikke permanent. De får status arkiveret, så historik og relationer bevares.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>Annuller</Button>
            <Button variant="destructive" onClick={handleArchive} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Arkiver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={duplicatesOpen} onOpenChange={setDuplicatesOpen}>
        <DialogContent className="sm:max-w-3xl md:max-w-3xl lg:max-w-3xl">
          <DialogHeader><DialogTitle>Find dubletter</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-auto">
            {duplicateGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ingen sandsynlige dubletter fundet.</p>
            ) : duplicateGroups.map((group, index) => (
              <div key={index} className="rounded-lg border p-3">
                <div className="mb-2 text-sm font-medium">Mulig dubletgruppe {index + 1}</div>
                <div className="space-y-2">
                  {group.map(work => (
                    <label key={work.id} className="flex items-center gap-3 rounded border px-3 py-2 text-sm">
                      <input type="checkbox" checked={selectedIds.includes(work.id)} onChange={() => toggleSelected(work.id)} className="h-4 w-4" />
                      <span className="font-medium">{work.title}</span>
                      <span className="text-muted-foreground">{work.year ?? "-"} · {workTypeLabel(work.type)}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicatesOpen(false)}>Luk</Button>
            <Button onClick={() => { setDuplicatesOpen(false); setMasterId(selectedIds[0] ?? ""); setMergeOpen(true); }} disabled={selectedIds.length < 2}>Flet valgte</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-2xl md:max-w-2xl lg:max-w-2xl">
          <DialogHeader><DialogTitle>Flet dubletter</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Field label="Vælg hovedværk">
              <Select value={masterId} onValueChange={setMasterId}>
                <SelectTrigger><SelectValue placeholder="Vælg hovedværk" /></SelectTrigger>
                <SelectContent>
                  {selectedWorks.map(work => (
                    <SelectItem key={work.id} value={work.id}>{work.title} ({work.year ?? "-"})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <p className="text-sm text-muted-foreground">
              Alle kontrakter og relationer fra de øvrige valgte værker flyttes til hovedværket. Dubletterne arkiveres bagefter.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>Annuller</Button>
            <Button onClick={handleMerge} disabled={saving || selectedIds.length < 2}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Flet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function DiffField({
  diff,
  children,
}: {
  diff?: { key: string; oldValue: unknown; newValue: unknown };
  children: React.ReactNode;
}) {
  return (
    <div className={diff ? "rounded-md border border-amber-300 bg-amber-50 p-2" : ""}>
      {children}
      {diff && (
        <div className="mt-2 grid gap-2 text-xs text-amber-900 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="font-medium text-amber-700">Gammel værdi</p>
            <p className="break-words">{formatDiffValue(diff.oldValue)}</p>
          </div>
          <div className="min-w-0">
            <p className="font-medium text-amber-700">Ny værdi</p>
            <p className="break-words font-semibold">{formatDiffValue(diff.newValue)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SortButton({ label, activeMark, onClick }: { label: string; activeMark: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-left font-medium hover:text-foreground">
      <span>{label}</span>
      <span className="w-3 text-xs text-muted-foreground">{activeMark}</span>
    </button>
  );
}

function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}

function DiffPanel({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: { key: string; oldValue: unknown; newValue: unknown }[];
  emptyText: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <div key={row.key} className="grid gap-2 rounded-md border px-3 py-2 text-sm md:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="font-medium">{FIELD_LABELS[row.key] ?? row.key}</div>
              <div>
                <div className="text-xs text-muted-foreground">Gammel værdi</div>
                <div className="break-words">{formatDiffValue(row.oldValue)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Ny værdi</div>
                <div className="break-words font-medium text-foreground">{formatDiffValue(row.newValue)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchColumn({
  title,
  items,
  selected,
  getKey,
  getTitle,
  getMeta,
  getPoster,
  onSelect,
}: {
  title: string;
  items: SearchResult[];
  selected: SearchResult | null;
  getKey: (item: SearchResult) => string;
  getTitle: (item: SearchResult) => string;
  getMeta: (item: SearchResult) => string;
  getPoster?: (item: SearchResult) => string | null;
  onSelect: (item: SearchResult) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="max-h-64 space-y-2 overflow-auto">
        {items.length === 0 ? (
          <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">Ingen resultater</p>
        ) : items.map(item => {
          const key = getKey(item);
          const isSelected = selected ? getKey(selected) === key : false;
          const poster = getPoster?.(item);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(item)}
              className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${isSelected ? "border-foreground bg-muted" : "hover:bg-muted"}`}
            >
              {poster && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={poster} alt={getTitle(item)} className="h-12 w-8 rounded object-cover" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-medium">{getTitle(item)}</span>
                <span className="block text-xs text-muted-foreground">{getMeta(item)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
