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

interface WorkCorrectionForm {
  title: string;
  type: string;
  year: string;
  duration_minutes: string;
  episode_count: string;
  genre: string;
  description: string;
}

interface Assignment {
  id: string;
  role: string | null;
  work_id?: string;
  rights_holder_id?: string | null;
  works?: {
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
    work_change_requests?: any[];
  } | null;
  rettighedshavere?: {
    id: string;
    full_name: string;
  } | null;
}

interface EditWorkModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignment: any;
  allAssignments: any[];
  onWorkUpdated: (message: string, success: boolean, updatedRole?: string, targetId?: string) => void;
  locale: string;
}

function emptyCoEditor(): CoEditorDraft {
  return { id: crypto.randomUUID(), name: "", role: "Klipper", action: "add" };
}

function displayRole(role: string | null | undefined) {
  return role === "Hovedklipper" ? "Konceptuerende klipper" : role ?? "Klipper";
}

function workToCorrectionForm(w: any): WorkCorrectionForm {
  return {
    title: w.title ?? "",
    type: w.type ?? "spillefilm",
    year: w.year != null ? String(w.year) : "",
    duration_minutes: w.duration_minutes != null ? String(w.duration_minutes) : "",
    episode_count: w.episode_count != null ? String(w.episode_count) : "",
    genre: w.genre ?? "",
    description: w.description ?? "",
  };
}

function requestKindLabel(request: any) {
  const kind = request.proposed_data?.kind;
  if (kind === "creation") return "Nyt værk";
  if (kind === "co_editors") return "Medklippere";
  return "Rettelse";
}

function requestStatusLabel(status: string) {
  if (status === "pending") return "Afventer";
  if (status === "approved") return "Godkendt";
  return "Afvist";
}

function adminRequestSummaries(work: any) {
  return (work?.work_change_requests ?? [])
    .flatMap((request: any) => {
      const comments = (request.work_change_request_comments ?? [])
        .filter((comment: any) => comment.author_role === "admin")
        .map((comment: any) => ({
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
    .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
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
  const supabase = createClient();

  const [editRole, setEditRole]                         = useState("");
  const [showWorkCorrection, setShowWorkCorrection]     = useState(false);
  const [workCorrection, setWorkCorrection]             = useState<WorkCorrectionForm | null>(null);
  const [workCorrectionComment, setWorkCorrectionComment] = useState("");
  const [editCoEditors, setEditCoEditors]               = useState<CoEditorDraft[]>([]);
  const [isSavingEdit, setIsSavingEdit]                 = useState(false);
  const [isSendingCorrection, setIsSendingCorrection]   = useState(false);

  useEffect(() => {
    if (isOpen && assignment) {
      setEditRole(displayRole(assignment.role));
      setShowWorkCorrection(false);
      setWorkCorrection(assignment.works ? workToCorrectionForm(assignment.works) : null);
      setWorkCorrectionComment("");
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

  const handleSaveEdit = async () => {
    setIsSavingEdit(true);
    const { error } = await supabase.from("work_assignments").update({ role: editRole }).eq("id", assignment.id);
    if (!error) {
      onWorkUpdated(t("common.saved"), true, editRole, assignment.id);
    } else {
      onWorkUpdated(error.message, false);
    }
    setIsSavingEdit(false);
  };

  const handleSendWorkCorrection = async () => {
    if (!assignment.works || !workCorrection) return;
    setIsSendingCorrection(true);
    try {
      const res = await submitWorkDataCorrection({
        assignmentId: assignment.id,
        workId: assignment.works.id,
        data: {
          title: workCorrection.title,
          type: workCorrection.type,
          year: numberOrNull(workCorrection.year),
          duration_minutes: numberOrNull(workCorrection.duration_minutes),
          episode_count: numberOrNull(workCorrection.episode_count),
          genre: workCorrection.genre || null,
          description: workCorrection.description || null,
        },
        comment: workCorrectionComment,
        coEditors: editCoEditors.filter(
          editor => !editor.locked || editor.action === "remove" || editor.action === "change"
        ),
      });
      if (!res.success) throw new Error(t("works.createFailed"));
      onWorkUpdated(t("works.correctionSent"), true);
    } catch (err: any) {
      onWorkUpdated(err.message || t("works.createFailed"), false);
    } finally {
      setIsSendingCorrection(false);
    }
  };

  if (!isOpen) return null;

  const editAdminSummaries = adminRequestSummaries(assignment.works);

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
          ? "Bemærk: Forkerte ændringer i værksdata kan gøre det svært at matche værket i systemet, hvilket kan forsinke eller forhindre korrekt udbetaling af rettighedsmidler. Alle rettelser skal derfor godkendes af en administrator." 
          : "Note: Incorrect changes in work data can make it difficult to match the work in the system, which can delay or prevent correct payment of rights funds. All corrections must therefore be approved by an administrator."}
      </div>
      {editAdminSummaries.length > 0 && (
        <div className="mb-5 rounded-lg border border-gray-200 p-4">
          <p className="mb-3 text-sm font-semibold text-gray-900">{t("works.adminComments")}</p>
          <div className="space-y-2">
            {editAdminSummaries.map((summary: any) => (
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
      <div className="mb-6 rounded-lg border border-gray-200 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">{t("works.manualWorkData")}</p>
            <p className="mt-1 text-xs text-gray-500">
              {locale === "da" 
                ? "Foreslå rettelser til titel, type, år, varighed, afsnit, genre eller beskrivelse."
                : "Suggest corrections to title, type, year, duration, episodes, genre, or description."}
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
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-gray-500">{t("works.episodesField")}</Label>
                <Input
                  value={workCorrection.episode_count}
                  onChange={e => setWorkCorrection({ ...workCorrection, episode_count: e.target.value })}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">{t("works.genreField")}</Label>
              <Input
                value={workCorrection.genre}
                onChange={e => setWorkCorrection({ ...workCorrection, genre: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">{t("works.descriptionField")}</Label>
              <Textarea
                value={workCorrection.description}
                onChange={e => setWorkCorrection({ ...workCorrection, description: e.target.value })}
              />
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="mb-3 text-sm font-semibold text-gray-900">{t("works.coEditors")}</p>
              <div className="space-y-2">
                {editCoEditors.map(editor => (
                  <div key={editor.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                    <Input
                      value={editor.name}
                      disabled={editor.locked && editor.action !== "change"}
                      onChange={e =>
                        setEditCoEditors(prev =>
                          prev.map(item =>
                            item.id === editor.id
                              ? { ...item, name: e.target.value, action: item.locked ? "change" : item.action }
                              : item
                          )
                        )
                      }
                      placeholder={t("works.namePlaceholder")}
                    />
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
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-500">{t("works.commentToAdmin")}</Label>
              <Textarea
                value={workCorrectionComment}
                onChange={e => setWorkCorrectionComment(e.target.value)}
                placeholder={locale === "da" ? "Forklar kort hvorfor værksdata bør rettes." : "Briefly explain why work data should be corrected."}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSendWorkCorrection} disabled={isSendingCorrection || !workCorrectionComment.trim()} className="gap-2">
                {isSendingCorrection && <Loader2 className="h-4 w-4 animate-spin" />}
                {locale === "da" ? "Send rettelse til admin" : "Send correction to admin"}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleSaveEdit} disabled={isSavingEdit} className="gap-2">
          {isSavingEdit && <Loader2 className="h-4 w-4 animate-spin" />} {t("common.save")}
        </Button>
      </div>
    </Modal>
  );
}
