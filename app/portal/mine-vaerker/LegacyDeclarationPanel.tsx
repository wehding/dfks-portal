"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSignature } from "lucide-react";
import { toast } from "sonner";
import { acceptLegacyDeclarations, disputeLegacyDeclarationTask } from "@/app/actions/legacy-work-declarations";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LegacyDeclarationTask } from "@/lib/work-documentation";
import { useI18n } from "@/lib/i18n";

type DeclarationDocument = {
  id: string;
  title: string;
  body: string;
  version: number;
  content_hash: string;
  published_at: string | null;
} | null;

export function LegacyDeclarationPanel({
  initialTasks,
  enabled,
  cutoffYear,
  organisationName,
  document,
}: {
  initialTasks: LegacyDeclarationTask[];
  enabled: boolean;
  cutoffYear: number | null;
  organisationName: string;
  document: DeclarationDocument;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState(initialTasks);
  const [selected, setSelected] = useState(() => new Set(initialTasks.map(task => task.rootWorkId)));
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(searchParams.get("declaration") === "1");
  const [pending, startTransition] = useTransition();
  const dialogOpen = open || searchParams.get("declaration") === "1";

  const renderedBody = useMemo(() => {
    const roles = [...new Set(tasks.filter(task => selected.has(task.rootWorkId)).map(task => task.role))];
    const role = roles.length === 1 ? roles[0] : "klipper";
    return (document?.body ?? "")
      .replaceAll("{faggruppe}", role)
      .replaceAll("{skæringsår}", String(cutoffYear ?? ""))
      .replaceAll("{organisation}", organisationName);
  }, [cutoffYear, document?.body, organisationName, selected, tasks]);

  if (!enabled || !tasks.length) return null;

  function toggle(workId: string, checked: boolean) {
    setSelected(current => {
      const next = new Set(current);
      if (checked) next.add(workId); else next.delete(workId);
      return next;
    });
  }

  function setDialogOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen && searchParams.get("declaration") === "1") {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("declaration");
      const query = nextParams.toString();
      router.replace(`/portal/mine-vaerker${query ? `?${query}` : ""}`, { scroll: false });
    }
  }

  function dispute(task: LegacyDeclarationTask) {
    if (!window.confirm(`Bekræft, at du ikke har arbejdet på “${task.title}”. Tilknytningen sendes til ${organisationName} til gennemgang.`)) return;
    startTransition(async () => {
      try {
        await disputeLegacyDeclarationTask(task.rootWorkId);
        setTasks(current => current.filter(item => item.rootWorkId !== task.rootWorkId));
        if (tasks.length === 1) setDialogOpen(false);
        setSelected(current => {
          const next = new Set(current);
          next.delete(task.rootWorkId);
          return next;
        });
        toast.success("Tilknytningen er sendt til gennemgang");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Tilknytningen kunne ikke sendes til gennemgang.");
      }
    });
  }

  function accept() {
    if (!confirmed || selected.size === 0) return;
    startTransition(async () => {
      try {
        const result = await acceptLegacyDeclarations([...selected]);
        toast.success(`${result.acceptedCount} ${result.acceptedCount === 1 ? "titel" : "titler"} bekræftet`);
        setDialogOpen(false);
        setTasks(current => current.filter(task => !selected.has(task.rootWorkId)));
        setSelected(new Set());
        setConfirmed(false);
        router.replace("/portal/mine-vaerker?review=1", { scroll: false });
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erklæringerne kunne ikke gemmes.");
      }
    });
  }

  return <>
    <Alert className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
      <FileSignature className="h-4 w-4" />
      <AlertTitle>{tasks.length} {t(tasks.length === 1 ? "works.legacy.banner.one" : "works.legacy.banner.many")}</AlertTitle>
      <AlertDescription className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{t("works.legacy.banner.description")} ({cutoffYear})</span>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>{t("works.legacy.open")}</Button>
      </AlertDescription>
    </Alert>

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{document?.title ?? "Tro-og-loveerklæring om arbejde på produktioner"}</DialogTitle>
          <DialogDescription>{t("works.legacy.description")}</DialogDescription>
        </DialogHeader>

        {!document?.id ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>{t("works.legacy.unpublished")}</AlertTitle><AlertDescription>{t("works.legacy.contactAdmin")}</AlertDescription></Alert> : <>
          <div className="whitespace-pre-line rounded-md border bg-muted/30 p-4 text-sm leading-6">{renderedBody}</div>
          <div className="space-y-2">
            {tasks.map(task => <div key={task.rootWorkId} className="rounded-md border p-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id={`legacy-${task.rootWorkId}`}
                  checked={selected.has(task.rootWorkId)}
                  onChange={event => toggle(task.rootWorkId, event.currentTarget.checked)}
                  className="mt-1 h-4 w-4 rounded border-input accent-primary"
                />
                <label htmlFor={`legacy-${task.rootWorkId}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block font-medium">{task.title}</span>
                  <span className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{task.role}</span>
                    {task.premiereYear != null && <Badge variant="outline">Premiere {task.premiereYear}</Badge>}
                    {task.productionYear != null && <Badge variant="outline">Produktion {task.productionYear}</Badge>}
                    {task.qualifyingScopeCount > 1 && <Badge variant="outline">{task.qualifyingScopeCount} kvalificerede sæsoner/afsnit</Badge>}
                  </span>
                </label>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => dispute(task)}>{t("works.legacy.dispute")}</Button>
              </div>
            </div>)}
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} className="mt-1 h-4 w-4 rounded border-input accent-primary" />
            <span className="text-sm">{t("works.legacy.confirm")}</span>
          </label>
        </>}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{t("works.legacy.later")}</Button>
          <Button type="button" disabled={pending || !document?.id || !confirmed || selected.size === 0} onClick={accept}>
            <CheckCircle2 className="mr-2 h-4 w-4" />Bekræft {selected.size} valgte {selected.size === 1 ? "titel" : "titler"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
