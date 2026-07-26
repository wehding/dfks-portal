"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Film, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getRightsHolderRelations, type RightsHolderRelationOption } from "@/app/actions/rettighedshavere";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { LinkedRecordEditorDialog } from "@/components/admin/linked-record-editor-dialog";

export function RightsHolderRelations({ rightsHolderId }: { rightsHolderId: string }) {
  const { locale } = useI18n();
  const da = locale === "da";
  const [worksOpen, setWorksOpen] = useState(false);
  const [contractsOpen, setContractsOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [works, setWorks] = useState<RightsHolderRelationOption[]>([]);
  const [contracts, setContracts] = useState<RightsHolderRelationOption[]>([]);
  const [editing, setEditing] = useState<{ id: string; kind: "work" | "contract"; title: string } | null>(null);

  async function ensureLoaded() {
    if (loaded || loading) return;
    setLoading(true);
    try {
      const result = await getRightsHolderRelations(rightsHolderId);
      setWorks(result.works);
      setContracts(result.contracts);
      setLoaded(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (da ? "Relationer kunne ikke hentes" : "Relations could not be loaded"));
    } finally {
      setLoading(false);
    }
  }

  function toggle(kind: "work" | "contract") {
    if (kind === "work") setWorksOpen(current => !current);
    else setContractsOpen(current => !current);
    void ensureLoaded();
  }

  const relationList = (rows: RightsHolderRelationOption[], kind: "work" | "contract") => (
    <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
      {rows.length ? rows.map(row => (
        <button
          type="button"
          key={row.id}
          className="flex items-start gap-2 rounded p-2 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setEditing({ id: row.id, kind, title: row.title })}
          aria-label={da ? `Rediger ${row.title} på denne side` : `Edit ${row.title} on this page`}
        >
          {kind === "work" ? <Film className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span className="min-w-0 flex-1"><span className="block font-medium">{row.title}</span>{row.secondary && <span className="text-muted-foreground">{row.secondary}</span>}</span>
        </button>
      )) : <p className="p-2 text-xs text-muted-foreground">{kind === "work" ? (da ? "Ingen tilknyttede værker." : "No linked works.") : (da ? "Ingen tilknyttede kontrakter." : "No linked contracts.")}</p>}
    </div>
  );

  const expansion = (kind: "work" | "contract") => {
    const isOpen = kind === "work" ? worksOpen : contractsOpen;
    const rows = kind === "work" ? works : contracts;
    const title = kind === "work" ? (da ? "Værker" : "Works") : (da ? "Kontrakter" : "Contracts");
    return <div>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-1 text-xs" onClick={() => toggle(kind)}>
        {isOpen ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
        {title}{loaded ? ` (${rows.length})` : ""}
      </Button>
      {isOpen && <div className="mt-1 min-w-[280px] rounded-md border bg-background p-2 shadow-sm sm:min-w-[420px]">
        {loading ? <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{da ? "Indlæser…" : "Loading…"}</div> : relationList(rows, kind)}
      </div>}
    </div>;
  };

  return <div className="mt-2 space-y-0.5" onClick={event => event.stopPropagation()}>
    {expansion("work")}
    {expansion("contract")}
    <LinkedRecordEditorDialog record={editing} onOpenChange={next => { if (!next) setEditing(null); }} />
  </div>;
}
