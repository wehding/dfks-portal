"use client";

import React, { useState, useEffect } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MessageThread, type MessageThreadMessage } from "@/components/messages/message-thread";
import { Modal } from "./Modal";
import { submitWorkDataCorrection } from "@/app/actions/work-management";
import { useI18n } from "@/lib/i18n";
import { fetchMemberSeriesEpisodeOptions, resolveUnifiedSearchResultDetails, searchWorksUnified, syncMemberEpisodeAssignments, updateMemberCoEditors, type UnifiedSearchWorkResult } from "@/app/actions/member-works";
import { SeriesEpisodeSelector } from "@/components/works/series-episode-selector";
import { LocalRightsHolderAutocomplete } from "@/components/works/local-rights-holder-autocomplete";
import { buildCompleteEpisodeOptions, inferSeriesWorkFields, type SeriesEpisodeOption } from "@/lib/series-episodes";
import { WORK_TYPES } from "@/lib/work-types";
import { createClientId } from "@/lib/client-id";
import { fetchMemberShareTask, respondToWorkShareTask } from "@/app/actions/work-share-cases";
import { confirmNoCoeditors } from "@/app/actions/work-collaboration-reviews";

const ROLES = ["Klipper", "B-klipper", "Konceptuerende klipper"];

const selectCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-input/30";

interface CoEditorDraft {
  id: string;
  name: string;
  role: string;
  assignmentId?: string | null;
  rightsHolderId?: string | null;
  originalRightsHolderId?: string | null;
  locked?: boolean;
  action?: "add" | "remove" | "change";
}

type MemberShareTask = {
  id: string;
  status: string;
  reservePercent: number | null;
  ownParticipant: { proposed_percent: number | null } | null;
  finalDistribution: Array<{ role: string; final_percent: number; rettighedshavere: { full_name: string } | null }>;
  reportedDeclines: Array<{ proposed_name: string | null; rettighedshavere: { full_name: string } | null }>;
};

interface WorkCorrectionForm {
  title: string;
  type: string;
  year: string;
  duration_minutes: string;
  season_count: string;
  season_number: string;
  episode_number: string;
  episode_count: string;
  genre: string;
  director: string;
  description: string;
  dfi_id: string;
  tmdb_id: string;
  imdb_id: string;
  field_sources: Record<string, string>;
}

function isSeriesType(type: string) {
  return type === "tv-serie" || type === "dokumentar-serie";
}

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
  source?: string | null;
  admin_comment?: string | null;
  proposed_data?: Record<string, unknown> | null;
  work_change_request_comments?: RequestComment[] | null;
};

type Work = {
  id: string;
  title: string;
  type: string | null;
  year: number | null;
  duration_minutes: number | null;
  season_count?: number | null;
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
  work_change_requests?: ChangeRequest[] | null;
};

type Assignment = {
  id: string;
  role: string | null;
  work_id?: string;
  rights_holder_id?: string | null;
  works?: Work | null;
  rettighedshavere?: {
    id?: string;
    full_name: string;
  } | null;
};

interface EditWorkModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignment: Assignment;
  allAssignments: Assignment[];
  onWorkUpdated: (message: string, success: boolean, updatedRole?: string, targetId?: string) => void;
  locale: string;
  editScope?: "work" | "season" | "episode";
  seasonWorkIds?: string[];
  initialEpisodeOptions?: SeriesEpisodeOption[];
  initialEpisodeScope?: { status: "pending" | "confirmed"; episode_numbers: number[]; covers_whole_season: boolean } | null;
  organisationShortName: string;
}

function emptyCoEditor(): CoEditorDraft {
  return { id: createClientId("co-editor"), name: "", role: "Klipper", action: "add" };
}

function displayRole(role: string | null | undefined) {
  return role === "Hovedklipper" ? "Konceptuerende klipper" : role ?? "Klipper";
}

function workToCorrectionForm(w: Work): WorkCorrectionForm {
  const series = inferSeriesWorkFields({
    title: w.title,
    seasonCount: w.season_count,
    seasonNumber: w.season_number,
    episodeNumber: w.episode_number,
    episodeCount: w.episode_count,
  });
  return {
    title: w.title ?? "",
    type: w.type ?? "spillefilm",
    year: w.year != null ? String(w.year) : "",
    duration_minutes: w.duration_minutes != null ? String(w.duration_minutes) : "",
    season_count: series.seasonCount != null ? String(series.seasonCount) : "",
    season_number: series.seasonNumber != null ? String(series.seasonNumber) : "",
    episode_number: series.episodeNumber != null ? String(series.episodeNumber) : "",
    episode_count: series.episodeCount != null ? String(series.episodeCount) : "",
    genre: w.genre ?? "",
    director: w.director ?? "",
    description: w.description ?? "",
    dfi_id: w.dfi_id ?? "",
    tmdb_id: w.tmdb_id != null ? String(w.tmdb_id) : "",
    imdb_id: w.imdb_id ?? "",
    field_sources: w.field_sources ?? {},
  };
}

