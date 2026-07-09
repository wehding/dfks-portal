"use client";

import React, { useMemo, useState, useEffect } from "react";
import { FileText, Upload, X, Trash2, Search, Loader2, Paperclip, CheckCircle2, AlertTriangle, Plus } from "lucide-react";
import { addMemberContractComment, deleteMemberContract, getContractSignedUrl, linkContractToWork, markContractCommentsRead } from "@/app/actions/member-contracts";
import { searchWorksUnified, resolveUnifiedSearchResultDetails, type UnifiedSearchWorkResult } from "@/app/actions/member-works";
import { createAndLinkWorkForContract } from "@/app/actions/work-management";
import { getTMDBWorkDetails } from "@/app/actions/tmdb";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";
import UploadDialog from "./UploadDialog";
import AddAlongeDialog from "./AddAlongeDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContextualHelp, HelpButton } from "@/components/help/contextual-help";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MINE_KONTRAKTER_HELP } from "@/lib/portal-help";

const TAG_CLASS = "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4";

type Validation = { has_credit_clause: boolean | null; has_overenskomst_incorporation: boolean | null; notes: string | null; extracted_data?: Record<string, unknown> | null; validated_at?: string | null } | null;
type Attachment = { id: string; type: string; title: string | null; pdf_url: string | null; created_at: string };
type ContractComment = { id: string; author_role: "member" | "admin"; message: string; created_at: string; member_read_at?: string | null; admin_read_at?: string | null };
export type Contract = {
  id: string;
  type: string | null;
  overenskomst: string | null;
  status: string;
  contract_date: string | null;
  start_date: string | null;
  end_date: string | null;
  pdf_url: string | null;
  working_title: string | null;
  created_at: string | null;
  works: { id: string; title: string; year: number | null } | null;
  employers: { id: string; name: string } | null;
  contract_validations: Validation[] | Validation;
  contract_attachments: Attachment[];
  contract_comments: ContractComment[];
};

const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  kladde:    { label: "Afventer validering", bg: "#fef3c7", color: "#92400e" },
  valideret: { label: "Valideret",           bg: "#dcfce7", color: "#166534" },
  arkiveret: { label: "Arkiveret",           bg: "#f4f4f5", color: "#71717a" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, bg: "#f4f4f5", color: "#71717a" };
  return (
    <span className={TAG_CLASS} style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function WorkLinkBadge({ linked }: { linked: boolean }) {
  return (
    <span
      className={TAG_CLASS}
      style={{
        backgroundColor: linked ? "#dcfce7" : "#fee2e2",
        color: linked ? "#166534" : "#991b1b",
      }}
    >
      {linked ? "Værk tilknyttet" : "Mangler værk"}
    </span>
  );
}

function contractDisplayTitle(contract: Contract) {
  return contract.works?.title ?? contract.working_title ?? "Kontrakt";
}

function aiValue(data: Record<string, unknown> | null | undefined, keys: string[]) {
  return keys.some(key => data?.[key] === true || data?.[key] === "ja");
}

function RightsBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={TAG_CLASS}
      style={{ backgroundColor: active ? "#18181b" : "#f4f4f5", color: active ? "white" : "#71717a" }}
    >
      {label} {active ? "✓" : "✗"}
    </span>
  );
}

function overenskomstLabel(o: string | null) {
  const map: Record<string, string> = {
    "de4-fiktion": "De4 Fiktion", "de4-dokumentar": "De4 Dok.",
    faf: "FAF", "faf-dokumentar": "FAF Dok.", dj: "DJ", metal: "Metal", ingen: "Ingen",
  };
  return o ? (map[o] ?? o) : "–";
}

