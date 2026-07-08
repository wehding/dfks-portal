"use client";

import React, { useState, useEffect } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "./Modal";
import { submitWorkDataCorrection } from "@/app/actions/work-management";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";

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

type CoEditorSuggestion = {
  id: string;
  full_name: string;
};

interface WorkCorrectionForm {
  title: string;
  type: string;
  year: string;
  duration_minutes: string;
  season_count: string;
  episode_count: string;
  genre: string;
  director: string;
  description: string;
}

function isSeriesType(type: string) {
  return type === "tv-serie" || type === "dokumentar-serie";
}

type RequestComment = {
  id: string;
  author_role: "member" | "admin";
  message: string;
  created_at: string;
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
  genre: string | null;
  director: string | null;
  status: string | null;
  dfi_id: string | null;
  tmdb_id: number | string | null;
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

type AdminRequestSummary = {
  id: string;
  kind: string;
  status: string;
  message: string;
  createdAt: string;
};

interface EditWorkModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignment: Assignment;
  allAssignments: Assignment[];
  onWorkUpdated: (message: string, success: boolean, updatedRole?: string, targetId?: string) => void;
  locale: string;
}

function emptyCoEditor(): CoEditorDraft {
  return { id: crypto.randomUUID(), name: "", role: "Klipper", action: "add" };
}

function displayRole(role: string | null | undefined) {
  return role === "Hovedklipper" ? "Konceptuerende klipper" : role ?? "Klipper";
}

function workToCorrectionForm(w: Work): WorkCorrectionForm {
  return {
    title: w.title ?? "",
    type: w.type ?? "spillefilm",
    year: w.year != null ? String(w.year) : "",
    duration_minutes: w.duration_minutes != null ? String(w.duration_minutes) : "",
    season_count: w.season_count != null ? String(w.season_count) : "",
    episode_count: w.episode_count != null ? String(w.episode_count) : "",
    genre: w.genre ?? "",
    director: w.director ?? "",
    description: w.description ?? "",
  };
}

function requestKindLabel(request: ChangeRequest) {
  const kind = request.proposed_data?.kind;
  if (kind === "creation") return "Nyt værk";
  if (kind === "co_editors") return "Medklippere";
  return "Rettelse";
}

function requestStatusLabel(status: ChangeRequest["status"]) {
  if (status === "pending") return "Afventer";
  if (status === "approved") return "Godkendt";
  return "Afvist";
}

