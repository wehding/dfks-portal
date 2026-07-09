"use client";

import React, { useState, useEffect } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "./Modal";
import { searchDFIFilms, getDFIFilmDetails } from "@/app/actions/dfi";
import { searchTMDB, getTMDBWorkDetails } from "@/app/actions/tmdb";
import { addWorkForMemberWithApproval, linkExistingWorkForMember, searchLocalWorksForMember, searchWorksUnified, resolveUnifiedSearchResultDetails, type UnifiedSearchWorkResult } from "@/app/actions/member-works";
import { cleanDfiTitle, extractDfiDirectors, extractDfiPosterUrl, extractDfiPremiereYear, mapDfiWorkType, parseDfiEpisodeCount, parseDfiEpisodeTitleInfo, type DfiMetadata } from "@/lib/dfi-metadata";
import { useI18n } from "@/lib/i18n";

const TMDB_IMG_W185 = "https://image.tmdb.org/t/p/w185";
const ROLES = ["B-klipper", "Klipper", "Konceptuerende klipper"];
const WORK_TYPES = [
  { value: "kortfilm", label: "Kortfilm" },
  { value: "spillefilm", label: "Spillefilm" },
  { value: "tv-serie", label: "Tv-serie" },
  { value: "dokumentarfilm", label: "Dokumentarfilm" },
  { value: "dokumentar-serie", label: "Dokumentar-serie" },
];

const selectCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400";

interface CoEditorDraft {
  id: string;
  name: string;
  role: string;
  assignmentId?: string | null;
  rightsHolderId?: string | null;
  locked?: boolean;
  action?: "add" | "remove" | "change";
}

interface ManualWorkForm {
  title: string;
  type: string;
  year: string;
  duration_minutes: string;
  episode_count: string;
  genre: string;
  director: string;
}

interface LocalWorkResult {
  id: string;
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  episode_count: number | null;
  season_number: number | null;
  episode_number: number | null;
  genre: string | null;
  director: string | null;
  status: string;
  dfi_id: string | null;
  tmdb_id: number | null;
  poster_url: string | null;
  description: string | null;
  work_assignments: WorkAssignmentPreview[];
}

interface WorkAssignmentPreview {
  id: string;
  role?: string | null;
  rights_holder_id?: string | null;
  rettighedshavere?: {
    id?: string | null;
    full_name?: string | null;
  } | null;
}

interface DfiPersonCredit {
  TypeCode?: string | null;
  Type?: string | null;
  Function?: string | null;
  Credit?: string | null;
  Description?: string | null;
  Name?: string | null;
}

interface DfiSearchResult {
  Id: number;
  Title?: string;
  ReleaseYear?: number;
  ProductionYear?: number;
  Premiere?: unknown;
  Category?: string;
  Description?: string;
  Type?: string;
  PersonCredits?: DfiPersonCredit[];
  Synopsis?: string;
  ShortSynopsis?: string;
  DanishTitle?: string;
}

type DfiFilm = DfiSearchResult & {
  Id: number | string;
  OriginalTitle?: string | null;
  Comment?: string | null;
  Duration?: number | string | null;
  Parent?: { Id?: number | string | null; Title?: string | null } | null;
  Children?: Array<{ Id?: number | string | null; Title?: string | null }>;
};

interface TmdbSearchResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string | null;
  first_air_date?: string | null;
  media_type?: string;
  poster_path?: string | null;
  overview?: string | null;
}

type TmdbDetails = TmdbSearchResult & {
  seasons?: Array<{ season_number: number; episode_count?: number | null }>;
};

type SearchItem = LocalWorkResult | DfiSearchResult | TmdbSearchResult;

interface ResultColumnDef {
  label: string;
  items: SearchItem[];
  getKey: (item: SearchItem) => string;
  isSelected: (item: SearchItem) => boolean;
  onSelect: (item: SearchItem) => void;
  getTitle: (item: SearchItem) => string;
  getMeta: (item: SearchItem) => string;
  getPoster: (item: SearchItem) => string | null;
}

interface EpisodeOption {
  number: number;
  title: string;
  dfiId?: string | null;
}

