"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, FileText, Film, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getRightsHolderRelations, type RightsHolderRelationOption } from "@/app/actions/rettighedshavere";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function RightsHolderRelations({ rightsHolderId }: { rightsHolderId: string }) {
  const { locale } = useI18n();
  const da = locale === "da";
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [works, setWorks] = useState<RightsHolderRelationOption[]>([]);
  const [contracts, setContracts] = useState<RightsHolderRelationOption[]>([]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || loaded) return;
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

  const relationList = (rows: RightsHolderRelationOption[], kind: "work" | "contract") => (
    <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
      {rows.length ? rows.map(row => (
        <a
          key={row.id}
          href={kind === "work" ? `/admin/vaerker?edit=${row.id}` : `/admin/kontrakter?edit=${row.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-2 rounded p-2 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={da ? `Rediger ${row.title} uden at lukke rettighedshaversiden` : `Edit ${row.title} without closing the rights-holder page`}
        >
          {kind === "work" ? <Film className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span className="min-w-0 flex-1"><span className="block font-medium">{row.title}</span>{row.secondary && <span className="text-muted-foreground">{row.secondary}</span>}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </a>
      )) : <p className="p-2 text-xs text-muted-foreground">{kind === "work" ? (da ? "Ingen tilknyttede værker." : "No linked works.") : (da ? "Ingen tilknyttede kontrakter." : "No linked contracts.")}</p>}
    </div>
  );

  return <div className="mt-2" onClick={event => event.stopPropagation()}>
    <Button type="button" size="sm" variant="ghost" className="h-7 px-1 text-xs" onClick={toggle}>
      {open ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
      {da ? "Vis tilknyttede værker og kontrakter" : "Show linked works and contracts"}
    </Button>
    {open && <div className="mt-2 min-w-[280px] space-y-2 rounded-md border bg-background p-3 shadow-sm sm:min-w-[420px]">
      {loading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{da ? "Indlæser relationer…" : "Loading relations…"}</div> : <>
        <p className="text-xs font-medium">{da ? "Værker" : "Works"}</p>{relationList(works, "work")}
        <p className="text-xs font-medium">{da ? "Kontrakter" : "Contracts"}</p>{relationList(contracts, "contract")}
        <p className="text-[11px] text-muted-foreground">{da ? "Redigering åbner i en ny fane, så denne rettighedshaverside forbliver åben." : "Editing opens in a new tab so this rights-holder page stays open."}</p>
      </>}
    </div>}
  </div>;
}
