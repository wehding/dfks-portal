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
}

interface LocalWorkResult {
  id: string;
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  episode_count: number | null;
  genre: string | null;
  status: string;
  dfi_id: string | null;
  tmdb_id: number | null;
  poster_url: string | null;
  description: string | null;
  work_assignments: any[];
}

interface DfiSearchResult {
  Id: number;
  Title?: string;
  ReleaseYear?: number;
  ProductionYear?: number;
  Category?: string;
  Description?: string;
  Type?: string;
  PersonCredits?: any[];
  Synopsis?: string;
  ShortSynopsis?: string;
  DanishTitle?: string;
}

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

type SearchItem = LocalWorkResult | DfiSearchResult | TmdbSearchResult;

interface ResultColumnDef {
  label: string;
  items: any[];
  getKey: (item: any) => string;
  isSelected: (item: any) => boolean;
  onSelect: (item: any) => void;
  getTitle: (item: any) => string;
  getMeta: (item: any) => string;
  getPoster: (item: any) => string | null;
}

interface AddWorkModalProps {
  isOpen: boolean;
  onClose: () => void;
  rightsHolderId: string | null;
  onWorkAdded: (message: string, success: boolean) => void;
  reloadAssignments: () => Promise<void>;
  locale: string;
}

function emptyManualWorkForm(): ManualWorkForm {
  return {
    title: "",
    type: "spillefilm",
    year: "",
    duration_minutes: "",
    episode_count: "",
    genre: "",
  };
}

function emptyCoEditor(): CoEditorDraft {
  return { id: crypto.randomUUID(), name: "", role: "Klipper", action: "add" };
}