interface AddWorkModalProps {
  isOpen: boolean;
  onClose: () => void;
  rightsHolderId: string | null;
  onWorkAdded: (message: string, success: boolean) => void;
  reloadAssignments: () => Promise<void>;
  locale: string;
  initialQuery?: string;
}

function emptyManualWorkForm(): ManualWorkForm {
  return {
    title: "",
    type: "spillefilm",
    year: "",
    duration_minutes: "",
    episode_count: "",
    genre: "",
    director: "",
  };
}

function emptyCoEditor(): CoEditorDraft {
  return { id: crypto.randomUUID(), name: "", role: "Klipper", action: "add" };
}

function displayRole(role: string | null | undefined) {
  return role === "Hovedklipper" ? "Konceptuerende klipper" : role ?? "Klipper";
}

function searchItemTitle(item: SearchItem | null) {
  if (!item) return "";
  if ("Title" in item) {
    const dfiItem = item as DfiSearchResult;
    return cleanDfiTitle(dfiItem.Title || dfiItem.DanishTitle || "");
  }
  if ("media_type" in item || "name" in item) {
    const tmdbItem = item as TmdbSearchResult;
    return tmdbItem.title || tmdbItem.name || "";
  }
  return (item as LocalWorkResult).title;
}

function localWorkToCoEditors(work: LocalWorkResult | null): CoEditorDraft[] {
  return (work?.work_assignments ?? []).map(assignment => ({
    id: assignment.id,
    name: assignment.rettighedshavere?.full_name ?? "Ukendt medklipper",
    role: displayRole(assignment.role),
    assignmentId: assignment.id,
    rightsHolderId: assignment.rights_holder_id ?? assignment.rettighedshavere?.id ?? null,
    locked: true,
  }));
}

// Kun rene klipper/editor-krediteringer — ikke klipassistenter, colorister
// eller andre postproduktionsroller (DFI TypeCode for klipper er "klip").
const DFI_EDITOR_CODES = new Set(["klip", "editor", "edit"]);
const DFI_EDITOR_TYPES = new Set(["klip", "editor"]);

function extractDfiCoEditors(film: DfiSearchResult): CoEditorDraft[] {
  const credits = Array.isArray(film.PersonCredits) ? film.PersonCredits : [];
  return credits
    .filter(credit => {
      const code = String(credit.TypeCode ?? "").toLowerCase().trim();
      const type = String(credit.Type ?? "").toLowerCase().trim();
      // DFI angiver den specifikke rolle i Description (fx "Klipper" vs "Klippeassistent").
      const roleText = `${credit.Description ?? ""} ${credit.Function ?? ""} ${credit.Credit ?? ""}`.toLowerCase();
      const isEditorCategory = DFI_EDITOR_CODES.has(code) || DFI_EDITOR_TYPES.has(type);
      // Kun rene klippere — ikke klipassistenter, colorister, lyd osv.
      const isAssistantOrOther = /assist|elev|trainee|prakt|farve|color|grade|online|vfx|lyd|sound/.test(`${code} ${type} ${roleText}`);
      return isEditorCategory && !isAssistantOrOther;
    })
    .map(credit => ({
      id: crypto.randomUUID(),
      name: credit.Name ?? "",
      role: "Klipper",
      action: "add" as const,
    }))
    .filter(editor => editor.name.trim());
}

function typeLabel(type: string | null, lang: string) {
  if (!type) return "";
  const t = type.toLowerCase();
  if (lang === "en") {
    if (t === "spillefilm") return "Feature Film";
    if (t === "kortfilm") return "Short Film";
    if (t === "tv-serie" || t === "serie") return "TV Series";
    if (t === "dokumentarfilm") return "Documentary";
    if (t === "dokumentar-serie") return "Docu-Series";
    return type;
  }
  if (t === "spillefilm") return "Spillefilm";
  if (t === "kortfilm") return "Kortfilm";
  if (t === "tv-serie" || t === "serie") return "Tv-serie";
  if (t === "dokumentarfilm") return "Dokumentarfilm";
  if (t === "dokumentar-serie") return "Dokumentar-serie";
  return type;
}