function getValidation(c: Contract): Validation {
  const v = c.contract_validations;
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

function normalizeContract(contract: Contract): Contract {
  return {
    ...contract,
    contract_attachments: contract.contract_attachments ?? [],
    contract_comments: contract.contract_comments ?? [],
  };
}

type MyWork = { id: string; title: string; year: number | null; type: string };
type SortKey = "title" | "employer" | "overenskomst" | "rights" | "status" | "date";
type SortValue = string | number;

export default function MineKontrakterClient({
  initialContracts,
  myWorks = [],
}: {
  initialContracts: Contract[];
  myWorks?: MyWork[];
}) {
  const [contracts, setContracts] = useState(initialContracts);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isUploading, setIsUploading] = useState(searchParams?.get("upload") === "true");
  const uploadWorkId    = searchParams?.get("workId") ?? undefined;
  const uploadWorkTitle = searchParams?.get("workTitle") ? decodeURIComponent(searchParams.get("workTitle")!) : undefined;
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [workSearch, setWorkSearch] = useState("");
  const [linkingSaving, setLinkingSaving] = useState(false);
  const [unifiedResults, setUnifiedResults] = useState<UnifiedSearchWorkResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pickedUnifiedResult, setPickedUnifiedResult] = useState<UnifiedSearchWorkResult | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Series fields
  const [addSeason, setAddSeason] = useState("");
  const [selectedEpisodes, setSelectedEpisodes] = useState<number[]>([]);
  const [episodeOptions, setEpisodeOptions] = useState<any[]>([]);
  const [detectedEpisodeCount, setDetectedEpisodeCount] = useState<number | null>(null);
  const [episodesLoading, setEpisodesLoading] = useState(false);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      const q = workSearch.trim();
      if (!q) {
        setUnifiedResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const res = await searchWorksUnified(q);
        if (res.success && res.results) {
          setUnifiedResults(res.results.slice(0, 8));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [workSearch]);

  useEffect(() => {
    const updateTmdbEpisodes = async () => {
      if (pickedUnifiedResult && (pickedUnifiedResult.type === "tv-serie" || pickedUnifiedResult.type === "dokumentar-serie")) {
        const tmdbId = pickedUnifiedResult.tmdb_id;
        if (tmdbId) {
          setEpisodesLoading(true);
          try {
            const det = await getTMDBWorkDetails(tmdbId, "tv");
            if (det.success && det.details) {
              const d = det.details as any;
              const sNum = parseInt(addSeason) || 1;
              const season = d.seasons?.find((s: any) => s.season_number === sNum);
              const count = season ? season.episode_count : null;
              if (count) {
                setDetectedEpisodeCount(count);
                setEpisodeOptions(Array.from({ length: count }, (_, idx) => ({ number: idx + 1, title: `Afsnit ${idx + 1}` })));
                setSelectedEpisodes(prev => prev.filter(x => x <= count));
              }
            }
          } catch (e) {
            console.error(e);
          } finally {
            setEpisodesLoading(false);
          }
        }
      }
    };
    updateTmdbEpisodes();
  }, [addSeason, pickedUnifiedResult]);

  const pickUnifiedResult = async (result: UnifiedSearchWorkResult) => {
    setPickedUnifiedResult(result);
    setDetectedEpisodeCount(null);
    setSelectedEpisodes([]);
    setEpisodeOptions([]);
    setDetailsLoading(true);

    try {
      const isSeries = result.type === "tv-serie" || result.type === "dokumentar-serie";
      if (isSeries) {
        const detRes = await resolveUnifiedSearchResultDetails(result);
        if (detRes.success && detRes.details) {
          const d = detRes.details;
          const options = d.episode_options || [];
          const count = d.episode_count || options.length;

          if (count) {
            setDetectedEpisodeCount(count);
            setEpisodeOptions(options.length ? options : Array.from({ length: count }, (_, i) => ({ number: i + 1, title: `Afsnit ${i + 1}` })));
            setSelectedEpisodes([]);
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDetailsLoading(false);
    }
  };

  const [isAddingAllonge, setIsAddingAllonge] = useState(false);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deleteContractId, setDeleteContractId] = useState<string | null>(null);

  const total     = contracts.length;
  const validerede = contracts.filter(c => c.status === "valideret").length;
  const afventer  = contracts.filter(c => c.status === "kladde").length;

  const filtered = useMemo(() => contracts.filter(c => {
    if (!search) return true;
    const t = search.toLowerCase();
    return (
      (c.works?.title ?? "").toLowerCase().includes(t) ||
      (c.working_title ?? "").toLowerCase().includes(t) ||
      (c.employers?.name ?? "").toLowerCase().includes(t) ||
      (c.overenskomst ?? "").toLowerCase().includes(t)
    );
  }).filter(c => {
    if (statusFilter === "all") return true;
    if (statusFilter === "linked") return Boolean(c.works);
    if (statusFilter === "missingWork") return !c.works;
    return c.status === statusFilter;
  }).sort((a, b) => {
    const direction = sortDir === "asc" ? 1 : -1;
    const rightsCount = (contract: Contract) => {
      const val = getValidation(contract);
      return Number(Boolean(val?.has_overenskomst_incorporation)) + Number(Boolean(val?.has_credit_clause));
    };
    const statusValue = (contract: Contract) => !contract.works ? "Mangler værk" : STATUS_MAP[contract.status]?.label ?? contract.status;
    const values: Record<SortKey, [SortValue, SortValue]> = {
      title: [contractDisplayTitle(a), contractDisplayTitle(b)],
      employer: [a.employers?.name ?? "", b.employers?.name ?? ""],
      overenskomst: [overenskomstLabel(a.overenskomst), overenskomstLabel(b.overenskomst)],
      rights: [rightsCount(a), rightsCount(b)],
      status: [statusValue(a), statusValue(b)],
      date: [a.contract_date ?? a.created_at ?? "", b.contract_date ?? b.created_at ?? ""],
    };
    const [left, right] = values[sortKey];
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return String(left).localeCompare(String(right), "da-DK", { numeric: true, sensitivity: "base" }) * direction;
  }), [contracts, search, sortDir, sortKey, statusFilter]);
  const visibleContracts = filtered.slice(0, pageSize);
  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selectedIds.includes(c.id));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(dir => dir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  };
  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  const toggleSelected = (id: string) => setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  const toggleAllFiltered = () => setSelectedIds(allFilteredSelected ? [] : filtered.map(c => c.id));

  async function handleDeleteSelected() {
    if (!selectedIds.length) return;
    setDeleteSelectedOpen(true);
  }

  async function confirmDeleteSelected() {
    if (!selectedIds.length) return;
    const ids = [...selectedIds];
    setDeleteSelectedOpen(false);
    const results = await Promise.all(ids.map(id => deleteMemberContract(id)));
    const failedIds = ids.filter((_, index) => !results[index].success);
    setContracts(prev => prev.filter(c => !ids.includes(c.id) || failedIds.includes(c.id)));
    setSelectedIds([]);
    setMsg(failedIds.length ? { type: "error", text: `${failedIds.length} kontrakt(er) kunne ikke fjernes.` } : { type: "success", text: "Valgte kontrakter fjernet." });
  }

  async function handleAddComment() {
    if (!selectedContract || !commentDraft.trim()) return;
    setCommentSaving(true);
    const res = await addMemberContractComment(selectedContract.id, commentDraft);
    setCommentSaving(false);
    if (!res.success || !("comment" in res) || !res.comment) {
      setMsg({ type: "error", text: res.error ?? "Kunne ikke gemme kommentar" });
      return;
    }
    const comment = res.comment as ContractComment;
    const updatedContract = {
      ...selectedContract,
      contract_comments: [...selectedContract.contract_comments, comment],
    };
    setSelectedContract(updatedContract);
    setContracts(prev => prev.map(c => c.id === selectedContract.id ? updatedContract : c));
    setCommentDraft("");
    setMsg({ type: "success", text: "Kommentar sendt til DFKS." });
    setSelectedContract(null);
  }

  function handleDelete(id: string) {
    setDeleteContractId(id);
  }

  async function confirmDeleteContract() {
    if (!deleteContractId) return;
    const id = deleteContractId;
    setDeleteContractId(null);
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
    const normalized = normalizeContract(contract);
    setSelectedContract(normalized);
    setWorkSearch(normalized.works ? "" : normalized.working_title ?? "");
    setViewUrl(null);
    void markCommentsRead(contract);
    if (!contract.pdf_url) return;
    setViewLoading(true);
    const res = await getContractSignedUrl(contract.pdf_url);
    setViewUrl(res.url ?? null);
    setViewLoading(false);
  }

  async function markCommentsRead(contract: Contract) {
    const hasUnread = (contract.contract_comments ?? []).some(
      c => c.author_role === "admin" && !c.member_read_at
    );
    if (!hasUnread) return;
    const now = new Date().toISOString();
    const patchComments = (c: Contract): Contract => ({
      ...c,
      contract_comments: (c.contract_comments ?? []).map(comment =>
        comment.author_role === "admin" && !comment.member_read_at
          ? { ...comment, member_read_at: now }
          : comment
      ),
    });
    setSelectedContract(prev => (prev && prev.id === contract.id ? patchComments(prev) : prev));
    setContracts(prev => prev.map(c => (c.id === contract.id ? patchComments(c) : c)));
    const res = await markContractCommentsRead(contract.id, "member");
    if (res.success) window.dispatchEvent(new CustomEvent("contracts-updated"));
  }

  function goToAddWork() {
    const params = new URLSearchParams({ add: "1" });
    if (workSearch.trim()) params.set("q", workSearch.trim());
    setSelectedContract(null);
    setIsUploading(false);
    router.push(`/portal/mine-vaerker?${params.toString()}`);
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

  async function handleLinkUnifiedWork() {
    if (!selectedContract || !pickedUnifiedResult) return;
    setLinkingSaving(true);
    try {
      const activeSeason = parseInt(addSeason) || 1;
      const res = await createAndLinkWorkForContract({
        contractId: selectedContract.id,
        result: pickedUnifiedResult,
        seasonNumber: activeSeason,
        selectedEpisodes: selectedEpisodes,
        role: "Klipper",
      });
      if (res.success && res.workId) {
        toast.success("Værket er nu tilknyttet kontrakten.");
        const updatedContract = {
          ...selectedContract,
          works: {
            id: res.workId,
            title: pickedUnifiedResult.title,
            year: pickedUnifiedResult.year
          }
        };
        setSelectedContract(updatedContract as Contract);
        setContracts(prev => prev.map(c => c.id === selectedContract.id ? updatedContract as Contract : c));
        setPickedUnifiedResult(null);
        setWorkSearch("");
      } else {
        toast.error(res.error || "Kunne ikke tilknytte værk.");
      }
    } catch (e: any) {
      toast.error(e.message || "Der skete en fejl.");
    } finally {
      setLinkingSaving(false);
    }
  }

  async function openAttachment(attachment: Attachment) {
    if (!attachment.pdf_url) return;
    setOpeningAttachmentId(attachment.id);
    const res = await getContractSignedUrl(attachment.pdf_url);
    setOpeningAttachmentId(null);
    if (res.url) window.open(res.url, "_blank");
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
          { label: "Validerede",          value: validerede },
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
        <div className="flex flex-col gap-3 px-5 py-3.5 border-b border-gray-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {selectedIds.length > 0 ? (
              <>
                <span className="text-sm font-semibold text-red-700">{selectedIds.length} valgt</span>
                <Button size="sm" variant="destructive" onClick={handleDeleteSelected} className="h-8 gap-1.5 text-xs">
                  <Trash2 className="h-3.5 w-3.5" /> Fjern valgte
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSelectedIds([])} className="h-8 text-xs">Annuller</Button>
              </>
            ) : (
              <>
                <div className="relative w-full sm:max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    placeholder="Søg i kontrakter..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-8 w-full pl-8 pr-8 text-sm sm:w-72"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-700"
                      aria-label="Tøm søgefelt"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900">
                  <option value="all">Status</option>
                  <option value="missingWork">Mangler værk</option>
                  <option value="linked">Værk tilknyttet</option>
                  <option value="kladde">Afventer validering</option>
                  <option value="valideret">Valideret</option>
                  <option value="arkiveret">Arkiveret</option>
                </select>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-500">
            Vis
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900">
              {[10, 20, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>

        {/* Kolonnehoveder */}
        <div className="hidden px-5 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-500 md:grid md:[grid-template-columns:36px_2fr_1.5fr_1fr_1fr_0.9fr_40px]">
          <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} className="h-4 w-4 cursor-pointer" />
          <button type="button" onClick={() => handleSort("title")} className="text-left hover:text-gray-700">Værk{sortArrow("title")}</button>
          <button type="button" onClick={() => handleSort("employer")} className="text-left hover:text-gray-700">Producent{sortArrow("employer")}</button>
          <button type="button" onClick={() => handleSort("overenskomst")} className="text-left hover:text-gray-700">Overenskomst{sortArrow("overenskomst")}</button>
          <button type="button" onClick={() => handleSort("rights")} className="text-left hover:text-gray-700">Rettigheder{sortArrow("rights")}</button>
          <button type="button" onClick={() => handleSort("status")} className="text-left hover:text-gray-700">Status{sortArrow("status")}</button>
          <div />
        </div>

        {/* Rækker */}
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            <FileText className="mx-auto h-10 w-10 text-gray-300 mb-3" />
          <p>{contracts.length === 0 ? "Ingen kontrakter endnu. Klik 'Upload kontrakt' for at starte." : "Ingen resultater."}</p>
          </div>
        ) : visibleContracts.map(c => {
          const val = getValidation(c);
          const title = contractDisplayTitle(c);
          return (
            <div
              key={c.id}
              onClick={() => openContract(c)}
              className="grid grid-cols-[24px_1fr_auto] gap-3 px-4 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors text-sm md:items-center md:px-5 md:py-3 md:[grid-template-columns:36px_2fr_1.5fr_1fr_1fr_0.9fr_40px]"
            >
              <div onClick={e => { e.stopPropagation(); toggleSelected(c.id); }}>
                <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => {}} className="h-4 w-4 cursor-pointer" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-gray-900">{title}</div>
                {c.contract_date && <div className="text-xs text-gray-500 mt-0.5">{c.contract_date.substring(0, 10)}</div>}
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500 md:hidden">
                  <span className="truncate">Producent: {c.employers?.name ?? "–"}</span>
                  <span>{overenskomstLabel(c.overenskomst)}</span>
                </div>
              </div>
              <div className="hidden text-gray-500 truncate md:block">{c.employers?.name ?? "–"}</div>
              <div className="hidden text-gray-500 md:block">{overenskomstLabel(c.overenskomst)}</div>
              <div className="hidden gap-1 flex-wrap md:flex">
                {val?.validated_at ? (
                  <>
                    <span className={TAG_CLASS} style={{ backgroundColor: val.has_overenskomst_incorporation ? "#18181b" : "#f4f4f5", color: val.has_overenskomst_incorporation ? "white" : "#71717a" }}>
                      Overenskomst {val.has_overenskomst_incorporation ? "✓" : "✗"}
                    </span>
                    <span className={TAG_CLASS} style={{ backgroundColor: val.has_credit_clause ? "#18181b" : "#f4f4f5", color: val.has_credit_clause ? "white" : "#71717a" }}>
                      Kreditering {val.has_credit_clause ? "✓" : "✗"}
                    </span>
                  </>
                ) : <span className="text-xs text-gray-400 italic">Afventer</span>}
              </div>
              <div className="space-y-1">
                <WorkLinkBadge linked={Boolean(c.works)} />
                {c.works && <StatusBadge status={c.status} />}
              </div>
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
          myWorks={myWorks}
          onClose={() => setIsUploading(false)}
          onUploaded={(savedContracts) => {
            const normalizedContracts = savedContracts.map((saved) => {
              const linkedWorkId = saved.work_id ?? (savedContracts.length === 1 ? uploadWorkId ?? null : null);
              const linkedWork = linkedWorkId ? myWorks.find(w => w.id === linkedWorkId) ?? null : null;
              return {
                id: saved.id,
                type: saved.type,
                overenskomst: null,
                status: saved.status,
                contract_date: null,
                start_date: null,
                end_date: null,
                pdf_url: saved.pdf_url,
                created_at: saved.created_at,
                working_title: saved.working_title ?? null,
                works: linkedWork
                  ? { id: linkedWork.id, title: linkedWork.title, year: linkedWork.year }
                  : linkedWorkId
                    ? { id: linkedWorkId, title: uploadWorkTitle ?? saved.working_title ?? "Værk", year: null }
                    : null,
                employers: null,
                contract_validations: null,
                contract_attachments: [],
                contract_comments: [],
              };
            });
            setContracts(prev => [...normalizedContracts, ...prev]);
            setIsUploading(false);
            setMsg({
              type: "success",
              text: savedContracts.length === 1
                ? "Kontrakt indsendt til DFKS."
                : `${savedContracts.length} kontrakter indsendt til DFKS.`,
            });
          }}
        />
      )}

      {/* Kontrakt-detalje-overlay */}
      {selectedContract && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
          onClick={e => { if (e.target === e.currentTarget) setSelectedContract(null); }}
        >
          <div className={`bg-white rounded-t-xl border border-gray-200 flex max-h-[96svh] w-full overflow-hidden sm:rounded-xl sm:max-h-[90vh] ${viewUrl ? "max-w-5xl" : "max-w-md"}`}>

            {/* PDF-viewer */}
            {viewUrl && (
              <div className="hidden flex-1 bg-gray-100 md:block">
                <iframe src={`${viewUrl}#navpanes=0`} className="w-full h-full border-0" title="Kontrakt" />
              </div>
            )}

            {/* Sidebar */}
            <div className={`${viewUrl ? "w-full md:w-[360px]" : "w-full"} flex shrink-0 flex-col gap-4 overflow-y-auto p-4 sm:p-7`}>

              {/* Titel + luk */}
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">{contractDisplayTitle(selectedContract)}</h2>
                <button onClick={() => setSelectedContract(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {viewLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Henter dokument...
                </div>
              )}
              {viewUrl && (
                <Button type="button" variant="outline" className="md:hidden" onClick={() => window.open(viewUrl, "_blank", "noopener,noreferrer")}>
                  Åbn PDF
                </Button>
              )}

              <StatusBadge status={selectedContract.status} />
              <WorkLinkBadge linked={Boolean(selectedContract.works)} />

              {/* Metadata-rækker */}
              <div className="flex flex-col gap-2">
                {[
                  { label: "Producent",    value: selectedContract.employers?.name },
                  { label: "Arbejdstitel",  value: selectedContract.working_title },
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

              {/* Werk-kobling */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Forbind med værk</p>
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
                      {isSearching ? (
                        <Loader2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-gray-400" />
                      ) : (
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      )}
                      <Input
                        placeholder="Søg i alle databaser (onboarding)..."
                        value={workSearch}
                        onChange={e => setWorkSearch(e.target.value)}
                        className="pl-8.5 h-9 text-sm"
                      />
                    </div>

                    {unifiedResults.length > 0 && !pickedUnifiedResult && (
                      <div className="max-h-56 overflow-y-auto flex flex-col gap-1 border border-gray-100 rounded-md p-1.5 bg-gray-50/50">
                        {unifiedResults.map(item => (
                          <button
                            key={item.id}
                            onClick={() => pickUnifiedResult(item)}
                            className="flex flex-col text-left text-xs px-2.5 py-1.5 rounded bg-white hover:bg-gray-50 border border-gray-100 transition-colors w-full"
                          >
                            <div className="flex items-center justify-between gap-1 w-full">
                              <span className="font-semibold text-gray-900 truncate">{item.title}</span>
                              <span className="text-[9px] uppercase font-bold text-gray-400 shrink-0">
                                {item.sources.join("·")}
                              </span>
                            </div>
                            <span className="text-[10px] text-gray-500 mt-0.5">
                              {item.year ?? "-"} · {item.type}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {pickedUnifiedResult && (
                      <div className="rounded-lg border border-gray-200 p-3 bg-white space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-gray-900">{pickedUnifiedResult.title}</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">
                              {pickedUnifiedResult.year ?? "-"} · {pickedUnifiedResult.type}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPickedUnifiedResult(null)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {detailsLoading && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500 justify-center py-2">
                            <Loader2 className="h-3 w-3 animate-spin" /> Indlæser detaljer...
                          </div>
                        )}

                        {!detailsLoading && (pickedUnifiedResult.type === "tv-serie" || pickedUnifiedResult.type === "dokumentar-serie") && (
                          <div className="space-y-3 pt-2 border-t border-gray-100">
                            <div className="flex flex-col gap-1">
                              <Label className="text-[11px] font-medium text-gray-500">Sæson</Label>
                              <Input
                                type="number"
                                min="1"
                                className="h-8 text-xs"
                                placeholder="1"
                                value={addSeason}
                                onChange={e => setAddSeason(e.target.value)}
                              />
                            </div>

                            {episodesLoading ? (
                              <div className="flex items-center gap-1.5 text-xs text-gray-500 justify-center">
                                <Loader2 className="h-3 w-3 animate-spin" /> Henter afsnit...
                              </div>
                            ) : detectedEpisodeCount !== null ? (
                              <div className="space-y-1.5">
                                <div className="flex justify-between items-center text-[11px] text-gray-500">
                                  <span>Vælg afsnit:</span>
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedEpisodes(episodeOptions.map(o => o.number))}
                                      className="hover:underline"
                                    >
                                      Vælg alle
                                    </button>
                                    <span>·</span>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedEpisodes([])}
                                      className="hover:underline"
                                    >
                                      Fravælg alle
                                    </button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-4 gap-1 max-h-32 overflow-y-auto p-1 border rounded border-gray-100 bg-gray-50">
                                  {episodeOptions.map(opt => {
                                    const checked = selectedEpisodes.includes(opt.number);
                                    return (
                                      <button
                                        key={opt.number}
                                        type="button"
                                        onClick={() =>
                                          setSelectedEpisodes(prev =>
                                            prev.includes(opt.number)
                                              ? prev.filter(n => n !== opt.number)
                                              : [...prev, opt.number].sort((a, b) => a - b)
                                          )
                                        }
                                        className={`py-1 text-[10px] rounded border text-center font-medium ${
                                          checked
                                            ? "border-gray-900 bg-gray-900 text-white"
                                            : "border-gray-200 bg-white hover:bg-gray-100 text-gray-600"
                                        }`}
                                      >
                                        {opt.number}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )}

                        <Button
                          type="button"
                          className="w-full h-8 text-xs font-semibold"
                          disabled={linkingSaving || (detailsLoading) || (episodesLoading)}
                          onClick={handleLinkUnifiedWork}
                        >
                          {linkingSaving ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Tilknyt værk
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Rettigheder */}
              {(() => {
                const val = getValidation(selectedContract);
                const data = val?.extracted_data ?? null;
                return val?.validated_at ? (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">Rettigheder</p>
                    <div className="flex gap-2 flex-wrap">
                      <RightsBadge label="Copydan" active={aiValue(data, ["copydan", "copydanReservation", "copydanforbehold"])} />
                      <RightsBadge label="Streaming" active={aiValue(data, ["svod", "streaming", "streamingReservation", "streamingforbehold"])} />
                      <RightsBadge label="Overenskomst" active={val.has_overenskomst_incorporation === true || aiValue(data, ["collectiveAgreement", "hasOverenskomstIncorporation"])} />
                      <RightsBadge label="Kreditering" active={val.has_credit_clause === true || aiValue(data, ["hasCreditClause"])} />
                      <RightsBadge label="AI/datamining" active={aiValue(data, ["aiDataMiningClause"])} />
                      <RightsBadge label="Fremtidige rettigheder" active={aiValue(data, ["futureRightsReservation"])} />
                      <RightsBadge label="Royalty" active={aiValue(data, ["royalty"])} />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg px-3 py-2.5 text-sm" style={{ backgroundColor: "#fef3c7", color: "#92400e" }}>
                    Afventer validering af DFKS — rettigheder vises når kontrakten er valideret.
                  </div>
                );
              })()}

              {/* Allonger */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-500">Allonger</p>
                  <button
                    onClick={() => setIsAddingAllonge(true)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-gray-300 hover:bg-gray-50"
                  >
                    <Paperclip className="h-3 w-3" /> Tilføj allonge
                  </button>
                </div>
                {(selectedContract.contract_attachments ?? []).length === 0 ? (
                  <p className="text-sm text-gray-400 italic">Ingen allonger endnu</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {(selectedContract.contract_attachments ?? []).map(a => (
                      <button
                        key={a.id}
                        onClick={() => openAttachment(a)}
                        disabled={openingAttachmentId === a.id}
                        className="flex items-center justify-between text-left text-sm px-3 py-2 rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <FileText className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                          <span className="font-medium text-gray-900 truncate">{a.title ?? "Allonge"}</span>
                        </span>
                        <span className="text-xs text-gray-500 shrink-0 ml-2">
                          {openingAttachmentId === a.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : a.created_at.substring(0, 10)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Kommentarer */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Kommentarer</p>
                <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                  {(selectedContract.contract_comments ?? []).length === 0 ? (
                    <p className="px-1 py-2 text-sm italic text-gray-400">Ingen kommentarer endnu</p>
                  ) : (selectedContract.contract_comments ?? []).map(comment => (
                    <div key={comment.id} className="rounded-md bg-white px-3 py-2 text-sm">
                      <div className="mb-1 text-xs text-gray-500">
                        {comment.author_role === "admin" ? "DFKS" : "Dig"} · {new Date(comment.created_at).toLocaleString("da-DK")}
                      </div>
                      <p className="text-gray-800">{comment.message}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-2 space-y-2">
                  <textarea
                    value={commentDraft}
                    onChange={e => setCommentDraft(e.target.value)}
                    placeholder="Skriv en kommentar til DFKS..."
                    className="min-h-20 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-gray-400"
                  />
                  <Button onClick={handleAddComment} disabled={commentSaving || !commentDraft.trim()} className="w-full">
                    {commentSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send kommentar
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setSelectedContract(null)} className="w-full">
                    Gem kontrakt
                  </Button>
                </div>
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
        storageKey="dfks-help-mine-kontrakter-v2"
      />

      {/* Tilføj allonge-dialog */}
      {isAddingAllonge && selectedContract && (
        <AddAlongeDialog
          contractId={selectedContract.id}
          onClose={() => setIsAddingAllonge(false)}
          onUploaded={(attachment) => {
            const updatedContract = { ...selectedContract, contract_attachments: [attachment, ...selectedContract.contract_attachments] };
            setSelectedContract(updatedContract);
            setContracts(prev => prev.map(c => c.id === selectedContract.id ? updatedContract : c));
            setIsAddingAllonge(false);
            setMsg({ type: "success", text: "Allonge tilføjet" });
          }}
        />
      )}

      <Dialog open={deleteSelectedOpen} onOpenChange={setDeleteSelectedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fjern valgte kontrakter?</DialogTitle>
            <DialogDescription>
              Du er ved at fjerne {selectedIds.length} valgte kontrakt{selectedIds.length === 1 ? "" : "er"} fra din liste.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSelectedOpen(false)}>
              Annuller
            </Button>
            <Button variant="destructive" onClick={confirmDeleteSelected}>
              Fjern {selectedIds.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteContractId)} onOpenChange={open => !open && setDeleteContractId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Slet kontrakt?</DialogTitle>
            <DialogDescription>
              Kontrakten fjernes fra din liste. Handlingen kan ikke fortrydes herfra.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteContractId(null)}>
              Annuller
            </Button>
            <Button variant="destructive" onClick={confirmDeleteContract}>
              Slet kontrakt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
