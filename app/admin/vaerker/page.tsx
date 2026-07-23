"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Film,
  GitMerge,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ActiveUserFilter } from "@/components/admin/active-user-filter";
import { MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view";
import { ContextualHelp, HelpButton } from "@/components/help/contextual-help";
import { MessageThread, type MessageThreadMessage } from "@/components/messages/message-thread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/data-skeletons";
import {
  archiveAdminWorks,
  approveAdminWorks,
  createAdminWork,
  deleteAdminWorkPermanently,
  deleteAdminWorksPermanently,
  fetchAdminBroadcasters,
  fetchAdminWorkDetail,
  fetchAdminSeasonEpisodes,
  fetchAdminRightsHolders,
  addAdminWorkRequestComment,
  fetchAdminWorksForReview,
  markAdminWorkMessagesReadByWorkIds,
  markWorkRequestCommentsRead,
  mergeAdminWorks,
  reviewWorkDataCorrection,
  syncAdminSeasonAssignments,
  updateAdminWorkData,
} from "@/app/actions/work-management";
import { getDFIFilmDetails, searchDFIFilms } from "@/app/actions/dfi";
import { resolveUnifiedSearchResultDetails, searchWorksUnified, type UnifiedSearchWorkResult } from "@/app/actions/member-works";
import { findTMDBPoster, getTMDBWorkDetails, searchTMDB } from "@/app/actions/tmdb";
import { extractDfiDirectors, extractDfiPosterUrl, extractDfiPremiereYear, mapDfiWorkType, type DfiMetadata, type DfiWorkType } from "@/lib/dfi-metadata";
import { useActiveRightsHolder } from "@/lib/use-active-rights-holder";
import { ResetFiltersButton } from "@/components/filters/reset-filters-button";
import { clearAdminMessageThread, deleteAdminMessage } from "@/app/actions/admin-messages";
import { SeriesEpisodeSelector } from "@/components/works/series-episode-selector";
import { SeasonStepper } from "@/components/works/season-stepper";
import { WORK_TYPES, WORK_TYPE_VALUES, workTypeLabel } from "@/lib/work-types";
import { buildCompleteEpisodeOptions } from "@/lib/series-episodes";

const TMDB_IMG_W185 = "https://image.tmdb.org/t/p/w185";


const CREDIT_ROLES = ["B-klipper", "Klipper", "Konceptuerende klipper"];
const BROADCASTERS = [
  "DR1",
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
type BroadcasterOption = { name: string; logo_path: string | null };
const FALLBACK_BROADCASTER_OPTIONS: BroadcasterOption[] = BROADCASTERS.map(name => ({ name, logo_path: null }));

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
  member_read_at?: string | null;
  admin_read_at?: string | null;
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
type WorkDistribution = {
  id?: string;
  broadcaster_name?: string | null;
  distribution_type: "tv" | "streaming" | "both";
  valid_from_year?: number | null;
  valid_to_year?: number | null;
  broadcasters?: { name?: string | null; logo_path?: string | null } | null;
};
type DistributionDraft = { broadcasterName: string; distributionType: "tv" | "streaming" | "both"; validFromYear: string; validToYear: string };
type SeasonCreditDraft = { rightsHolderId: string; name: string; role: string; episodes: number[] };

type WorkRow = {
  id: string;
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  season_count: number | null;
  episode_count: number | null;
  parent_work_id?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  genre: string | null;
  director: string | null;
  alternative_titles?: string[] | null;
  production_countries?: string[] | null;
  production_companies?: string[] | null;
  status: string;
  dfi_id: string | null;
  tmdb_id: string | number | null;
  imdb_id?: string | null;
  field_sources?: Record<string, string> | null;
  description: string | null;
  poster_url: string | null;
  dfi_title?: string | null;
  dfi_danish_title?: string | null;
  dfi_original_title?: string | null;
  dfi_category?: string | null;
  dfi_type?: string | null;
  dfi_metadata?: DfiMetadata | null;
  work_change_requests?: ChangeRequest[];
  contracts?: ContractLink[];
  work_assignments?: WorkAssignment[];
  work_production_numbers?: WorkProductionNumber[];
  work_distributions?: WorkDistribution[];
  is_season_group?: boolean;
  group_key?: string;
  child_work_ids?: string[];
  overview_pending_count?: number;
  overview_unread_count?: number;
  overview_contract_count?: number;
  overview_assigned_user_count?: number;
};

type WorkForm = {
  title: string;
  type: string;
  year: string;
  duration_minutes: string;
  season_count: string;
  episode_count: string;
  season_number: string;
  episode_number: string;
  genre: string;
  director: string;
  alternative_titles: string;
  production_countries: string;
  production_companies: string;
  description: string;
  dfi_id: string;
  tmdb_id: string;
  imdb_id: string;
  field_sources: Record<string, string>;
  poster_url: string;
  dfi_title: string;
  dfi_danish_title: string;
  dfi_original_title: string;
  dfi_category: string;
  dfi_type: string;
  status: string;
  broadcaster: string;
  dfi_metadata?: DfiMetadata | null;
};

type AddWorkForm = {
  title: string;
  type: string;
  year: string;
  duration_minutes: string;
  season_count: string;
  episode_count: string;
  genre: string;
  director: string;
  alternative_titles: string;
  production_countries: string;
  production_companies: string;
  description: string;
  dfi_id: string;
  tmdb_id: string;
  imdb_id: string;
  poster_url: string;
  status: string;
  dfi_title: string;
  dfi_danish_title: string;
  dfi_original_title: string;
  dfi_category: string;
  dfi_type: string;
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
  season_count: number | null;
  episode_count: number | null;
  genre: string | null;
  director: string | null;
  alternative_titles: string[];
  production_countries: string[];
  production_companies: string[];
  dfi_title: string | null;
  dfi_danish_title: string | null;
  dfi_original_title: string | null;
  dfi_category: string | null;
  dfi_type: string | null;
  description: string | null;
  dfi_id: string | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  field_sources: Record<string, string>;
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
  arkiveret: "border-border bg-muted text-muted-foreground",
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
  return (work.overview_pending_count ?? 0) > 0 || (work.work_change_requests ?? []).some(request => request.status === "pending");
}

function unreadMemberMessageCount(work: WorkRow) {
  return work.overview_unread_count ?? (work.work_change_requests ?? []).reduce((sum, request) =>
    sum + (request.work_change_request_comments ?? []).filter(
      comment => comment.author_role === "member" && !comment.admin_read_at
    ).length, 0);
}

// Seneste ulæste medlems-besked på et værk (til liste-preview).
function latestUnreadMemberMessage(work: WorkRow): string | null {
  const unread = (work.work_change_requests ?? [])
    .flatMap(request => request.work_change_request_comments ?? [])
    .filter(comment => comment.author_role === "member" && !comment.admin_read_at)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const last = unread[unread.length - 1];
  return last ? last.message.split("\n")[0] : null;
}

function requestMessages(request: ChangeRequest | null): MessageThreadMessage[] {
  return (request?.work_change_request_comments ?? []).map(comment => ({
    id: comment.id,
    authorRole: comment.author_role,
    message: comment.message,
    createdAt: comment.created_at,
    memberReadAt: comment.member_read_at,
    adminReadAt: comment.admin_read_at,
  }));
}

function requestNextActionLabel(request: ChangeRequest | null) {
  if (!request) return null;
  const latest = requestMessages(request).at(-1);
  if (request.status === "approved") return "Godkendt og afsluttet";
  if (request.status === "rejected") return "Afvist og afsluttet";
  if (latest?.authorRole === "member" && !latest.adminReadAt) return "Kræver svar fra DFKS";
  if (latest?.authorRole === "admin") return "Afventer bruger";
  return "Afventer DFKS-behandling";
}

function requestNextActionTone(request: ChangeRequest | null): "neutral" | "attention" | "done" {
  if (!request) return "neutral";
  if (request.status === "approved" || request.status === "rejected") return "done";
  const latest = requestMessages(request).at(-1);
  if (latest?.authorRole === "member" && !latest.adminReadAt) return "attention";
  return "neutral";
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
  if (proposed.kind === "message") return "Besked";
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
  year: "Premiereår",
  duration_minutes: "Varighed",
  season_count: "Sæson",
  episode_count: "Afsnit",
  genre: "Genre",
  director: "Instruktør",
  alternative_titles: "Alternative titler",
  production_countries: "Produktionslande",
  production_companies: "Produktionsselskaber",
  description: "Beskrivelse",
  dfi_id: "DFI-id",
  tmdb_id: "TMDB-id",
  poster_url: "Poster-url",
  dfi_original_title: "Arbejdstitel",
  status: "Status",
  memberRole: "Medlemsrolle",
};

const DIFF_KEYS = [
  "title",
  "type",
  "year",
  "duration_minutes",
  "season_count",
  "episode_count",
  "genre",
  "director",
  "alternative_titles",
  "production_countries",
  "production_companies",
  "dfi_id",
  "tmdb_id",
  "dfi_original_title",
];

function isSeriesType(type: string) {
  return type === "tv-serie" || type === "dokumentar-serie";
}

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
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "boolean") return value ? "Ja" : "Nej";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function comparableValue(value: unknown) {
  // Normaliser til en sammenlignelig repræsentation, så uændrede felter (især arrays
  // og tal-vs-streng) ikke fejlagtigt markeres som ændringer.
  if (Array.isArray(value)) return JSON.stringify(value.map(v => String(v).trim()).filter(Boolean).sort());
  if (value === undefined || value === "" || value === null) return null;
  return typeof value === "number" ? String(value) : value;
}

function requestDiffRows(request: ChangeRequest) {
  const proposed = request.proposed_data ?? {};
  // Kun reelle data-redigeringer markerer felter. Beskeder og medklipper-requests
  // ændrer ikke værksdata, så de skal ikke markere noget.
  if (proposed.kind === "message" || proposed.kind === "co_editors") return [];
  const workData = typeof proposed.workData === "object" && proposed.workData ? proposed.workData as Record<string, unknown> : proposed;

  // Ved rettelser er old_data et snapshot af værket. Ved oprettelser er old_data tom,
  // så vi sammenligner i stedet med det matchede eksisterende værk (localMatch) —
  // ellers markeres alle felter (også dem der er identiske) som ændringer.
  const storedOld = request.old_data ?? {};
  const localMatch = Array.isArray(proposed.localMatches) && proposed.localMatches.length
    ? proposed.localMatches[0] as Record<string, unknown>
    : {};
  const baseline = Object.keys(storedOld).length > 0 ? storedOld : localMatch;

  return DIFF_KEYS
    .filter(key => Object.prototype.hasOwnProperty.call(workData, key))
    .map(key => ({ key, oldValue: baseline[key], newValue: workData[key] }))
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
  const distributions = (work.work_distributions ?? [])
    .map(item => item.broadcasters?.name ?? item.broadcaster_name)
    .filter((name): name is string => Boolean(name));
  if (distributions.length > 0) return distributions.join(", ");
  return (work.work_production_numbers ?? []).find(item => item.number === BROADCAST_STREAM_NUMBER)?.tv_station
    ?? (work.work_production_numbers ?? [])[0]?.tv_station
    ?? null;
}

function posterSrc(posterUrl: string | null | undefined) {
  if (!posterUrl) return null;
  return posterUrl.startsWith("http") || posterUrl.startsWith("data:image/")
    ? posterUrl
    : `${TMDB_IMG_W185}${posterUrl}`;
}

function splitList(value: string) {
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function joinList(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function toForm(work: WorkRow): WorkForm {
  return {
    title: work.title ?? "",
    type: work.type ?? "",
    year: work.year?.toString() ?? "",
    duration_minutes: work.duration_minutes?.toString() ?? "",
    season_count: work.season_count?.toString() ?? "",
    episode_count: work.episode_count?.toString() ?? "",
    season_number: work.season_number?.toString() ?? "",
    episode_number: work.episode_number?.toString() ?? "",
    genre: work.genre ?? "",
    director: work.director ?? "",
    alternative_titles: joinList(work.alternative_titles),
    production_countries: joinList(work.production_countries),
    production_companies: joinList(work.production_companies),
    description: work.description ?? "",
    dfi_id: work.dfi_id ?? "",
    tmdb_id: work.tmdb_id?.toString() ?? "",
    imdb_id: work.imdb_id ?? "",
    field_sources: work.field_sources ?? {},
    poster_url: work.poster_url ?? "",
    dfi_title: work.dfi_title ?? textValue(work.dfi_metadata?.Title),
    dfi_danish_title: work.dfi_danish_title ?? textValue(work.dfi_metadata?.DanishTitle),
    dfi_original_title: work.dfi_original_title ?? textValue(work.dfi_metadata?.OriginalTitle),
    dfi_category: work.dfi_category ?? textValue(work.dfi_metadata?.Category),
    dfi_type: work.dfi_type ?? textValue(work.dfi_metadata?.Type),
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

function nonEmptyText(value: unknown) {
  const text = textValue(value).trim();
  return text ? text : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== null) return number;
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function dfiTextList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return nonEmptyText(record.Name) ?? nonEmptyText(record.Title) ?? nonEmptyText(record.Country) ?? "";
        }
        return "";
      })
      .filter(Boolean);
  }
  const text = nonEmptyText(value);
  return text ? [text] : [];
}