function numberOrNull(val: string) {
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

function asDfiFilm(film: DfiSearchResult | DfiFilm): DfiFilm {
  return film as DfiFilm;
}

function dfiNumericId(value: number | string | null | undefined) {
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

function dfiResultFromFilm(film: DfiFilm, fallback: DfiSearchResult): DfiSearchResult {
  const id = dfiNumericId(film.Id) ?? fallback.Id;
  return {
    ...fallback,
    Id: id,
    Title: film.Title || film.DanishTitle || fallback.Title,
    DanishTitle: film.DanishTitle || fallback.DanishTitle,
    Category: film.Category || fallback.Category,
    Type: film.Type || fallback.Type,
    ReleaseYear: film.ReleaseYear || fallback.ReleaseYear,
    ProductionYear: film.ProductionYear || fallback.ProductionYear,
    Synopsis: film.Synopsis || fallback.Synopsis,
    ShortSynopsis: film.ShortSynopsis || fallback.ShortSynopsis,
    PersonCredits: film.PersonCredits || fallback.PersonCredits,
  };
}

function countDfiEpisodes(film: DfiFilm) {
  const commentCount = parseDfiEpisodeCount(film.Comment || film.Synopsis || "");
  if (commentCount) return commentCount;
  const children = Array.isArray(film.Children) ? film.Children : [];
  const episodeChildren = children.filter(child => parseDfiEpisodeTitleInfo(child.Title ?? ""));
  return episodeChildren.length || null;
}

function isDfiChildResult(result: DfiSearchResult) {
  const film = result as DfiFilm;
  return Boolean(dfiNumericId(film.Parent?.Id)) || Boolean(parseDfiEpisodeTitleInfo(result.Title ?? ""));
}

function dfiEpisodeOptions(film: DfiFilm): EpisodeOption[] {
  const children = Array.isArray(film.Children) ? film.Children : [];
  const options = children
    .map((child, index) => {
      const parsed = parseDfiEpisodeTitleInfo(child.Title ?? "");
      const number = parsed?.episodeNumber ?? index + 1;
      const title = parsed?.subtitle || child.Title || `Afsnit ${number}`;
      return {
        number,
        title,
        dfiId: child.Id ? String(child.Id) : null,
      };
    })
    .filter(option => Number.isFinite(option.number) && option.number > 0);

  if (options.length) {
    return Array.from(new Map(options.map(option => [option.number, option])).values())
      .sort((a, b) => a.number - b.number);
  }

  const count = countDfiEpisodes(film);
  return count
    ? Array.from({ length: count }, (_, index) => ({
        number: index + 1,
        title: `Afsnit ${index + 1}`,
      }))
    : [];
}

function findDfiEpisodeNumber(parentFilm: DfiFilm, childFilm: DfiFilm) {
  const childId = dfiNumericId(childFilm.Id);
  const children = Array.isArray(parentFilm.Children) ? parentFilm.Children : [];
  const matchingChild = children.find(child => childId && dfiNumericId(child.Id) === childId);
  const parsed = parseDfiEpisodeTitleInfo(matchingChild?.Title ?? childFilm.Title ?? "");
  if (parsed?.episodeNumber) return parsed.episodeNumber;
  const index = matchingChild ? children.indexOf(matchingChild) : -1;
  return index >= 0 ? index + 1 : null;
}

async function resolveDfiSelection(result: DfiSearchResult) {
  const details = await getDFIFilmDetails(Number(result.Id));
  const firstFilm = asDfiFilm((details.success ? (details as { film?: DfiSearchResult }).film : result) ?? result);
  const parentId = dfiNumericId(firstFilm.Parent?.Id);

  if (!parentId) {
    return {
      film: firstFilm,
      result: dfiResultFromFilm(firstFilm, result),
      posterDataUrl: details.success ? details.posterDataUrl ?? null : null,
      selectedEpisode: null as number | null,
    };
  }

  const parentDetails = await getDFIFilmDetails(parentId);
  const parentFilm = asDfiFilm((parentDetails.success ? (parentDetails as { film?: DfiSearchResult }).film : undefined) ?? {
    ...result,
    Id: parentId,
    Title: firstFilm.Parent?.Title || result.Title,
  });

  return {
    film: parentFilm,
    result: dfiResultFromFilm(parentFilm, { ...result, Id: parentId }),
    posterDataUrl: (parentDetails.success ? parentDetails.posterDataUrl ?? null : null) ?? (details.success ? details.posterDataUrl ?? null : null),
    selectedEpisode: findDfiEpisodeNumber(parentFilm, firstFilm),
  };
}

export function AddWorkModal({
  isOpen,
  onClose,
  rightsHolderId,
  onWorkAdded,
  reloadAssignments,
  locale,
  initialQuery = "",
}: AddWorkModalProps) {
  const { t } = useI18n();
  const [addQuery, setAddQuery]               = useState("");
  const [addRole, setAddRole]                 = useState("Klipper");
  const [manualMode, setManualMode]           = useState(false);
  const [manualWork, setManualWork]           = useState<ManualWorkForm>(emptyManualWorkForm());
  const [addSeason, setAddSeason]             = useState("");
  const [addEpisode, setAddEpisode]           = useState("");
  const [detectedEpisodeCount, setDetectedEpisodeCount] = useState<number | null>(null);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [selectedEpisodes, setSelectedEpisodes] = useState<number[]>([]);
  const [episodeOptions, setEpisodeOptions] = useState<EpisodeOption[]>([]);
  const [addComment, setAddComment]           = useState("");

  const [addCoEditors, setAddCoEditors]       = useState<CoEditorDraft[]>([]);
  const [unifiedResults, setUnifiedResults]   = useState<UnifiedSearchWorkResult[]>([]);
  const [pickedUnifiedResult, setPickedUnifiedResult] = useState<UnifiedSearchWorkResult | null>(null);
  const [isSearching, setIsSearching]         = useState(false);
  const [detailsLoading, setDetailsLoading]   = useState(false);
  const [hasSearchedAdd, setHasSearchedAdd]   = useState(false);
  const [isSaving, setIsSaving]               = useState(false);
  const autoSearchKeyRef = React.useRef("");

  useEffect(() => {
    const updateTmdbEpisodes = async () => {
      if (pickedUnifiedResult && (pickedUnifiedResult.type === "tv-serie" || pickedUnifiedResult.type === "dokumentar-serie")) {
        const tmdbId = pickedUnifiedResult.tmdb_id;
        if (tmdbId) {
          setEpisodesLoading(true);
          try {
            const det = await getTMDBWorkDetails(tmdbId, "tv");
            if (det.success && det.details) {
              const d = det.details as any;
              const sNum = parseInt(addSeason) || 1;
              const season = d.seasons?.find((s: any) => s.season_number === sNum);
              const count = season ? season.episode_count : null;
              if (count) {
                setDetectedEpisodeCount(count);
                setEpisodeOptions(Array.from({ length: count }, (_, idx) => ({ number: idx + 1, title: `Afsnit ${idx + 1}` })));
                setSelectedEpisodes(prev => prev.filter(x => x <= count));
              }
            }
          } catch (e) {
            console.error(e);
          }
          finally {
            setEpisodesLoading(false);
          }
        }
      }
    };
    updateTmdbEpisodes();
  }, [addSeason, pickedUnifiedResult]);

  useEffect(() => {
    if (manualMode && (manualWork.type === "tv-serie" || manualWork.type === "dokumentar-serie")) {
      const count = parseInt(manualWork.episode_count) || null;
      setDetectedEpisodeCount(count);
      if (count) {
        setEpisodeOptions(Array.from({ length: count }, (_, i) => ({ number: i + 1, title: `Afsnit ${i + 1}` })));
        setSelectedEpisodes(prev => {
          const filtered = prev.filter(x => x <= count);
          if (filtered.length === 0) {
            return Array.from({ length: count }, (_, i) => i + 1);
          }
          return filtered;
        });
      } else {
        setEpisodeOptions([]);
        setSelectedEpisodes([]);
      }
    }
  }, [manualMode, manualWork.episode_count, manualWork.type]);

  const resetAddState = React.useCallback(() => {
    autoSearchKeyRef.current = "";
    setManualMode(false);
    setHasSearchedAdd(false);
    setManualWork(emptyManualWorkForm());
    setAddQuery(initialQuery);
    setAddComment("");
    setAddCoEditors([]);
    setUnifiedResults([]);
    setPickedUnifiedResult(null);
    setAddSeason("");
    setAddEpisode("");
    setDetectedEpisodeCount(null);
    setSelectedEpisodes([]);
    setEpisodeOptions([]);
  }, [initialQuery]);

  useEffect(() => {
    if (isOpen) {
      resetAddState();
    }
  }, [isOpen, resetAddState]);

  const handleSearch = async (queryOverride?: string) => {
    const query = (queryOverride ?? addQuery).trim();
    if (!query) return;
    if (queryOverride) setAddQuery(query);
    setIsSearching(true);
    setHasSearchedAdd(true);
    setUnifiedResults([]);
    setPickedUnifiedResult(null);
    setAddCoEditors([]);

    try {
      const res = await searchWorksUnified(query);
      if (res.success && res.results) {
        setUnifiedResults(res.results);
        if (res.results.length > 0) {
          await pickUnifiedResult(res.results[0]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !initialQuery.trim()) return;
    const key = initialQuery.trim();
    if (autoSearchKeyRef.current === key) return;
    autoSearchKeyRef.current = key;
    const timer = window.setTimeout(() => {
      void handleSearch(key);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, initialQuery]);

  const pickUnifiedResult = async (result: UnifiedSearchWorkResult) => {
    setPickedUnifiedResult(result);
    setManualMode(false);
    setAddCoEditors([]);
    setDetectedEpisodeCount(null);
    setSelectedEpisodes([]);
    setEpisodeOptions([]);
    setDetailsLoading(true);

    try {
      if (result.local_id && result.raw_local) {
        setAddCoEditors(localWorkToCoEditors(result.raw_local));
      }

      const isSeries = result.type === "tv-serie" || result.type === "dokumentar-serie";
      if (isSeries) {
        const detRes = await resolveUnifiedSearchResultDetails(result);
        if (detRes.success && detRes.details) {
          const d = detRes.details;
          const options = d.episode_options || [];
          const count = d.episode_count || options.length;

          if (count) {
            setDetectedEpisodeCount(count);
            setEpisodeOptions(options.length ? options : Array.from({ length: count }, (_, i) => ({ number: i + 1, title: `Afsnit ${i + 1}` })));
            setSelectedEpisodes([]);
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeAfterSuccess = () => {
    resetAddState();
    onClose();
    void reloadAssignments();
  };

  const handleAddWork = async () => {
    if ((!manualMode && !pickedUnifiedResult) || !rightsHolderId) return;
    setIsSaving(true);
    try {
      const selectedSeasonNumber = showSeriesFields ? numberOrNull(addSeason) ?? 1 : numberOrNull(addSeason);
      if (showSeriesFields && detectedEpisodeCount !== null && selectedEpisodes.length === 0) {
        throw new Error(locale === "da" ? "Vælg mindst ét afsnit." : "Select at least one episode.");
      }

      if (manualMode) {
        const res = await addWorkForMemberWithApproval({
          rightsHolderId,
          role: addRole,
          comment: addComment,
          source: "manual",
          overrideLocalMatch: false,
          coEditors: addCoEditors.filter(editor => !editor.locked && editor.name.trim()),
          workData: {
            title: manualWork.title,
            type: manualWork.type,
            year: numberOrNull(manualWork.year),
            duration_minutes: numberOrNull(manualWork.duration_minutes),
            episode_count: numberOrNull(manualWork.episode_count),
            season_number: selectedSeasonNumber,
            episode_number: numberOrNull(addEpisode),
            selected_episodes: selectedEpisodes,
            genre: manualWork.genre || null,
            director: manualWork.director || null,
            description: null,
          },
        });
        if (!res.success) throw new Error(res.error ?? t("works.createFailed"));
        onWorkAdded(res.pending ? t("works.pendingApproval") : t("works.added"), true);
        await closeAfterSuccess();
        return;
      }

      if (pickedUnifiedResult) {
        const u = pickedUnifiedResult;
        if (u.local_id) {
          const res = await linkExistingWorkForMember({
            rightsHolderId,
            workId: u.local_id,
            role: addRole,
            comment: addComment,
            coEditors: addCoEditors.filter(editor => !editor.locked && editor.name.trim()),
            seasonNumber: selectedSeasonNumber,
            episodeNumber: numberOrNull(addEpisode),
            selectedEpisodes,
          });
          if (!res.success) throw new Error(res.error ?? t("works.createFailed"));
          onWorkAdded(res.pending ? t("works.addedPending") : t("works.added"), true);
          await closeAfterSuccess();
          return;
        } else {
          setDetailsLoading(true);
          const detailsRes = await resolveUnifiedSearchResultDetails(u);
          setDetailsLoading(false);
          if (!detailsRes.success || !detailsRes.details) {
            throw new Error(locale === "da" ? "Kunne ikke hente detaljer for det valgte værk." : "Could not fetch details for selected work.");
          }
          const d = detailsRes.details;

          const res = await addWorkForMemberWithApproval({
            rightsHolderId,
            role: addRole,
            comment: addComment,
            source: u.sources.includes("dfi") ? "dfi" : "tmdb",
            overrideLocalMatch: false,
            coEditors: addCoEditors.filter(editor => !editor.locked && editor.name.trim()),
            workData: {
              dfi_id: d.dfi_id ? String(d.dfi_id) : undefined,
              tmdb_id: d.tmdb_id ? Number(d.tmdb_id) : undefined,
              imdb_id: d.imdb_id ?? undefined,
              wikidata_id: d.wikidata_id ?? undefined,
              title: d.title,
              type: d.type,
              year: d.year,
              director: d.director ?? undefined,
              genre: d.genre ?? undefined,
              duration_minutes: d.duration_minutes ?? undefined,
              season_number: selectedSeasonNumber,
              episode_number: numberOrNull(addEpisode),
              selected_episodes: selectedEpisodes,
              episode_count: d.episode_count ?? undefined,
              description: d.description,
              poster_url: d.poster_url,
              dfi_metadata: d.dfi_metadata ?? undefined,
            },
          });
          if (!res.success) throw new Error(res.error ?? t("works.createFailed"));
          onWorkAdded(res.pending ? t("works.pendingApproval") : t("works.added"), true);
          await closeAfterSuccess();
          return;
        }
      }
    } catch (err: unknown) {
      onWorkAdded(err instanceof Error ? err.message : t("common.genericError"), false);
    } finally {
      setIsSaving(false);
    }
  };

  const showSeriesFields =
    (manualMode && (manualWork.type === "tv-serie" || manualWork.type === "dokumentar-serie")) ||
    (!manualMode &&
      pickedUnifiedResult &&
      (pickedUnifiedResult.type === "tv-serie" || pickedUnifiedResult.type === "dokumentar-serie"));
  const selectedEpisodeLabel = selectedEpisodes.length > 0
    ? selectedEpisodes.join(", ")
    : numberOrNull(addEpisode)
    ? String(numberOrNull(addEpisode))
    : "";
  const chosenTitle = manualMode ? manualWork.title : pickedUnifiedResult?.title ?? "";
  const chosenSummary = showSeriesFields && selectedEpisodeLabel
    ? `${chosenTitle}, ${locale === "da" ? "afsnit" : "episodes"} ${selectedEpisodeLabel}`
    : chosenTitle;
  const missingSeriesEpisodes = Boolean(showSeriesFields && detectedEpisodeCount !== null && selectedEpisodes.length === 0);
  const noSearchResults = hasSearchedAdd && !isSearching && unifiedResults.length === 0;

  const seriesEpisodePicker = (
    <div className="mt-3 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-500">{t("works.season")}</Label>
          <Input type="number" min="1" placeholder="1" value={addSeason} onChange={e => setAddSeason(e.target.value)} />
        </div>
        {!episodesLoading && detectedEpisodeCount === null && (
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-gray-500">{t("works.episode")}</Label>
            <Input type="number" min="1" placeholder="1" value={addEpisode} onChange={e => setAddEpisode(e.target.value)} />
          </div>
        )}
      </div>

      {episodesLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {locale === "da" ? "Henter afsnit…" : "Loading episodes…"}
        </div>
      )}

      {!episodesLoading && detectedEpisodeCount !== null && (
        <div className="rounded-lg border border-gray-200 p-4 bg-white/50">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
            <Label className="text-sm font-semibold text-gray-900">
              {locale === "da" ? "Vælg de afsnit, du har arbejdet på:" : "Select the episodes you worked on:"}
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="h-7 text-xs px-2"
                onClick={() => setSelectedEpisodes(episodeOptions.length ? episodeOptions.map(option => option.number) : Array.from({ length: detectedEpisodeCount }, (_, i) => i + 1))}
              >
                {locale === "da" ? "Vælg alle" : "Select all"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="h-7 text-xs px-2"
                onClick={() => setSelectedEpisodes([])}
              >
                {locale === "da" ? "Fravælg alle" : "Deselect all"}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 max-h-48 overflow-y-auto p-1">
            {(episodeOptions.length ? episodeOptions : Array.from({ length: detectedEpisodeCount }, (_, idx) => ({ number: idx + 1, title: `Afsnit ${idx + 1}` }))).map(option => {
              const epNum = option.number;
              const isChecked = selectedEpisodes.includes(epNum);
              return (
                <label
                  key={epNum}
                  className={`flex min-h-12 items-start gap-2 border rounded px-2 py-1.5 text-sm cursor-pointer transition-colors ${
                    isChecked
                      ? "border-gray-900 bg-gray-900 font-semibold text-white"
                      : "border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={isChecked}
                    onChange={() => {
                      setSelectedEpisodes(prev =>
                        prev.includes(epNum)
                          ? prev.filter(x => x !== epNum)
                          : [...prev, epNum].sort((a, b) => a - b)
                      );
                    }}
                  />
                  <span className="shrink-0 tabular-nums">{epNum}</span>
                  <span className="min-w-0 text-left text-xs leading-snug line-clamp-2">{option.title}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  if (!isOpen) return null;

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-gray-900">{t("works.addWork")}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-col gap-2 mb-4 sm:flex-row">
        <Input
          autoFocus
          placeholder={t("works.addSearchPlaceholder")}
          value={addQuery}
          onChange={e => setAddQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") handleSearch();
          }}
        />
        <Button variant="outline" onClick={() => handleSearch()} disabled={isSearching} className="w-full gap-1.5 shrink-0 sm:w-auto">
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {t("common.searchButton")}
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {noSearchResults && (
          <Button
            type="button"
            size="sm"
            variant={manualMode ? "default" : "outline"}
            onClick={() => {
              setManualMode(v => !v);
              if (!manualMode) {
                setPickedUnifiedResult(null);
                setAddCoEditors([]);
              }
            }}
          >
            {manualMode ? (locale === "da" ? "Skift til søgning" : "Switch to search") : t("works.createManual")}
          </Button>
        )}
      </div>

      <div className="mb-4 space-y-1.5">
        <Label className="text-sm font-medium text-gray-500">{t("works.yourRole")}</Label>
        <select value={addRole} onChange={e => setAddRole(e.target.value)} className={selectCls}>
          {ROLES.map(r => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {manualMode && (
        <div className="mb-4 rounded-lg border border-gray-200 p-4">
          <p className="mb-3 text-sm font-semibold text-gray-900">{t("works.manualWorkData")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">{t("works.titleField")}</Label>
              <Input
                value={manualWork.title}
                onChange={e => setManualWork({ ...manualWork, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">{t("works.typeField")}</Label>
              <select
                value={manualWork.type}
                onChange={e => setManualWork({ ...manualWork, type: e.target.value })}
                className={selectCls}
              >
                {WORK_TYPES.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">{t("works.yearField")}</Label>
              <Input
                value={manualWork.year}
                onChange={e => setManualWork({ ...manualWork, year: e.target.value })}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">{t("works.durationField")}</Label>
              <Input
                value={manualWork.duration_minutes}
                onChange={e => setManualWork({ ...manualWork, duration_minutes: e.target.value })}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">{t("works.episodesField")}</Label>
              <Input
                value={manualWork.episode_count}
                onChange={e => setManualWork({ ...manualWork, episode_count: e.target.value })}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">{t("works.genreField")}</Label>
              <Input
                value={manualWork.genre}
                onChange={e => setManualWork({ ...manualWork, genre: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">Instruktør</Label>
              <Input
                value={manualWork.director}
                onChange={e => setManualWork({ ...manualWork, director: e.target.value })}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-500">{t("works.posterHint")}</p>
          {showSeriesFields && seriesEpisodePicker}
        </div>
      )}


      {!manualMode && unifiedResults.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-2">
            {locale === "da" ? "Søgeresultater" : "Search results"} ({unifiedResults.length})
          </p>
          <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
            {unifiedResults.map(item => {
              const sel = pickedUnifiedResult?.id === item.id;
              return (
                <React.Fragment key={item.id}>
                  <button
                    onClick={() => pickUnifiedResult(item)}
                    className={`text-left px-3 py-2.5 rounded-md border text-sm transition-colors flex gap-3 items-start w-full ${
                      sel ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {item.poster_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.poster_url} alt={item.title} className="w-8 h-11 object-cover rounded shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-gray-900 truncate">{item.title}</p>
                        <div className="flex gap-1">
                          {item.sources.map(src => (
                            <span
                              key={src}
                              className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                                src === "local"
                                  ? "bg-amber-100 text-amber-800"
                                  : src === "dfi"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-purple-100 text-purple-800"
                              }`}
                            >
                              {src}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {item.year ?? "-"} · {typeLabel(item.type, locale)} {item.director ? `· Instruktør: ${item.director}` : ""}
                      </p>
                      {item.description && (
                        <p className="mt-1 text-xs text-gray-500 line-clamp-2">{item.description}</p>
                      )}
                    </div>
                  </button>
                  {sel && detailsLoading && (
                    <div className="flex items-center justify-center p-3 text-sm text-gray-500 gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {locale === "da" ? "Indlæser detaljer…" : "Loading details…"}
                    </div>
                  )}
                  {sel && !detailsLoading && showSeriesFields && seriesEpisodePicker}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {(pickedUnifiedResult || manualMode) && (
        <div className="space-y-4 border-t border-gray-100 pt-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="mb-3 text-sm font-semibold text-gray-900">{t("works.coEditors")}</p>
            <div className="space-y-2">
              {addCoEditors.map(editor => (
                <div key={editor.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                  <Input
                    value={editor.name}
                    disabled={editor.locked}
                    onChange={e =>
                      setAddCoEditors(prev =>
                        prev.map(item => (item.id === editor.id ? { ...item, name: e.target.value } : item))
                      )
                    }
                    placeholder={t("works.namePlaceholder")}
                  />
                  <select
                    value={editor.role}
                    disabled={editor.locked}
                    onChange={e =>
                      setAddCoEditors(prev =>
                        prev.map(item => (item.id === editor.id ? { ...item, role: e.target.value } : item))
                      )
                    }
                    className={selectCls}
                  >
                    {ROLES.map(role => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddCoEditors(prev => prev.filter(item => item.id !== editor.id))}
                    disabled={editor.locked}
                  >
                    {t("works.removeCoEditor")}
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setAddCoEditors(prev => [...prev, emptyCoEditor()])}
            >
              {t("works.addCoEditor")}
            </Button>
            {addCoEditors.some(editor => editor.locked) && (
              <p className="mt-2 text-xs text-gray-500">{t("works.lockedCoEditorsHint")}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-gray-500">{t("works.commentToAdmin")}</Label>
            <Textarea
              value={addComment}
              onChange={e => setAddComment(e.target.value)}
              placeholder={t("works.commentPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-500">
              {showSeriesFields && selectedEpisodeLabel
                ? t("works.chosen")
                : manualMode
                ? t("works.manualWork")
                : t("works.chosen")}
              :{" "}
              <strong className="text-gray-900">
                {chosenSummary}
              </strong>
            </p>
            <Button onClick={handleAddWork} disabled={isSaving || (manualMode && !manualWork.title.trim()) || missingSeriesEpisodes} className="w-full gap-2 sm:w-auto">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {isSaving ? t("works.adding") : t("works.addWork")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
