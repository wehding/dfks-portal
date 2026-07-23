"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { getRightsHolderRelations, saveRightsHolderRelations, type RightsHolderRelationOption } from "@/app/actions/rettighedshavere";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

export function RightsHolderRelations({ rightsHolderId }: { rightsHolderId: string }) {
  const { locale } = useI18n();
  const da = locale === "da";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [works, setWorks] = useState<RightsHolderRelationOption[]>([]);
  const [contracts, setContracts] = useState<RightsHolderRelationOption[]>([]);
  const [query, setQuery] = useState("");

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || works.length || contracts.length) return;
    setLoading(true);
    try {
      const result = await getRightsHolderRelations(rightsHolderId);
      setWorks(result.works); setContracts(result.contracts);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (da ? "Relationer kunne ikke hentes" : "Relations could not be loaded"));
    } finally { setLoading(false); }
  }

  async function save() {
    setSaving(true);
    const result = await saveRightsHolderRelations({
      rightsHolderId,
      workIds: works.filter(row => row.selected).map(row => row.id),
      contractIds: contracts.filter(row => row.selected).map(row => row.id),
    });
    setSaving(false);
    if (!result.success) toast.error(result.error ?? (da ? "Relationerne kunne ikke gemmes" : "Relations could not be saved"));
    else toast.success(da ? "Værk- og kontrakttilknytninger er gemt" : "Work and contract links were saved");
  }

  const needle = query.trim().toLocaleLowerCase("da");
  const filter = (row: RightsHolderRelationOption) => !needle || `${row.title} ${row.secondary ?? ""}`.toLocaleLowerCase("da").includes(needle);
  const relationList = (rows: RightsHolderRelationOption[], setRows: (rows: RightsHolderRelationOption[]) => void) => <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
    {rows.filter(filter).map(row => <label key={row.id} className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-xs hover:bg-muted">
      <input type="checkbox" checked={row.selected} onChange={event => setRows(rows.map(item => item.id === row.id ? { ...item, selected: event.target.checked } : item))} />
      <span><span className="block font-medium">{row.title}</span>{row.secondary && <span className="text-muted-foreground">{row.secondary}</span>}</span>
    </label>)}
  </div>;

  return <div className="mt-2" onClick={event => event.stopPropagation()}>
    <Button type="button" size="sm" variant="ghost" className="h-7 px-1 text-xs" onClick={toggle}>
      {open ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
      {da ? "Administrér værker og kontrakter" : "Manage works and contracts"}
    </Button>
    {open && <div className="mt-2 min-w-[280px] space-y-2 rounded-md border bg-background p-3 shadow-sm sm:min-w-[420px]">
      {loading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{da ? "Indlæser relationer…" : "Loading relations…"}</div> : <>
        <Input value={query} onChange={event => setQuery(event.target.value)} className="h-8" placeholder={da ? "Søg værk eller kontrakt…" : "Search work or contract…"} />
        <p className="text-xs font-medium">{da ? "Værker" : "Works"}</p>{relationList(works, setWorks)}
        <p className="text-xs font-medium">{da ? "Kontrakter" : "Contracts"}</p>{relationList(contracts, setContracts)}
        <Button type="button" size="sm" disabled={saving} onClick={save}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{da ? "Gem tilknytninger" : "Save relations"}</Button>
      </>}
    </div>}
  </div>;
}