function displayRole(role: string | null | undefined) {
  return role === "Hovedklipper" ? "Konceptuerende klipper" : role ?? "Klipper";
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

function extractDfiCoEditors(film: DfiSearchResult): CoEditorDraft[] {
  const credits = Array.isArray(film.PersonCredits) ? film.PersonCredits : [];
  return credits
    .filter(credit => {
      const code = String(credit.TypeCode ?? "").toLowerCase();
      const text = `${credit.Type ?? ""} ${credit.Function ?? ""} ${credit.Credit ?? ""}`.toLowerCase();
      return code.includes("klip") || code.includes("edit") || text.includes("klip") || text.includes("edit");
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

export function AddWorkModal({
  isOpen,
  onClose,
  rightsHolderId,
  onWorkAdded,
  reloadAssignments,
  locale,
}: AddWorkModalProps) {
  const { t } = useI18n();

  const [addQuery, setAddQuery]               = useState("");
  const [addRole, setAddRole]                 = useState("Klipper");
  const [manualMode, setManualMode]           = useState(false);
  const [manualWork, setManualWork]           = useState<ManualWorkForm>(emptyManualWorkForm());
  const [addSeason, setAddSeason]             = useState("");
  const [addEpisode, setAddEpisode]           = useState("");
  const [addComment, setAddComment]           = useState("");
  const [addCoEditors, setAddCoEditors]       = useState<CoEditorDraft[]>([]);
  const [localResults, setLocalResults]       = useState<LocalWorkResult[]>([]);
  const [dfiResults, setDfiResults]           = useState<DfiSearchResult[]>([]);
  const [tmdbResults, setTmdbResults]         = useState<TmdbSearchResult[]>([]);
  const [pickedResult, setPickedResult]       = useState<any>(null);
  const [pickedSource, setPickedSource]       = useState<"local" | "dfi" | "tmdb" | null>(null);
  const [isSearching, setIsSearching]         = useState(false);
  const [hasSearchedAdd, setHasSearchedAdd]   = useState(false);
  const [isSaving, setIsSaving]               = useState(false);

  useEffect(() => {
    if (isOpen) {
      resetAddState();
    }
  }, [isOpen]);

  const resetAddState = () => {
    setManualMode(false);
    setHasSearchedAdd(false);
    setManualWork(emptyManualWorkForm());
    setAddQuery("");
    setAddComment("");
    setAddCoEditors([]);
    setLocalResults([]);
    setDfiResults([]);
    setTmdbResults([]);
    setPickedResult(null);
    setPickedSource(null);
    setAddSeason("");
    setAddEpisode("");
  };

  const handleSearch = async () => {
    if (!addQuery.trim()) return;
    setIsSearching(true);
    setHasSearchedAdd(true);
    setLocalResults([]);
    setDfiResults([]);
    setTmdbResults([]);
    setPickedResult(null);
    setPickedSource(null);
    setAddCoEditors([]);

    const [local, dfi, tmdb] = await Promise.all([
      searchLocalWorksForMember(addQuery).catch(() => ({ success: false, works: [] })),
      searchDFIFilms(addQuery).catch(() => ({ success: false, results: [] })),
      searchTMDB(addQuery).catch(() => []),
    ]);

    setLocalResults(((local as { works?: LocalWorkResult[] }).works ?? []).slice(0, 8));
    setDfiResults(((dfi as { results?: DfiSearchResult[] }).results ?? []).slice(0, 8));
    setTmdbResults((Array.isArray(tmdb) ? tmdb : []).slice(0, 8));
    setIsSearching(false);
  };

  const pickLocalResult = (work: LocalWorkResult) => {
    setPickedResult(work);
    setPickedSource("local");
    setManualMode(false);
    setAddCoEditors(localWorkToCoEditors(work));
  };

  const pickDfiResult = async (result: DfiSearchResult) => {
    setPickedResult(result);
    setPickedSource("dfi");
    setManualMode(false);
    setAddCoEditors([]);
    try {
      const det = await getDFIFilmDetails(Number(result.Id));
      const film = det.success ? (det as { film?: DfiSearchResult }).film ?? result : result;
      const editors = extractDfiCoEditors(film);
      if (editors.length) setAddCoEditors(editors);
    } catch {
      setAddCoEditors([]);
    }
  };

  const handleAddWork = async () => {
    if ((!manualMode && (!pickedResult || !pickedSource)) || !rightsHolderId) return;
    setIsSaving(true);
    try {
      if (pickedSource === "local" && pickedResult) {
        const res = await linkExistingWorkForMember({
          rightsHolderId,
          workId: pickedResult.id,
          role: addRole,
          comment: addComment,
          coEditors: addCoEditors.filter(editor => !editor.locked && editor.name.trim()),
        });
        if (!res.success) throw new Error(res.error ?? t("works.createFailed"));
        onWorkAdded(
          res.pending ? t("works.addedPending") : t("works.added"),
          true
        );
        await reloadAssignments();
        onClose();
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
            genre: manualWork.genre || null,
            description: null,
          },
        });
        if (!res.success) throw new Error(res.error ?? t("works.createFailed"));
        onWorkAdded(res.pending ? t("works.pendingApproval") : t("works.added"), true);
        await reloadAssignments();
        onClose();
        return;
      }

      if (pickedSource === "dfi" && pickedResult) {
        const det = await getDFIFilmDetails(pickedResult.Id);
        const film = det.success ? (det as any).film : pickedResult;
        const combined = ((film.Category || "") + " " + (film.Type || "")).toLowerCase();
        const type =
          combined.includes("dokumentar") && combined.includes("serie")
            ? "dokumentar-serie"
            : combined.includes("dokumentar")
            ? "dokumentarfilm"
            : combined.includes("serie") || combined.includes("tv-")
            ? "tv-serie"
            : combined.includes("kort")
            ? "kortfilm"
            : "spillefilm";
        const res = await addWorkForMemberWithApproval({
          rightsHolderId,
          role: addRole,
          comment: addComment || (localResults.length > 0 ? "Brugeren har valgt DFI frem for lokalt databasehit." : ""),
          source: "dfi",
          overrideLocalMatch: localResults.length > 0,
          coEditors: addCoEditors.filter(editor => !editor.locked && editor.name.trim()),
          workData: {
            dfi_id: String(pickedResult.Id),
            title: film.Title || film.DanishTitle || "Ukendt",
            type,
            year: film.ProductionYear || film.ReleaseYear || null,
            description: film.Synopsis || film.ShortSynopsis || null,
          },
        });
        if (!res.success) throw new Error(res.error ?? t("works.createFailed"));
        onWorkAdded(res.pending ? t("works.pendingApproval") : t("works.added"), true);
        await reloadAssignments();
        onClose();
        return;
      }

      if (pickedSource === "tmdb" && pickedResult) {
        const det = await getTMDBWorkDetails(pickedResult.id, pickedResult.media_type || "movie");
        const d = det.success ? (det as { details?: TmdbSearchResult }).details ?? pickedResult : pickedResult;
        const title = d.title || d.name || "Ukendt";
        const year = d.release_date
          ? parseInt(d.release_date.substring(0, 4))
          : d.first_air_date
          ? parseInt(d.first_air_date.substring(0, 4))
          : null;
        const res = await addWorkForMemberWithApproval({
          rightsHolderId,
          role: addRole,
          comment: addComment || (localResults.length > 0 ? "Brugeren har valgt TMDB frem for lokalt databasehit." : ""),
          source: "tmdb",
          overrideLocalMatch: localResults.length > 0,
          coEditors: addCoEditors.filter(editor => !editor.locked && editor.name.trim()),
          workData: {
            tmdb_id: pickedResult.id,
            title,
            type: pickedResult.media_type === "tv" ? "tv-serie" : "spillefilm",
            year,
            description: d.overview || null,
            poster_url: d.poster_path ? `${TMDB_IMG_W185}${d.poster_path}` : null,
          },
        });
        if (!res.success) throw new Error(res.error ?? t("works.createFailed"));
        onWorkAdded(res.pending ? t("works.pendingApproval") : t("works.added"), true);
        await reloadAssignments();
        onClose();
        return;
      }
    } catch (err: any) {
      onWorkAdded(err.message || t("common.genericError"), false);
    } finally {
      setIsSaving(false);
    }
  };

  const showSeriesFields =
    (manualMode && (manualWork.type === "tv-serie" || manualWork.type === "dokumentar-serie")) ||
    (!manualMode &&
      pickedResult &&
      (pickedSource === "local"
        ? pickedResult.type === "tv-serie" || pickedResult.type === "dokumentar-serie"
        : pickedSource === "dfi"
        ? (pickedResult.Type || pickedResult.Category || "").toLowerCase().includes("serie")
        : pickedResult.media_type === "tv"));

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
        <Button type="button" size="sm" variant={!manualMode ? "default" : "outline"} onClick={() => setManualMode(false)}>
          {t("works.searchDfiTmdb")}
        </Button>
        {hasSearchedAdd && (
          <Button
            type="button"
            size="sm"
            variant={manualMode ? "default" : "outline"}
            onClick={() => {
              setManualMode(true);
              setPickedResult(null);
              setPickedSource(null);
              setAddCoEditors([]);
            }}
          >
            {t("works.createManual")}
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
          </div>
          <p className="mt-3 text-xs text-gray-500">{t("works.posterHint")}</p>
        </div>
      )}

      {showSeriesFields && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-gray-500">{t("works.season")}</Label>
            <Input type="number" min="1" placeholder="1" value={addSeason} onChange={e => setAddSeason(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-gray-500">{t("works.episode")}</Label>
            <Input type="number" min="1" placeholder="1" value={addEpisode} onChange={e => setAddEpisode(e.target.value)} />
          </div>
        </div>
      )}

      {!manualMode && localResults.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-semibold text-amber-900">{t("works.possibleExisting")}</p>
          <div className="space-y-1.5">
            {localResults.map(work => {
              const sel = pickedSource === "local" && pickedResult?.id === work.id;
              return (
                <button
                  key={work.id}
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
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-amber-800">
            {t("works.existingMatchWarning")}
          </p>
        </div>
      )}

      {!manualMode && (dfiResults.length > 0 || tmdbResults.length > 0) && (
        <div className="grid grid-cols-1 gap-5 mb-4 sm:grid-cols-2">
          {([
            {
              label: `DFI (${dfiResults.length})`,
              items: dfiResults,
              getKey: (x: any) => String((x as DfiSearchResult).Id),
              isSelected: (x: any) => pickedResult?.Id === (x as DfiSearchResult).Id && pickedSource === "dfi",
              onSelect: (x: any) => pickDfiResult(x as DfiSearchResult),
              getTitle: (x: any) => (x as DfiSearchResult).Title ?? "",
              getMeta: (x: any) => {
                const f = x as DfiSearchResult;
                return `${f.ProductionYear || f.ReleaseYear} · ${f.Category}`;
              },
              getPoster: () => null,
            },
            {
              label: `TMDB (${tmdbResults.length})`,
              items: tmdbResults,
              getKey: (x: any) => String((x as TmdbSearchResult).id),
              isSelected: (x: any) => pickedResult?.id === (x as TmdbSearchResult).id && pickedSource === "tmdb",
              onSelect: (x: any) => {
                const i = x as TmdbSearchResult;
                setPickedResult(i);
                setPickedSource("tmdb");
                setAddCoEditors([]);
              },
              getTitle: (x: any) => {
                const i = x as TmdbSearchResult;
                return i.title || i.name || "";
              },
              getMeta: (x: any) => {
                const i = x as TmdbSearchResult;
                return `${i.release_date?.substring(0, 4) || i.first_air_date?.substring(0, 4)} · ${
                  i.media_type === "tv" ? typeLabel("serie", locale) : typeLabel("film", locale)
                }`;
              },
              getPoster: (x: any) => {
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
                  return (
                    <button
                      key={col.getKey(item)}
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
                      </div>
                    </button>
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
              {manualMode
                ? t("works.manualWork")
                : t("works.chosen")}
              :{" "}
              <strong className="text-gray-900">
                {manualMode
                  ? manualWork.title
                  : pickedResult.Title || pickedResult.title || pickedResult.name || pickedResult.title}
              </strong>
            </p>
            <Button onClick={handleAddWork} disabled={isSaving || (manualMode && !manualWork.title.trim())} className="w-full gap-2 sm:w-auto">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {isSaving ? t("works.adding") : t("works.addToMyWorks")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