function mergeLists(...lists: string[][]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const normalized = item.trim();
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      merged.push(normalized);
    }
  }
  return merged;
}

function dfiProductionCompanies(metadata: SearchResult) {
  return dfiTextList(metadata.ProductionCompanies);
}

function dfiProductionCountries(metadata: SearchResult) {
  return dfiTextList(metadata.ProductionCountries);
}

function dfiAlternativeTitles(metadata: SearchResult) {
  return mergeLists(
    dfiTextList(metadata.AltTitle),
    dfiTextList(metadata.ForeignTitles)
  );
}

function dfiFieldValues(metadata: SearchResult) {
  return {
    dfi_title: textValue(metadata.Title),
    dfi_danish_title: textValue(metadata.DanishTitle),
    dfi_original_title: textValue(metadata.OriginalTitle),
    dfi_category: textValue(metadata.Category),
    dfi_type: textValue(metadata.Type),
  };
}

function dfiDirector(metadata: SearchResult) {
  return extractDfiDirectors(metadata).join(", ");
}

function resultYear(item: SearchResult) {
  const dateYear = textValue(item.release_date).substring(0, 4) || textValue(item.first_air_date).substring(0, 4);
  const year = extractDfiPremiereYear(item) ?? Number(dateYear || 0);
  return Number.isFinite(year) ? year : 0;
}

function newestFirst<T extends SearchResult>(items: T[]) {
  return [...items].sort((a, b) => resultYear(b) - resultYear(a));
}

function notifyWorksUpdated() {
  window.dispatchEvent(new Event("works-updated"));
}


function defaultAddForm(): AddWorkForm {
  return {
    title: "",
    type: "spillefilm",
    year: "",
    duration_minutes: "",
    season_count: "",
    episode_count: "",
    genre: "",
    director: "",
    alternative_titles: "",
    production_countries: "",
    production_companies: "",
    description: "",
    dfi_id: "",
    tmdb_id: "",
    imdb_id: "",
    poster_url: "",
    status: "godkendt",
    dfi_title: "",
    dfi_danish_title: "",
    dfi_original_title: "",
    dfi_category: "",
    dfi_type: "",
    rightsHolderId: "",
    role: "Klipper",
    sharePercent: "",
    broadcaster: NO_BROADCASTER,
  };
}

function toDistributionDrafts(work: WorkRow): DistributionDraft[] {
  if ((work.work_distributions ?? []).length > 0) {
    return (work.work_distributions ?? []).map(item => ({
      broadcasterName: item.broadcasters?.name ?? item.broadcaster_name ?? "",
      distributionType: item.distribution_type ?? "both",
      validFromYear: item.valid_from_year == null ? "" : String(item.valid_from_year),
      validToYear: item.valid_to_year == null ? "" : String(item.valid_to_year),
    }));
  }
  const legacy = getWorkBroadcaster(work);
  return legacy ? [{ broadcasterName: legacy, distributionType: "both", validFromYear: "", validToYear: "" }] : [];
}

function distributionPayload(items: DistributionDraft[]) {
  return items.filter(item => item.broadcasterName).map(item => ({
    broadcasterName: item.broadcasterName,
    distributionType: item.distributionType,
    validFromYear: nullableNumber(item.validFromYear),
    validToYear: nullableNumber(item.validToYear),
  }));
}

