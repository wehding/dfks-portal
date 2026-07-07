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
import { addWorkForMemberWithApproval, linkExistingWorkForMember, searchLocalWorksForMember } from "@/app/actions/member-works";
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
  const [addComment, setAddComment]           = useState("");

  const [addCoEditors, setAddCoEditors]       = useState<CoEditorDraft[]>([]);
  const [localResults, setLocalResults]       = useState<LocalWorkResult[]>([]);
  const [dfiResults, setDfiResults]           = useState<DfiSearchResult[]>([]);
  const [tmdbResults, setTmdbResults]         = useState<TmdbSearchResult[]>([]);
  const [pickedResult, setPickedResult]       = useState<SearchItem | null>(null);
  const [pickedSource, setPickedSource]       = useState<"local" | "dfi" | "tmdb" | null>(null);
  const [isSearching, setIsSearching]         = useState(false);
  const [isSearchingTmdb, setIsSearchingTmdb] = useState(false);
  const [hasSearchedAdd, setHasSearchedAdd]   = useState(false);
  const [isSaving, setIsSaving]               = useState(false);
  const [showExternalResults, setShowExternalResults] = useState(false);

  useEffect(() => {
    const updateTmdbEpisodes = async () => {
      if (pickedSource === "tmdb" && pickedResult) {
        const tmdbResult = pickedResult as TmdbSearchResult;
        setEpisodesLoading(true);
        try {
          const det = await getTMDBWorkDetails(tmdbResult.id, "tv");
          if (det.success && det.details) {
            const d = det.details as TmdbDetails;
            const sNum = parseInt(addSeason) || 1;
            const season = d.seasons?.find(s => s.season_number === sNum);
            const count = season ? season.episode_count : null;
            if (count) {
              setDetectedEpisodeCount(count);
              setSelectedEpisodes(prev => prev.filter(x => x <= count));
            }
          }
        } catch (e) {
          console.error(e);
        } finally {
          setEpisodesLoading(false);
        }
      }
    };
    updateTmdbEpisodes();
  }, [addSeason, pickedSource, pickedResult]);

  useEffect(() => {
    if (manualMode && (manualWork.type === "tv-serie" || manualWork.type === "dokumentar-serie")) {
      const count = parseInt(manualWork.episode_count) || null;
      setDetectedEpisodeCount(count);
      if (count) {
        setSelectedEpisodes(prev => prev.filter(x => x <= count));
      } else {
        setSelectedEpisodes([]);
      }
    }
  }, [manualMode, manualWork.episode_count, manualWork.type]);

  const resetAddState = React.useCallback(() => {
    setManualMode(false);
    setHasSearchedAdd(false);
    setManualWork(emptyManualWorkForm());
    setAddQuery(initialQuery);
    setAddComment("");
    setAddCoEditors([]);
    setLocalResults([]);
    setDfiResults([]);
    setTmdbResults([]);
    setPickedResult(null);
    setPickedSource(null);
    setAddSeason("");
    setAddEpisode("");
    setDetectedEpisodeCount(null);
    setSelectedEpisodes([]);
    setShowExternalResults(false);
  }, [initialQuery]);

  useEffect(() => {
    if (isOpen) {
      resetAddState();
    }
  }, [isOpen, resetAddState]);

  const handleSearch = async () => {
    if (!addQuery.trim()) return;
    setIsSearching(true);
    setHasSearchedAdd(true);
    setShowExternalResults(false);
    setLocalResults([]);
    setDfiResults([]);
    setTmdbResults([]);
    setPickedResult(null);
    setPickedSource(null);
    setAddCoEditors([]);

    const [local, dfi] = await Promise.all([
      searchLocalWorksForMember(addQuery).catch(() => ({ success: false, works: [] })),
      searchDFIFilms(addQuery).catch(() => ({ success: false, results: [] })),
    ]);

    const locals = ((local as { works?: LocalWorkResult[] }).works ?? []).slice(0, 8);
    const dfiParents = (((dfi as { results?: DfiSearchResult[] }).results ?? [])
      .filter(result => !isDfiChildResult(result)))
      .slice(0, 8);
    setLocalResults(locals);
    setDfiResults(dfiParents);
    setTmdbResults([]);
    setIsSearching(false);

    if (locals.length > 0) {
      setPickedResult(locals[0]);
      setPickedSource("local");
      setManualMode(false);
      setAddCoEditors(localWorkToCoEditors(locals[0]));
    }
  };

  const handleTmdbSearch = async () => {
    if (!addQuery.trim()) return;
    setIsSearchingTmdb(true);
    setShowExternalResults(true);
    setTmdbResults([]);
    const tmdb = await searchTMDB(addQuery).catch(() => []);
    setTmdbResults((Array.isArray(tmdb) ? tmdb : []).slice(0, 8));
    setIsSearchingTmdb(false);
  };

  const pickLocalResult = async (work: LocalWorkResult) => {
    setPickedResult(work);
    setPickedSource("local");
    setManualMode(false);
    setAddCoEditors(localWorkToCoEditors(work));
    setSelectedEpisodes([]);
    const isSeries = work.type === "tv-serie" || work.type === "dokumentar-serie";
    if (!isSeries) {
      setDetectedEpisodeCount(null);
      return;
    }
    // Hvis det valgte lokale værk selv er et afsnit, sæt sæsonen automatisk.
    if (work.season_number) setAddSeason(String(work.season_number));
    setDetectedEpisodeCount(null);
    setEpisodesLoading(true);
    try {
      // Lokale serier har ofte ikke episode_count gemt — udled antal afsnit fra
      // TMDB/DFI (som DFI/TMDB-flowet gør), så afsnitsvælgeren kan vises.
      let count: number | null = work.episode_count ?? null;
      if (!count && work.tmdb_id) {
        const det = await getTMDBWorkDetails(work.tmdb_id, "tv");
        if (det.success && det.details) {
          const d = det.details as TmdbDetails;
          const sNum = work.season_number ?? (parseInt(addSeason) || 1);
          count = d.seasons?.find(s => s.season_number === sNum)?.episode_count ?? null;
        }
      }
      if (!count && work.dfi_id) {
        const details = await getDFIFilmDetails(Number(work.dfi_id));
        if (details.success && details.film) count = countDfiEpisodes(asDfiFilm(details.film as DfiFilm));
      }
      setDetectedEpisodeCount(count);
      // Forvælg det afsnit, brugeren klikkede på (hvis det selv er et afsnit).
      if (work.episode_number && count && work.episode_number <= count) {
        setSelectedEpisodes([work.episode_number]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setEpisodesLoading(false);
    }
  };

  const pickDfiResult = async (result: DfiSearchResult) => {
    setPickedResult(result);
    setPickedSource("dfi");
    setManualMode(false);
    setAddCoEditors([]);
    setDetectedEpisodeCount(null);
    setSelectedEpisodes([]);
    setEpisodesLoading(true);
    try {
      const resolved = await resolveDfiSelection(result);
      const film = resolved.film;
      const targetResult = resolved.result;
      setPickedResult(targetResult);

      const editors = extractDfiCoEditors(film);
      if (editors.length) setAddCoEditors(editors);

      const count = countDfiEpisodes(film);
      if (count) {
        setDetectedEpisodeCount(count);
        if (resolved.selectedEpisode) {
          setSelectedEpisodes([resolved.selectedEpisode]);
        } else {
          setSelectedEpisodes([]);
        }
      }
    } catch (e) {
      console.error(e);
      setAddCoEditors([]);
    } finally {
      setEpisodesLoading(false);
    }
  };

  const closeAfterSuccess = () => {
    // Luk vinduet med det samme; genindlæs listen i baggrunden.
    resetAddState();
    onClose();
    void reloadAssignments();
  };

  const handleAddWork = async () => {
    if ((!manualMode && (!pickedResult || !pickedSource)) || !rightsHolderId) return;
    setIsSaving(true);
    try {
      const selectedSeasonNumber = showSeriesFields ? numberOrNull(addSeason) ?? 1 : numberOrNull(addSeason);
      if (showSeriesFields && detectedEpisodeCount !== null && selectedEpisodes.length === 0) {
        throw new Error(locale === "da" ? "Vælg mindst ét afsnit." : "Select at least one episode.");
      }
      if (pickedSource === "local" && pickedResult) {
        const localResult = pickedResult as LocalWorkResult;
        const res = await linkExistingWorkForMember({
          rightsHolderId,
          workId: localResult.id,
          role: addRole,
          comment: addComment,
          coEditors: addCoEditors.filter(editor => !editor.locked && editor.name.trim()),
          seasonNumber: selectedSeasonNumber,
          episodeNumber: numberOrNull(addEpisode),
          selectedEpisodes,
        });
        if (!res.success) throw new Error(res.error ?? t("works.createFailed"));
        onWorkAdded(
          res.pending ? t("works.addedPending") : t("works.added"),
          true
        );
        await closeAfterSuccess();
        return;
      }

      if (manualMode) {
        const res = await addWorkForMemberWithApproval({
          rightsHolderId,
          role: addRole,
          comment: addComment,
          source: "manual",
          overrideLocalMatch: localResults.length > 0,
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

      if (pickedSource === "dfi" && pickedResult) {
        const dfiResult = pickedResult as DfiSearchResult;
        const resolved = await resolveDfiSelection(dfiResult);
        const film = resolved.film;
        const type = mapDfiWorkType(film.Category, film.Type);
        const dfiPoster = resolved.posterDataUrl ?? extractDfiPosterUrl(film);
        const director = extractDfiDirectors(film).join(", ") || null;
        const selectedDfiEpisodes = selectedEpisodes.length > 0
          ? selectedEpisodes
          : resolved.selectedEpisode
          ? [resolved.selectedEpisode]
          : [];
        const dfiEpisodeCount = detectedEpisodeCount ?? countDfiEpisodes(film);
        const res = await addWorkForMemberWithApproval({
          rightsHolderId,
          role: addRole,
          comment: addComment || (localResults.length > 0 ? "Brugeren har valgt DFI frem for lokalt databasehit." : ""),
          source: "dfi",
          overrideLocalMatch: localResults.length > 0,
          coEditors: addCoEditors.filter(editor => !editor.locked && editor.name.trim()),
          workData: {
            dfi_id: String(film.Id),
            title: cleanDfiTitle(film.Title || film.DanishTitle || "Ukendt") || "Ukendt",
            type,
            year: extractDfiPremiereYear(film),
            director,
            season_number: selectedSeasonNumber,
            episode_number: numberOrNull(addEpisode),
            selected_episodes: selectedDfiEpisodes,
            episode_count: dfiEpisodeCount,
            description: film.Synopsis || film.ShortSynopsis || null,
            poster_url: dfiPoster,
            dfi_metadata: film as unknown as DfiMetadata,
          },
        });
        if (!res.success) throw new Error(res.error ?? t("works.createFailed"));
        onWorkAdded(res.pending ? t("works.pendingApproval") : t("works.added"), true);
        await closeAfterSuccess();
        return;
      }

      if (pickedSource === "tmdb" && pickedResult) {
        const tmdbResult = pickedResult as TmdbSearchResult;
        const det = await getTMDBWorkDetails(tmdbResult.id, tmdbResult.media_type || "movie");
        const d = det.success ? (det as { details?: TmdbSearchResult }).details ?? tmdbResult : tmdbResult;
        const title = d.title || d.name || "Ukendt";
        const year = d.release_date
          ? parseInt(d.release_date.substring(0, 4))
          : d.first_air_date
          ? parseInt(d.first_air_date.substring(0, 4))
          : null;
        const tmdbDetail = d as TmdbSearchResult & { runtime?: number | null; episode_run_time?: number[] };
        const durationMinutes = typeof tmdbDetail.runtime === "number" && tmdbDetail.runtime > 0
          ? tmdbDetail.runtime
          : Array.isArray(tmdbDetail.episode_run_time) && tmdbDetail.episode_run_time[0]
          ? tmdbDetail.episode_run_time[0]
          : null;
        const res = await addWorkForMemberWithApproval({
          rightsHolderId,
          role: addRole,
          comment: addComment || (localResults.length > 0 ? "Brugeren har valgt TMDB frem for lokalt databasehit." : ""),
          source: "tmdb",
          overrideLocalMatch: localResults.length > 0,
          coEditors: addCoEditors.filter(editor => !editor.locked && editor.name.trim()),
          workData: {
            tmdb_id: tmdbResult.id,
            title,
            type: tmdbResult.media_type === "tv" ? "tv-serie" : "spillefilm",
            year,
            duration_minutes: durationMinutes,
            season_number: selectedSeasonNumber,
            episode_number: numberOrNull(addEpisode),
            selected_episodes: selectedEpisodes,
            episode_count: detectedEpisodeCount,
            description: d.overview || null,
            poster_url: d.poster_path ? `${TMDB_IMG_W185}${d.poster_path}` : null,
          },
        });
        if (!res.success) throw new Error(res.error ?? t("works.createFailed"));
        onWorkAdded(res.pending ? t("works.pendingApproval") : t("works.added"), true);
        await closeAfterSuccess();
        return;
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
      pickedResult &&
      (pickedSource === "local"
        ? (pickedResult as LocalWorkResult).type === "tv-serie" || (pickedResult as LocalWorkResult).type === "dokumentar-serie"
        : pickedSource === "dfi"
        ? ["tv-serie", "dokumentar-serie"].includes(mapDfiWorkType((pickedResult as DfiSearchResult).Category, (pickedResult as DfiSearchResult).Type)) || detectedEpisodeCount !== null
        : (pickedResult as TmdbSearchResult).media_type === "tv"));
  const selectedEpisodeLabel = selectedEpisodes.length > 0
    ? selectedEpisodes.join(", ")
    : numberOrNull(addEpisode)
    ? String(numberOrNull(addEpisode))
    : "";
  const chosenTitle = manualMode ? manualWork.title : searchItemTitle(pickedResult);
  const chosenSummary = showSeriesFields && selectedEpisodeLabel
    ? `${chosenTitle}, ${locale === "da" ? "afsnit" : "episodes"} ${selectedEpisodeLabel}`
    : chosenTitle;
  const missingSeriesEpisodes = Boolean(showSeriesFields && detectedEpisodeCount !== null && selectedEpisodes.length === 0);

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
                onClick={() => setSelectedEpisodes(Array.from({ length: detectedEpisodeCount }, (_, i) => i + 1))}
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
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 max-h-40 overflow-y-auto p-1">
            {Array.from({ length: detectedEpisodeCount }, (_, idx) => {
              const epNum = idx + 1;
              const isChecked = selectedEpisodes.includes(epNum);
              return (
                <label
                  key={epNum}
                  className={`flex items-center justify-center border rounded px-2 py-1.5 text-sm cursor-pointer transition-colors ${
                    isChecked
                      ? "border-gray-900 bg-white font-semibold text-gray-900 ring-2 ring-gray-900 ring-offset-2"
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
                  {epNum}
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
        <Button variant="outline" onClick={handleSearch} disabled={isSearching} className="w-full gap-1.5 shrink-0 sm:w-auto">
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {t("common.searchButton")}
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {hasSearchedAdd && (
          <Button
            type="button"
            size="sm"
            variant={manualMode ? "default" : "outline"}
            onClick={() => {
              setManualMode(v => !v);
              if (!manualMode) {
                setPickedResult(null);
                setPickedSource(null);
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


      {!manualMode && hasSearchedAdd && !isSearching && localResults.length === 0 && dfiResults.length === 0 && tmdbResults.length === 0 && !showExternalResults && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-900">
          {locale === "da" ? "Titel ikke fundet" : "Title not found"}
        </div>
      )}

      {!manualMode && localResults.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-semibold text-amber-900">{t("works.possibleExisting")}</p>
          <div className="space-y-1.5">
            {localResults.map(work => {
              const sel = pickedSource === "local" && (pickedResult as LocalWorkResult | null)?.id === work.id;
              return (
                <React.Fragment key={work.id}>
                  <button
                    type="button"
                    onClick={() => pickLocalResult(work)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                      sel ? "border-gray-900 bg-white" : "border-amber-200 bg-white/70 hover:bg-white"
                    }`}
                  >
                    <span className="font-medium text-gray-900">{work.title}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      {work.year ?? "-"} · {typeLabel(work.type, locale)}
                    </span>
                    {work.description ? <span className="mt-0.5 block text-xs text-gray-500">{work.description.slice(0, 90)}</span> : null}
                  </button>
                  {sel && showSeriesFields && seriesEpisodePicker}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {!manualMode && dfiResults.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-2">DFI ({dfiResults.length})</p>
          <div className="flex flex-col gap-1.5">
            {dfiResults.map(item => {
              const sel = (pickedResult as DfiSearchResult | null)?.Id === item.Id && pickedSource === "dfi";
              const dfiDescription = item.ShortSynopsis || item.Synopsis || item.Description || "";
              return (
                <React.Fragment key={String(item.Id)}>
                  <button
                    onClick={() => pickDfiResult(item)}
                    className={`text-left px-3 py-2.5 rounded-md border text-sm transition-colors w-full ${
                      sel ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <p className="font-medium text-gray-900 truncate">{cleanDfiTitle(item.Title ?? item.DanishTitle ?? "")}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{extractDfiPremiereYear(item) ?? "-"} · {item.Category}</p>
                    {dfiDescription ? <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{dfiDescription.slice(0, 120)}</p> : null}
                  </button>
                  {sel && showSeriesFields && seriesEpisodePicker}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {!manualMode && hasSearchedAdd && !isSearching && tmdbResults.length === 0 && (
        <div className="mt-3 mb-4 flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={handleTmdbSearch} disabled={isSearchingTmdb}>
            {isSearchingTmdb && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {locale === "da" ? "Led videre på TMDB databasen" : "Search further in the TMDB database"}
          </Button>
        </div>
      )}

      {!manualMode && tmdbResults.length > 0 && showExternalResults && (
        <div className="grid grid-cols-1 gap-5 mb-4 sm:grid-cols-2">
          {([
            {
              label: `TMDB (${tmdbResults.length})`,
              items: tmdbResults,
              getKey: (x: SearchItem) => String((x as TmdbSearchResult).id),
              isSelected: (x: SearchItem) => (pickedResult as TmdbSearchResult | null)?.id === (x as TmdbSearchResult).id && pickedSource === "tmdb",
              onSelect: (x: SearchItem) => {
                const i = x as TmdbSearchResult;
                setPickedResult(i);
                setPickedSource("tmdb");
                setAddCoEditors([]);
              },
              getTitle: (x: SearchItem) => {
                const i = x as TmdbSearchResult;
                return i.title || i.name || "";
              },
              getMeta: (x: SearchItem) => {
                const i = x as TmdbSearchResult;
                return `${i.release_date?.substring(0, 4) || i.first_air_date?.substring(0, 4)} · ${
                  i.media_type === "tv" ? typeLabel("serie", locale) : typeLabel("film", locale)
                }`;
              },
              getPoster: (x: SearchItem) => {
                const i = x as TmdbSearchResult;
                return i.poster_path ? `${TMDB_IMG_W185}${i.poster_path}` : null;
              },
            },
          ] as ResultColumnDef[]).map(col => (
            <div key={col.label}>
              <p className="text-xs font-medium text-gray-500 mb-2">{col.label}</p>
              <div className="flex flex-col gap-1.5">
                {col.items.map((item: SearchItem) => {
                  const sel = col.isSelected(item);
                  const poster = col.getPoster(item);
                  const overview = (item as TmdbSearchResult).overview ?? "";
                  return (
                    <React.Fragment key={col.getKey(item)}>
                      <button
                        onClick={() => col.onSelect(item)}
                        className={`text-left px-3 py-2.5 rounded-md border text-sm transition-colors flex gap-2.5 items-start w-full ${
                          sel ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        {poster && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={poster} alt={col.getTitle(item)} className="w-7 h-10 object-cover rounded shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">{col.getTitle(item)}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{col.getMeta(item)}</p>
                          {overview ? <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{overview.slice(0, 120)}</p> : null}
                        </div>
                      </button>
                      {sel && showSeriesFields && seriesEpisodePicker}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {(pickedResult || manualMode) && (
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