function requestThreadMessages(work: Work | null | undefined): MessageThreadMessage[] {
  return (work?.work_change_requests ?? []).flatMap(request =>
    (request.work_change_request_comments ?? []).map(comment => ({
      id: comment.id,
      authorRole: comment.author_role,
      message: comment.message,
      createdAt: comment.created_at,
      memberReadAt: comment.member_read_at,
      adminReadAt: comment.admin_read_at,
    }))
  );
}

function workNextActionLabel(work: Work | null | undefined) {
  const requests = work?.work_change_requests ?? [];
  const pending = requests.some(request => request.status === "pending");
  const latest = requestThreadMessages(work).at(-1);
  if (latest?.authorRole === "admin" && !latest.memberReadAt) return "Nyt svar fra DFKS";
  if (pending) return "Afventer DFKS";
  if (requests.some(request => request.status === "rejected")) return "Afvist rettelse";
  if (requests.some(request => request.status === "approved")) return "Godkendt rettelse";
  return "Ingen aktive beskeder";
}

function workNextActionTone(work: Work | null | undefined): "neutral" | "attention" | "done" {
  const latest = requestThreadMessages(work).at(-1);
  if (latest?.authorRole === "admin" && !latest.memberReadAt) return "attention";
  const requests = work?.work_change_requests ?? [];
  if (requests.some(request => request.status === "approved")) return "done";
  return "neutral";
}

