"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Cloud, Folder, HardDrive, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Provider = "google_drive" | "onedrive" | "dropbox";
type Connection = { id: string; provider: Provider; account_label: string | null; display_name: string; status: string; last_error: string | null };
type DriveFile = { id: string; name: string; size: number; revision: string };
type DriveFolder = { id: string; name: string };

const PROVIDERS: Array<{ id: Provider; label: string }> = [{ id: "google_drive", label: "Google Drive" }];

export function MemberDriveConnections({ allowImport = false, onImported }: { allowImport?: boolean; onImported?: () => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Connection | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [folderPath, setFolderPath] = useState<Array<{ id: string; name: string }>>([{ id: "root", name: "Mit drev" }]);
  const [folderView, setFolderView] = useState<"root" | "shared">("root");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadConnections = async () => {
    setLoading(true);
    try { const response = await fetch("/api/portal/import-connections", { cache: "no-store" }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setConnections(json.connections ?? []); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Drevforbindelserne kunne ikke hentes"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadConnections(); }, []);

  const connect = (provider: Provider) => {
    const returnTo = allowImport ? "/portal/mine-kontrakter" : "/portal/min-profil";
    window.location.assign(`/api/portal/import-connections/authorize/${provider}?returnTo=${encodeURIComponent(returnTo)}`);
  };
  const disconnect = async (id: string) => {
    if (!window.confirm("Fjern drevforbindelsen? Allerede importerede kontrakter påvirkes ikke.")) return;
    const response = await fetch(`/api/portal/import-connections?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(json.error ?? "Forbindelsen kunne ikke fjernes");
    toast.success("Drevforbindelsen er fjernet"); void loadConnections();
  };
  const loadFiles = async (connection: Connection, folderId: string, view: "root" | "shared", cursor?: string, append = false) => {
    setFilesLoading(true);
    try {
      const params = new URLSearchParams({ folderId, view });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/portal/import-connections/${connection.id}/files?${params}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setFiles(current => append ? [...current, ...(json.files ?? [])] : (json.files ?? []));
      setFolders(current => append ? [...current, ...(json.folders ?? [])] : (json.folders ?? []));
      setNextCursor(json.nextCursor ?? null);
    }
    catch (error) { toast.error(error instanceof Error ? error.message : "Filerne kunne ikke hentes"); }
    finally { setFilesLoading(false); }
  };
  const openFiles = (connection: Connection) => {
    setSelected(connection); setFiles([]); setFolders([]); setSelectedIds([]); setFolderView("root");
    setFolderPath([{ id: "root", name: "Mit drev" }]);
    void loadFiles(connection, "root", "root");
  };
  const importFiles = async () => {
    if (!selected || !selectedIds.length) return;
    setImporting(true);
    try {
      const response = await fetch(`/api/portal/import-connections/${selected.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds: selectedIds }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error);
      toast.success(`${json.queued ?? selectedIds.length} kontrakt(er) er lagt i baggrundskø. Du kan nu forlade siden.`);
      setSelected(null); onImported?.();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Kontrakterne kunne ikke importeres"); }
    finally { setImporting(false); }
  };

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {PROVIDERS.map(provider => <Button key={provider.id} type="button" variant="outline" size="sm" onClick={() => connect(provider.id)}><Cloud className="mr-2 h-4 w-4" />Forbind {provider.label}</Button>)}
    </div>
    <p className="text-xs text-muted-foreground">Google Drive åbnes skrivebeskyttet. Adgangen opbevares krypteret på serveren, og kun de kontrakter, du selv vælger, importeres.</p>
    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : connections.length === 0 ? <p className="text-sm text-muted-foreground">Ingen online-drev er forbundet.</p> : <div className="space-y-2">
      {connections.map(connection => <div key={connection.id} className="flex min-w-0 items-center gap-2 rounded-md border p-3">
        <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{PROVIDERS.find(p => p.id === connection.provider)?.label}</p><p className="truncate text-xs text-muted-foreground">{connection.account_label ?? connection.display_name}</p></div>
        {allowImport && <Button type="button" size="sm" onClick={() => void openFiles(connection)}>Vælg filer</Button>}
        <Button type="button" variant="ghost" size="icon" aria-label="Fjern drevforbindelse" onClick={() => void disconnect(connection.id)}><Trash2 className="h-4 w-4" /></Button>
      </div>)}
    </div>}
    <Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}><DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-xl"><DialogHeader><DialogTitle>Vælg kontrakter fra {selected?.account_label ?? "Google Drive"}</DialogTitle></DialogHeader>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant={folderView === "root" ? "default" : "outline"} onClick={() => { if (!selected) return; setFolderView("root"); setFolderPath([{ id: "root", name: "Mit drev" }]); void loadFiles(selected, "root", "root"); }}>Mit drev</Button><Button type="button" size="sm" variant={folderView === "shared" ? "default" : "outline"} onClick={() => { if (!selected) return; setFolderView("shared"); setFolderPath([{ id: "root", name: "Delt med mig" }]); void loadFiles(selected, "root", "shared"); }}>Delt med mig</Button></div>
      <div className="flex flex-wrap items-center gap-1 text-sm">{folderPath.map((part, index) => <span key={`${part.id}:${index}`} className="flex items-center"><button type="button" className="rounded px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2" onClick={() => { if (!selected) return; const path = folderPath.slice(0, index + 1); setFolderPath(path); void loadFiles(selected, part.id, index === 0 ? folderView : "root"); }}>{part.name}</button>{index < folderPath.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}</span>)}</div>
      <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">{filesLoading && !files.length && !folders.length ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : !files.length && !folders.length ? <p className="py-8 text-center text-sm text-muted-foreground">Ingen mapper eller PDF-/Word-kontrakter blev fundet.</p> : <>{folders.map(folder => <button type="button" key={folder.id} className="flex w-full items-center gap-2 rounded-md border p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2" onClick={() => { if (!selected) return; setFolderPath(path => [...path, { id: folder.id, name: folder.name }]); void loadFiles(selected, folder.id, "root"); }}><Folder className="h-4 w-4" /><span className="min-w-0 truncate">{folder.name}</span><ChevronRight className="ml-auto h-4 w-4" /></button>)}{files.map(file => <label key={`${file.id}:${file.revision}`} className="flex items-start gap-3 rounded-md border p-3 text-sm"><input type="checkbox" className="mt-1" checked={selectedIds.includes(file.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, file.id] : current.filter(id => id !== file.id))} /><span className="min-w-0"><span className="block truncate font-medium">{file.name}</span><span className="text-xs text-muted-foreground">{file.size ? `${Math.ceil(file.size / 1024)} KB` : "Størrelse ukendt"}</span></span></label>)}{nextCursor && selected && <Button type="button" variant="outline" className="w-full" disabled={filesLoading} onClick={() => void loadFiles(selected, folderPath.at(-1)?.id ?? "root", folderPath.length === 1 ? folderView : "root", nextCursor, true)}>Vis flere</Button>}</>}</div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setSelected(null)}>Annuller</Button><Button type="button" disabled={!selectedIds.length || importing} onClick={() => void importFiles()}>{importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Importer {selectedIds.length || ""}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
