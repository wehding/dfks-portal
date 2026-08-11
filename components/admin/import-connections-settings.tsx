"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Cloud, Folder, FolderSync, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { startAdminDriveImport, waitForAdminDriveImport } from "@/lib/client/admin-drive-import";

type Provider = "google_drive" | "onedrive" | "dropbox";
type Connection = { id: string; provider: Provider; display_name: string; account_label: string | null; status: string; last_tested_at: string | null };
type Source = {
  id: string;
  connection_id: string;
  import_type: string;
  provider_folder_id: string;
  display_name: string;
  recursive: boolean;
  auto_sync: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  enabled: boolean;
  import_connections: { provider: Provider; account_label: string | null; display_name: string } | Array<{ provider: Provider; account_label: string | null; display_name: string }>;
};

const PROVIDERS = [{ id: "google_drive", label: "Google Drive" }] as const;
const IMPORT_TYPES = [
  { id: "contracts", label: "Kontrakter" },
  { id: "contract_reviews", label: "Kontraktgennemgang" },
  { id: "screenings", label: "Visningsdata" },
  { id: "members", label: "Medlemmer" },
  { id: "producers", label: "Producenter" },
  { id: "works", label: "Værker" },
] as const;

function sourceConnection(source: Source) {
  return Array.isArray(source.import_connections) ? source.import_connections[0] : source.import_connections;
}

