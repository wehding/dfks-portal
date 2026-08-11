"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderSync, Loader2, RefreshCw, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { startAdminDriveImport, waitForAdminDriveImport, type AdminDriveImportRun } from "@/lib/client/admin-drive-import";

type DriveConnection = {
  provider: "google_drive" | "onedrive" | "dropbox";
  account_label: string | null;
  display_name: string;
};

type DriveImportSource = {
  id: string;
  import_type: string;
  display_name: string;
  enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  import_connections: DriveConnection | DriveConnection[];
};

function sourceConnection(source: DriveImportSource) {
  return Array.isArray(source.import_connections) ? source.import_connections[0] : source.import_connections;
}

export function ContractDriveImportLauncher({ onImportFinished }: { onImportFinished?: (run: AdminDriveImportRun) => void }) {
  const { locale, t } = useI18n();
  const [sources, setSources] = useState<DriveImportSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<AdminDriveImportRun | null>(null);
  const pollController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/import-sources", { cache: "no-store" });
      const json = await response.json().catch(() => ({})) as { sources?: DriveImportSource[]; error?: string };
      if (!response.ok) throw new Error(json.error ?? t("admin.contracts.driveLoadError"));
      setSources(json.sources ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("admin.contracts.driveLoadError");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    return () => pollController.current?.abort();
  }, [load]);

  const contractSources = useMemo(() => sources.filter(source => {
    const connection = sourceConnection(source);
    return source.enabled && source.import_type === "contracts" && connection?.provider === "google_drive";
  }), [sources]);

  const sync = async (source: DriveImportSource) => {
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    setSyncingId(source.id);
    setLastRun(null);
    try {
      const started = await startAdminDriveImport(source.id);
      toast.success(started.resumed ? t("admin.contracts.driveResumed") : t("admin.contracts.driveStarted"));
      const run = await waitForAdminDriveImport(source.id, started.runId, { signal: controller.signal });
      if (!run) return;
      setLastRun(run);
      if (run.status === "failed" || run.status === "cancelled") {
        toast.error(run.last_error ?? t("admin.contracts.driveFailed"));
      } else {
        toast.success(t("admin.contracts.driveCompleted", {
          imported: run.imported_count,
          duplicates: run.duplicate_count,
          failed: run.failed_count,
        }));
      }
      window.dispatchEvent(new CustomEvent("contracts-updated"));
      onImportFinished?.(run);
      await load();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : t("admin.contracts.driveFailed"));
    } finally {
      if (pollController.current === controller) {
        pollController.current = null;
        setSyncingId(null);
      }
    }
  };

  return <section className="rounded-lg border bg-muted/30 p-3 sm:p-4">
    <div className="flex items-start gap-3">
      <FolderSync className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">{t("admin.contracts.fromDrive")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("admin.contracts.driveHelp")}</p>
      </div>
    </div>

    {loading ? <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("admin.contracts.driveLoading")}</div> : loadError ? <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-sm text-destructive">{loadError}</p>
      <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />{t("admin.contracts.driveRetry")}</Button>
    </div> : contractSources.length ? <div className="mt-3 space-y-2">
      {contractSources.map(source => {
        const connection = sourceConnection(source);
        const syncing = syncingId === source.id;
        return <div key={source.id} className="rounded-md border bg-background p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{source.display_name}</p>
              <p className="truncate text-xs text-muted-foreground">{connection?.account_label ?? connection?.display_name ?? "Google Drive"}</p>
              {source.last_synced_at && <p className="mt-1 text-[11px] text-muted-foreground">{t("admin.contracts.driveLastSynced", { date: new Date(source.last_synced_at).toLocaleString(locale === "da" ? "da-DK" : "en-GB") })}</p>}
              {source.last_error && <p className="mt-1 text-xs text-destructive">{source.last_error}</p>}
            </div>
            <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" disabled={Boolean(syncingId)} onClick={() => void sync(source)}>
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {syncing ? t("admin.contracts.driveImporting") : t("admin.contracts.driveImport")}
            </Button>
          </div>
        </div>;
      })}
    </div> : <div className="mt-3 rounded-md border border-dashed bg-background p-3">
      <p className="text-sm text-muted-foreground">{t("admin.contracts.driveMissing")}</p>
      <Button asChild size="sm" variant="outline" className="mt-3 w-full sm:w-auto">
        <Link href="/admin/organisation#importforbindelser"><Settings className="mr-2 h-4 w-4" />{t("admin.contracts.driveSetup")}</Link>
      </Button>
    </div>}

    {lastRun && <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">{t("admin.contracts.driveCompleted", {
      imported: lastRun.imported_count,
      duplicates: lastRun.duplicate_count,
      failed: lastRun.failed_count,
    })}</p>}
  </section>;
}