export default function VaerksadministrationPage() {
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [rightsHolders, setRightsHolders] = useState<RightsHolder[]>([]);
  const [broadcasterOptions, setBroadcasterOptions] = useState<BroadcasterOption[]>(FALLBACK_BROADCASTER_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<WorkRow | null>(null);
  const [editForm, setEditForm] = useState<WorkForm | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [adminComment, setAdminComment] = useState("");
  // Admin-redigering af antal afsnit + hvilke afsnit medlemmet krediteres på (ved serie-rettelse)
  const [reviewEpisodeCount, setReviewEpisodeCount] = useState<string>("");
  const [reviewEpisodes, setReviewEpisodes] = useState<number[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editingDeleteOpen, setEditingDeleteOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [editingArchiveOpen, setEditingArchiveOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addTypeFilter, setAddTypeFilter] = useState("all");
  const [addForm, setAddForm] = useState<AddWorkForm>(defaultAddForm);
  const [addManualMode, setAddManualMode] = useState(false);
  const [addAssignments, setAddAssignments] = useState<AssignmentDraft[]>([]);
  const [addDistributions, setAddDistributions] = useState<DistributionDraft[]>([]);
  const [editDistributions, setEditDistributions] = useState<DistributionDraft[]>([]);
  const [addForceExternalSearch, setAddForceExternalSearch] = useState(false);
  const [unifiedAddResults, setUnifiedAddResults] = useState<UnifiedSearchWorkResult[]>([]);
  const [pickedUnifiedAddResult, setPickedUnifiedAddResult] = useState<UnifiedSearchWorkResult | null>(null);
  const [pickedResult, setPickedResult] = useState<SearchResult | null>(null);
  const [pickedSource, setPickedSource] = useState<"local" | "dfi" | "tmdb" | null>(null);
  const [addSeasonNumber, setAddSeasonNumber] = useState("1");
  const [addEpisodeOptions, setAddEpisodeOptions] = useState<Array<{ number: number; title: string }>>([]);
  const [addEpisodesLoading, setAddEpisodesLoading] = useState(false);
  const [addEpisodesError, setAddEpisodesError] = useState<string | null>(null);
  const [addSelectedEpisodes, setAddSelectedEpisodes] = useState<number[]>([]);
  const [isSearchingAdd, setIsSearchingAdd] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, AssignmentDraft>>({});
  const [newAssignment, setNewAssignment] = useState<AssignmentDraft>({ rightsHolderId: "", role: "Klipper", sharePercent: "" });
  const [importPreview, setImportPreview] = useState<{ source: "DFI" | "TMDB"; rows: { key: string; oldValue: unknown; newValue: unknown }[] } | null>(null);
  const [editLookupQuery, setEditLookupQuery] = useState("");
  const [editDfiResults, setEditDfiResults] = useState<SearchResult[]>([]);
  const [editTmdbResults, setEditTmdbResults] = useState<SearchResult[]>([]);
  const [editUnifiedResults, setEditUnifiedResults] = useState<UnifiedSearchWorkResult[]>([]);
  const [isSearchingEdit, setIsSearchingEdit] = useState(false);
  const [masterId, setMasterId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedSeasons, setExpandedSeasons] = useState<Set<string>>(new Set());
  const [seasonEpisodes, setSeasonEpisodes] = useState<Record<string, WorkRow[]>>({});
  const [loadingSeasons, setLoadingSeasons] = useState<Set<string>>(new Set());
  const [seasonErrors, setSeasonErrors] = useState<Record<string, string>>({});
  const [editingSeasonGroup, setEditingSeasonGroup] = useState<WorkRow | null>(null);
  const [editingSeasonEpisodes, setEditingSeasonEpisodes] = useState<WorkRow[]>([]);
  const [seasonCreditDrafts, setSeasonCreditDrafts] = useState<Record<string, SeasonCreditDraft>>({});
  const { activeRh, setActiveRh } = useActiveRightsHolder();

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchAdminWorksForReview();
      if (res.success) setWorks(res.works as unknown as WorkRow[]);

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
          setBroadcasterOptions(broadcastersRes.broadcasters as BroadcasterOption[]);
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingSeasonGroup) {
          setEditingSeasonGroup(null);
        } else if (editing) {
          setEditing(null);
        } else if (addOpen) {
          setAddOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingSeasonGroup, editing, addOpen]);

  useEffect(() => {
    load();
  }, []);

  const editParamHandled = useRef(false);
  const rhParamHandled = useRef(false);
  // Deep-link: ?edit=<id> åbner Rediger værk automatisk (fx fra rettighedshaver-siden)
  useEffect(() => {
    if (editParamHandled.current || works.length === 0) return;
    const editId = new URLSearchParams(window.location.search).get("edit");
    if (!editId) return;
    const work = works.find(w => w.id === editId);
    editParamHandled.current = true;
    if (work) {
      openEdit(work);
      window.history.replaceState(null, "", "/admin/vaerker");
      return;
    }
    void fetchAdminWorkDetail(editId).then(result => {
      if (result.success && result.work) openEdit(result.work as WorkRow);
      else setNotice(result.error ?? "Værket blev ikke fundet.");
      window.history.replaceState(null, "", "/admin/vaerker");
    });
  }, [works]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (rhParamHandled.current || rightsHolders.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const rhId = params.get("rh");
    if (!rhId) return;
    const rh = rightsHolders.find(x => x.id === rhId);
    if (!rh) return;
    rhParamHandled.current = true;
    setActiveRh({ id: rh.id, name: rh.full_name });
    params.delete("rh");
    const next = params.toString();
    window.history.replaceState(null, "", next ? `/admin/vaerker?${next}` : "/admin/vaerker");
  }, [rightsHolders, setActiveRh]);

  // Forudfyld antal afsnit + valgte afsnit fra den aktive rettelse (medlemmets myEpisodes)
  useEffect(() => {
    const req = (editing?.work_change_requests ?? []).find(r => r.id === activeRequestId);
    const proposed = (req?.proposed_data ?? {}) as Record<string, unknown>;
    const ec = proposed.episode_count ?? editing?.episode_count ?? "";
    setReviewEpisodeCount(ec != null && ec !== "" ? String(ec) : "");
    setReviewEpisodes(Array.isArray(proposed.myEpisodes) ? (proposed.myEpisodes as number[]) : []);
  }, [activeRequestId, editing]);

  const broadcasterLogoMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const broadcaster of broadcasterOptions) {
      if (broadcaster.name && broadcaster.logo_path) map[broadcaster.name] = broadcaster.logo_path;
    }
    return map;
  }, [broadcasterOptions]);

  const filtered = useMemo(() => {
    let list = [...works];
    if (activeRh) list = list.filter(work =>
      work.work_assignments?.some(assignment => assignment.rettighedshavere?.id === activeRh.id)
    );
    if (filterStatus === "beskeder") list = list.filter(work => unreadMemberMessageCount(work) > 0);
    else if (filterStatus !== "all") list = list.filter(work => displayStatus(work) === filterStatus);
    if (filterType !== "all") list = list.filter(work => work.type === filterType);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(work =>
        work.title?.toLowerCase().includes(q) ||
        work.type?.toLowerCase().includes(q) ||
        String(work.year ?? "").includes(q) ||
        work.dfi_id?.toLowerCase().includes(q) ||
        String(work.tmdb_id ?? "").includes(q) ||
        (getWorkBroadcaster(work) ?? "").toLowerCase().includes(q) ||
        work.work_assignments?.some(assignment =>
          assignment.rettighedshavere?.full_name?.toLowerCase().includes(q)
        )
      );
    }
    list.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "year") return ((a.year ?? 0) - (b.year ?? 0)) * direction;

      const values: Record<Exclude<SortKey, "year">, [string, string]> = {
        title: [a.title ?? "", b.title ?? ""],
        type: [workTypeLabel(a.type), workTypeLabel(b.type)],
        data: [
          `${a.dfi_id ?? ""} ${a.tmdb_id ?? ""} ${a.duration_minutes ?? ""} ${a.season_count ?? ""} ${a.episode_count ?? ""}`,
          `${b.dfi_id ?? ""} ${b.tmdb_id ?? ""} ${b.duration_minutes ?? ""} ${b.season_count ?? ""} ${b.episode_count ?? ""}`,
        ],
        broadcaster: [getWorkBroadcaster(a) ?? "", getWorkBroadcaster(b) ?? ""],
        status: [statusSortValue(a), statusSortValue(b)],
      };
      const [left, right] = values[sortKey];
      return left.localeCompare(right, "da-DK", { numeric: true, sensitivity: "base" }) * direction;
    });
    return list;
  }, [works, activeRh, filterStatus, filterType, search, sortKey, sortDir]);
  const visibleWorks = filtered.slice(0, pageSize);

  const stats = useMemo(() => {
    const activeWorks = works.filter(work => displayStatus(work) !== "arkiveret");
    const total = activeWorks.reduce((sum, work) => sum + (work.is_season_group ? work.episode_count ?? 0 : 1), 0);
    const withContract = activeWorks.reduce((sum, work) => sum + (work.is_season_group ? work.overview_contract_count ?? 0 : (work.contracts ?? []).length > 0 ? 1 : 0), 0);
    return {
      total,
      withContract,
      missingContract: Math.max(total - withContract, 0),
    };
  }, [works]);

  const selectionIdsForWork = (work: WorkRow) => work.is_season_group ? work.child_work_ids ?? [] : [work.id];
  const selectedWorks = useMemo(
    () => works.filter(work => selectionIdsForWork(work).some(id => selectedIds.includes(id))),
    [works, selectedIds]
  );
  const hasSelectedSeason = selectedWorks.some(work => work.is_season_group);

  const selectedContracts = useMemo(
    () => selectedWorks.flatMap(work => (work.contracts ?? []).map(contract => ({ work, contract }))),
    [selectedWorks]
  );

  const totalAssignments = useMemo(
    () => selectedWorks.reduce((acc, work) => acc + (work.work_assignments?.length ?? 0), 0),
    [selectedWorks]
  );

  const totalContracts = useMemo(
    () => selectedWorks.reduce((acc, work) => acc + (work.contracts?.length ?? 0), 0),
    [selectedWorks]
  );

  const duplicateGroups = useMemo(() => {
    const candidates = works.filter(work =>
      displayStatus(work) !== "arkiveret" &&
      !work.parent_work_id &&
      work.episode_number == null
    );
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

  const toggleWorkSelection = (work: WorkRow) => {
    const ids = selectionIdsForWork(work);
    const allSelected = ids.length > 0 && ids.every(id => selectedIds.includes(id));
    setSelectedIds(prev => allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  };

  const filteredIds = [...new Set(filtered.flatMap(selectionIdsForWork))];
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.includes(id));

  const toggleAllFiltered = () => {
    setSelectedIds(prev => allFilteredSelected
      ? prev.filter(id => !filteredIds.includes(id))
      : [...new Set([...prev, ...filteredIds])]
    );
  };

  const loadAdminSeason = async (work: WorkRow, force = false) => {
    if (!work.is_season_group || !work.parent_work_id || work.season_number == null) return;
    const key = work.group_key ?? work.id;
    if ((!force && seasonEpisodes[key]) || loadingSeasons.has(key)) return;
    setLoadingSeasons(prev => new Set(prev).add(key));
    setSeasonErrors(prev => { const next = { ...prev }; delete next[key]; return next; });
    const result = await fetchAdminSeasonEpisodes({ parentWorkId: work.parent_work_id, seasonNumber: work.season_number });
    if (result.success) setSeasonEpisodes(prev => ({ ...prev, [key]: result.works as unknown as WorkRow[] }));
    else setSeasonErrors(prev => ({ ...prev, [key]: result.error ?? "Kunne ikke hente sæsonens afsnit." }));
    setLoadingSeasons(prev => { const next = new Set(prev); next.delete(key); return next; });
  };

  const toggleAdminSeason = (work: WorkRow) => {
    if (!work.is_season_group) return;
    const key = work.group_key ?? work.id;
    const isOpen = expandedSeasons.has(key);
    setExpandedSeasons(prev => {
      const next = new Set(prev);
      if (isOpen) next.delete(key); else next.add(key);
      return next;
    });
    if (!isOpen) void loadAdminSeason(work);
  };

  const refreshSeasonContaining = async (work: WorkRow | null | undefined) => {
    if (!work?.parent_work_id || work.season_number == null) return;
    const group = works.find(item => item.is_season_group && item.parent_work_id === work.parent_work_id && item.season_number === work.season_number);
    if (group && expandedSeasons.has(group.group_key ?? group.id)) await loadAdminSeason(group, true);
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

  const markWorkMessagesRead = async (work: WorkRow) => {
    const unreadRequestIds = (work.work_change_requests ?? [])
      .filter(request => (request.work_change_request_comments ?? []).some(c => c.author_role === "member" && !c.admin_read_at))
      .map(request => request.id);
    if (unreadRequestIds.length === 0) return;
    const now = new Date().toISOString();
    const patch = (w: WorkRow): WorkRow => ({
      ...w,
      work_change_requests: (w.work_change_requests ?? []).map(request =>
        unreadRequestIds.includes(request.id)
          ? {
              ...request,
              work_change_request_comments: (request.work_change_request_comments ?? []).map(c =>
                c.author_role === "member" && !c.admin_read_at ? { ...c, admin_read_at: now } : c
              ),
            }
          : request
      ),
    });
    setWorks(prev => prev.map(w => (w.id === work.id ? patch(w) : w)));
    setEditing(prev => (prev && prev.id === work.id ? patch(prev) : prev));
    const results = await Promise.all(unreadRequestIds.map(id => markWorkRequestCommentsRead(id, "admin")));
    if (results.some(r => r.success)) notifyWorksUpdated();
  };

  const openEdit = async (work: WorkRow) => {
    setEditingSeasonGroup(null);
    setEditingSeasonEpisodes([]);
    setSeasonCreditDrafts({});
    // Auto-åbn KUN en request med en ulæst besked (så nye beskeder ses).
    // Allerede sete/godkendte rettelser popper ikke op — dem klikker man selv på.
    const requestWithUnread = (work.work_change_requests ?? []).find(request =>
      (request.work_change_request_comments ?? []).some(c => c.author_role === "member" && !c.admin_read_at)
    ) ?? null;
    void markWorkMessagesRead(work);
    setEditing(work);
    setEditForm(toForm(work));
    setEditDistributions(toDistributionDrafts(work));
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
    setActiveRequestId(requestWithUnread?.id ?? null);
    setAdminComment("");
    setImportPreview(null);
    setEditLookupQuery(work.title ?? "");
    setEditDfiResults([]);
    setEditTmdbResults([]);

    const detail = await fetchAdminWorkDetail(work.id);
    if (!detail.success || !detail.work) return;
    const detailedWork = detail.work as WorkRow;
    const detailedRequestWithUnread = (detailedWork.work_change_requests ?? []).find(request =>
      (request.work_change_request_comments ?? []).some(c => c.author_role === "member" && !c.admin_read_at)
    ) ?? null;
    setWorks(prev => prev.map(item => item.id === work.id ? detailedWork : item));
    setEditing(detailedWork);
    setEditForm(toForm(detailedWork));
    setEditDistributions(toDistributionDrafts(detailedWork));
    setAssignmentDrafts(Object.fromEntries((detailedWork.work_assignments ?? []).map(assignment => [
      assignment.id,
      {
        id: assignment.id,
        rightsHolderId: assignment.rettighedshavere?.id,
        role: displayCreditRole(assignment.role),
        sharePercent: assignment.share_percent === null || assignment.share_percent === undefined ? "" : String(assignment.share_percent),
      },
    ])));
    setActiveRequestId(detailedRequestWithUnread?.id ?? requestWithUnread?.id ?? null);
    setEditLookupQuery(detailedWork.title ?? "");
  };

  const openAdminSeasonEdit = async (group: WorkRow) => {
    if (!group.is_season_group || !group.parent_work_id || group.season_number == null) return;
    setSaving(true);
    try {
      const [parentResult, episodesResult] = await Promise.all([
        fetchAdminWorkDetail(group.parent_work_id),
        fetchAdminSeasonEpisodes({ parentWorkId: group.parent_work_id, seasonNumber: group.season_number }),
      ]);
      if (!parentResult.success || !parentResult.work) throw new Error(parentResult.error ?? "Serien blev ikke fundet.");
      if (!episodesResult.success) throw new Error(episodesResult.error ?? "Sæsonens afsnit kunne ikke hentes.");
      const parent = parentResult.work as WorkRow;
      const episodes = episodesResult.works as unknown as WorkRow[];
      const credits = new Map<string, SeasonCreditDraft>();
      for (const episode of episodes) {
        for (const assignment of episode.work_assignments ?? []) {
          const holderId = assignment.rettighedshavere?.id;
          if (!holderId || episode.episode_number == null) continue;
          const existing = credits.get(holderId) ?? {
            rightsHolderId: holderId,
            name: assignment.rettighedshavere?.full_name ?? "Ukendt rettighedshaver",
            role: displayCreditRole(assignment.role),
            episodes: [],
          };
          if (!existing.episodes.includes(episode.episode_number)) existing.episodes.push(episode.episode_number);
          credits.set(holderId, existing);
        }
      }
      for (const credit of credits.values()) credit.episodes.sort((a, b) => a - b);
      setEditingSeasonGroup(group);
      setEditingSeasonEpisodes(episodes);
      setSeasonCreditDrafts(Object.fromEntries(credits));
      setEditing(parent);
      setEditForm(toForm(parent));
      setEditDistributions(toDistributionDrafts(parent));
      setAssignmentDrafts({});
      setNewAssignment({ rightsHolderId: "", role: "Klipper", sharePercent: "" });
      setActiveRequestId(null);
      setAdminComment("");
      setImportPreview(null);
      setEditLookupQuery(parent.title ?? "");
      setEditUnifiedResults([]);
    } catch (error: unknown) {
      setNotice(errorMessage(error, "Sæsonen kunne ikke åbnes."));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWork = async () => {
    if (!editing || !editForm) return;
    const savedWork = editing;
    const savedSeasonGroup = editingSeasonGroup;
    setSaving(true);
    try {
      await updateAdminWorkData({
        workId: editing.id,
        data: {
          title: editForm.title,
          type: editForm.type,
          year: nullableNumber(editForm.year),
          duration_minutes: nullableNumber(editForm.duration_minutes),
          season_count: nullableNumber(editForm.season_count),
          episode_count: nullableNumber(editForm.episode_count),
          season_number: nullableNumber(editForm.season_number),
          episode_number: nullableNumber(editForm.episode_number),
          genre: editForm.genre || null,
          director: editForm.director || null,
          alternative_titles: splitList(editForm.alternative_titles),
          production_countries: splitList(editForm.production_countries),
          production_companies: splitList(editForm.production_companies),
          description: editForm.description || null,
          dfi_id: editForm.dfi_id || null,
          tmdb_id: nullableNumber(editForm.tmdb_id),
          imdb_id: editForm.imdb_id || null,
          field_sources: editForm.field_sources,
          poster_url: editForm.poster_url || null,
          dfi_title: editForm.dfi_title || null,
          dfi_danish_title: editForm.dfi_danish_title || null,
          dfi_original_title: editForm.dfi_original_title || null,
          dfi_category: editForm.dfi_category || null,
          dfi_type: editForm.dfi_type || null,
          status: editForm.status === "arkiveret" ? "godkendt" : editForm.status,
          dfi_metadata: editForm.dfi_metadata || null,
        },
        distributions: distributionPayload(editDistributions),
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
      if (editingSeasonGroup?.parent_work_id && editingSeasonGroup.season_number != null) {
        await syncAdminSeasonAssignments({
          parentWorkId: editingSeasonGroup.parent_work_id,
          seasonNumber: editingSeasonGroup.season_number,
          credits: Object.values(seasonCreditDrafts).map(credit => ({
            rightsHolderId: credit.rightsHolderId,
            role: credit.role,
            episodes: credit.episodes,
          })),
        });
      }
      setNotice("Værket er gemt.");
      setEditing(null);
      setEditForm(null);
      setActiveRequestId(null);
      setImportPreview(null);
      setEditingSeasonGroup(null);
      setEditingSeasonEpisodes([]);
      setSeasonCreditDrafts({});
      await load();
      if (savedSeasonGroup) await loadAdminSeason(savedSeasonGroup, true);
      else await refreshSeasonContaining(savedWork);
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke gemme værket."));
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async (decision: "approved" | "rejected", requestId?: string) => {
    const reviewedRequestId = requestId ?? activeRequestId;
    if (!reviewedRequestId) return;
    const editingWorkId = editing?.id;
    setSaving(true);
    try {
      await reviewWorkDataCorrection({
        requestId: reviewedRequestId,
        decision,
        comment: adminComment,
        episodeCountOverride: reviewEpisodeCount ? Number(reviewEpisodeCount) : null,
        myEpisodesOverride: reviewEpisodes,
      });
      setNotice(decision === "approved" ? "Rettelsen er godkendt." : "Rettelsen er afvist.");
      setAdminComment("");
      const res = await fetchAdminWorksForReview();
      if (res.success) {
        const freshWorks = res.works as unknown as WorkRow[];
        setWorks(freshWorks);
        const updatedEditing = freshWorks.find(work => work.id === editingWorkId) ?? null;
        if (decision !== "approved" && updatedEditing) {
          setEditing(updatedEditing);
          setEditForm(toForm(updatedEditing));
          setAssignmentDrafts(Object.fromEntries((updatedEditing.work_assignments ?? []).map(assignment => [
            assignment.id,
            {
              id: assignment.id,
              rightsHolderId: assignment.rettighedshavere?.id,
              role: displayCreditRole(assignment.role),
              sharePercent: assignment.share_percent === null || assignment.share_percent === undefined ? "" : String(assignment.share_percent),
            },
          ])));
        }
      }
      setActiveRequestId(null);
      if (decision === "approved") {
        setEditing(null);
        setEditForm(null);
        setImportPreview(null);
      }
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke behandle rettelsen."));
    } finally {
      setSaving(false);
    }
  };

  const handleSendReply = async () => {
    if (!activeRequestId || !adminComment.trim()) return;
    const editingWorkId = editing?.id;
    setSaving(true);
    try {
      await addAdminWorkRequestComment({ requestId: activeRequestId, message: adminComment });
      setAdminComment("");
      const res = await fetchAdminWorksForReview();
      if (res.success) {
        const freshWorks = res.works as unknown as WorkRow[];
        setWorks(freshWorks);
        const updatedEditing = freshWorks.find(work => work.id === editingWorkId) ?? null;
        if (updatedEditing) setEditing(updatedEditing);
      }
      setNotice("Svar sendt til bruger.");
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke sende svar."));
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
      const result = await approveAdminWorks({ workIds: selectedIds });
      setNotice(
        `${result.approvedWorks} værk(er) og ${result.approvedRequests} oprettelsesanmodning(er) er godkendt.`
        + (result.skippedWorks ? ` ${result.skippedWorks} værk(er) kræver individuel gennemgang.` : "")
      );
      setSelectedIds([]);
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke godkende værker."));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkSelectedMessagesRead = async () => {
    setSaving(true);
    try {
      const result = await markAdminWorkMessagesReadByWorkIds({ workIds: selectedIds });
      if (!result.success) throw new Error(result.error);
      setNotice(result.updated > 0 ? `${result.updated} besked(er) markeret som læst.` : "Ingen ulæste beskeder blandt de valgte.");
      setSelectedIds([]);
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke markere beskeder læst."));
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
          season_count: nullableNumber(editForm.season_count),
          episode_count: nullableNumber(editForm.episode_count),
          genre: editForm.genre || null,
          director: editForm.director || null,
          alternative_titles: splitList(editForm.alternative_titles),
          production_countries: splitList(editForm.production_countries),
          production_companies: splitList(editForm.production_companies),
          description: editForm.description || null,
          dfi_id: editForm.dfi_id || null,
          tmdb_id: nullableNumber(editForm.tmdb_id),
          poster_url: editForm.poster_url || null,
          dfi_title: editForm.dfi_title || null,
          dfi_danish_title: editForm.dfi_danish_title || null,
          dfi_original_title: editForm.dfi_original_title || null,
          dfi_category: editForm.dfi_category || null,
          dfi_type: editForm.dfi_type || null,
          status,
          dfi_metadata: editForm.dfi_metadata || null,
        },
        broadcaster: editForm.broadcaster === NO_BROADCASTER ? null : editForm.broadcaster,
      });
      setNotice(status === "godkendt" ? "Værket er godkendt." : "Værket er arkiveret.");
      setEditForm({ ...editForm, status });
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke ændre status."));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEditingPermanently = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await deleteAdminWorkPermanently({ workId: editing.id });
      setNotice("Værket er slettet permanent.");
      setEditingDeleteOpen(false);
      setEditing(null);
      setEditForm(null);
      setActiveRequestId(null);
      setImportPreview(null);
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke slette værket permanent."));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSelectedPermanently = async () => {
    if (selectedIds.length === 0) return;
    setSaving(true);
    try {
      await deleteAdminWorksPermanently({ workIds: selectedIds });
      setNotice(`${selectedIds.length} værk(er) er slettet permanent.`);
      setBatchDeleteOpen(false);
      setSelectedIds([]);
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke slette værkerne permanent."));
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
    setUnifiedAddResults([]);
    setPickedUnifiedAddResult(null);
    setPickedResult(null);
    setPickedSource(null);
    setAddEpisodeOptions([]);
    setAddSelectedEpisodes([]);
    try {
      const unified = await searchWorksUnified(addQuery, { preferLocalOnly: !addForceExternalSearch });
      const results = (unified.success ? unified.results ?? [] : []).slice(0, 12);
      setUnifiedAddResults(results);
      if (results[0]) await pickUnifiedAddResult(results[0]);
    } finally {
      setIsSearchingAdd(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("add") !== "1") return;
    const query = params.get("q") ?? "";
    setAddOpen(true);
    setAddQuery(query);
    setAddForm(form => ({ ...form, title: query }));
  }, []);

  useEffect(() => {
    if (!addOpen || !addQuery.trim()) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("add") !== "1") return;
    void handleAddSearch();
    window.history.replaceState(null, "", "/admin/vaerker");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOpen, addQuery]);

  const handleEditSearch = async () => {
    if (!editLookupQuery.trim()) return;
    setIsSearchingEdit(true);
    setEditUnifiedResults([]);
    try {
      const result = await searchWorksUnified(editLookupQuery);
      setEditUnifiedResults((result.success ? result.results ?? [] : []).slice(0, 12));
    } finally {
      setIsSearchingEdit(false);
    }
  };

  const applyUnifiedToEdit = async (result: UnifiedSearchWorkResult) => {
    if (!editForm) return;
    setSaving(true);
    try {
      const resolved = await resolveUnifiedSearchResultDetails(result);
      if (!resolved.success || !resolved.details) throw new Error("Kunne ikke hente værksdata.");
      const details = resolved.details;
      const sources = result.sources.filter(source => source !== "local");
      const primarySource = sources.includes("dfi") ? "dfi" : sources.includes("tmdb") ? "tmdb" : "manual";
      const nextValues: Partial<WorkForm> = {
        title: details.title || editForm.title,
        type: details.type || editForm.type,
        year: details.year != null ? String(details.year) : editForm.year,
        duration_minutes: details.duration_minutes != null ? String(details.duration_minutes) : editForm.duration_minutes,
        episode_count: details.episode_count != null ? String(details.episode_count) : editForm.episode_count,
        season_count: details.season_count != null ? String(details.season_count) : editForm.season_count,
        season_number: details.season_hint != null ? String(details.season_hint) : editForm.season_number,
        alternative_titles: details.alternative_titles?.length ? details.alternative_titles.join(", ") : editForm.alternative_titles,
        production_countries: details.production_countries?.length ? details.production_countries.join(", ") : editForm.production_countries,
        production_companies: details.production_companies?.length ? details.production_companies.join(", ") : editForm.production_companies,
        genre: details.genre || editForm.genre,
        director: details.director || editForm.director,
        description: details.description || editForm.description,
        dfi_id: details.dfi_id ? String(details.dfi_id) : editForm.dfi_id,
        tmdb_id: details.tmdb_id ? String(details.tmdb_id) : editForm.tmdb_id,
        imdb_id: details.imdb_id || editForm.imdb_id,
        poster_url: details.poster_url || editForm.poster_url,
        dfi_metadata: details.dfi_metadata || editForm.dfi_metadata,
        field_sources: {
          ...editForm.field_sources,
          title: primarySource,
          type: primarySource,
          year: primarySource,
          duration_minutes: details.duration_minutes != null ? primarySource : editForm.field_sources.duration_minutes,
          genre: details.genre ? primarySource : editForm.field_sources.genre,
          director: details.director ? primarySource : editForm.field_sources.director,
          description: details.description ? primarySource : editForm.field_sources.description,
          poster_url: result.sources.includes("tmdb") ? "tmdb" : primarySource,
          imdb_id: details.imdb_id ? "tmdb" : editForm.field_sources.imdb_id,
        },
      };
      setImportPreview({ source: primarySource === "tmdb" ? "TMDB" : "DFI", rows: importDiffRows(editForm, nextValues) });
      setEditForm({ ...editForm, ...nextValues });
      setNotice("Kombinerede værksdata er hentet. Gennemgå ændringerne og gem værket.");
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke hente kombinerede værksdata."));
    } finally {
      setSaving(false);
    }
  };

  const applyDfiToEdit = async (result: SearchResult) => {
    if (!editForm) return;

    setSaving(true);
    try {
      const details = await getDFIFilmDetails(Number(result.Id));
      const film = (details.success ? (details as { film?: SearchResult }).film : result) ?? result;
      const type = mapDfiWorkType(film.Category, film.Type, workTypeFallback(editForm.type));
      const title = textValue(film.Title) || textValue(film.DanishTitle) || textValue(film.OriginalTitle) || editForm.title;
      const year = extractDfiPremiereYear(film);
      const dfiPoster = (details.success ? details.posterDataUrl : null) ?? extractDfiPosterUrl(film);
      const tmdbPoster = dfiPoster ? null : await findTMDBPoster(title, year);
      const nextValues: Partial<WorkForm> = {
        title,
        type,
        year: year ? String(year) : editForm.year,
        duration_minutes: firstNumber(film.LengthInMin) ? String(firstNumber(film.LengthInMin)) : editForm.duration_minutes,
        genre: textValue(film.Genre) || editForm.genre,
        director: dfiDirector(film) || editForm.director,
        alternative_titles: mergeLists(splitList(editForm.alternative_titles), dfiAlternativeTitles(film)).join(", "),
        production_countries: mergeLists(splitList(editForm.production_countries), dfiProductionCountries(film)).join(", "),
        production_companies: mergeLists(splitList(editForm.production_companies), dfiProductionCompanies(film)).join(", "),
        ...dfiFieldValues(film),
        dfi_id: String(result.Id),
        poster_url: dfiPoster ?? (tmdbPoster ? `${TMDB_IMG_W185}${tmdbPoster}` : editForm.poster_url),
        dfi_metadata: film as DfiMetadata,
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

  const pickUnifiedAddResult = async (result: UnifiedSearchWorkResult) => {
    setAddManualMode(false);
    setPickedUnifiedAddResult(result);
    setPickedSource(result.local_id ? "local" : result.dfi_id ? "dfi" : result.tmdb_id ? "tmdb" : null);
    setPickedResult(result.local_id
      ? { id: result.local_id }
      : result.dfi_id
        ? { Id: result.dfi_id }
        : result.tmdb_id
          ? { id: result.tmdb_id, media_type: result.type === "tv-serie" || result.type === "dokumentar-serie" ? "tv" : "movie" }
          : null
    );

    const details = await resolveUnifiedSearchResultDetails(result);
    const d = details.success ? details.details : null;
    const episodeOptions = (d?.episode_options ?? []).map(option => ({ number: option.number, title: option.title }));
    const episodeCount = Math.max(d?.episode_count ?? 0, episodeOptions.length);
    const hintedSeason = d?.season_hint ?? result.season_hint ?? null;
    setAddSeasonNumber(hintedSeason ? String(hintedSeason) : "1");
    setAddEpisodeOptions(
      episodeCount
        ? buildCompleteEpisodeOptions({
          episodeCount,
          externalOptions: episodeOptions,
          seasonNumber: Number(hintedSeason ?? result.season_hint ?? 1),
        })
        : []
    );
    setAddSelectedEpisodes([]);
    setAddForm(form => ({
      ...form,
      title: d?.title ?? result.title,
      type: d?.type ?? result.type ?? form.type,
      year: d?.year ? String(d.year) : result.year ? String(result.year) : "",
      duration_minutes: d?.duration_minutes ? String(d.duration_minutes) : result.duration_minutes ? String(result.duration_minutes) : "",
      episode_count: d?.episode_count ? String(d.episode_count) : "",
      genre: d?.genre ?? result.genre ?? "",
      director: d?.director ?? result.director ?? "",
      description: d?.description ?? result.description ?? "",
      dfi_id: d?.dfi_id ? String(d.dfi_id) : result.dfi_id ? String(result.dfi_id) : "",
      tmdb_id: d?.tmdb_id ? String(d.tmdb_id) : result.tmdb_id ? String(result.tmdb_id) : "",
      imdb_id: d?.imdb_id ?? result.imdb_id ?? "",
      poster_url: d?.poster_url ?? result.poster_url ?? "",
    }));
  };

  useEffect(() => {
    let cancelled = false;
    const updateEpisodesForSeason = async () => {
      if (pickedUnifiedAddResult && (pickedUnifiedAddResult.type === "tv-serie" || pickedUnifiedAddResult.type === "dokumentar-serie")) {
        const sNum = parseInt(addSeasonNumber) || 1;
        setAddEpisodesLoading(true);
        setAddEpisodesError(null);
        try {
          const detailsRes = await resolveUnifiedSearchResultDetails(pickedUnifiedAddResult, sNum);
          if (cancelled) return;
          const d = detailsRes.success ? detailsRes.details : null;
          const episodeOptions = (d?.episode_options ?? []).map(option => ({ number: option.number, title: option.title }));
          const episodeCount = Math.max(d?.episode_count ?? 0, episodeOptions.length);
          if (d?.episode_lookup_status === "found" && episodeCount > 0) {
            setAddEpisodeOptions(buildCompleteEpisodeOptions({
              episodeCount,
              externalOptions: episodeOptions,
              seasonNumber: sNum,
            }));
            setAddSelectedEpisodes(prev => prev.filter(number => number <= episodeCount));
          } else {
            // Sæsonen findes ikke — ryd stale afsnit og vis fejl (sæson-inputtet forbliver synligt).
            setAddEpisodeOptions([]);
            setAddSelectedEpisodes([]);
            setAddEpisodesError(d?.episode_lookup_status === "error"
              ? `Kunne ikke hente sæson ${sNum}. Prøv igen.`
              : `Sæson ${sNum} blev ikke fundet.`);
          }
        } catch (e) {
          if (cancelled) return;
          console.error("Fejl ved opdatering af sæsonafsnit i admin:", e);
          setAddEpisodeOptions([]);
          setAddSelectedEpisodes([]);
          setAddEpisodesError(`Kunne ikke hente sæson ${parseInt(addSeasonNumber) || 1}. Prøv igen.`);
        } finally {
          if (!cancelled) setAddEpisodesLoading(false);
        }
      }
    };
    updateEpisodesForSeason();
    return () => { cancelled = true; };
  }, [addSeasonNumber, pickedUnifiedAddResult]);

  const handleCreateWork = async () => {
    setSaving(true);
    try {
      let data: AdminCreateWorkData = {
        title: addForm.title,
        type: addForm.type,
        year: nullableNumber(addForm.year),
        duration_minutes: nullableNumber(addForm.duration_minutes),
        season_count: nullableNumber(addForm.season_count),
        episode_count: nullableNumber(addForm.episode_count),
          genre: addForm.genre || null,
          director: addForm.director || null,
          alternative_titles: splitList(addForm.alternative_titles),
          production_countries: splitList(addForm.production_countries),
          production_companies: splitList(addForm.production_companies),
          dfi_title: addForm.dfi_title || null,
          dfi_danish_title: addForm.dfi_danish_title || null,
          dfi_original_title: addForm.dfi_original_title || null,
          dfi_category: addForm.dfi_category || null,
          dfi_type: addForm.dfi_type || null,
        description: addForm.description || null,
        dfi_id: addForm.dfi_id || null,
        tmdb_id: nullableNumber(addForm.tmdb_id),
        imdb_id: addForm.imdb_id || null,
        field_sources: {},
        poster_url: addForm.poster_url || null,
        dfi_metadata: null,
      };

      if (pickedSource === "dfi" && pickedResult) {
        const details = await getDFIFilmDetails(Number(pickedResult.Id));
        const film = (details.success ? (details as { film?: SearchResult }).film : pickedResult) ?? pickedResult;
        const title = textValue(film.Title) || textValue(film.DanishTitle) || textValue(film.OriginalTitle) || data.title;
        const year = extractDfiPremiereYear(film) ?? data.year;
        const dfiPoster = (details.success ? details.posterDataUrl : null) ?? extractDfiPosterUrl(film);
        const tmdbPoster = dfiPoster ? null : await findTMDBPoster(title, year);
        data = {
          ...data,
          title,
          year,
          duration_minutes: firstNumber(film.LengthInMin) ?? data.duration_minutes,
          genre: textValue(film.Genre) || data.genre,
          director: dfiDirector(film) || data.director,
          alternative_titles: mergeLists(data.alternative_titles, dfiAlternativeTitles(film)),
          production_countries: mergeLists(data.production_countries, dfiProductionCountries(film)),
          production_companies: mergeLists(data.production_companies, dfiProductionCompanies(film)),
          ...dfiFieldValues(film),
          dfi_id: String(pickedResult.Id),
          poster_url: dfiPoster ?? (tmdbPoster ? `${TMDB_IMG_W185}${tmdbPoster}` : null),
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
        assignments: addAssignments
          .filter(assignment => assignment.rightsHolderId && assignment.role)
          .map(assignment => ({
            rightsHolderId: assignment.rightsHolderId as string,
            role: assignment.role,
            sharePercent: nullableNumber(assignment.sharePercent),
          })),
        broadcaster: addForm.broadcaster === NO_BROADCASTER ? null : addForm.broadcaster,
        seasonNumber: nullableNumber(addSeasonNumber),
        selectedEpisodes: addSelectedEpisodes,
        status: addForm.status,
        distributions: distributionPayload(addDistributions),
      });
      setNotice("Værket er tilføjet.");
      setAddOpen(false);
      setAddQuery("");
      setAddForm(defaultAddForm());
      setAddManualMode(false);
      setAddAssignments([]);
      setAddDistributions([]);
      setPickedResult(null);
      setPickedSource(null);
      setPickedUnifiedAddResult(null);
      setUnifiedAddResults([]);
      setAddEpisodeOptions([]);
      setAddSelectedEpisodes([]);
      setAddSeasonNumber("1");
      setAddForceExternalSearch(false);
      await load();
      notifyWorksUpdated();
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Kunne ikke tilføje værket."));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <TableSkeleton columns={7} rows={7} />;

  const addRequiresEpisodeSelection =
    addAssignments.some(assignment => Boolean(assignment.rightsHolderId)) &&
    (addForm.type === "tv-serie" || addForm.type === "dokumentar-serie") &&
    addEpisodeOptions.length > 0 &&
    addSelectedEpisodes.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Værksadministration"
        subtitle={`${filtered.length} af ${works.length} værker`}
        actions={
          <>
            <Button className="gap-2" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Tilføj værk
            </Button>
            <HelpButton onClick={() => setHelpOpen(true)} />
          </>
        }
      />
      <ContextualHelp
        title="Værksadministration"
        intro="Her godkender, retter og kobler du værker til rettighedshavere og kontrakter."
        open={helpOpen}
        onOpenChange={setHelpOpen}
        topics={[
          {
            title: "Til godkendelse",
            body: "Værker og rettelser med status Til godkendelse skal gennemgås, før data bruges som endelige værksdata.",
          },
          {
            title: "Requests",
            body: "Pending rettelser vises inde i Rediger værk. Vælg en rettelse for at se, hvilke felter brugeren foreslår ændret.",
          },
          {
            title: "Rettighedshavere og andele",
            body: "Rolle og andel gemmes på relationen mellem værket og rettighedshaveren. Andelen er informativ og behøver ikke summere til 100%.",
          },
        ]}
      />

      {notice && (
        <div className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-muted-foreground">Luk</button>
        </div>
      )}

      <div className="hidden gap-3 sm:grid sm:grid-cols-3">
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

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative w-full lg:w-auto">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Søg titel, DFI-id, TMDB-id, type..." className="w-full pl-8 pr-8 lg:w-[320px]" value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              aria-label="Tøm søgefelt"
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full lg:w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status</SelectItem>
            <SelectItem value="til_godkendelse">Til godkendelse</SelectItem>
            <SelectItem value="godkendt">Godkendt</SelectItem>
            <SelectItem value="arkiveret">Arkiveret</SelectItem>
            <SelectItem value="beskeder">Beskeder</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-full lg:w-[180px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Type</SelectItem>
            {WORK_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <ActiveUserFilter rightsHolders={rightsHolders} activeRh={activeRh} onChange={setActiveRh} />
        <ResetFiltersButton
          active={Boolean(search || filterStatus !== "all" || filterType !== "all" || activeRh)}
          onReset={() => { setSearch(""); setFilterStatus("all"); setFilterType("all"); setActiveRh(null); setSelectedIds([]); setPageSize(20); }}
        />
        <Button variant="outline" className="w-full gap-2 sm:w-auto" onClick={() => setDuplicatesOpen(true)}>
          <Search className="h-4 w-4" />
          Find dubletter
        </Button>
        <div className="grid w-full grid-cols-[1fr_auto] gap-2 lg:hidden">
          <Select value={sortKey} onValueChange={value => setSortKey(value as SortKey)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sorter efter" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="title">Værk</SelectItem>
              <SelectItem value="type">Type</SelectItem>
              <SelectItem value="year">Premiereår</SelectItem>
              <SelectItem value="data">Data</SelectItem>
              <SelectItem value="broadcaster">Broadcast/stream</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} className="h-9 px-3">
            {sortDir === "asc" ? "A-Z" : "Z-A"}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground lg:ml-auto">
          Vis
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
            {[10, 20, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        {filtered.length > 0 && (
          <Button type="button" variant="outline" className="w-full sm:w-auto lg:hidden" onClick={toggleAllFiltered}>
            {allFilteredSelected ? "Fravælg alle" : "Vælg alle"}
            {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
          </Button>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3">
          <span className="text-sm font-medium">{selectedIds.length} valgt</span>
          <Button size="sm" variant="outline" className="gap-2" onClick={handleApproveSelected} disabled={saving}>
            <CheckCircle2 className="h-4 w-4" />
            Godkend valgte
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={handleMarkSelectedMessagesRead} disabled={saving}>
            <MessageSquare className="h-4 w-4" />
            Besked læst
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setArchiveOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Arkiver
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => { setMasterId(selectedIds[0] ?? ""); setMergeOpen(true); }} disabled={selectedIds.length < 2 || hasSelectedSeason} title={hasSelectedSeason ? "Fold sæsonen ud og vælg konkrete værker, før de flettes." : undefined}>
            <GitMerge className="h-4 w-4" />
            Flet dubletter
          </Button>
          <Button size="sm" variant="destructive" className="gap-2" onClick={() => setBatchDeleteOpen(true)}>
            <AlertTriangle className="h-4 w-4" />
            Slet permanent
          </Button>
        </div>
      )}

		      <MobileCardList>
        {filtered.length === 0 ? (
          <MobileDataCard>
            <p className="py-6 text-center text-sm text-muted-foreground">Ingen værker matcher søgningen</p>
          </MobileDataCard>
        ) : visibleWorks.map(work => {
          const status = displayStatus(work);
          const isSeason = Boolean(work.is_season_group);
          const groupKey = work.group_key ?? work.id;
          const isExpanded = expandedSeasons.has(groupKey);
          const episodes = seasonEpisodes[groupKey] ?? [];
          const broadcaster = getWorkBroadcaster(work);
          const broadcasterLogo = broadcaster ? broadcasterLogoMap[broadcaster] : null;
          const poster = posterSrc(work.poster_url);
          const pendingCount = work.overview_pending_count ?? (work.work_change_requests ?? []).filter(request => request.status === "pending").length;
          const coEditors = [...new Set((work.work_assignments ?? [])
            .map(a => a.rettighedshavere?.full_name)
            .filter((name): name is string => Boolean(name)))];
          const workSelectionIds = selectionIdsForWork(work);
          const isSelected = workSelectionIds.length > 0 && workSelectionIds.every(id => selectedIds.includes(id));
          return (
            <div key={work.id} className="space-y-2">
            <MobileDataCard className={pendingCount ? "border-amber-200 bg-amber-50/35" : undefined}>
              <div className="flex gap-3">
                <div onClick={event => event.stopPropagation()} className="pt-1">
                  <input type="checkbox" checked={isSelected} onChange={() => toggleWorkSelection(work)} className="h-4 w-4" aria-label={`Vælg ${work.title}`} />
                </div>
                {isSeason && <button type="button" onClick={() => toggleAdminSeason(work)} className="mt-1 shrink-0 text-muted-foreground" aria-label={isExpanded ? "Skjul afsnit" : "Vis afsnit"}>{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>}
                <button type="button" onClick={() => isSeason ? openAdminSeasonEdit(work) : openEdit(work)} className="flex min-w-0 flex-1 gap-3 text-left">
                  <div className="flex h-16 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                    {poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={poster} alt={work.title} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <Film className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium leading-snug">{work.title}{isSeason && work.season_number != null ? ` · Sæson ${work.season_number}` : ""}</p>
                      {unreadMemberMessageCount(work) > 0 && <Badge variant="outline" className="border-blue-300 bg-blue-100 text-blue-800">Besked</Badge>}
                    </div>
                    {latestUnreadMemberMessage(work) && <p className="mt-1 line-clamp-2 text-xs text-blue-700">{latestUnreadMemberMessage(work)}</p>}
                  </div>
                </button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <MobileMetaRow label="Type">{workTypeLabel(work.type)}</MobileMetaRow>
                <MobileMetaRow label="År">{work.year ?? "—"}</MobileMetaRow>
                <MobileMetaRow label="Status">
                  <Badge variant="outline" className={STATUS_CLASS[status] ?? ""}>
                    {STATUS_LABELS[status] ?? status}
                  </Badge>
                </MobileMetaRow>
                <MobileMetaRow label="Broadcast">
                  {broadcaster ? (
                    broadcasterLogo ? (
                      <span className="inline-flex h-6 w-14 items-center rounded border bg-background px-1.5 py-0.5" title={broadcaster}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={broadcasterLogo} alt={`${broadcaster} logo`} className="max-h-4 max-w-full object-contain" loading="lazy" />
                      </span>
                    ) : broadcaster
                  ) : "—"}
                </MobileMetaRow>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {isSeason ? `${work.episode_count ?? 0} afsnit · Afsnit med kontrakt: ${work.overview_contract_count ?? 0}` : `DFI: ${work.dfi_id ?? "-"} · TMDB: ${work.tmdb_id ?? "-"} · Kontrakter: ${work.contracts?.length ?? 0}`}
                {coEditors.length > 0 && <div className="mt-1 line-clamp-2">Medklippere: {coEditors.join(", ")}</div>}
              </div>
            </MobileDataCard>
            {isSeason && isExpanded && (
              <div className="ml-4 space-y-2 border-l pl-3">
                {loadingSeasons.has(groupKey) && <p className="py-3 text-sm text-muted-foreground">Henter afsnit…</p>}
                {seasonErrors[groupKey] && (
                  <div className="rounded-md border border-destructive/30 p-3 text-sm">
                    <p>{seasonErrors[groupKey]}</p>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => void loadAdminSeason(work, true)}>Prøv igen</Button>
                  </div>
                )}
                {episodes.map(episode => {
                  const names = (episode.work_assignments ?? []).map(a => `${a.rettighedshavere?.full_name ?? "Ukendt"} (${displayCreditRole(a.role)})`);
                  return (
                    <button key={episode.id} type="button" onClick={() => openEdit(episode)} className="block w-full rounded-lg border bg-background p-3 text-left hover:bg-muted/50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">S{String(episode.season_number ?? work.season_number ?? 0).padStart(2, "0")}E{String(episode.episode_number ?? 0).padStart(2, "0")} · {episode.title}</span>
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{names.length ? names.join(", ") : "Ingen tilknyttede brugere"} · Kontrakter: {episode.contracts?.length ?? 0}</p>
                    </button>
                  );
                })}
                {!loadingSeasons.has(groupKey) && !seasonErrors[groupKey] && episodes.length === 0 && <p className="py-3 text-sm text-muted-foreground">Ingen afsnit i sæsonen.</p>}
              </div>
            )}
            </div>
          );
        })}
      </MobileCardList>

      <ResponsiveTableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} className="h-4 w-4" aria-label="Vælg alle værker" />
              </TableHead>
              <TableHead><SortButton label="Værk" activeMark={sortMark("title")} onClick={() => handleSort("title")} /></TableHead>
              <TableHead><SortButton label="Type" activeMark={sortMark("type")} onClick={() => handleSort("type")} /></TableHead>
              <TableHead><SortButton label="Premiereår" activeMark={sortMark("year")} onClick={() => handleSort("year")} /></TableHead>
              <TableHead><SortButton label="Data" activeMark={sortMark("data")} onClick={() => handleSort("data")} /></TableHead>
              <TableHead><SortButton label="Broadcast/stream" activeMark={sortMark("broadcaster")} onClick={() => handleSort("broadcaster")} /></TableHead>
              <TableHead><SortButton label="Status" activeMark={sortMark("status")} onClick={() => handleSort("status")} /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Ingen værker matcher søgningen</TableCell></TableRow>
            ) : visibleWorks.map(work => {
              const status = displayStatus(work);
              const isSeason = Boolean(work.is_season_group);
              const groupKey = work.group_key ?? work.id;
              const isExpanded = expandedSeasons.has(groupKey);
              const episodes = seasonEpisodes[groupKey] ?? [];
              const broadcaster = getWorkBroadcaster(work);
              const broadcasterLogo = broadcaster ? broadcasterLogoMap[broadcaster] : null;
              const poster = posterSrc(work.poster_url);
              const pendingCount = work.overview_pending_count ?? (work.work_change_requests ?? []).filter(request => request.status === "pending").length;
              const workSelectionIds = selectionIdsForWork(work);
              const isSelected = workSelectionIds.length > 0 && workSelectionIds.every(id => selectedIds.includes(id));
              return (
                <Fragment key={work.id}>
                <TableRow className={pendingCount ? "bg-amber-50/45" : undefined}>
                  <TableCell>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleWorkSelection(work)} className="h-4 w-4" aria-label={`Vælg ${work.title}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => isSeason ? openAdminSeasonEdit(work) : openEdit(work)} className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted" aria-label={`Rediger ${work.title}`}>
                        {poster ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={poster} alt={work.title} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <Film className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          {isSeason && <button type="button" onClick={() => toggleAdminSeason(work)} className="text-muted-foreground" aria-label={isExpanded ? "Skjul afsnit" : "Vis afsnit"}>{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>}
                          <button onClick={() => isSeason ? openAdminSeasonEdit(work) : openEdit(work)} className="inline-flex items-center gap-1 text-left font-medium underline-offset-4 hover:underline">
                            {work.title}{isSeason && work.season_number != null ? ` · Sæson ${work.season_number}` : ""}
                          </button>
                          {unreadMemberMessageCount(work) > 0 && (
                            <Badge variant="outline" className="border-blue-300 bg-blue-100 text-blue-800">
                              {unreadMemberMessageCount(work) > 1 ? `${unreadMemberMessageCount(work)} beskeder` : "Besked"}
                            </Badge>
                          )}
                        </div>
                        {(() => {
                          const msg = latestUnreadMemberMessage(work);
                          if (msg) return <p className="max-w-[320px] truncate text-xs text-blue-700">{msg}</p>;
                          return work.description ? <p className="text-xs text-muted-foreground">{work.description.slice(0, 90)}</p> : null;
                        })()}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{workTypeLabel(work.type)}</TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">{work.year ?? "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>{isSeason ? `${work.episode_count ?? 0} afsnit` : `DFI: ${work.dfi_id ?? "-"} · TMDB: ${work.tmdb_id ?? "-"}`}</div>
                    <div>
                      Varighed: {work.duration_minutes ?? "-"}
                      {isSeriesType(work.type) && <> · Sæson: {work.season_count ?? "-"} · Afsnit: {work.episode_count ?? "-"}</>}
                    </div>
                    <div>{isSeason ? `Afsnit med kontrakt: ${work.overview_contract_count ?? 0}` : `Kontrakter: ${work.contracts?.length ?? 0}`}</div>
                    {(() => {
                      const coEditors = [...new Set((work.work_assignments ?? [])
                        .map(a => a.rettighedshavere?.full_name)
                        .filter((name): name is string => Boolean(name)))];
                      return coEditors.length > 0 ? <div>Medklippere: {coEditors.join(", ")}</div> : null;
                    })()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {broadcaster ? (
                      broadcasterLogo ? (
                        <div className="flex items-center">
                          <span className="inline-flex h-6 w-14 items-center rounded border bg-background px-1.5 py-0.5" title={broadcaster}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={broadcasterLogo} alt={`${broadcaster} logo`} className="max-h-4 max-w-full object-contain" loading="lazy" />
                          </span>
                        </div>
                      ) : broadcaster
                    ) : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_CLASS[status] ?? ""}>
                      {status === "til_godkendelse" ? <Clock className="mr-1 h-3 w-3" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                      {STATUS_LABELS[status] ?? status}
                    </Badge>
                  </TableCell>
                </TableRow>
                {isSeason && isExpanded && loadingSeasons.has(groupKey) && (
                  <TableRow key={`${groupKey}-loading`}><TableCell colSpan={7} className="pl-16 text-sm text-muted-foreground">Henter afsnit…</TableCell></TableRow>
                )}
                {isSeason && isExpanded && seasonErrors[groupKey] && (
                  <TableRow key={`${groupKey}-error`}><TableCell colSpan={7} className="pl-16 text-sm text-destructive">{seasonErrors[groupKey]} <Button size="sm" variant="outline" className="ml-2" onClick={() => void loadAdminSeason(work, true)}>Prøv igen</Button></TableCell></TableRow>
                )}
                {isSeason && isExpanded && episodes.map(episode => {
                  const episodeStatus = displayStatus(episode);
                  const episodeNames = (episode.work_assignments ?? []).map(a => `${a.rettighedshavere?.full_name ?? "Ukendt"} (${displayCreditRole(a.role)})`);
                  return (
                    <TableRow key={episode.id} className="bg-muted/20">
                      <TableCell className="pl-8"><input type="checkbox" checked={selectedIds.includes(episode.id)} onChange={() => toggleSelected(episode.id)} className="h-4 w-4" aria-label={`Vælg ${episode.title}`} /></TableCell>
                      <TableCell className="pl-12"><button type="button" onClick={() => openEdit(episode)} className="text-left text-sm font-medium underline-offset-4 hover:underline">S{String(episode.season_number ?? work.season_number ?? 0).padStart(2, "0")}E{String(episode.episode_number ?? 0).padStart(2, "0")} · {episode.title}</button></TableCell>
                      <TableCell className="text-sm">Afsnit</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{episode.year ?? "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{episodeNames.length ? episodeNames.join(", ") : "Ingen tilknyttede brugere"}<div>Kontrakter: {episode.contracts?.length ?? 0}</div></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{getWorkBroadcaster(episode) ?? "-"}</TableCell>
                      <TableCell><Badge variant="outline" className={STATUS_CLASS[episodeStatus] ?? ""}>{STATUS_LABELS[episodeStatus] ?? episodeStatus}</Badge></TableCell>
                    </TableRow>
                  );
                })}
                {isSeason && isExpanded && !loadingSeasons.has(groupKey) && !seasonErrors[groupKey] && episodes.length === 0 && (
                  <TableRow key={`${groupKey}-empty`}><TableCell colSpan={7} className="pl-16 text-sm text-muted-foreground">Ingen afsnit i sæsonen.</TableCell></TableRow>
                )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </ResponsiveTableFrame>

      <Dialog open={!!editing} onOpenChange={open => { if (!open) { setEditing(null); setEditForm(null); setActiveRequestId(null); setImportPreview(null); setAdminComment(""); setEditingDeleteOpen(false); setEditingArchiveOpen(false); setEditingSeasonGroup(null); setEditingSeasonEpisodes([]); setSeasonCreditDrafts({}); } }}>
        <DialogContent className="max-h-[92vh] w-[min(1360px,calc(100vw-2rem))] !max-w-none sm:!max-w-none overflow-y-auto overflow-x-hidden">
          <DialogHeader><DialogTitle>{editingSeasonGroup ? `Rediger ${editingSeasonGroup.title} · Sæson ${editingSeasonGroup.season_number}` : "Rediger værk"}</DialogTitle></DialogHeader>
          {editing && editForm && (
            (() => {
              const requests = editing.work_change_requests ?? [];
              const activeRequest = requests.find(request => request.id === activeRequestId) ?? null;
              // Kun PENDING rettelser markerer datafelterne. Allerede godkendte/afviste
              // rettelser vises stadig i request-panelet, men "popper" ikke op ved felterne.
              const activeDiffMap = activeRequest?.status === "pending" ? requestDiffMap(activeRequest) : {};
              const pendingReviewRequest = requests.find(request => request.status === "pending") ?? null;
              const summary = activeRequest ? requestSummary(activeRequest) : null;
              const visibleContracts = [...new Map((editingSeasonGroup
                ? [...(editing.contracts ?? []), ...editingSeasonEpisodes.flatMap(episode => episode.contracts ?? [])]
                : editing.contracts ?? []).map(contract => [contract.id, contract])).values()];
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
                  {!editingSeasonGroup && (
                    <>
                      <Button type="button" variant="outline" onClick={() => setEditingArchiveOpen(true)} disabled={saving}>
                        Arkiver værk
                      </Button>
                      <Button type="button" variant="destructive" onClick={() => setEditingDeleteOpen(true)} disabled={saving}>
                        Slet permanent
                      </Button>
                    </>
                  )}
                  {pendingReviewRequest ? (
                    <Button type="button" onClick={() => handleReview("approved", pendingReviewRequest.id)} disabled={saving}>
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Godkend rettelser
                    </Button>
                  ) : (
                    <Button type="button" onClick={handleSaveWork} disabled={saving}>
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Gem værk
                    </Button>
                  )}
                  <Button type="button" variant="outline" onClick={() => { setEditing(null); setEditForm(null); setActiveRequestId(null); setImportPreview(null); setAdminComment(""); setEditingSeasonGroup(null); setEditingSeasonEpisodes([]); setSeasonCreditDrafts({}); }}>
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
                        {activeRequest.status === "pending" && requestDiffRows(activeRequest).length > 0 && (
                          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            {requestDiffRows(activeRequest).length} feltændring{requestDiffRows(activeRequest).length === 1 ? "" : "er"} er markeret i Værksdata nedenfor.
                          </p>
                        )}
                        {activeRequest.status === "pending" && (isSeriesType(editForm?.type ?? "") || isSeriesType(String((activeRequest.proposed_data as Record<string, unknown>)?.type ?? ""))) && (
                          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                            <div className="flex items-center gap-2">
                              <Label className="text-sm">Antal afsnit</Label>
                              <Input type="number" min="1" className="h-8 w-24" value={reviewEpisodeCount} onChange={e => setReviewEpisodeCount(e.target.value)} />
                            </div>
                            {Number(reviewEpisodeCount) > 0 && (
                              <div>
                                <p className="mb-1 text-xs text-muted-foreground">Afsnit medlemmet er krediteret på (klik for at vælge til/fra):</p>
                                <SeriesEpisodeSelector
                                  season={1}
                                  onSeasonChange={() => undefined}
                                  options={buildCompleteEpisodeOptions({ episodeCount: Number(reviewEpisodeCount), seasonNumber: 1 })}
                                  selected={reviewEpisodes}
                                  onSelectedChange={setReviewEpisodes}
                                  label="Afsnit medlemmet er krediteret på"
                                  compact
                                  seasonReadOnly
                                />
                              </div>
                            )}
                          </div>
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
                        <MessageThread
                          title="Beskeder med medlem"
                          messages={requestMessages(activeRequest)}
                          viewerRole="admin"
                          memberLabel="Medlem"
                          adminLabel="DFKS"
                          emptyText="Der er endnu ingen beskeder på denne request."
                          nextActionLabel={requestNextActionLabel(activeRequest)}
                          nextActionTone={requestNextActionTone(activeRequest)}
                          composerValue={adminComment}
                          onComposerChange={setAdminComment}
                          onSend={handleSendReply}
                          composerLoading={saving}
                          composerPlaceholder="Skriv et svar til brugeren…"
                          sendLabel="Send svar"
                          onDeleteMessage={async messageId => {
                            await deleteAdminMessage({ kind: "work", threadId: activeRequest.id, messageId });
                            setEditing(prev => prev ? { ...prev, work_change_requests: (prev.work_change_requests ?? []).map(request => request.id === activeRequest.id ? { ...request, work_change_request_comments: (request.work_change_request_comments ?? []).filter(comment => comment.id !== messageId) } : request) } : prev);
                          }}
                          onClearThread={async () => {
                            await clearAdminMessageThread({ kind: "work", threadId: activeRequest.id });
                            setEditing(prev => prev ? { ...prev, work_change_requests: (prev.work_change_requests ?? []).map(request => request.id === activeRequest.id ? { ...request, work_change_request_comments: [] } : request) } : prev);
                          }}
                          footer={activeRequest.status === "pending" ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button variant="outline" onClick={() => handleReview("rejected")} disabled={saving}>
                                <XCircle className="mr-2 h-4 w-4" />
                                Afvis
                              </Button>
                              <Button onClick={() => handleReview("approved")} disabled={saving}>
                                Godkend
                              </Button>
                            </div>
                          ) : null}
                        />
                      </div>
                    )}
                  </div>
                )}
              </InfoPanel>
              <div className="space-y-4">
                <InfoPanel title="Værksdata">
                  <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start">
                    {posterSrc(editForm.poster_url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={posterSrc(editForm.poster_url) as string}
                        alt={editForm.title ? `${editForm.title} poster` : "Poster"}
                        className="h-40 w-auto shrink-0 rounded-md border object-contain"
                      />
                    ) : null}
                    <div className="grid flex-1 gap-4 sm:grid-cols-2">
                      <DiffField diff={activeDiffMap.title}>
                        <Field label="Titel" source={editForm.field_sources.title}><Input value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value, field_sources: { ...editForm.field_sources, title: "manual" } })} /></Field>
                      </DiffField>
                      <DiffField diff={activeDiffMap.type}>
                        <Field label="Værktype">
                        <Select value={editForm.type} onValueChange={type => setEditForm({ ...editForm, type })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {WORK_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        </Field>
                      </DiffField>
                    </div>
                  </div>
                  {activeRequest && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Viser foreslåede ændringer fra <span className="font-medium">{activeRequest.rettighedshavere?.full_name ?? "ukendt bruger"}</span>.
                      Felter med ændringer er markeret herunder.
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <DiffField diff={activeDiffMap.year}>
                      <Field label="Premiereår" source={editForm.field_sources.year}><Input value={editForm.year} onChange={e => setEditForm({ ...editForm, year: e.target.value, field_sources: { ...editForm.field_sources, year: "manual" } })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.duration_minutes}>
                      <Field label="Varighed"><Input value={editForm.duration_minutes} onChange={e => setEditForm({ ...editForm, duration_minutes: e.target.value })} /></Field>
                    </DiffField>
                    {isSeriesType(editForm.type) && !editing?.parent_work_id && (
                      <DiffField diff={activeDiffMap.season_count}>
                        <Field label="Antal sæsoner"><Input value={editForm.season_count} onChange={e => setEditForm({ ...editForm, season_count: e.target.value })} /></Field>
                      </DiffField>
                    )}
                    {isSeriesType(editForm.type) && !editing?.parent_work_id && (
                      <DiffField diff={activeDiffMap.episode_count}>
                        <Field label="Antal afsnit"><Input value={editForm.episode_count} onChange={e => setEditForm({ ...editForm, episode_count: e.target.value })} /></Field>
                      </DiffField>
                    )}
                    {isSeriesType(editForm.type) && Boolean(editing?.parent_work_id) && <Field label="Sæsonnummer"><Input value={editForm.season_number} onChange={e => setEditForm({ ...editForm, season_number: e.target.value })} /></Field>}
                    {isSeriesType(editForm.type) && Boolean(editing?.parent_work_id) && <Field label="Afsnitsnummer"><Input value={editForm.episode_number} onChange={e => setEditForm({ ...editForm, episode_number: e.target.value })} /></Field>}
                    <DiffField diff={activeDiffMap.genre}>
                      <Field label="Genre"><Input value={editForm.genre} onChange={e => setEditForm({ ...editForm, genre: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.director}>
                      <Field label="Instruktør"><Input value={editForm.director} onChange={e => setEditForm({ ...editForm, director: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.dfi_original_title}>
                      <Field label="Arbejdstitel"><Input value={editForm.dfi_original_title} onChange={e => setEditForm({ ...editForm, dfi_original_title: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.alternative_titles}>
                      <Field label="Alternative titler"><Input value={editForm.alternative_titles} onChange={e => setEditForm({ ...editForm, alternative_titles: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.production_countries}>
                      <Field label="Produktionslande"><Input value={editForm.production_countries} onChange={e => setEditForm({ ...editForm, production_countries: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.production_companies}>
                      <Field label="Produktionsselskaber"><Input value={editForm.production_companies} onChange={e => setEditForm({ ...editForm, production_companies: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.dfi_id}>
                      <Field label="DFI-id"><Input value={editForm.dfi_id} onChange={e => setEditForm({ ...editForm, dfi_id: e.target.value })} /></Field>
                    </DiffField>
                    <DiffField diff={activeDiffMap.tmdb_id}>
                      <Field label="TMDB-id"><Input value={editForm.tmdb_id} onChange={e => setEditForm({ ...editForm, tmdb_id: e.target.value })} /></Field>
                    </DiffField>
                    <Field label="IMDb-id" source={editForm.field_sources.imdb_id}>
                      <Input value={editForm.imdb_id} onChange={e => setEditForm({ ...editForm, imdb_id: e.target.value, field_sources: { ...editForm.field_sources, imdb_id: "manual" } })} />
                    </Field>
                    <div className="md:col-span-2"><DistributionEditor value={editDistributions} onChange={setEditDistributions} options={broadcasterOptions} /></div>

                  </div>

                  {editForm.dfi_metadata && (
                    <div className="mt-5 space-y-4 border-t pt-4">
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
                {editingSeasonGroup && (
                  <InfoPanel title="Rettighedshavere og afsnit i sæsonen">
                    <p className="text-sm text-muted-foreground">
                      Vælg præcist hvilke afsnit hver klipper eller medklipper er knyttet til. Ændringerne gælder kun sæson {editingSeasonGroup.season_number}.
                    </p>
                    <div className="space-y-4">
                      {Object.values(seasonCreditDrafts).map(credit => (
                        <div key={credit.rightsHolderId} className="rounded-md border p-3">
                          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm font-medium">{credit.name}</p>
                            <Select value={credit.role} onValueChange={role => setSeasonCreditDrafts(previous => ({ ...previous, [credit.rightsHolderId]: { ...credit, role } }))}>
                              <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                              <SelectContent>{CREDIT_ROLES.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <SeriesEpisodeSelector
                            season={editingSeasonGroup.season_number ?? 1}
                            onSeasonChange={() => undefined}
                            options={editingSeasonEpisodes.map(episode => ({ number: episode.episode_number ?? 0, title: episode.title })).filter(option => option.number > 0)}
                            selected={credit.episodes}
                            onSelectedChange={episodes => setSeasonCreditDrafts(previous => ({ ...previous, [credit.rightsHolderId]: { ...credit, episodes } }))}
                            seasonReadOnly
                            compact
                          />
                        </div>
                      ))}
                      {Object.keys(seasonCreditDrafts).length === 0 && <p className="text-sm text-muted-foreground">Ingen rettighedshavere er knyttet til sæsonen.</p>}
                    </div>
                    <div className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-[minmax(220px,1fr)_180px_auto] sm:items-end">
                      <Field label="Tilføj klipper eller medklipper">
                        <Select value={newAssignment.rightsHolderId ?? ""} onValueChange={rightsHolderId => setNewAssignment(previous => ({ ...previous, rightsHolderId }))}>
                          <SelectTrigger><SelectValue placeholder="Vælg rettighedshaver" /></SelectTrigger>
                          <SelectContent>{rightsHolders.filter(holder => !seasonCreditDrafts[holder.id]).map(holder => <SelectItem key={holder.id} value={holder.id}>{holder.full_name}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                      <Field label="Kreditering">
                        <Select value={newAssignment.role} onValueChange={role => setNewAssignment(previous => ({ ...previous, role }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{CREDIT_ROLES.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                      <Button type="button" variant="outline" disabled={!newAssignment.rightsHolderId} onClick={() => {
                        const holder = rightsHolders.find(item => item.id === newAssignment.rightsHolderId);
                        if (!holder) return;
                        setSeasonCreditDrafts(previous => ({ ...previous, [holder.id]: {
                          rightsHolderId: holder.id,
                          name: holder.full_name,
                          role: newAssignment.role,
                          episodes: editingSeasonEpisodes.map(episode => episode.episode_number).filter((number): number is number => number != null),
                        } }));
                        setNewAssignment({ rightsHolderId: "", role: "Klipper", sharePercent: "" });
                      }}>Tilføj til sæson</Button>
                    </div>
                  </InfoPanel>
                )}
                {!editingSeasonGroup && <InfoPanel title="Rettighedshavere">
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
                </InfoPanel>}
              </div>
              <InfoPanel title="Tilknyttede kontrakter">
                <button
                  type="button"
                  onClick={() => { window.location.href = `/admin/kontrakter?new=1&work=${editing.id}`; }}
                  className="w-full rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
                >
                  {visibleContracts.length === 0
                    ? "Ingen kontrakter tilknyttet — klik for at tilføje en kontrakt i kontraktadmin."
                    : "Klik for at tilføje en kontrakt i kontraktadmin."}
                </button>
                {visibleContracts.map(contract => (
                  <div key={contract.id} className="mt-2 rounded border px-3 py-2 text-sm">
                    <div className="font-medium">{contract.rettighedshavere?.full_name ?? "Ukendt medlem"}</div>
                    <div className="text-xs text-muted-foreground">{contract.type ?? "Kontrakt"} · {contract.status ?? "ukendt status"}</div>
                  </div>
                ))}
              </InfoPanel>
              <InfoPanel title="Hent værksdata">
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
                {editUnifiedResults.length > 0 && (
                  <div className="space-y-2">
                    {editUnifiedResults.map(result => (
                      <button key={result.id} type="button" onClick={() => applyUnifiedToEdit(result)} className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-muted">
                        <span><span className="font-medium">{result.title}</span><span className="ml-2 text-xs text-muted-foreground">{result.year ?? "-"} · {workTypeLabel(result.type)}</span></span>
                        <span className="flex gap-1">{result.sources.map(source => <Badge key={source} variant="secondary" className="uppercase">{source}</Badge>)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {importPreview && <p className="text-sm text-muted-foreground">Værksdata er hentet og udfyldt i felterne ovenfor.</p>}
              </InfoPanel>
            </div>
              );
            })()
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Slet valgte værker permanent</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Permanent sletning
              </div>
              <p>
                Du er ved at slette {selectedWorks.length} værk(er) permanent fra værkdatabasen. Dette kan ikke fortrydes.
              </p>
              <ul className="mt-2 max-h-32 overflow-y-auto list-disc pl-5 text-xs text-red-800">
                {selectedWorks.map(w => (
                  <li key={w.id}>{w.title}</li>
                ))}
              </ul>
            </div>
            {(totalAssignments > 0 || totalContracts > 0) && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  Værkerne har relationer
                </div>
                <p>
                  Der er i alt {totalAssignments} rettighedshaver-tilknytning(er) og {totalContracts} kontrakt(er) tilknyttet de valgte værker.
                </p>
                <p className="mt-1">
                  Sletning fjerner rettighedshaver-tilknytninger og afkobler kontrakter fra de valgte værker.
                </p>
              </div>
            )}
            <p className="text-muted-foreground">
              Brug Arkiver værk, hvis historik og relationer skal bevares.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDeleteOpen(false)}>Annuller</Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSelectedPermanently}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Slet permanent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingDeleteOpen} onOpenChange={setEditingDeleteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Slet værk permanent</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Permanent sletning
              </div>
              <p>
                Du er ved at slette “{editing?.title ?? "værket"}” fuldstændigt fra værkdatabasen.
              </p>
            </div>
            {((editing?.work_assignments?.length ?? 0) > 0 || (editing?.contracts?.length ?? 0) > 0) && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  Værket har relationer
                </div>
                <p>
                  {editing?.work_assignments?.length ?? 0} rettighedshaver{(editing?.work_assignments?.length ?? 0) === 1 ? "" : "e"} og {editing?.contracts?.length ?? 0} kontrakt{(editing?.contracts?.length ?? 0) === 1 ? "" : "er"} er tilknyttet værket.
                </p>
                <p className="mt-1">
                  Sletning fjerner rettighedshaver-tilknytninger og afkobler kontrakter fra værket.
                </p>
              </div>
            )}
            <p className="text-muted-foreground">
              Brug Arkiver værk, hvis historik og relationer skal bevares.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDeleteOpen(false)}>Annuller</Button>
            <Button
              variant="destructive"
              onClick={handleDeleteEditingPermanently}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Slet permanent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingArchiveOpen} onOpenChange={setEditingArchiveOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Arkiver værk</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Værket bliver arkiveret
              </div>
              <p>
                “{editing?.title ?? "Værket"}” får status arkiveret. Kontrakter, rettighedshavere og historik bevares.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingArchiveOpen(false)}>Annuller</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setEditingArchiveOpen(false);
                await handleSetEditingStatus("arkiveret");
              }}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Arkiver værk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={open => {
        setAddOpen(open);
        if (!open) {
          setAddManualMode(false);
          setAddTypeFilter("all");
          setAddAssignments([]);
          setAddDistributions([]);
          setAddForm(defaultAddForm());
          setPickedResult(null);
          setPickedSource(null);
          setPickedUnifiedAddResult(null);
          setUnifiedAddResults([]);
          setAddEpisodeOptions([]);
          setAddSelectedEpisodes([]);
          setAddSeasonNumber("1");
          setAddForceExternalSearch(false);
        }
      }}>
        <DialogContent className="max-h-[92vh] sm:max-w-5xl md:max-w-5xl lg:max-w-5xl xl:max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>Tilføj værk</DialogTitle></DialogHeader>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <InfoPanel title="Søg i lokal database, DFI og TMDB">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    autoFocus
                    placeholder="Søg titel i lokal database, DFI og TMDB..."
                    value={addQuery}
                    onChange={e => setAddQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddSearch(); }}
                  />
                  <Select value={addTypeFilter} onValueChange={setAddTypeFilter}>
                    <SelectTrigger className="sm:w-48"><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Type</SelectItem>
                      {WORK_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={handleAddSearch} disabled={isSearchingAdd} className="gap-2">
                    {isSearchingAdd ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Søg
                  </Button>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={addForceExternalSearch}
                    onChange={e => setAddForceExternalSearch(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-input"
                  />
                  Tving ekstern søgning
                </label>
                {unifiedAddResults.some(result => result.sources.includes("local")) && (
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
                {unifiedAddResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">{unifiedAddResults.filter(result => addTypeFilter === "all" || result.type === addTypeFilter).length} resultater</p>
                    <div className="max-h-80 overflow-auto rounded-md border">
                      {unifiedAddResults.filter(result => addTypeFilter === "all" || result.type === addTypeFilter).map(result => {
                        const selected = pickedUnifiedAddResult?.id === result.id;
                        return (
                          <button
                            key={result.id}
                            type="button"
                            className={`flex w-full items-start gap-3 border-b p-3 text-left last:border-b-0 hover:bg-muted/60 ${selected ? "bg-muted" : ""}`}
                            onClick={() => void pickUnifiedAddResult(result)}
                          >
                            {result.poster_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={result.poster_url} alt="" className="h-16 w-11 rounded object-cover" loading="lazy" />
                            ) : (
                              <div className="flex h-16 w-11 items-center justify-center rounded bg-muted">
                                <Film className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate font-medium">{result.title}</p>
                                {result.sources.map(source => (
                                  <Badge key={source} variant={source === "local" ? "default" : "secondary"} className="uppercase">
                                    {source === "local" ? "Findes allerede" : source}
                                  </Badge>
                                ))}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {result.year ?? "-"} · {workTypeLabel(result.type)}{result.imdb_id ? ` · IMDb ${result.imdb_id}` : ""}
                              </p>
                              {result.description && (
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.description}</p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {pickedUnifiedAddResult && (pickedUnifiedAddResult.type === "tv-serie" || pickedUnifiedAddResult.type === "dokumentar-serie") && (
                  <div className="rounded-md border p-3">
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <SeasonStepper
                        value={Number(addSeasonNumber) || 1}
                        onChange={season => {
                          setAddSeasonNumber(String(season));
                          setAddSelectedEpisodes([]);
                        }}
                        compact
                      />
                    </div>
                    {addEpisodesLoading ? (
                      <div className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Henter afsnit...
                      </div>
                    ) : addEpisodesError ? (
                      <p className="text-xs text-destructive">{addEpisodesError}</p>
                    ) : (
                      <SeriesEpisodeSelector
                        season={Number(addSeasonNumber) || 1}
                        onSeasonChange={season => setAddSeasonNumber(String(season))}
                        options={buildCompleteEpisodeOptions({
                          episodeCount: Math.max(Number(addForm.episode_count) || 0, addEpisodeOptions.length),
                          externalOptions: addEpisodeOptions,
                          seasonNumber: Number(addSeasonNumber) || 1,
                        })}
                        selected={addSelectedEpisodes}
                        onSelectedChange={setAddSelectedEpisodes}
                        showSeason={false}
                        compact
                      />
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Skift sæson for at tilføje afsnit eller en hel sæson fra en anden sæson af samme serie.
                      Hvis du vælger en rettighedshaver, tilknyttes personen de valgte afsnit.
                    </p>
                  </div>
                )}
              </InfoPanel>

              {!pickedUnifiedAddResult && !addManualMode && (
                <button
                  type="button"
                  onClick={() => {
                    setAddManualMode(true);
                    setPickedResult(null);
                    setPickedSource(null);
                    setAddForm(form => ({ ...defaultAddForm(), title: form.title || addQuery }));
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-4 py-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                  Opret værk manuelt
                </button>
              )}

              {(addManualMode || pickedUnifiedAddResult) && <InfoPanel title={addManualMode ? "Manuel oprettelse" : "Gennemgå valgte data"}>
                <div className="mb-2 flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => { setAddForm(defaultAddForm()); setPickedResult(null); setPickedSource(null); setPickedUnifiedAddResult(null); setAddEpisodeOptions([]); setAddSelectedEpisodes([]); setAddSeasonNumber("1"); }}>
                    Ryd
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Titel"><Input value={addForm.title} onChange={e => setAddForm({ ...addForm, title: e.target.value })} /></Field>
                  <Field label="Værktype">
                    <Select value={addForm.type} onValueChange={type => setAddForm({ ...addForm, type })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WORK_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Premiereår"><Input value={addForm.year} onChange={e => setAddForm({ ...addForm, year: e.target.value })} /></Field>
                  <Field label="Varighed"><Input value={addForm.duration_minutes} onChange={e => setAddForm({ ...addForm, duration_minutes: e.target.value })} /></Field>
                  <Field label="Sæsoner"><Input value={addForm.season_count} onChange={e => setAddForm({ ...addForm, season_count: e.target.value })} /></Field>
                  <Field label="Afsnit"><Input value={addForm.episode_count} onChange={e => setAddForm({ ...addForm, episode_count: e.target.value })} /></Field>
                  <Field label="Genre"><Input value={addForm.genre} onChange={e => setAddForm({ ...addForm, genre: e.target.value })} /></Field>
                  <Field label="Instruktør"><Input value={addForm.director} onChange={e => setAddForm({ ...addForm, director: e.target.value })} /></Field>
                  <Field label="Alternative titler"><Input value={addForm.alternative_titles} onChange={e => setAddForm({ ...addForm, alternative_titles: e.target.value })} /></Field>
                  <Field label="Produktionslande"><Input value={addForm.production_countries} onChange={e => setAddForm({ ...addForm, production_countries: e.target.value })} /></Field>
                  <Field label="Produktionsselskaber"><Input value={addForm.production_companies} onChange={e => setAddForm({ ...addForm, production_companies: e.target.value })} /></Field>
                  <div className="md:col-span-2"><Field label="Beskrivelse"><Textarea value={addForm.description} onChange={e => setAddForm({ ...addForm, description: e.target.value })} /></Field></div>
                  <Field label="DFI ID"><Input value={addForm.dfi_id} onChange={e => setAddForm({ ...addForm, dfi_id: e.target.value })} /></Field>
                  <Field label="TMDB ID"><Input value={addForm.tmdb_id} onChange={e => setAddForm({ ...addForm, tmdb_id: e.target.value })} /></Field>
                  <Field label="IMDb ID"><Input value={addForm.imdb_id} onChange={e => setAddForm({ ...addForm, imdb_id: e.target.value })} /></Field>
                  <Field label="Poster-link"><Input value={addForm.poster_url} onChange={e => setAddForm({ ...addForm, poster_url: e.target.value })} /></Field>
                  <Field label="DFI titel"><Input value={addForm.dfi_title} onChange={e => setAddForm({ ...addForm, dfi_title: e.target.value })} /></Field>
                  <Field label="DanishTitle"><Input value={addForm.dfi_danish_title} onChange={e => setAddForm({ ...addForm, dfi_danish_title: e.target.value })} /></Field>
                  <Field label="Original / work Title"><Input value={addForm.dfi_original_title} onChange={e => setAddForm({ ...addForm, dfi_original_title: e.target.value })} /></Field>
                  <Field label="DFI kategori"><Input value={addForm.dfi_category} onChange={e => setAddForm({ ...addForm, dfi_category: e.target.value })} /></Field>
                  <Field label="DFI type"><Input value={addForm.dfi_type} onChange={e => setAddForm({ ...addForm, dfi_type: e.target.value })} /></Field>
                  <Field label="Status">
                    <Select value={addForm.status} onValueChange={status => setAddForm({ ...addForm, status })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="godkendt">Godkendt</SelectItem>
                        <SelectItem value="til_godkendelse">Til godkendelse</SelectItem>
                        <SelectItem value="afsluttet">Afsluttet</SelectItem>
                        <SelectItem value="arkiveret">Arkiveret</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="md:col-span-2"><DistributionEditor value={addDistributions} onChange={setAddDistributions} options={broadcasterOptions} /></div>
                </div>
              </InfoPanel>}
            </div>
            <div className="space-y-4">
              {(addManualMode || pickedUnifiedAddResult) && <InfoPanel title="Rettighedshavere og kreditering">
                <div className="space-y-3">
                  {addAssignments.map((assignment, index) => (
                    <div key={`${assignment.rightsHolderId}-${index}`} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Rettighedshaver {index + 1}</span>
                        <Button type="button" size="icon" variant="ghost" onClick={() => setAddAssignments(prev => prev.filter((_, itemIndex) => itemIndex !== index))} aria-label="Fjern rettighedshaver">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <Select value={assignment.rightsHolderId ?? ""} onValueChange={rightsHolderId => setAddAssignments(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, rightsHolderId } : item))}>
                        <SelectTrigger><SelectValue placeholder="Vælg rettighedshaver" /></SelectTrigger>
                        <SelectContent>{rightsHolders.filter(holder => !addAssignments.some((item, itemIndex) => itemIndex !== index && item.rightsHolderId === holder.id)).map(holder => <SelectItem key={holder.id} value={holder.id}>{holder.full_name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={assignment.role} onValueChange={role => setAddAssignments(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, role } : item))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{CREDIT_ROLES.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent>
                      </Select>
                      <Field label="Andel %"><Input inputMode="numeric" maxLength={3} className="w-20" value={assignment.sharePercent} onChange={e => setAddAssignments(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, sharePercent: e.target.value } : item))} /></Field>
                    </div>
                  ))}
                  <Button type="button" variant="outline" className="w-full gap-2" onClick={() => setAddAssignments(prev => [...prev, { rightsHolderId: "", role: "Klipper", sharePercent: "" }])}>
                    <Plus className="h-4 w-4" /> Tilføj rettighedshaver
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Du kan tilføje og redigere flere rettighedshavere, før værket gemmes.</p>
                {addRequiresEpisodeSelection && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Vælg mindst ét afsnit, når du tilknytter en rettighedshaver til en serie.
                  </p>
                )}
              </InfoPanel>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Annuller</Button>
            <Button onClick={handleCreateWork} disabled={saving || !addForm.title.trim() || addRequiresEpisodeSelection}>
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
                    <div key={`${work.id}-${contract.id}`} className="rounded bg-background/70 px-2 py-1">
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

function DistributionEditor({ value, onChange, options }: { value: DistributionDraft[]; onChange: (value: DistributionDraft[]) => void; options: BroadcasterOption[] }) {
  const update = (index: number, patch: Partial<DistributionDraft>) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2"><Label>Broadcastere og streamere</Label><Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, { broadcasterName: "", distributionType: "both", validFromYear: "", validToYear: "" }])}><Plus className="mr-1 h-4 w-4" />Tilføj</Button></div>
      {value.length === 0 ? <p className="text-xs text-muted-foreground">Ingen broadcastere eller streamere tilknyttet.</p> : value.map((item, index) => (
        <div key={index} className="grid gap-2 rounded border p-2 sm:grid-cols-[minmax(180px,1fr)_100px_100px_auto]">
          <Select value={item.broadcasterName} onValueChange={broadcasterName => update(index, { broadcasterName })}><SelectTrigger><SelectValue placeholder="Vælg broadcaster" /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.name} value={option.name}>{option.name}</SelectItem>)}</SelectContent></Select>
          <Input inputMode="numeric" placeholder="Fra år" value={item.validFromYear} onChange={event => update(index, { validFromYear: event.target.value })} />
          <Input inputMode="numeric" placeholder="Til år" value={item.validToYear} onChange={event => update(index, { validToYear: event.target.value })} />
          <Button type="button" size="icon" variant="ghost" aria-label="Fjern broadcaster" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
    </div>
  );
}

function Field({ label, source, children }: { label: string; source?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-2">
        {label}
        {source && <span title={`Kilde: ${source}`} className="rounded-full border px-1.5 py-0.5 text-[10px] font-normal uppercase text-muted-foreground">{source}</span>}
      </Label>
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