export function ImportConnectionsSettings() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [form, setForm] = useState({ connectionId: "", importType: "contracts", folderId: "", displayName: "", recursive: true });
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerLoading, setFolderPickerLoading] = useState(false);
  const [folderView, setFolderView] = useState<"root" | "shared">("root");
  const [folderPath, setFolderPath] = useState<Array<{ id: string; name: string }>>([{ id: "root", name: "Mit drev" }]);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [folderCursor, setFolderCursor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [connectionsResponse, sourcesResponse] = await Promise.all([
        fetch("/api/admin/import-connections", { cache: "no-store" }),
        fetch("/api/admin/import-sources", { cache: "no-store" }),
      ]);
      const [connectionsJson, sourcesJson] = await Promise.all([connectionsResponse.json(), sourcesResponse.json()]);
      if (!connectionsResponse.ok) throw new Error(connectionsJson.error);
      if (!sourcesResponse.ok) throw new Error(sourcesJson.error);
      setConnections(connectionsJson.connections ?? []);
      setSources(sourcesJson.sources ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Drevopsætningen kunne ikke hentes");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!form.connectionId && connections[0]) setForm(current => ({ ...current, connectionId: connections[0].id }));
  }, [connections, form.connectionId]);

  const connected = useMemo(() => connections.filter(connection => connection.status === "connected"), [connections]);

  const removeConnection = async (id: string) => {
    if (!window.confirm("Afbryd forbindelsen? Alle importmapper på kontoen fjernes, og automatisk import stopper.")) return;
    const response = await fetch(`/api/admin/import-connections?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) { toast.error("Forbindelsen kunne ikke fjernes"); return; }
    await load();
  };

  const removeSource = async (id: string) => {
    if (!window.confirm("Fjern importmappen? Allerede importerede filer og kontrakter bevares.")) return;
    const response = await fetch(`/api/admin/import-sources?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) { toast.error("Importmappen kunne ikke fjernes"); return; }
    setSources(previous => previous.filter(source => source.id !== id));
  };

  const saveSource = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/import-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setForm(current => ({ ...current, folderId: "", displayName: "" }));
      setShowSourceForm(false);
      await load();
      toast.success("Importmappen er gemt");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Importmappen kunne ikke gemmes");
    } finally {
      setSaving(false);
    }
  };

  const loadFolders = async (connectionId: string, folderId: string, view: "root" | "shared", cursor?: string, append = false) => {
    setFolderPickerLoading(true);
    try {
      const params = new URLSearchParams({ folderId, view });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/admin/import-connections/${connectionId}/folders?${params}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setFolders(current => append ? [...current, ...(json.folders ?? [])] : (json.folders ?? []));
      setFolderCursor(json.nextCursor ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mapperne kunne ikke hentes");
    } finally {
      setFolderPickerLoading(false);
    }
  };

  const openFolderPicker = () => {
    if (!form.connectionId) return;
    setFolderView("root");
    setFolderPath([{ id: "root", name: "Mit drev" }]);
    setFolderPickerOpen(true);
    void loadFolders(form.connectionId, "root", "root");
  };

  const chooseFolder = () => {
    const current = folderPath.at(-1)!;
    setForm(value => ({ ...value, folderId: current.id, displayName: value.displayName || current.name }));
    setFolderPickerOpen(false);
  };

  const sync = async (source: Source) => {
    setSyncingId(source.id);
    try {
      const started = await startAdminDriveImport(source.id);
      toast.success(started.resumed ? "Importen fortsætter i baggrunden" : "Importen er startet i baggrunden");
      const run = await waitForAdminDriveImport(source.id, started.runId);
      if (run) toast.success(`${run.imported_count} fil(er) importeret${run.duplicate_count ? `, ${run.duplicate_count} dublet(ter)` : ""}${run.failed_count ? `, ${run.failed_count} fejl` : ""}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Synkroniseringen fejlede");
    } finally {
      setSyncingId(null);
    }
  };

  return <section id="importforbindelser" className="scroll-mt-24 rounded-lg border bg-card p-4 shadow-sm sm:p-5">
    <h2 className="flex items-center gap-2 text-base font-semibold"><Cloud className="h-5 w-5" />Importforbindelser</h2>
    <p className="mt-1 text-sm text-muted-foreground">Forbind organisationsdrev til kontrakter og andre filimporter. Portalen får kun læseadgang, og forbindelsen kan afbrydes igen.</p>
    {loading ? <Loader2 className="mt-4 h-5 w-5 animate-spin" /> : <div className="mt-4 space-y-3">
      {PROVIDERS.map(provider => {
        const existing = connections.filter(connection => connection.provider === provider.id);
        return <div key={provider.id} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-medium">{provider.label}</p><p className="text-xs text-muted-foreground">{existing.length ? existing.map(item => item.account_label ?? item.display_name).join(", ") : "Ikke forbundet"}</p></div>
            <Button type="button" variant="outline" size="sm" onClick={() => { window.location.href = `/api/admin/import-connections/${provider.id}/authorize`; }}>Forbind konto</Button>
          </div>
          {existing.map(connection => <div key={connection.id} className="mt-2 flex items-center justify-between rounded bg-muted px-2 py-1.5 text-xs"><span>{connection.account_label ?? connection.display_name} · {connection.status}</span><Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void removeConnection(connection.id)} aria-label={`Afbryd ${connection.display_name}`}><Trash2 className="h-3.5 w-3.5" /></Button></div>)}
        </div>;
      })}

      <div className="rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="flex items-center gap-2 font-medium"><FolderSync className="h-4 w-4" />Importmapper</p><p className="text-xs text-muted-foreground">En mappe kan bruges af alle organisationens administratorer.</p></div>
          <Button type="button" variant="outline" size="sm" disabled={!connected.length} onClick={() => setShowSourceForm(value => !value)}><Plus className="mr-1.5 h-4 w-4" />Tilføj mappe</Button>
        </div>
        {!connected.length && <p className="mt-3 rounded bg-muted p-2 text-xs text-muted-foreground">Forbind først en Google Drive-konto.</p>}
        {showSourceForm && <div className="mt-3 grid gap-3 rounded-md bg-muted/50 p-3 sm:grid-cols-2">
          <div><Label htmlFor="source-connection">Forbindelse</Label><select id="source-connection" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.connectionId} onChange={event => setForm(current => ({ ...current, connectionId: event.target.value }))}>{connected.map(connection => <option key={connection.id} value={connection.id}>{connection.account_label ?? connection.display_name}</option>)}</select></div>
          <div><Label htmlFor="source-type">Importtype</Label><select id="source-type" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.importType} onChange={event => setForm(current => ({ ...current, importType: event.target.value }))}>{IMPORT_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></div>
          <div><Label htmlFor="source-name">Navn i portalen</Label><Input id="source-name" className="mt-1" value={form.displayName} onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))} placeholder="Fx Nye kontrakter" /></div>
          <div><Label>Google Drive-mappe</Label><Button type="button" variant="outline" className="mt-1 w-full justify-start" onClick={openFolderPicker}><Folder className="mr-2 h-4 w-4" />{form.folderId ? form.displayName || "Valgt mappe" : "Vælg mappe"}</Button></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.recursive} onChange={event => setForm(current => ({ ...current, recursive: event.target.checked }))} />Medtag undermapper</label>
          <div className="flex gap-2 sm:col-span-2"><Button type="button" size="sm" disabled={saving} onClick={() => void saveSource()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Gem importmappe</Button><Button type="button" size="sm" variant="ghost" onClick={() => setShowSourceForm(false)}>Annuller</Button></div>
        </div>}
        <div className="mt-3 space-y-2">
          {sources.map(source => {
            const connection = sourceConnection(source);
            const typeLabel = IMPORT_TYPES.find(type => type.id === source.import_type)?.label ?? source.import_type;
            return <div key={source.id} className="rounded-md bg-muted px-3 py-2 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-medium">{source.display_name}</p><p className="text-xs text-muted-foreground">{typeLabel} · {connection?.account_label ?? connection?.display_name} · manuel import</p>{source.last_error && <p className="mt-1 text-xs text-destructive">{source.last_error}</p>}</div>
                <div className="flex gap-1"><Button type="button" size="sm" variant="outline" disabled={syncingId === source.id || source.import_type !== "contracts"} onClick={() => void sync(source)}>{syncingId === source.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Synkroniser</Button><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => void removeSource(source.id)} aria-label={`Fjern ${source.display_name}`}><Trash2 className="h-4 w-4" /></Button></div>
              </div>
              {source.last_synced_at && <p className="mt-1 text-[11px] text-muted-foreground">Senest synkroniseret {new Date(source.last_synced_at).toLocaleString("da-DK")}</p>}
            </div>;
          })}
        </div>
      </div>
    </div>}
    <p className="mt-3 text-xs text-muted-foreground">Import startes altid manuelt. Når den er startet, fortsætter den i en sikker baggrundskø uden en samlet øvre filgrænse, også hvis du forlader siden. Filer slettes aldrig fra Google Drive, og slettede drevfiler sletter ikke importerede data.</p>
    <Dialog open={folderPickerOpen} onOpenChange={setFolderPickerOpen}><DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-xl"><DialogHeader><DialogTitle>Vælg Google Drive-mappe</DialogTitle></DialogHeader>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant={folderView === "root" ? "default" : "outline"} onClick={() => { setFolderView("root"); setFolderPath([{ id: "root", name: "Mit drev" }]); void loadFolders(form.connectionId, "root", "root"); }}>Mit drev</Button><Button type="button" size="sm" variant={folderView === "shared" ? "default" : "outline"} onClick={() => { setFolderView("shared"); setFolderPath([{ id: "root", name: "Delt med mig" }]); void loadFolders(form.connectionId, "root", "shared"); }}>Delt med mig</Button></div>
      <div className="flex flex-wrap items-center gap-1 text-sm">{folderPath.map((part, index) => <span key={`${part.id}:${index}`} className="flex items-center"><button type="button" className="rounded px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2" onClick={() => { const nextPath = folderPath.slice(0, index + 1); setFolderPath(nextPath); void loadFolders(form.connectionId, part.id, folderView); }}>{part.name}</button>{index < folderPath.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}</span>)}</div>
      <div className="max-h-[50vh] space-y-1 overflow-y-auto">{folderPickerLoading && !folders.length ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : folders.length ? folders.map(folder => <button type="button" key={folder.id} className="flex w-full items-center gap-2 rounded-md border p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2" onClick={() => { setFolderPath(path => [...path, { id: folder.id, name: folder.name }]); void loadFolders(form.connectionId, folder.id, "root"); }}><Folder className="h-4 w-4" /><span className="min-w-0 truncate">{folder.name}</span><ChevronRight className="ml-auto h-4 w-4" /></button>) : <p className="py-8 text-center text-sm text-muted-foreground">Denne mappe har ingen undermapper.</p>}{folderCursor && <Button type="button" variant="outline" className="w-full" disabled={folderPickerLoading} onClick={() => void loadFolders(form.connectionId, folderPath.at(-1)?.id ?? "root", folderPath.length === 1 ? folderView : "root", folderCursor, true)}>Vis flere mapper</Button>}</div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setFolderPickerOpen(false)}>Annuller</Button><Button type="button" onClick={chooseFolder}>Brug denne mappe</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
