"use client";

import { useEffect, useState } from "react";
import { Cloud, HardDrive, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Provider = "google_drive" | "onedrive" | "dropbox";
type Connection = { id: string; provider: Provider; account_label: string | null; display_name: string; status: string; last_error: string | null };
type DriveFile = { id: string; name: string; size: number; revision: string };

const PROVIDERS: Array<{ id: Provider; label: string }> = [
  { id: "google_drive", label: "Google Drive" }, { id: "onedrive", label: "Microsoft OneDrive" }, { id: "dropbox", label: "Dropbox" },
];

export function MemberDriveConnections({ allowImport = false, onImported }: { allowImport?: boolean; onImported?: () => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Connection | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
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
  const openFiles = async (connection: Connection) => {
    setSelected(connection); setFiles([]); setSelectedIds([]); setFilesLoading(true);
    try { const response = await fetch(`/api/portal/import-connections/${connection.id}/files`, { cache: "no-store" }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setFiles(json.files ?? []); if (json.truncated) toast.info("De første 500 kontraktfiler vises."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Filerne kunne ikke hentes"); }
    finally { setFilesLoading(false); }
  };
  const importFiles = async () => {
    if (!selected || !selectedIds.length) return;
    setImporting(true);
    try {
      const response = await fetch(`/api/portal/import-connections/${selected.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds: selectedIds }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error);
      const duplicateCount = (json.results ?? []).filter((result: { status: string }) => result.status === "duplicate").length;
      const errorCount = (json.results ?? []).filter((result: { status: string }) => result.status === "error").length;
      toast.success(`${selectedIds.length - duplicateCount - errorCount} kontrakt(er) lagt i analysekø${duplicateCount ? `, ${duplicateCount} dublet(ter) afvist` : ""}.`);
      setSelected(null); onImported?.();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Kontrakterne kunne ikke importeres"); }
    finally { setImporting(false); }
  };

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {PROVIDERS.map(provider => <Button key={provider.id} type="button" variant="outline" size="sm" onClick={() => connect(provider.id)}><Cloud className="mr-2 h-4 w-4" />Forbind {provider.label}</Button>)}
    </div>
    <p className="text-xs text-muted-foreground">Drevet åbnes skrivebeskyttet. Tokens opbevares krypteret på serveren og kontrakter importeres kun, når du vælger dem.</p>
    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : connections.length === 0 ? <p className="text-sm text-muted-foreground">Ingen online-drev er forbundet.</p> : <div className="space-y-2">
      {connections.map(connection => <div key={connection.id} className="flex min-w-0 items-center gap-2 rounded-md border p-3">
        <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{PROVIDERS.find(p => p.id === connection.provider)?.label}</p><p className="truncate text-xs text-muted-foreground">{connection.account_label ?? connection.display_name}</p></div>
        {allowImport && <Button type="button" size="sm" onClick={() => void openFiles(connection)}>Vælg filer</Button>}
        <Button type="button" variant="ghost" size="icon" aria-label="Fjern drevforbindelse" onClick={() => void disconnect(connection.id)}><Trash2 className="h-4 w-4" /></Button>
      </div>)}
    </div>}
    <Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}><DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-xl"><DialogHeader><DialogTitle>Vælg kontrakter fra {selected?.account_label ?? "online-drev"}</DialogTitle></DialogHeader>
      <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">{filesLoading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : files.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Ingen PDF- eller Word-kontrakter blev fundet.</p> : files.map(file => <label key={`${file.id}:${file.revision}`} className="flex items-start gap-3 rounded-md border p-3 text-sm"><input type="checkbox" className="mt-1" checked={selectedIds.includes(file.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, file.id] : current.filter(id => id !== file.id))} /><span className="min-w-0"><span className="block truncate font-medium">{file.name}</span><span className="text-xs text-muted-foreground">{file.size ? `${Math.ceil(file.size / 1024)} KB` : "Størrelse ukendt"}</span></span></label>)}</div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setSelected(null)}>Annuller</Button><Button type="button" disabled={!selectedIds.length || importing} onClick={() => void importFiles()}>{importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Importer {selectedIds.length || ""}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