function adminRequestSummaries(work: Work | null | undefined): AdminRequestSummary[] {
  return (work?.work_change_requests ?? [])
    .flatMap((request): AdminRequestSummary[] => {
      const comments = (request.work_change_request_comments ?? [])
        .filter(comment => comment.author_role === "admin")
        .map(comment => ({
          id: `${request.id}-${comment.id}`,
          kind: requestKindLabel(request),
          status: requestStatusLabel(request.status),
          message: comment.message,
          createdAt: comment.created_at,
        }));
      return comments.length
        ? comments
        : request.admin_comment
        ? [
            {
              id: request.id,
              kind: requestKindLabel(request),
              status: requestStatusLabel(request.status),
              message: request.admin_comment,
              createdAt: "",
            },
          ]
        : [];
    })
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

function numberOrNull(val: string) {
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

export function EditWorkModal({
  isOpen,
  onClose,
  assignment,
  allAssignments,
  onWorkUpdated,
  locale,
}: EditWorkModalProps) {
  const { t } = useI18n();

  const [editRole, setEditRole]                         = useState("");
  const [showWorkCorrection, setShowWorkCorrection]     = useState(false);
  const [workCorrection, setWorkCorrection]             = useState<WorkCorrectionForm | null>(null);
  const [workCorrectionComment, setWorkCorrectionComment] = useState("");
  const [editCoEditors, setEditCoEditors]               = useState<CoEditorDraft[]>([]);
  const [coEditorSuggestions, setCoEditorSuggestions]   = useState<Record<string, CoEditorSuggestion[]>>({});
  const [isSendingCorrection, setIsSendingCorrection]   = useState(false);
  const [commentError, setCommentError]                 = useState(false);
  const [selectedEpisodes, setSelectedEpisodes]         = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (isOpen && assignment) {
      setEditRole(displayRole(assignment.role));
      setShowWorkCorrection(false);
      setWorkCorrection(assignment.works ? workToCorrectionForm(assignment.works) : null);
      setWorkCorrectionComment("");
      setCommentError(false);
      setSelectedEpisodes({});
      setCoEditorSuggestions({});
      setEditCoEditors(
        (allAssignments ?? [])
          .filter(other => other.work_id === assignment.works?.id)
          .map(other => ({
            id: other.id,
            name: other.rettighedshavere?.full_name ?? "Ukendt medklipper",
            role: displayRole(other.role),
            assignmentId: other.id,
            rightsHolderId: other.rights_holder_id ?? other.rettighedshavere?.id ?? null,
            locked: true,
          }))
      );
    }
  }, [isOpen, assignment, allAssignments]);

  const searchCoEditors = async (editorId: string, query: string) => {
    const q = query.trim();
    if (q.length < 2) {
      setCoEditorSuggestions(prev => ({ ...prev, [editorId]: [] }));
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("rettighedshavere")
      .select("id, full_name")
      .ilike("full_name", `%${q}%`)
      .limit(6);
    const existingIds = new Set(editCoEditors.map(editor => editor.rightsHolderId).filter(Boolean));
    const suggestions = ((data ?? []) as CoEditorSuggestion[])
      .filter(suggestion => !existingIds.has(suggestion.id));
    setCoEditorSuggestions(prev => ({ ...prev, [editorId]: suggestions }));
  };

  const handleSendWorkCorrection = async () => {
    if (!assignment.works || !workCorrection) return;
    if (!workCorrectionComment.trim()) { setCommentError(true); return; }
    setIsSendingCorrection(true);

    const myEpisodes = Object.entries(selectedEpisodes)
      .filter(([_, checked]) => checked)
      .map(([num, _]) => parseInt(num, 10))
      .sort((a, b) => a - b);

    try {
      const res = await submitWorkDataCorrection({
        assignmentId: assignment.id,
        workId: assignment.works.id,
        data: {
          title: workCorrection.title,
          type: workCorrection.type,
          year: numberOrNull(workCorrection.year),
          duration_minutes: numberOrNull(workCorrection.duration_minutes),
          season_count: numberOrNull(workCorrection.season_count),
          episode_count: numberOrNull(workCorrection.episode_count),
          genre: workCorrection.genre || null,
          director: workCorrection.director || null,
          description: workCorrection.description || null,
        },
        comment: workCorrectionComment,
        coEditors: editCoEditors.filter(
          editor => !editor.locked || editor.action === "remove" || editor.action === "change"
        ),
        myEpisodes,
      });
      if (!res.success) throw new Error(t("works.createFailed"));
      onWorkUpdated(t("works.correctionSent"), true);
    } catch (err: unknown) {
      onWorkUpdated(err instanceof Error ? err.message : t("works.createFailed"), false);
    } finally {
      setIsSendingCorrection(false);
    }
  };

  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const handleSaveEdit = async () => {
    setIsSavingEdit(true);
    const supabase = createClient();

    const coEditorChanges = editCoEditors.filter(
      editor => !editor.locked || editor.action === "remove" || editor.action === "change"
    );

    // "Gem" sender også en åben værks-rettelse med — så indtastede felter
    // ikke tabes fordi brugeren trykkede "Gem" i stedet for "Send rettelse".
    const wantsCorrection = showWorkCorrection && !!workCorrection;
    const willSubmit = coEditorChanges.length > 0 || wantsCorrection;

    if (willSubmit && !workCorrectionComment.trim()) {
      setCommentError(true);
      setIsSavingEdit(false);
      return;
    }

    try {
      let ownRoleError = null;
      if (editRole !== displayRole(assignment.role)) {
        const { error } = await supabase
          .from("work_assignments")
          .update({ role: editRole })
          .eq("id", assignment.id);
        ownRoleError = error;
      }

      if (ownRoleError) throw new Error(ownRoleError.message);

      if (willSubmit) {
        if (!assignment.works) throw new Error("Værket mangler.");
        const data = wantsCorrection && workCorrection
          ? {
              title: workCorrection.title,
              type: workCorrection.type,
              year: numberOrNull(workCorrection.year),
              duration_minutes: numberOrNull(workCorrection.duration_minutes),
              season_count: numberOrNull(workCorrection.season_count),
              episode_count: numberOrNull(workCorrection.episode_count),
              genre: workCorrection.genre || null,
              director: workCorrection.director || null,
              description: workCorrection.description || null,
            }
          : {
              title: assignment.works.title,
              type: assignment.works.type ?? "spillefilm",
              year: assignment.works.year,
              duration_minutes: assignment.works.duration_minutes,
              season_count: assignment.works.season_count,
              episode_count: assignment.works.episode_count,
              genre: assignment.works.genre,
              director: assignment.works.director,
              description: assignment.works.description,
            };
        await submitWorkDataCorrection({
          assignmentId: assignment.id,
          workId: assignment.works.id,
          data,
          comment: workCorrectionComment,
          coEditors: coEditorChanges,
        });
      }

      onWorkUpdated(t("common.saved"), true, editRole, assignment.id);
    } catch (err: unknown) {
      onWorkUpdated(err instanceof Error ? err.message : t("common.genericError"), false);
    } finally {
      setIsSavingEdit(false);
    }
  };

  if (!isOpen) return null;

  const editAdminSummaries = adminRequestSummaries(assignment.works);
  const coEditorChanges = editCoEditors.filter(
    editor => !editor.locked || editor.action === "remove" || editor.action === "change"
  );

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-semibold text-gray-900">{assignment.works?.title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {locale === "da"
          ? "Bemærk: Forkerte værksdata kan gøre det svært at matche værket i systemet, hvilket kan forsinke eller forhindre korrekt udbetaling af dine rettighedsmidler. Alle rettelser skal derfor godkendes af administrator."
          : "Note: Incorrect work data can make it difficult to match the work in the system, which can delay or prevent correct payment of your rights funds. All corrections must therefore be approved by an administrator."}
      </div>
      {editAdminSummaries.length > 0 && (
        <div className="mb-5 rounded-lg border border-gray-200 p-4">
          <p className="mb-3 text-sm font-semibold text-gray-900">{t("works.adminComments")}</p>
          <div className="space-y-2">
            {editAdminSummaries.map(summary => (
              <div key={summary.id} className="rounded-md bg-gray-50 px-3 py-2 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">{summary.kind}</span>
                  <span>{summary.status}</span>
                  {summary.createdAt && <span>{new Date(summary.createdAt).toLocaleString("da-DK")}</span>}
                </div>
                <p className="text-gray-800">{summary.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1.5 mb-6">
        <Label className="text-sm font-medium text-gray-500">{t("works.yourRole")}</Label>
        <select value={editRole} onChange={e => setEditRole(e.target.value)} className={selectCls}>
          {ROLES.map(r => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* MEDKLIPPERE SEKTION (Altid synlig på side 1) */}
      <div className="rounded-lg border border-gray-200 p-4 mb-6">
        <p className="mb-3 text-sm font-semibold text-gray-900">{t("works.coEditors")}</p>
        <div className="space-y-2">
          {editCoEditors.map(editor => (
            <div key={editor.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
              <div className="relative">
                <Input
                  value={editor.name}
                  disabled={editor.locked && editor.action !== "change"}
                  onChange={e => {
                      const value = e.target.value;
                      setEditCoEditors(prev =>
                        prev.map(item =>
                          item.id === editor.id
                            ? { ...item, name: value, rightsHolderId: null, action: item.locked ? "change" : item.action }
                            : item
                        )
                      );
                      searchCoEditors(editor.id, value);
                    }}
                  placeholder={t("works.namePlaceholder")}
                />
                {(coEditorSuggestions[editor.id] ?? []).length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-sm">
                    {(coEditorSuggestions[editor.id] ?? []).map(suggestion => (
                      <button
                        key={suggestion.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        onClick={() => {
                          setEditCoEditors(prev =>
                            prev.map(item =>
                              item.id === editor.id
                                ? { ...item, name: suggestion.full_name, rightsHolderId: suggestion.id, action: item.locked ? "change" : item.action }
                                : item
                            )
                          );
                          setCoEditorSuggestions(prev => ({ ...prev, [editor.id]: [] }));
                        }}
                      >
                        {suggestion.full_name}
                      </button>
                    ))}
                  </div>
                )}
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
      </div>

      {/* BEMÆRKNING VED MEDKLIPPER-ÆNDRINGER ELLER MANUEL RETTELSE */}
      {(coEditorChanges.length > 0 || showWorkCorrection) && (
        <div className="space-y-1.5 mb-6">
          <Label className="text-sm font-medium text-gray-500">{t("works.commentToAdmin")}</Label>
          <Textarea
            value={workCorrectionComment}
            onChange={e => { setWorkCorrectionComment(e.target.value); if (commentError) setCommentError(false); }}
            placeholder={locale === "da" ? "Forklar kort hvorfor dataene/medklipperne bør ændres." : "Briefly explain why data/co-editors should be changed."}
            className={commentError ? "border-red-500 focus-visible:ring-red-500" : undefined}
          />
          {commentError && (
            <p className="text-xs text-red-600">
              {locale === "da" ? "Skriv en bemærkning til admin, før du gemmer." : "Add a note to admin before saving."}
            </p>
          )}
        </div>
      )}

      {/* FORESLÅ MANUEL RETTELSE SEKTION */}
      <div className="mb-6 rounded-lg border border-gray-200 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">{t("works.manualWorkData")}</p>
            <p className="mt-1 text-xs text-gray-500">
              {locale === "da"
                ? "Foreslå rettelser til titel, type, premiereår, varighed, sæson, afsnit, og instruktør."
                : "Suggest corrections to title, type, premiere year, duration, season, episodes, and director."}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowWorkCorrection(v => !v)}
            className="w-full sm:w-auto"
          >
            {showWorkCorrection ? t("works.hideCorrection") : t("works.suggestCorrection")}
          </Button>
        </div>

        {showWorkCorrection && workCorrection && (
          <div className="mt-4 grid gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">{t("works.titleField")}</Label>
              <Input
                value={workCorrection.title}
                onChange={e => setWorkCorrection({ ...workCorrection, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-gray-500">{t("works.typeField")}</Label>
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
                <Label className="text-sm font-medium text-gray-500">{t("works.yearField")}</Label>
                <Input
                  value={workCorrection.year}
                  onChange={e => setWorkCorrection({ ...workCorrection, year: e.target.value })}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-gray-500">{t("works.durationField")}</Label>
                <Input
                  value={workCorrection.duration_minutes}
                  onChange={e => setWorkCorrection({ ...workCorrection, duration_minutes: e.target.value })}
                  inputMode="numeric"
                />
              </div>
              {isSeriesType(workCorrection.type) && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-gray-500">Sæson</Label>
                  <Input
                    value={workCorrection.season_count}
                    onChange={e => setWorkCorrection({ ...workCorrection, season_count: e.target.value })}
                    inputMode="numeric"
                  />
                </div>
              )}
              {isSeriesType(workCorrection.type) && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-gray-500">{t("works.episodesField")}</Label>
                  <Input
                    value={workCorrection.episode_count}
                    onChange={e => setWorkCorrection({ ...workCorrection, episode_count: e.target.value })}
                    inputMode="numeric"
                  />
                </div>
              )}
              {isSeriesType(workCorrection.type) && (
                (() => {
                  const epCount = parseInt(workCorrection.episode_count || "0", 10) || 0;
                  if (epCount <= 0) return null;
                  return (
                    <div className="col-span-1 sm:col-span-2 space-y-2 rounded-lg border border-gray-200 p-4 bg-gray-50/50">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold text-gray-900">Vælg afsnit du har klippet</Label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium bg-transparent border-0 cursor-pointer"
                            onClick={() => {
                              const all: Record<number, boolean> = {};
                              for (let i = 1; i <= epCount; i++) all[i] = true;
                              setSelectedEpisodes(all);
                            }}
                          >
                            Vælg alle
                          </button>
                          <span className="text-gray-300 text-xs">|</span>
                          <button
                            type="button"
                            className="text-xs text-gray-500 hover:text-gray-700 font-medium bg-transparent border-0 cursor-pointer"
                            onClick={() => setSelectedEpisodes({})}
                          >
                            Fravælg alle
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 max-h-48 overflow-y-auto p-1 bg-white rounded-md border border-gray-200">
                        {Array.from({ length: epCount }, (_, idx) => {
                          const epNum = idx + 1;
                          const isChecked = selectedEpisodes[epNum] || false;
                          return (
                            <label
                              key={epNum}
                              className={`flex items-center gap-2 rounded border p-2 text-xs cursor-pointer select-none transition-colors ${
                                isChecked
                                  ? "border-blue-500 bg-blue-50/50 text-blue-900"
                                  : "border-gray-200 hover:bg-gray-50 text-gray-700"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) =>
                                  setSelectedEpisodes((prev) => ({
                                    ...prev,
                                    [epNum]: e.target.checked,
                                  }))
                                }
                                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span>Afsnit {epNum}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">Instruktør</Label>
              <Input
                value={workCorrection.director}
                onChange={e => setWorkCorrection({ ...workCorrection, director: e.target.value })}
              />
            </div>
            <div className="flex justify-end mt-2">
              <Button onClick={handleSendWorkCorrection} disabled={isSendingCorrection} className="gap-2">
                {isSendingCorrection && <Loader2 className="h-4 w-4 animate-spin" />}
                {locale === "da" ? "Send rettelse til admin" : "Send correction to admin"}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end mt-4 pt-4 border-t border-gray-100">
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleSaveEdit} disabled={isSavingEdit} className="gap-2">
          {isSavingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
          {locale === "da" ? "Gem" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
