"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Cloud, Folder, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Connection = { id: string; status: string; account_label: string | null; display_name: string };
type DriveEntry = { id: string; name: string; size?: number; revision?: string };

export function GoogleDriveContractPicker({ onImported }: { onImported?: () => void }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([{ id: "root", name: "Google Drive" }]);
  const [folders, setFolders] = useState<DriveEntry[]>([]);
  const [files, setFiles] = useState<DriveEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetch("/api/admin/import-connections", { cache: "no-store" }).then(async response => {
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setConnection((json.connections ?? []).find((item: Connection) => item.status === "connected") ?? null);
    }).catch(error => toast.error(error instanceof Error ? error.message : "Google Drive-forbindelsen kunne ikke hentes"))
      .finally(() => setLoading(false));
  }, []);

  const loadFolder = async (folderId: string) => {
    if (!connection) return;
    setFilesLoading(true);
    try {
      const response = await fetch(`/api/admin/import-connection-files/${connection.id}?folderId=${encodeURIComponent(folderId)}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setFolders(json.folders ?? []); setFiles(json.files ?? []);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Google Drive kunne ikke åbnes"); }
    finally { setFilesLoading(false); }
  };
  const openPicker = () => { setOpen(true); setSelected([]); setPath([{ id: "root", name: "Google Drive" }]); void loadFolder("root"); };
  const importSelected = async () => {
    if (!connection || !selected.length) return;
    setImporting(true);
    try {
      const response = await fetch(`/api/admin/import-connection-files/${connection.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds: selected }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      toast.success(`${json.queued ?? selected.length} kontrakt(er) er lagt i importkøen`);
      setOpen(false); onImported?.();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Kontrakterne kunne ikke importeres"); }
    finally { setImporting(false); }
  };

  if (loading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!connection) return <div className="rounded-md border border-dashed p-4 text-sm"><p className="font-medium">Google Drive er ikke forbundet</p><p className="mt-1 text-muted-foreground">Forbind organisationens drev, før du vælger kontrakter.</p><Button className="mt-3" variant="outline" size="sm" asChild><a href="/admin/organisation?section=integrationer">Opsæt Google Drive</a></Button></div>;

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"><div><p className="text-sm font-medium">Google Drive</p><p className="text-xs text-muted-foreground">{connection.account_label ?? connection.display_name} · skrivebeskyttet import</p></div><Button type="button" variant="outline" onClick={openPicker}><Cloud className="mr-2 h-4 w-4" />Vælg filer fra Google Drive</Button></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] sm:max-w-xl"><DialogHeader><DialogTitle>Vælg kontrakter fra Google Drive</DialogTitle></DialogHeader>
      <div className="flex flex-wrap items-center gap-1 text-sm">{path.map((part, index) => <span key={`${part.id}:${index}`} className="flex items-center"><button type="button" className="rounded px-1 py-0.5 hover:bg-muted" onClick={() => { setPath(path.slice(0, index + 1)); void loadFolder(part.id); }}>{part.name}</button>{index < path.length - 1 && <ChevronRight className="h-3.5 w-3.5" />}</span>)}</div>
      <div className="max-h-[55vh] space-y-2 overflow-y-auto">{filesLoading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : <>{folders.map(folder => <button type="button" key={folder.id} className="flex w-full items-center gap-2 rounded-md border p-3 text-left hover:bg-muted" onClick={() => { setPath(current => [...current, { id: folder.id, name: folder.name }]); void loadFolder(folder.id); }}><Folder className="h-4 w-4" />{folder.name}<ChevronRight className="ml-auto h-4 w-4" /></button>)}{files.map(file => <label key={`${file.id}:${file.revision ?? ""}`} className="flex items-start gap-3 rounded-md border p-3 text-sm"><input type="checkbox" className="mt-1" checked={selected.includes(file.id)} onChange={event => setSelected(current => event.target.checked ? [...current, file.id] : current.filter(id => id !== file.id))} /><span><span className="block font-medium">{file.name}</span><span className="text-xs text-muted-foreground">{file.size ? `${Math.ceil(file.size / 1024)} KB` : "Størrelse ukendt"}</span></span></label>)}</>}</div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Annuller</Button><Button onClick={importSelected} disabled={!selected.length || importing}>{importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Importer {selected.length || ""}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
