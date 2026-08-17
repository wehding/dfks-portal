"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import { Cloud, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Connection = { id: string; provider: string; status: string; account_label: string | null; display_name: string };
type PickerDocument = { id?: string; name?: string; mimeType?: string };

declare global {
  interface Window { gapi?: { load: (name: string, callback: () => void) => void }; google?: { picker?: Record<string, any> } }
}

let pickerScriptPromise: Promise<void> | null = null;
function loadPickerScript() {
  if (window.google?.picker) return Promise.resolve();
  if (pickerScriptPromise) return pickerScriptPromise;
  pickerScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-dfks-google-picker]');
    const script = existing ?? document.createElement("script");
    script.dataset.dfksGooglePicker = "true";
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = () => window.gapi?.load("picker", resolve);
    script.onerror = () => reject(new Error("Google Picker kunne ikke indlæses"));
    if (!existing) document.head.appendChild(script);
  });
  return pickerScriptPromise;
}

export function GoogleDriveContractPicker({ onImported }: { onImported?: () => void }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetch("/api/admin/import-connections", { cache: "no-store" }).then(async response => {
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setConnection((json.connections ?? []).find((item: Connection) => item.provider === "google_drive" && item.status === "connected") ?? null);
    }).catch(error => toast.error(error instanceof Error ? error.message : "Google Drive-forbindelsen kunne ikke hentes"))
      .finally(() => setLoading(false));
  }, []);

  const importSelected = async (fileIds: string[]) => {
    if (!connection || !fileIds.length) return;
    setImporting(true);
    try {
      const response = await fetch(`/api/admin/import-connection-files/${connection.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      toast.success(`${json.queued ?? fileIds.length} kontrakt(er) er lagt i importkøen`);
      onImported?.();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Kontrakterne kunne ikke importeres"); }
    finally { setImporting(false); }
  };

  const openPicker = async () => {
    if (!connection) return;
    try {
      const [response] = await Promise.all([
        fetch(`/api/admin/import-connection-files/${connection.id}/picker-token`, { cache: "no-store" }),
        loadPickerScript(),
      ]);
      const config = await response.json();
      if (!response.ok) throw new Error(config.error);
      const picker = window.google?.picker as any;
      if (!picker) throw new Error("Google Picker blev ikke indlæst");
      const mimeTypes = "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const myDrive = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setMimeTypes(mimeTypes);
      const sharedDrives = new picker.DocsView(picker.ViewId.DOCS).setEnableDrives(true).setIncludeFolders(true).setMimeTypes(mimeTypes);
      const instance = new picker.PickerBuilder()
        .setOAuthToken(config.accessToken)
        .setDeveloperKey(config.developerKey)
        .setAppId(config.appId)
        .setLocale("da")
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        .addView(myDrive)
        .addView(sharedDrives)
        .setCallback((data: Record<string, unknown>) => {
          if (data[picker.Response.ACTION] !== picker.Action.PICKED) return;
          const documents = (data[picker.Response.DOCUMENTS] ?? []) as PickerDocument[];
          void importSelected(documents.map(document => document.id).filter((id): id is string => Boolean(id)));
        }).build();
      instance.setVisible(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Google Drive kunne ikke åbnes"); }
  };

  if (loading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!connection) return <div className="rounded-md border border-dashed p-4 text-sm"><p className="font-medium">Google Drive er ikke forbundet</p><p className="mt-1 text-muted-foreground">Forbind organisationens drev, før du vælger kontrakter.</p><Button className="mt-3" variant="outline" size="sm" asChild><a href="/admin/organisation?section=integrationer">Opsæt Google Drive</a></Button></div>;
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"><div><p className="text-sm font-medium">Google Drive</p><p className="text-xs text-muted-foreground">{connection.account_label ?? connection.display_name} · Mit drev, fællesdrev og søgning</p></div><Button type="button" variant="outline" disabled={importing} onClick={() => void openPicker()}>{importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cloud className="mr-2 h-4 w-4" />}Vælg filer fra Google Drive</Button></div>;
}