function numberOrNull(val: string) {
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

function sharePercentOrNull(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function workTypeLabel(value: string | null | undefined) {
  return WORK_TYPES.find(type => type.value === value)?.label ?? value ?? "—";
}

function readonlyValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function ReadonlyWorkField({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="min-h-9 rounded-md border bg-muted/30 px-3 py-2 text-sm text-foreground">
        {readonlyValue(value)}
      </div>
    </div>
  );
}

export function EditWorkModal({
  isOpen,
  onClose,
  assignment,
  allAssignments,
  onWorkUpdated,
  locale,
  editScope = "work",
  seasonWorkIds = [],
  initialEpisodeOptions = [],
  initialEpisodeScope = null,
  organisationShortName,
}: EditWorkModalProps) {
  const { t } = useI18n();

  const [editRole, setEditRole]                         = useState("");
  const [showWorkCorrection, setShowWorkCorrection]     = useState(false);
  const [workCorrection, setWorkCorrection]             = useState<WorkCorrectionForm | null>(null);
  const [workCorrectionComment, setWorkCorrectionComment] = useState("");
  const [editCoEditors, setEditCoEditors]               = useState<CoEditorDraft[]>([]);
  const [isSendingCorrection, setIsSendingCorrection]   = useState(false);
  const [commentError, setCommentError]                 = useState(false);
  const [selectedEpisodes, setSelectedEpisodes]         = useState<Record<number, boolean>>({});
  const [directEpisodeOptions, setDirectEpisodeOptions] = useState<SeriesEpisodeOption[]>([]);
  const [directEpisodeSeason, setDirectEpisodeSeason] = useState(1);
  const [directEpisodesLoading, setDirectEpisodesLoading] = useState(false);
  const [coversWholeSeason, setCoversWholeSeason] = useState(false);
  const [externalQuery, setExternalQuery] = useState("");
  const [externalResults, setExternalResults] = useState<UnifiedSearchWorkResult[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [selfSharePercent, setSelfSharePercent] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [shareTask, setShareTask] = useState<MemberShareTask | null>(null);
  const [shareTaskLoading, setShareTaskLoading] = useState(false);
  const [shareTaskSaving, setShareTaskSaving] = useState(false);
  const [soloSaving, setSoloSaving] = useState(false);

  useEffect(() => {
    if (isOpen && assignment) {
      setEditRole(displayRole(assignment.role));
      setShowWorkCorrection(false);
      setWorkCorrection(assignment.works ? workToCorrectionForm(assignment.works) : null);
      setExternalQuery(assignment.works?.title ?? "");
      setExternalResults([]);
      setWorkCorrectionComment("");
      setSelfSharePercent("");
      setSaveFeedback(null);
      setCommentError(false);
      const seriesKey = assignment.works?.parent_work_id ?? assignment.works?.id;
      const season = assignment.works?.season_number ?? 1;
      const assignedEpisodes = (allAssignments ?? []).filter(other => {
        const work = other.works;
        return other.rights_holder_id === assignment.rights_holder_id && work && (work.parent_work_id ?? work.id) === seriesKey && (work.season_number ?? 1) === season && work.episode_number;
      }).map(other => other.works!.episode_number!);
      const initialNumbers = assignedEpisodes.length > 0 ? assignedEpisodes : initialEpisodeScope?.episode_numbers ?? [];
      setSelectedEpisodes(Object.fromEntries(initialNumbers.map(number => [number, true])));
      setCoversWholeSeason(Boolean(initialEpisodeScope?.covers_whole_season));
      setDirectEpisodeOptions(initialEpisodeOptions);
      const inferredSeries = inferSeriesWorkFields({
        title: assignment.works?.title,
        seasonCount: assignment.works?.season_count,
        seasonNumber: assignment.works?.season_number,
        episodeNumber: assignment.works?.episode_number,
        episodeCount: assignment.works?.episode_count,
      });
      setDirectEpisodeSeason(inferredSeries.seasonNumber ?? 1);
      const coEditorRows = (allAssignments ?? [])
          .filter(other => other.rights_holder_id !== assignment.rights_holder_id && (
            editScope === "season" ? seasonWorkIds.includes(other.work_id ?? "") : other.work_id === assignment.works?.id
          ));
      const uniqueCoEditors = [...new Map(coEditorRows.map(other => [`${other.rights_holder_id ?? other.rettighedshavere?.id}:${displayRole(other.role)}`, other])).values()];
      setEditCoEditors(
        uniqueCoEditors
          .map(other => ({
            id: other.id,
            name: other.rettighedshavere?.full_name ?? "Ukendt medklipper",
            role: displayRole(other.role),
            assignmentId: other.id,
            rightsHolderId: other.rights_holder_id ?? other.rettighedshavere?.id ?? null,
            originalRightsHolderId: other.rights_holder_id ?? other.rettighedshavere?.id ?? null,
            locked: true,
          }))
      );
    }
  }, [isOpen, assignment, allAssignments, editScope, initialEpisodeOptions, initialEpisodeScope, seasonWorkIds]);

  useEffect(() => {
    if (!isOpen || !assignment.rights_holder_id || !assignment.works?.id) return;
    let cancelled = false;
    setShareTaskLoading(true);
    void fetchMemberShareTask({
      rightsHolderId: assignment.rights_holder_id,
      workId: assignment.works.id,
      seasonNumber: editScope === "season" ? directEpisodeSeason : assignment.works.season_number,
      episodeNumber: editScope === "episode" ? assignment.works.episode_number : null,
    }).then(result => {
      if (!cancelled && result.success) {
        setShareTask(result.task as unknown as MemberShareTask | null);
        setEditCoEditors(current => {
          const existing = new Set(current.map(editor => `${editor.rightsHolderId}:${displayRole(editor.role)}`));
          const additions = (result.registeredCoEditors ?? [])
            .filter(editor => !existing.has(`${editor.rightsHolderId}:${displayRole(editor.role)}`))
            .map(editor => ({
              id: editor.assignmentId,
              name: editor.name,
              role: displayRole(editor.role),
              assignmentId: editor.assignmentId,
              rightsHolderId: editor.rightsHolderId,
              originalRightsHolderId: editor.rightsHolderId,
              locked: true,
            } satisfies CoEditorDraft));
          return [...current, ...additions];
        });
        const ownPercent = result.task?.ownParticipant?.proposed_percent;
        setSelfSharePercent(ownPercent == null ? "" : String(ownPercent));
      }
    }).finally(() => { if (!cancelled) setShareTaskLoading(false); });
    return () => { cancelled = true; };
  }, [assignment.rights_holder_id, assignment.works, directEpisodeSeason, editScope, isOpen]);

  useEffect(() => {
    const loadSeriesEpisodes = async () => {
      const work = assignment.works;
      const rightsHolderId = assignment.rights_holder_id;
      if (!isOpen || !work || !rightsHolderId || editScope !== "work" || !isSeriesType(work.type ?? "")) return;
      setDirectEpisodesLoading(true);
      try {
        const result = await fetchMemberSeriesEpisodeOptions({ rightsHolderId, workId: work.id });
        if (result.success) {
          setDirectEpisodeOptions(result.options ?? []);
          setDirectEpisodeSeason(result.seasonNumber ?? 1);
          setWorkCorrection(current => {
            if (!current) return current;
            const inferred = inferSeriesWorkFields({
              title: work.title,
              seasonCount: numberOrNull(current.season_count),
              seasonNumber: result.seasonNumber ?? numberOrNull(current.season_number),
              episodeNumber: work.episode_number ?? numberOrNull(current.episode_number),
              episodeCount: numberOrNull(current.episode_count),
              knownEpisodeCount: result.episodeCount,
            });
            return {
              ...current,
              season_count: inferred.seasonCount != null ? String(inferred.seasonCount) : current.season_count,
              season_number: inferred.seasonNumber != null ? String(inferred.seasonNumber) : current.season_number,
              episode_number: inferred.episodeNumber != null ? String(inferred.episodeNumber) : current.episode_number,
              episode_count: inferred.episodeCount != null ? String(inferred.episodeCount) : current.episode_count,
            };
          });
        }
      } finally {
        setDirectEpisodesLoading(false);
      }
    };
    void loadSeriesEpisodes();
  }, [assignment.rights_holder_id, assignment.works, editScope, isOpen]);

  const handleExternalSearch = async () => {
    if (!externalQuery.trim()) return;
    setExternalLoading(true);
    try {
      const result = await searchWorksUnified(externalQuery);
      setExternalResults((result.success ? result.results ?? [] : []).slice(0, 10));
    } finally {
      setExternalLoading(false);
    }
  };

  const applyExternalResult = async (result: UnifiedSearchWorkResult) => {
    if (!workCorrection) return;
    setExternalLoading(true);
    try {
      const resolved = await resolveUnifiedSearchResultDetails(result);
      if (!resolved.success || !resolved.details) throw new Error("Kunne ikke hente værksdata.");
      const d = resolved.details;
      const source = result.sources.includes("dfi") ? "dfi" : result.sources.includes("tmdb") ? "tmdb" : "manual";
      const inferred = inferSeriesWorkFields({
        title: d.title,
        seasonCount: d.season_count ?? numberOrNull(workCorrection.season_count),
        seasonNumber: d.season_hint ?? numberOrNull(workCorrection.season_number),
        episodeNumber: numberOrNull(workCorrection.episode_number),
        episodeCount: d.episode_count ?? numberOrNull(workCorrection.episode_count),
        knownEpisodeCount: d.episode_options?.length,
      });
      setWorkCorrection({
        ...workCorrection,
        title: d.title || workCorrection.title,
        type: d.type || workCorrection.type,
        year: d.year != null ? String(d.year) : workCorrection.year,
        duration_minutes: d.duration_minutes != null ? String(d.duration_minutes) : workCorrection.duration_minutes,
        season_count: inferred.seasonCount != null ? String(inferred.seasonCount) : workCorrection.season_count,
        season_number: inferred.seasonNumber != null ? String(inferred.seasonNumber) : workCorrection.season_number,
        episode_number: inferred.episodeNumber != null ? String(inferred.episodeNumber) : workCorrection.episode_number,
        episode_count: inferred.episodeCount != null ? String(inferred.episodeCount) : workCorrection.episode_count,
        genre: d.genre || workCorrection.genre,
        director: d.director || workCorrection.director,
        description: d.description || workCorrection.description,
        dfi_id: d.dfi_id ? String(d.dfi_id) : workCorrection.dfi_id,
        tmdb_id: d.tmdb_id ? String(d.tmdb_id) : workCorrection.tmdb_id,
        imdb_id: d.imdb_id || workCorrection.imdb_id,
        field_sources: { ...workCorrection.field_sources, title: source, type: source, year: source, duration_minutes: source, genre: source, director: source, description: source, imdb_id: d.imdb_id ? "tmdb" : source },
      });
      setExternalResults([]);
    } finally {
      setExternalLoading(false);
    }
  };

  const handleSendWorkCorrection = async () => {
    if (!assignment.works || !workCorrection) return;
    setSaveFeedback(null);
    const myEpisodes = Object.entries(selectedEpisodes)
      .filter(([, checked]) => checked)
      .map(([num]) => parseInt(num, 10))
      .sort((a, b) => a - b);
    const initialCorrection = workToCorrectionForm(assignment.works);
    const hasWorkDataChanges = JSON.stringify(workCorrection) !== JSON.stringify(initialCorrection);
    const changedCoEditors = editCoEditors.filter(editor => !editor.locked || editor.action === "remove" || editor.action === "change");
    const hasCoEditorChanges = changedCoEditors.length > 0;
    const addedCoEditors = editCoEditors.filter(editor => !editor.locked && editor.name.trim());
    const ownShare = sharePercentOrNull(selfSharePercent);
    if (addedCoEditors.length > 0 && ownShare === null) {
      setSaveFeedback({ type: "error", text: "Angiv din egen vurderede arbejdsandel, når du tilføjer en medklipper." });
      return;
    }
    const missingRightsHolder = changedCoEditors.some(editor => (editor.action === "add" || editor.action === "change" || !editor.locked) && !editor.rightsHolderId);
    if (missingRightsHolder) {
      setSaveFeedback({ type: "error", text: "Vælg en eksisterende rettighedshaver fra listen, før du gemmer medklipperen." });
      return;
    }
    const roleChanged = editRole !== displayRole(assignment.role);
    if (hasWorkDataChanges && !workCorrectionComment.trim()) {
      setCommentError(true);
      setShowWorkCorrection(true);
      setSaveFeedback({ type: "error", text: `Skriv en bemærkning til ${organisationShortName}, før du gemmer rettelsen.` });
      return;
    }
    setIsSendingCorrection(true);

    try {
      if (editScope === "season" && assignment.rights_holder_id) {
        const syncResult = await syncMemberEpisodeAssignments({
          rightsHolderId: assignment.rights_holder_id,
          workId: assignment.works.id,
          role: editRole,
          selectedEpisodes: myEpisodes,
          seasonNumber: directEpisodeSeason,
          coversWholeSeason,
        });
        if (!syncResult.success) throw new Error(syncResult.error ?? "Afsnitstilknytningerne kunne ikke gemmes.");
      }
      if (hasCoEditorChanges || roleChanged) {
        const res = await updateMemberCoEditors({
          rightsHolderId: assignment.rights_holder_id!,
          workId: assignment.works.id,
          editScope,
          seasonNumber: editScope === "season" ? directEpisodeSeason : undefined,
          episodeNumbers: editScope === "season" ? myEpisodes : undefined,
          memberRole: editRole,
          selfSharePercent: addedCoEditors.length > 0 ? ownShare : null,
          changes: changedCoEditors.map(editor => ({
            assignmentId: editor.assignmentId,
            rightsHolderId: editor.rightsHolderId,
            originalRightsHolderId: editor.originalRightsHolderId,
            role: editor.role,
            action: editor.action ?? "add",
          })),
        });
        if (!res.success) throw new Error(res.error ?? "Medklipperne kunne ikke gemmes.");
      }
      if (hasWorkDataChanges) {
        const res = await submitWorkDataCorrection({
          assignmentId: assignment.id,
          workId: assignment.works.id,
          editScope,
          seasonNumber: editScope === "season" ? directEpisodeSeason : undefined,
          data: {
            title: workCorrection.title,
            type: workCorrection.type,
            year: numberOrNull(workCorrection.year),
            duration_minutes: numberOrNull(workCorrection.duration_minutes),
            season_count: numberOrNull(workCorrection.season_count),
            season_number: editScope === "episode" ? numberOrNull(workCorrection.season_number) : null,
            episode_number: editScope === "episode" ? numberOrNull(workCorrection.episode_number) : null,
            episode_count: numberOrNull(workCorrection.episode_count),
            genre: workCorrection.genre || null,
            director: workCorrection.director || null,
            description: workCorrection.description || null,
            dfi_id: workCorrection.dfi_id || null,
            tmdb_id: numberOrNull(workCorrection.tmdb_id),
            imdb_id: workCorrection.imdb_id || null,
            field_sources: workCorrection.field_sources,
          },
          comment: workCorrectionComment,
        });
        if (!res.success) throw new Error(t("works.createFailed"));
      }
      const message = hasWorkDataChanges
        ? t("works.correctionSent")
        : hasCoEditorChanges
          ? "Medklipperne er gemt."
          : editScope === "season"
            ? "Sæsonens afsnit er gemt."
            : t("common.saved");
      setSaveFeedback({ type: "success", text: message });
      onWorkUpdated(message, true, roleChanged || editScope === "season" ? editRole : undefined, assignment.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("works.createFailed");
      setSaveFeedback({ type: "error", text: message });
      onWorkUpdated(message, false);
    } finally {
      setIsSendingCorrection(false);
    }
  };

  if (!isOpen) return null;

  const directSeriesEpisodeCount = workCorrection && isSeriesType(workCorrection.type)
    ? parseInt(workCorrection.episode_count || "0", 10) || 0
    : 0;
  const directSeriesEpisodeOptions = directEpisodeOptions.length
    ? directEpisodeOptions
    : buildCompleteEpisodeOptions({ episodeCount: directSeriesEpisodeCount });
  const directSelectedEpisodeNumbers = Object.entries(selectedEpisodes)
    .filter(([, checked]) => checked)
    .map(([num]) => parseInt(num, 10))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const collaborationReviewWorkIds = editScope === "season"
    ? [...new Set(allAssignments
        .filter(item => item.rights_holder_id === assignment.rights_holder_id && item.works?.episode_number != null && (coversWholeSeason || directSelectedEpisodeNumbers.includes(item.works.episode_number)))
        .map(item => item.works?.id ?? item.work_id)
        .filter((id): id is string => Boolean(id)))]
    : assignment.works?.id ? [assignment.works.id] : [];

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-semibold text-foreground">{assignment.works?.title}</h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </div>
      {assignment.works && (
        <div className="mb-6 rounded-lg border p-4">
          <p className="mb-3 text-sm font-semibold text-foreground">
            {locale === "da" ? "Grunddata" : "Current work data"}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ReadonlyWorkField label="Titel" value={assignment.works.title} />
            <ReadonlyWorkField label="Type" value={workTypeLabel(assignment.works.type)} />
            <ReadonlyWorkField label="Premiereår" value={assignment.works.year} />
            <ReadonlyWorkField label="Længde" value={assignment.works.duration_minutes != null ? `${assignment.works.duration_minutes} min.` : null} />
            <ReadonlyWorkField label="Produktionsselskab" value={(assignment.works.production_companies ?? []).join(", ")} />
            <ReadonlyWorkField label="Instruktør" value={assignment.works.director} />
          </div>
        </div>
      )}
      {(assignment.works?.work_change_requests ?? []).length > 0 && (
        <div className="mb-5">
          <MessageThread
            title={t("works.adminComments")}
            messages={requestThreadMessages(assignment.works)}
            viewerRole="member"
            memberLabel="Dig"
            adminLabel="DFKS"
            emptyText="Der er endnu ingen beskeder på rettelsen."
            nextActionLabel={workNextActionLabel(assignment.works)}
            nextActionTone={workNextActionTone(assignment.works)}
          />
        </div>
      )}
      {editScope === "season" && (directSeriesEpisodeCount > 0 || directSeriesEpisodeOptions.length > 0 || initialEpisodeScope?.status === "pending") && (
        <div className="mb-6 rounded-lg border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {locale === "da" ? "Dine afsnit" : "Your episodes"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {locale === "da"
                  ? "Vælg de afsnit, du har klippet. Tilknytningerne gemmes direkte."
                  : "Choose the episodes you edited. Assignments are saved directly."}
              </p>
            </div>
            {directSelectedEpisodeNumbers.length > 0 && (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">
                {directSelectedEpisodeNumbers.length} valgt
              </span>
            )}
          </div>
          <div className="mt-3">
            <label className="mb-3 flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={coversWholeSeason}
                onChange={event => {
                  setCoversWholeSeason(event.target.checked);
                  if (event.target.checked) setSelectedEpisodes({});
                }}
              />
              <span>{locale === "da" ? "Jeg arbejdede på hele sæsonen" : "I worked on the entire season"}</span>
            </label>
            <SeriesEpisodeSelector
              season={directEpisodeSeason}
              onSeasonChange={() => undefined}
              options={directSeriesEpisodeOptions}
              selected={coversWholeSeason ? [] : directSelectedEpisodeNumbers}
              onSelectedChange={episodes => {
                setCoversWholeSeason(false);
                setSelectedEpisodes(Object.fromEntries(episodes.map(number => [number, true])));
              }}
              loading={directEpisodesLoading}
              seasonReadOnly
              compact
            />
          </div>
        </div>
      )}

      {/* MEDKLIPPERE SEKTION (Altid synlig på side 1) */}
      <div className="rounded-lg border p-4 mb-6">
        <p className="mb-3 text-sm font-semibold text-foreground">Rettighedshavere</p>
        <div className="mb-4 space-y-1.5">
          <Label className="text-sm font-medium text-muted-foreground">{t("works.yourRole")}</Label>
          <select value={editRole} onChange={e => setEditRole(e.target.value)} className={selectCls}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="mb-4 rounded-md bg-blue-50 p-3 text-sm text-blue-950 dark:bg-blue-500/10 dark:text-blue-100">
          <p className="font-medium">Hvad skal du gøre?</p>
          <p className="mt-1 text-xs leading-relaxed">
            Hvis du ikke har klippet {editScope === "episode" ? "afsnittet" : "værket"} alene, skal du tilføje de andre klippere, der har arbejdet på {editScope === "episode" ? "afsnittet" : "værket"}. Når du tilføjer en medklipper, skal du også angive din egen vurderede arbejdsandel. Hver medklipper bliver bedt om at angive sin egen andel. I kan ikke se hinandens bud, og DFKS fastsætter og offentliggør først den endelige fordeling. Hvis du har klippet {editScope === "episode" ? "afsnittet" : "værket"} alene, skal du vælge “Har klippet alene” – du skal ikke angive en procent.
          </p>
        </div>
        {assignment.rights_holder_id && collaborationReviewWorkIds.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <p className="max-w-xl text-xs text-muted-foreground">Bekræft kun dette, hvis ingen andre klippere arbejdede på det valgte værk eller de valgte afsnit. Hvis andre allerede er registreret, sendes din oplysning til DFKS som en indsigelse.</p>
            <Button type="button" variant="outline" disabled={soloSaving} onClick={() => {
              setSoloSaving(true);
              void confirmNoCoeditors({ rightsHolderId: assignment.rights_holder_id!, workIds: collaborationReviewWorkIds, source: "member_editor" })
                .then(result => {
                  if (!result.success) throw new Error(result.error);
                  const message = result.disputed
                    ? `Dit svar er gemt. ${result.disputed} værk eller afsnit afventer DFKS, fordi andre klippere allerede er registreret.`
                    : "Dit svar ‘Har klippet alene’ er gemt.";
                  onWorkUpdated(message, true);
                })
                .catch(error => {
                  const message = error instanceof Error ? error.message : "Svaret kunne ikke gemmes.";
                  setSaveFeedback({ type: "error", text: message });
                  onWorkUpdated(message, false);
                })
                .finally(() => setSoloSaving(false));
            }}>Har klippet alene</Button>
          </div>
        )}
        <div className="space-y-2">
          {editCoEditors.map(editor => (
            <div key={editor.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
              <div className="relative">
                <LocalRightsHolderAutocomplete
                  value={editor.name}
                  disabled={editor.locked && editor.action !== "change"}
                  placeholder={t("works.namePlaceholder")}
                  excludedIds={[
                    assignment.rights_holder_id,
                    ...editCoEditors.map(item => item.id === editor.id ? null : item.rightsHolderId),
                  ]}
                  onValueChange={value => {
                    setEditCoEditors(prev =>
                      prev.map(item =>
                        item.id === editor.id
                          ? { ...item, name: value, rightsHolderId: null, action: item.locked ? "change" : item.action }
                          : item
                      )
                    );
                  }}
                  onSelect={suggestion => {
                    setEditCoEditors(prev =>
                      prev.map(item =>
                        item.id === editor.id
                          ? { ...item, name: suggestion.full_name, rightsHolderId: suggestion.id, action: item.locked ? "change" : item.action }
                          : item
                      )
                    );
                  }}
                />
              </div>
              <select
                value={editor.role}
                disabled={editor.locked && editor.action !== "change"}
                onChange={e =>
                  setEditCoEditors(prev =>
                    prev.map(item =>
                      item.id === editor.id
                        ? { ...item, role: e.target.value, action: item.locked ? "change" : item.action }
                        : item
                    )
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
              {editor.locked ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setEditCoEditors(prev =>
                        prev.map(item =>
                          item.id === editor.id
                            ? { ...item, action: item.action === "change" ? undefined : "change" }
                            : item
                        )
                      )
                    }
                  >
                    {editor.action === "change" ? t("works.lock") : t("works.suggestEdit")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setEditCoEditors(prev =>
                        prev.map(item =>
                          item.id === editor.id
                            ? { ...item, action: item.action === "remove" ? undefined : "remove" }
                            : item
                        )
                      )
                    }
                  >
                    {editor.action === "remove" ? t("works.undo") : t("works.suggestRemove")}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditCoEditors(prev => prev.filter(item => item.id !== editor.id))}
                >
                  {t("works.removeCoEditor")}
                </Button>
              )}
              {editor.action === "remove" && (
                <p className="text-xs text-red-600 sm:col-span-3">{t("works.removeNotice")}</p>
              )}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setEditCoEditors(prev => [...prev, emptyCoEditor()])}
        >
          {t("works.addCoEditor")}
        </Button>
        <p className="mt-2 text-xs text-gray-500">{t("works.editCoEditorsHint")}</p>
        {(editCoEditors.some(editor => !editor.locked && editor.name.trim()) || shareTask) && (
          <div className="mt-4 max-w-sm space-y-1.5">
            <Label htmlFor="edit-self-share">Din egen vurderede arbejdsandel (%)</Label>
            <Input id="edit-self-share" inputMode="decimal" value={selfSharePercent} onChange={event => setSelfSharePercent(event.target.value)} placeholder="Fx 40" />
            <p className="text-xs text-muted-foreground">Skriv kun din egen andel. Procenten bliver først offentlig, når DFKS har afsluttet sagen.</p>
          </div>
        )}
        {shareTask && shareTask.status !== "resolved" && assignment.rights_holder_id && (
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            <Button
              type="button"
              disabled={shareTaskSaving || sharePercentOrNull(selfSharePercent) === null}
              onClick={() => {
                setShareTaskSaving(true);
                void respondToWorkShareTask({
                  rightsHolderId: assignment.rights_holder_id!, caseId: shareTask.id,
                  percent: sharePercentOrNull(selfSharePercent), declined: false, responseScope: editScope,
                }).then(result => {
                  if (!result.success) throw new Error(result.error);
                  onWorkUpdated("Din vurderede arbejdsandel er gemt og sendt til DFKS.", true);
                }).catch(error => {
                  const message = error instanceof Error ? error.message : "Svaret kunne ikke gemmes.";
                  setSaveFeedback({ type: "error", text: message });
                  onWorkUpdated(message, false);
                })
                  .finally(() => setShareTaskSaving(false));
              }}
            >Gem mit procentbud</Button>
            <Button
              type="button" variant="outline" disabled={shareTaskSaving}
              onClick={() => {
                setShareTaskSaving(true);
                void respondToWorkShareTask({ rightsHolderId: assignment.rights_holder_id!, caseId: shareTask.id, declined: true, responseScope: editScope })
                  .then(result => {
                    if (!result.success) throw new Error(result.error);
                    onWorkUpdated("Du har oplyst, at du ikke har arbejdet på værket. DFKS gennemgår sagen.", true);
                  }).catch(error => {
                    const message = error instanceof Error ? error.message : "Svaret kunne ikke gemmes.";
                    setSaveFeedback({ type: "error", text: message });
                    onWorkUpdated(message, false);
                  })
                  .finally(() => setShareTaskSaving(false));
              }}
            >Jeg har ikke arbejdet på værket</Button>
          </div>
        )}
        {shareTaskLoading && <p className="mt-3 text-xs text-muted-foreground">Henter procentopgaven…</p>}
        {shareTask?.status === "resolved" && (
          <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Endelig fordeling</p>
            {(shareTask.finalDistribution ?? []).map((row, index) => (
              <p key={index} className="mt-1 text-xs text-muted-foreground">{row.rettighedshavere?.full_name ?? row.role}: {row.final_percent} %</p>
            ))}
            {shareTask.reservePercent ? <p className="mt-1 text-xs text-muted-foreground">Reserve: {shareTask.reservePercent} %</p> : null}
          </div>
        )}
        {(shareTask?.reportedDeclines ?? []).map((row, index) => (
          <p key={`decline-${index}`} className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
            {row.rettighedshavere?.full_name ?? row.proposed_name ?? "Den angivne medklipper"} har oplyst, at vedkommende ikke arbejdede på værket. DFKS gennemgår sagen.
          </p>
        ))}
      </div>

      {/* FORESLÅ MANUEL RETTELSE SEKTION */}
      <div className="mb-6 rounded-lg border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">{t("works.manualWorkData")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {locale === "da"
                ? "Foreslå rettelser til titel, type, premiereår, varighed, sæson, afsnit, og instruktør."
                : "Suggest corrections to title, type, premiere year, duration, season, episodes, and director."}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setShowWorkCorrection(v => !v);
              if (!showWorkCorrection && !externalQuery.trim()) {
                setExternalQuery(workCorrection?.title ?? assignment.works?.title ?? "");
              }
            }}
            className="w-full sm:w-auto"
          >
            {showWorkCorrection ? t("works.hideCorrection") : t("works.suggestCorrection")}
          </Button>
        </div>

        {showWorkCorrection && workCorrection && (
          <div className="mt-4 grid gap-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              {locale === "da"
                ? "Bemærk: Forkerte værksdata kan gøre det svært at matche værket i systemet, hvilket kan forsinke eller forhindre korrekt udbetaling af dine rettighedsmidler. Alle rettelser skal derfor godkendes af administrator."
                : "Note: Incorrect work data can make it difficult to match the work in the system, which can delay or prevent correct payment of your rights funds. All corrections must therefore be approved by an administrator."}
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <Label className="text-sm font-medium">Find og kombiner data fra DFI og TMDB</Label>
              <div className="mt-2 flex gap-2">
                <Input value={externalQuery} onChange={e => setExternalQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void handleExternalSearch(); }} placeholder="Søg efter værket…" />
                <Button type="button" variant="outline" onClick={handleExternalSearch} disabled={externalLoading} className="gap-2">
                  {externalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Søg
                </Button>
              </div>
              {externalResults.length > 0 && <div className="mt-2 space-y-1">
                {externalResults.map(result => <button key={result.id} type="button" onClick={() => applyExternalResult(result)} className="flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm hover:bg-muted">
                  <span>{result.title} · {result.year ?? "-"}</span><span className="text-xs uppercase text-muted-foreground">{result.sources.join(" + ")}</span>
                </button>)}
              </div>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-muted-foreground">{t("works.titleField")}</Label>
              <Input
                value={workCorrection.title}
                onChange={e => setWorkCorrection({ ...workCorrection, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-muted-foreground">{t("works.typeField")}</Label>
                <select
                  value={workCorrection.type}
                  onChange={e => setWorkCorrection({ ...workCorrection, type: e.target.value })}
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
                <Label className="text-sm font-medium text-muted-foreground">{t("works.yearField")}</Label>
                <Input
                  value={workCorrection.year}
                  onChange={e => setWorkCorrection({ ...workCorrection, year: e.target.value })}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-muted-foreground">{t("works.durationField")}</Label>
                <Input
                  value={workCorrection.duration_minutes}
                  onChange={e => setWorkCorrection({ ...workCorrection, duration_minutes: e.target.value })}
                  inputMode="numeric"
                />
              </div>
              {isSeriesType(workCorrection.type) && editScope === "episode" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-muted-foreground">Sæson</Label>
                  <Input
                    value={workCorrection.season_number}
                    onChange={e => {
                      setWorkCorrection({ ...workCorrection, season_number: e.target.value });
                      setDirectEpisodeSeason(numberOrNull(e.target.value) ?? 1);
                    }}
                    inputMode="numeric"
                  />
                </div>
              )}
              {isSeriesType(workCorrection.type) && editScope === "episode" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-muted-foreground">Afsnit</Label>
                  <Input
                    value={workCorrection.episode_number}
                    onChange={e => setWorkCorrection({ ...workCorrection, episode_number: e.target.value })}
                    inputMode="numeric"
                  />
                </div>
              )}
              {isSeriesType(workCorrection.type) && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-muted-foreground">Antal afsnit</Label>
                  <Input
                    value={workCorrection.episode_count}
                    onChange={e => setWorkCorrection({ ...workCorrection, episode_count: e.target.value })}
                    inputMode="numeric"
                  />
                </div>
              )}
              {isSeriesType(workCorrection.type) && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-muted-foreground">Antal sæsoner</Label>
                  <Input
                    value={workCorrection.season_count}
                    onChange={e => setWorkCorrection({ ...workCorrection, season_count: e.target.value })}
                    inputMode="numeric"
                  />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">Instruktør</Label>
              <Input
                value={workCorrection.director}
                onChange={e => setWorkCorrection({ ...workCorrection, director: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>DFI-id</Label><Input value={workCorrection.dfi_id} onChange={e => setWorkCorrection({ ...workCorrection, dfi_id: e.target.value, field_sources: { ...workCorrection.field_sources, dfi_id: "manual" } })} /></div>
              <div className="space-y-1.5"><Label>TMDB-id</Label><Input value={workCorrection.tmdb_id} onChange={e => setWorkCorrection({ ...workCorrection, tmdb_id: e.target.value, field_sources: { ...workCorrection.field_sources, tmdb_id: "manual" } })} /></div>
              <div className="space-y-1.5"><Label>IMDb-id</Label><Input value={workCorrection.imdb_id} onChange={e => setWorkCorrection({ ...workCorrection, imdb_id: e.target.value, field_sources: { ...workCorrection.field_sources, imdb_id: "manual" } })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-muted-foreground">{t("works.commentToAdmin")}</Label>
              <Textarea value={workCorrectionComment} onChange={e => { setWorkCorrectionComment(e.target.value); if (commentError) setCommentError(false); }} placeholder={locale === "da" ? "Forklar kort rettelsen af værksdata, fx titel, type, år eller instruktør." : "Briefly explain the work data correction, such as title, type, year, or director."} className={commentError ? "border-red-500 focus-visible:ring-red-500" : undefined} />
              {commentError && <p className="text-xs text-red-600">{locale === "da" ? `Skriv en bemærkning til ${organisationShortName}, før du sender rettelsen.` : `Add a note to ${organisationShortName} before sending the correction.`}</p>}
            </div>
          </div>
        )}
      </div>
      {saveFeedback && (
        <div
          className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            saveFeedback.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-100"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"
          }`}
        >
          {saveFeedback.text}
        </div>
      )}
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end mt-4 pt-4 border-t border-gray-100">
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleSendWorkCorrection} disabled={isSendingCorrection} className="gap-2">
          {isSendingCorrection && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("common.save")}
        </Button>
      </div>
    </Modal>
  );
}
