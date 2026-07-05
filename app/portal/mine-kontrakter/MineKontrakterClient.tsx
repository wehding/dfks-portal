"use client";

import React, { useState } from "react";
import { FileText, Upload, X, Trash2, Search, Loader2 } from "lucide-react";
import { deleteMemberContract, getContractSignedUrl, linkContractToWork } from "@/app/actions/member-contracts";
import { useSearchParams } from "next/navigation";
import UploadDialog from "./UploadDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContextualHelp, HelpButton, type HelpTopic } from "@/components/help/contextual-help";

type Validation = { has_credit_clause: boolean | null; has_overenskomst_incorporation: boolean | null; notes: string | null } | null;
export type Contract = {
  id: string;
  type: string | null;
  overenskomst: string | null;
  status: string;
  contract_date: string | null;
  start_date: string | null;
  end_date: string | null;
  pdf_url: string | null;
  created_at: string | null;
  works: { id: string; title: string; year: number | null } | null;
  employers: { id: string; name: string } | null;
  contract_validations: Validation[] | Validation;
};

const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  kladde:    { label: "Afventer validering", bg: "#fef3c7", color: "#92400e" },
  valideret: { label: "Godkendt",            bg: "#dcfce7", color: "#166534" },
  arkiveret: { label: "Arkiveret",           bg: "#f4f4f5", color: "#71717a" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, bg: "#f4f4f5", color: "#71717a" };
  return (
    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function overenskomstLabel(o: string | null) {
  const map: Record<string, string> = {
    "de4-fiktion": "De4 Fiktion", "de4-dokumentar": "De4 Dok.",
    faf: "FAF", "faf-dokumentar": "FAF Dok.", ingen: "Ingen",
  };
  return o ? (map[o] ?? o) : "–";
}

function getValidation(c: Contract): Validation {
  const v = c.contract_validations;
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

type MyWork = { id: string; title: string; year: number | null; type: string };

const MINE_KONTRAKTER_HELP: HelpTopic[] = [
  {
    title: "Upload kontrakt",
    body: "Upload PDF eller DOCX. Systemet forsøger at udfylde titel, kategori, kreditering og datoer automatisk, men du skal altid kontrollere felterne før indsendelse.",
  },
  {
    title: "Koblet værk",
    body: "En kontrakt bør være koblet til det værk, den handler om. Kommer du fra Mine værker via Mangler kontrakt, er værket forvalgt.",
  },
  {
    title: "Validering",
    body: "Afventer validering betyder, at DFKS endnu ikke har godkendt kontraktens oplysninger. Når den er valideret, vises rettighedsmarkeringerne på kontrakten.",
  },
  {
    title: "Rettigheder",
    body: "Overenskomst og kreditering viser, om kontrakten indeholder de vigtigste punkter for korrekt registrering og udbetaling.",
  },
];

export default function MineKontrakterClient({
  initialContracts,
  myWorks = [],
}: {
  initialContracts: Contract[];
  myWorks?: MyWork[];
}) {
  const [contracts, setContracts] = useState(initialContracts);
  const searchParams = useSearchParams();
  const [isUploading, setIsUploading] = useState(searchParams.get("upload") === "true");
  const uploadWorkId    = searchParams.get("workId") ?? undefined;
  const uploadWorkTitle = searchParams.get("workTitle") ? decodeURIComponent(searchParams.get("workTitle")!) : undefined;
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [workSearch, setWorkSearch] = useState("");
  const [linkingSaving, setLinkingSaving] = useState(false);

  const total     = contracts.length;
  const godkendte = contracts.filter(c => c.status === "valideret").length;
  const afventer  = contracts.filter(c => c.status === "kladde").length;

  const filtered = contracts.filter(c => {
    if (!search) return true;
    const t = search.toLowerCase();
    return (
      (c.works?.title ?? "").toLowerCase().includes(t) ||
      (c.employers?.name ?? "").toLowerCase().includes(t) ||
      (c.overenskomst ?? "").toLowerCase().includes(t)
    );
  });

  async function handleDelete(id: string) {
    if (!confirm("Er du sikker på at du vil slette denne kontrakt?")) return;
    const res = await deleteMemberContract(id);
    if (res.success) {
      setContracts(prev => prev.filter(c => c.id !== id));
      setSelectedContract(null);
      setMsg({ type: "success", text: "Kontrakt slettet." });
    } else {
      setMsg({ type: "error", text: res.error ?? "Kunne ikke slette" });
    }
  }

  async function openContract(contract: Contract) {
    setSelectedContract(contract);
    setViewUrl(null);
    if (!contract.pdf_url) return;
    setViewLoading(true);
    const res = await getContractSignedUrl(contract.pdf_url);
    setViewUrl(res.url ?? null);
    setViewLoading(false);
  }

  async function handleLinkWork(workId: string | null) {
    if (!selectedContract) return;
    setLinkingSaving(true);
    const res = await linkContractToWork(selectedContract.id, workId);
    if (res.success) {
      const linked = workId ? myWorks.find(w => w.id === workId) ?? null : null;
      const updatedContract = { ...selectedContract, works: linked ? { id: linked.id, title: linked.title, year: linked.year } : null };
      setSelectedContract(updatedContract as Contract);
      setContracts(prev => prev.map(c => c.id === selectedContract.id ? updatedContract as Contract : c));
      setMsg({ type: "success", text: workId ? `Koblet til "${linked?.title}"` : "Kobling fjernet" });
    } else {
      setMsg({ type: "error", text: res.error ?? "Fejl ved kobling" });
    }
    setLinkingSaving(false);
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mine Kontrakter</h1>
          <p className="text-sm text-gray-500 mt-1">Upload dine kontrakter — DFKS validerer dem herefter.</p>
        </div>
        <div className="flex gap-2">
          <HelpButton onClick={() => setHelpOpen(true)} />
          <Button onClick={() => setIsUploading(true)} className="gap-2">
            <Upload className="h-4 w-4" /> Upload kontrakt
          </Button>
        </div>
      </div>

      {/* Statistik */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total",               value: total },
          { label: "Godkendte",           value: godkendte },
          { label: "Afventer validering", value: afventer },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-6 py-5">
            <p className="text-sm font-medium text-gray-500 mb-1">{s.label}</p>
            <p className="text-3xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toast-besked */}
      {msg && (
        <div className={`flex items-center justify-between rounded-lg px-4 py-3 text-sm ${
          msg.type === "success" ? "bg-[#E6F4EA] text-[#137333]" : "bg-[#FCE8E6] text-[#C5221F]"
        }`}>
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-4 shrink-0 opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Tabel */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">

        {/* Søgefelt */}
        <div className="px-5 py-3.5 border-b border-gray-100">
          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              placeholder="Søg i kontrakter..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm w-72"
            />
          </div>
        </div>

        {/* Kolonnehoveder */}
        <div className="grid px-5 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-500"
          style={{ gridTemplateColumns: "2fr 1.5fr 1fr 1fr 0.8fr 40px" }}>
          <div>Værk</div>
          <div>Producent</div>
          <div>Overenskomst</div>
          <div>Rettigheder</div>
          <div>Status</div>
          <div />
        </div>

        {/* Rækker */}
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            <FileText className="mx-auto h-10 w-10 text-gray-300 mb-3" />
            <p>{contracts.length === 0 ? "Ingen kontrakter endnu. Klik 'Upload kontrakt' for at starte." : "Ingen resultater."}</p>
          </div>
        ) : filtered.map(c => {
          const val = getValidation(c);
          return (
            <div
              key={c.id}
              onClick={() => openContract(c)}
              className="grid items-center px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors text-sm"
              style={{ gridTemplateColumns: "2fr 1.5fr 1fr 1fr 0.8fr 40px" }}
            >
              <div>
                <div className="font-semibold text-gray-900">{c.works?.title ?? "Ikke koblet til værk"}</div>
                {c.contract_date && <div className="text-xs text-gray-500 mt-0.5">{c.contract_date.substring(0, 10)}</div>}
              </div>
              <div className="text-gray-500 truncate">{c.employers?.name ?? "–"}</div>
              <div className="text-gray-500">{overenskomstLabel(c.overenskomst)}</div>
              <div className="flex gap-1 flex-wrap">
                {val ? (
                  <>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: val.has_overenskomst_incorporation ? "#18181b" : "#f4f4f5", color: val.has_overenskomst_incorporation ? "white" : "#71717a" }}>
                      Overenskomst {val.has_overenskomst_incorporation ? "✓" : "✗"}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: val.has_credit_clause ? "#18181b" : "#f4f4f5", color: val.has_credit_clause ? "white" : "#71717a" }}>
                      Kreditering {val.has_credit_clause ? "✓" : "✗"}
                    </span>
                  </>
                ) : <span className="text-xs text-gray-400 italic">Afventer</span>}
              </div>
              <div><StatusBadge status={c.status} /></div>
              <div
                onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                className="flex justify-center text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Upload-dialog */}
      {isUploading && (
        <UploadDialog
          workId={uploadWorkId}
          workTitle={uploadWorkTitle}
          onClose={() => setIsUploading(false)}
          onUploaded={(saved) => {
            setContracts(prev => [{
              id: saved.id,
              type: saved.type,
              overenskomst: null,
              status: saved.status,
              contract_date: null,
              start_date: null,
              end_date: null,
              pdf_url: saved.pdf_url,
              created_at: saved.created_at,
              works: uploadWorkId ? { id: uploadWorkId, title: uploadWorkTitle ?? saved.working_title ?? "Værk", year: null } : null,
              employers: null,
              contract_validations: null,
            }, ...prev]);
            setIsUploading(false);
            setMsg({ type: "success", text: "Kontrakt indsendt til DFKS." });
          }}
        />
      )}

      {/* Kontrakt-detalje-overlay */}
      {selectedContract && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6"
          onClick={e => { if (e.target === e.currentTarget) setSelectedContract(null); }}
        >
          <div className={`bg-white rounded-xl border border-gray-200 flex overflow-hidden max-h-[90vh] w-full ${viewUrl ? "max-w-5xl" : "max-w-md"}`}>

            {/* PDF-viewer */}
            {viewUrl && (
              <div className="flex-1 bg-gray-100">
                <iframe src={`${viewUrl}#navpanes=0`} className="w-full h-full border-0" title="Kontrakt" />
              </div>
            )}

            {/* Sidebar */}
            <div className={`${viewUrl ? "w-[360px]" : "w-full"} p-7 overflow-y-auto flex flex-col gap-4 shrink-0`}>

              {/* Titel + luk */}
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">{selectedContract.works?.title ?? "Kontrakt"}</h2>
                <button onClick={() => setSelectedContract(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {viewLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Henter dokument...
                </div>
              )}

              <StatusBadge status={selectedContract.status} />

              {/* Metadata-rækker */}
              <div className="flex flex-col gap-2">
                {[
                  { label: "Producent",    value: selectedContract.employers?.name },
                  { label: "Overenskomst", value: overenskomstLabel(selectedContract.overenskomst) },
                  { label: "Kontrakttype", value: selectedContract.type },
                  { label: "Kontraktdato",value: selectedContract.contract_date?.substring(0, 10) },
                  { label: "Startdato",   value: selectedContract.start_date?.substring(0, 10) },
                  { label: "Slutdato",    value: selectedContract.end_date?.substring(0, 10) },
                ].filter(r => r.value).map(row => (
                  <div key={row.label} className="flex justify-between text-sm bg-gray-50 rounded-md px-3 py-2">
                    <span className="text-gray-500">{row.label}</span>
                    <span className="font-medium text-gray-900">{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Rettigheder */}
              {(() => {
                const val = getValidation(selectedContract);
                return val ? (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">Rettigheder</p>
                    <div className="flex gap-2 flex-wrap">
                      {([
                        { key: "has_overenskomst_incorporation", label: "Overenskomst" },
                        { key: "has_credit_clause",              label: "Kreditering" },
                      ] as const).map(r => {
                        const has = val[r.key] === true;
                        return (
                          <span key={r.key} className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                            style={{ backgroundColor: has ? "#18181b" : "#f4f4f5", color: has ? "white" : "#71717a" }}>
                            {r.label} {has ? "✓" : "✗"}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg px-3 py-2.5 text-sm" style={{ backgroundColor: "#fef3c7", color: "#92400e" }}>
                    Afventer validering af DFKS — rettigheder vises når kontrakten er godkendt.
                  </div>
                );
              })()}

              {/* Werk-kobling */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Koblet værk</p>
                {selectedContract.works ? (
                  <div className="flex items-center justify-between bg-gray-50 rounded-lg border border-gray-200 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{selectedContract.works.title}</p>
                      {selectedContract.works.year && <p className="text-xs text-gray-500">{selectedContract.works.year}</p>}
                    </div>
                    <button onClick={() => handleLinkWork(null)} disabled={linkingSaving} className="text-gray-400 hover:text-gray-600 p-1">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                      <Input
                        placeholder="Søg i dine værker..."
                        value={workSearch}
                        onChange={e => setWorkSearch(e.target.value)}
                        className="pl-7 h-8 text-sm"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
                      {myWorks
                        .filter(w => !workSearch || w.title.toLowerCase().includes(workSearch.toLowerCase()))
                        .map(w => (
                          <button
                            key={w.id}
                            onClick={() => { handleLinkWork(w.id); setWorkSearch(""); }}
                            disabled={linkingSaving}
                            className="flex justify-between items-center text-left text-sm px-3 py-2 rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors"
                          >
                            <span className="font-medium text-gray-900">{w.title}</span>
                            <span className="text-xs text-gray-500">{w.year ?? ""}</span>
                          </button>
                        ))}
                      {myWorks.filter(w => !workSearch || w.title.toLowerCase().includes(workSearch.toLowerCase())).length === 0 && (
                        <p className="text-sm text-gray-400 italic px-2 py-1.5">Ingen værker fundet</p>
                      )}
                    </div>
                    {linkingSaving && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Loader2 className="h-3 w-3 animate-spin" /> Gemmer...
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Slet */}
              <button
                onClick={() => handleDelete(selectedContract.id)}
                className="mt-auto flex items-center justify-center gap-1.5 text-sm text-red-600 border border-red-200 rounded-md px-4 py-2.5 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> Slet kontrakt
              </button>
            </div>
          </div>
        </div>
      )}

      <ContextualHelp
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Hjælp til Mine kontrakter"
        intro="Praktisk forklaring af upload, kobling og validering."
        topics={MINE_KONTRAKTER_HELP}
      />
    </div>
  );
}
