"use client";

import React, { useMemo, useState, useEffect } from "react";
import { FileText, Upload, X, Trash2, Search, Loader2, Paperclip, Plus } from "lucide-react";
import { addMemberContractComment, deleteMemberContract, fetchMemberContractDetail, getContractSignedUrl, linkContractToWork, markContractCommentsRead } from "@/app/actions/member-contracts";
import { searchWorksUnified, resolveUnifiedSearchResultDetails, type UnifiedSearchWorkResult } from "@/app/actions/member-works";
import { createAndLinkWorkForContract } from "@/app/actions/work-management";
import { getTMDBWorkDetails } from "@/app/actions/tmdb";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import UploadDialog from "./UploadDialog";
import AddAlongeDialog from "./AddAlongeDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContextualHelp, HelpButton } from "@/components/help/contextual-help";
import { MessageThread, type MessageThreadMessage } from "@/components/messages/message-thread";
import { SeriesEpisodeSelector } from "@/components/works/series-episode-selector";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MINE_KONTRAKTER_HELP } from "@/lib/portal-help";
import { ResetFiltersButton } from "@/components/filters/reset-filters-button";
import { WORK_TYPES } from "@/lib/work-types";
import { buildCompleteEpisodeOptions } from "@/lib/series-episodes";
import { useI18n } from "@/lib/i18n";

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
  works: { id: string; title: string; year: number | null; type: string | null } | null;
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
      role="status"
      aria-label={`${label}: ${active ? "ja" : "nej"}`}
      className={`${TAG_CLASS} pointer-events-none select-none border`}
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

function hasWorkLink(contract: Contract) {
  return Boolean(contract.works) || contract.status === "valideret";
}

function contractMessages(comments: ContractComment[]): MessageThreadMessage[] {
  return comments.map(comment => ({
    id: comment.id,
    authorRole: comment.author_role,
    message: comment.message,
    createdAt: comment.created_at,
    memberReadAt: comment.member_read_at,
    adminReadAt: comment.admin_read_at,
  }));
}

function contractNextAction(contract: Contract) {
  const comments = contract.contract_comments ?? [];
  const latest = comments.at(-1);
  if (!latest) return "Ingen beskeder endnu";
  if (latest.author_role === "admin" && !latest.member_read_at) return "Nyt svar fra DFKS";
  if (latest.author_role === "member") return "Afventer DFKS";
  return "Samtalen er ajour";
}

function contractNextActionTone(contract: Contract): "neutral" | "attention" | "done" {
  const latest = (contract.contract_comments ?? []).at(-1);
  if (!latest) return "neutral";
  if (latest.author_role === "admin" && !latest.member_read_at) return "attention";
  if (latest.author_role === "member") return "neutral";
  return "done";
}

type MyWork = { id: string; title: string; year: number | null; type: string };
type SortKey = "title" | "employer" | "overenskomst" | "rights" | "status" | "date";
type SortValue = string | number;

export default function MineKontrakterClient({
  initialContracts,
  myWorks = [],
  rightsHolderId,
}: {
  initialContracts: Contract[];
  myWorks?: MyWork[];
  rightsHolderId: string;
}) {
  const { t } = useI18n();
  const [contracts, setContracts] = useState(initialContracts);
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
                setEpisodeOptions(buildCompleteEpisodeOptions({
                  episodeCount: count,
                  seasonNumber: sNum,
                }));
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
    setAddSeason(result.season_hint ? String(result.season_hint) : "");
    setDetailsLoading(true);

    try {
      const isSeries = result.type === "tv-serie" || result.type === "dokumentar-serie";
      if (isSeries) {
        const detRes = await resolveUnifiedSearchResultDetails(result);
        if (detRes.success && detRes.details) {
          const d = detRes.details;
          const options = d.episode_options || [];
          const count = Math.max(d.episode_count || 0, options.length);
          const hintedSeason = d.season_hint ?? result.season_hint ?? null;
          if (hintedSeason) setAddSeason(String(hintedSeason));

          if (count) {
            setDetectedEpisodeCount(count);
            setEpisodeOptions(buildCompleteEpisodeOptions({
              episodeCount: count,
              externalOptions: options,
              seasonNumber: Number(hintedSeason ?? result.season_hint ?? 1),
            }));
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
  const [typeFilter, setTypeFilter] = useState("all");
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
    if (typeFilter !== "all" && c.works?.type !== typeFilter) return false;
    if (statusFilter === "all") return true;
    if (statusFilter === "linked") return hasWorkLink(c);
    if (statusFilter === "missingWork") return !hasWorkLink(c);
    if (statusFilter === "messages") return c.contract_comments.some(comment => comment.author_role === "admin" && !comment.member_read_at);
    if (statusFilter === "missingDocument") return !c.pdf_url;
    if (statusFilter === "actionRequired") {
      const latest = c.contract_comments.at(-1);
      return !hasWorkLink(c) || !c.pdf_url || c.status === "kladde" || Boolean(latest?.author_role === "admin" && !latest.member_read_at);
    }
    return c.status === statusFilter;
  }).sort((a, b) => {
    const direction = sortDir === "asc" ? 1 : -1;
    const rightsCount = (contract: Contract) => {
      const val = getValidation(contract);
      return Number(Boolean(val?.has_overenskomst_incorporation)) + Number(Boolean(val?.has_credit_clause));
    };
    const statusValue = (contract: Contract) => !hasWorkLink(contract) ? "Mangler værk" : STATUS_MAP[contract.status]?.label ?? contract.status;
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
  }), [contracts, search, sortDir, sortKey, statusFilter, typeFilter]);
  const visibleContracts = filtered.slice(0, pageSize);
  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selectedIds.includes(c.id));
  const selectedDeleteContracts = contracts.filter(c => selectedIds.includes(c.id));
  const selectedDeleteAttachments = selectedDeleteContracts.reduce((sum, contract) => sum + (contract.contract_attachments?.length ?? 0), 0);
  const selectedDeleteMessages = selectedDeleteContracts.reduce((sum, contract) => sum + (contract.contract_comments?.length ?? 0), 0);
  const selectedDeleteValidations = selectedDeleteContracts.filter(contract => Boolean(getValidation(contract))).length;

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
    setMsg(failedIds.length ? { type: "error", text: `${failedIds.length} kontrakt(er) kunne ikke slettes.` } : { type: "success", text: "Valgte kontrakter slettet permanent." });
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
    let normalized = normalizeContract(contract);
    setSelectedContract(normalized);
    setWorkSearch(normalized.works ? "" : normalized.working_title ?? "");
    setViewUrl(null);
    const detail = await fetchMemberContractDetail(contract.id);
    if (detail.success && detail.contract) {
      normalized = normalizeContract(detail.contract as unknown as Contract);
      setSelectedContract(normalized);
      setContracts(prev => prev.map(c => c.id === contract.id ? normalized : c));
    }
    void markCommentsRead(normalized);
    const pdfUrl = normalized.pdf_url ?? contract.pdf_url;
    if (!pdfUrl) return;
    setViewLoading(true);
    const res = await getContractSignedUrl(pdfUrl);
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("contracts.mineTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("contracts.mineSubtitle")}</p>
        </div>
        <div className="grid w-full gap-2 sm:flex sm:w-auto">
          <HelpButton onClick={() => setHelpOpen(true)} className="w-full sm:w-auto" />
          <Button onClick={() => setIsUploading(true)} className="w-full gap-2 sm:w-auto">
            <Upload className="h-4 w-4" /> {t("contracts.upload")}
          </Button>
        </div>
      </div>

      {/* Statistik */}
      <div className="hidden grid-cols-3 gap-4 sm:grid">
        {[
          { label: t("common.total"),              value: total },
          { label: t("common.validated"),          value: validerede },
          { label: t("common.pendingValidation"), value: afventer },
        ].map(s => (
          <div key={s.label} className="rounded-lg border bg-card px-6 py-5 text-card-foreground">
            <p className="text-sm font-medium text-muted-foreground mb-1">{s.label}</p>
            <p className="text-3xl font-bold text-foreground">{s.value}</p>
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
      <div className="rounded-lg border bg-card text-card-foreground overflow-hidden">

        {/* Søgefelt */}
        <div className="flex flex-col gap-3 px-5 py-3.5 border-b sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {selectedIds.length > 0 ? (
              <>
                <span className="text-sm font-semibold text-red-700">{selectedIds.length} {t("common.selected")}</span>
                <Button size="sm" variant="destructive" onClick={handleDeleteSelected} className="h-8 gap-1.5 text-xs">
                  <Trash2 className="h-3.5 w-3.5" /> {t("contracts.removeSelected")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSelectedIds([])} className="h-8 text-xs">{t("common.cancel")}</Button>
              </>
            ) : (
              <>
                <div className="relative w-full sm:max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    placeholder={t("contracts.searchPlaceholder")}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-8 w-full pl-8 pr-8 text-sm sm:w-72"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border text-muted-foreground hover:text-foreground"
                      aria-label={t("common.clearSearch")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                  <option value="all">{t("common.status")}</option>
                  <option value="missingWork">{t("contracts.missingWork")}</option>
                  <option value="linked">{t("contracts.workLinked")}</option>
                  <option value="kladde">{t("common.pendingValidation")}</option>
                  <option value="valideret">{t("contracts.validated")}</option>
                  <option value="arkiveret">{t("contracts.archived")}</option>
                  <option value="messages">{t("contracts.newMessagesFromOrg")}</option>
                  <option value="missingDocument">{t("contracts.missingDocument")}</option>
                  <option value="actionRequired">{t("contracts.actionRequired")}</option>
                </select>
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                  <option value="all">{t("common.type")}</option>
                  {WORK_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                <ResetFiltersButton
                  active={Boolean(search || statusFilter !== "all" || typeFilter !== "all")}
                  onReset={() => { setSearch(""); setStatusFilter("all"); setTypeFilter("all"); setSelectedIds([]); setPageSize(20); }}
                />
                <div className="grid w-full grid-cols-[1fr_auto] gap-2 md:hidden">
                  <select
                    value={sortKey}
                    onChange={e => setSortKey(e.target.value as SortKey)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  >
                    <option value="date">{t("contracts.date")}</option>
                    <option value="title">{t("contracts.work")}</option>
                    <option value="employer">{t("contracts.producer")}</option>
                    <option value="overenskomst">{t("contracts.agreement")}</option>
                    <option value="rights">{t("contracts.rights")}</option>
                    <option value="status">{t("common.status")}</option>
                  </select>
                  <Button type="button" variant="outline" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} className="h-8 px-3 text-xs">
                    {sortKey === "date" ? (sortDir === "asc" ? t("contracts.oldest") : t("contracts.newest")) : sortDir === "asc" ? "A-Z" : "Z-A"}
                  </Button>
                </div>
              </>
            )}
          </div>
	          <label className="flex items-center gap-2 text-sm text-muted-foreground">
	            {t("contracts.show")}
	            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground">
	              {[10, 20, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
	            </select>
	          </label>
	          {filtered.length > 0 && (
	            <Button type="button" variant="outline" className="w-full sm:w-auto md:hidden" onClick={toggleAllFiltered}>
	              {allFilteredSelected ? t("common.deselectAll") : t("common.selectAll")}
	              {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
	            </Button>
	          )}
	        </div>

	        {/* Kolonnehoveder */}
	        <div className="hidden px-5 py-2.5 border-b text-sm font-medium text-muted-foreground md:grid md:[grid-template-columns:36px_2fr_1.5fr_1fr_1fr_0.9fr_40px]">
          <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} className="h-4 w-4 cursor-pointer" />
          <button type="button" onClick={() => handleSort("title")} className="text-left hover:text-foreground">{t("contracts.work")}{sortArrow("title")}</button>
          <button type="button" onClick={() => handleSort("employer")} className="text-left hover:text-foreground">{t("contracts.producer")}{sortArrow("employer")}</button>
          <button type="button" onClick={() => handleSort("overenskomst")} className="text-left hover:text-foreground">{t("contracts.agreement")}{sortArrow("overenskomst")}</button>
          <button type="button" onClick={() => handleSort("rights")} className="text-left hover:text-foreground">{t("contracts.rights")}{sortArrow("rights")}</button>
          <button type="button" onClick={() => handleSort("status")} className="text-left hover:text-foreground">{t("common.status")}{sortArrow("status")}</button>
          <div />
        </div>

        {/* Rækker */}
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <p>{contracts.length === 0 ? t("contracts.empty") : t("contracts.noResults")}</p>
          </div>
        ) : visibleContracts.map(c => {
          const val = getValidation(c);
          const title = contractDisplayTitle(c);
          return (
            <div
              key={c.id}
              onClick={() => openContract(c)}
              className="grid grid-cols-[24px_1fr_auto] gap-3 px-4 py-4 border-b cursor-pointer hover:bg-muted/50 transition-colors text-sm md:items-center md:px-5 md:py-3 md:[grid-template-columns:36px_2fr_1.5fr_1fr_1fr_0.9fr_40px]"
            >
              <div onClick={e => { e.stopPropagation(); toggleSelected(c.id); }}>
                <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => {}} className="h-4 w-4 cursor-pointer" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-foreground">{title}</div>
                {c.contract_date && <div className="text-xs text-muted-foreground mt-0.5">{c.contract_date.substring(0, 10)}</div>}
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground md:hidden">
                  <span className="truncate">Producent: {c.employers?.name ?? "–"}</span>
                  <span>{overenskomstLabel(c.overenskomst)}</span>
                </div>
              </div>
              <div className="hidden text-muted-foreground truncate md:block">{c.employers?.name ?? "–"}</div>
              <div className="hidden text-muted-foreground md:block">{overenskomstLabel(c.overenskomst)}</div>
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
                ) : <span className="text-xs text-muted-foreground italic">Afventer</span>}
              </div>
              <div className="space-y-1">
                <WorkLinkBadge linked={hasWorkLink(c)} />
                {c.works && <StatusBadge status={c.status} />}
              </div>
              <div
                onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                className="flex justify-center text-muted-foreground hover:text-red-500 transition-colors cursor-pointer"
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
          rightsHolderId={rightsHolderId}
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
                  ? { id: linkedWork.id, title: linkedWork.title, year: linkedWork.year, type: linkedWork.type }
                  : linkedWorkId
                    ? { id: linkedWorkId, title: saved.linked_work_title ?? uploadWorkTitle ?? saved.working_title ?? "Værk", year: null, type: null }
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
                ? savedContracts[0]?.work_pending
                  ? "Kontrakt indsendt. Det nye værk afventer admin-godkendelse."
                  : "Kontrakt indsendt til DFKS."
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
          <div className={`bg-background text-foreground rounded-t-xl border flex max-h-[96svh] w-full overflow-hidden sm:rounded-xl sm:max-h-[90vh] ${viewUrl ? "max-w-5xl" : "max-w-md"}`}>

            {/* PDF-viewer */}
            {viewUrl && (
              <div className="hidden flex-1 bg-muted md:block">
                <iframe src={`${viewUrl}#navpanes=0`} className="w-full h-full border-0" title="Kontrakt" />
              </div>
            )}

            {/* Sidebar */}
            <div className={`${viewUrl ? "w-full md:w-[360px]" : "w-full"} flex shrink-0 flex-col gap-4 overflow-y-auto p-4 sm:p-7`}>

              {/* Titel + luk */}
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">{contractDisplayTitle(selectedContract)}</h2>
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
              <WorkLinkBadge linked={hasWorkLink(selectedContract)} />

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
                  <div key={row.label} className="flex justify-between text-sm bg-muted rounded-md px-3 py-2">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium text-foreground">{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Werk-kobling */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Forbind med værk</p>
                {selectedContract.works ? (
                  <div className="flex items-center justify-between bg-muted rounded-lg border px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-foreground">{selectedContract.works.title}</p>
                      {selectedContract.works.year && <p className="text-xs text-muted-foreground">{selectedContract.works.year}</p>}
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
                      <div className="max-h-56 overflow-y-auto flex flex-col gap-1 border rounded-md p-1.5 bg-muted/40">
                        {unifiedResults.map(item => (
                          <button
                            key={item.id}
                            onClick={() => pickUnifiedResult(item)}
                            className="flex flex-col text-left text-xs px-2.5 py-1.5 rounded bg-background hover:bg-muted border transition-colors w-full"
                          >
                            <div className="flex items-center justify-between gap-1 w-full">
                              <span className="font-semibold text-foreground truncate">{item.title}</span>
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
                      <div className="rounded-lg border bg-card p-3 text-card-foreground space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-foreground">{pickedUnifiedResult.title}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {pickedUnifiedResult.year ?? "-"} · {pickedUnifiedResult.type}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPickedUnifiedResult(null)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {detailsLoading && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground justify-center py-2">
                            <Loader2 className="h-3 w-3 animate-spin" /> Indlæser detaljer...
                          </div>
                        )}

                        {!detailsLoading && (pickedUnifiedResult.type === "tv-serie" || pickedUnifiedResult.type === "dokumentar-serie") && (
                          <div className="space-y-3 pt-2 border-t">
                            <div className="flex flex-col gap-1">
                              <Label className="text-[11px] font-medium text-muted-foreground">Sæson</Label>
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
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground justify-center">
                                <Loader2 className="h-3 w-3 animate-spin" /> Henter afsnit...
                              </div>
                            ) : detectedEpisodeCount !== null ? (
                              <SeriesEpisodeSelector
                                season={Number(addSeason) || 1}
                                onSeasonChange={season => setAddSeason(String(season))}
                                options={buildCompleteEpisodeOptions({
                                  episodeCount: detectedEpisodeCount,
                                  externalOptions: episodeOptions,
                                  seasonNumber: Number(addSeason) || 1,
                                })}
                                selected={selectedEpisodes}
                                onSelectedChange={setSelectedEpisodes}
                                showSeason={false}
                                compact
                              />
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
                    <p className="text-xs font-medium text-muted-foreground mb-2">Rettigheder</p>
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
                  <p className="text-xs font-medium text-muted-foreground">Allonger</p>
                  <button
                    onClick={() => setIsAddingAllonge(true)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border hover:bg-muted"
                  >
                    <Paperclip className="h-3 w-3" /> Tilføj allonge
                  </button>
                </div>
                {(selectedContract.contract_attachments ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Ingen allonger endnu</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {(selectedContract.contract_attachments ?? []).map(a => (
                      <button
                        key={a.id}
                        onClick={() => openAttachment(a)}
                        disabled={openingAttachmentId === a.id}
                        className="flex items-center justify-between text-left text-sm px-3 py-2 rounded-md border bg-muted/40 hover:bg-muted transition-colors"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium text-foreground truncate">{a.title ?? "Allonge"}</span>
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">
                          {openingAttachmentId === a.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : a.created_at.substring(0, 10)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <MessageThread
                title="Beskeder med DFKS"
                messages={contractMessages(selectedContract.contract_comments ?? [])}
                viewerRole="member"
                memberLabel="Medlem"
                adminLabel="DFKS"
                emptyText="Ingen beskeder endnu. Skriv til DFKS, hvis der er noget ved kontrakten, der skal afklares."
                nextActionLabel={contractNextAction(selectedContract)}
                nextActionTone={contractNextActionTone(selectedContract)}
                composerValue={commentDraft}
                onComposerChange={setCommentDraft}
                onSend={handleAddComment}
                composerLoading={commentSaving}
                composerPlaceholder="Skriv en besked til DFKS..."
                sendLabel="Send besked"
                footer={(
                  <Button type="button" variant="outline" onClick={() => setSelectedContract(null)} className="w-full sm:w-auto">
                    Gem kontrakt
                  </Button>
                )}
              />

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
        intro="Sådan uploader, forbinder og følger du dine kontrakter."
        topics={MINE_KONTRAKTER_HELP}
        storageKey="dfks-help-mine-kontrakter-v3"
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
            <DialogTitle>Slet valgte kontrakter permanent?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Du er ved at slette {selectedIds.length} valgte kontrakt{selectedIds.length === 1 ? "" : "er"} permanent.
              </span>
              <span className="block">
                Det sletter også tilknyttede bilag/allonger, beskeder med DFKS og eventuel validering/AI-gennemgang.
              </span>
              {(selectedDeleteAttachments > 0 || selectedDeleteMessages > 0 || selectedDeleteValidations > 0) && (
                <span className="block font-medium text-foreground">
                  De viste data indeholder: {selectedDeleteAttachments} bilag/allonge{selectedDeleteAttachments === 1 ? "" : "r"}, {selectedDeleteMessages} besked{selectedDeleteMessages === 1 ? "" : "er"} og {selectedDeleteValidations} validering{selectedDeleteValidations === 1 ? "" : "er"}.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSelectedOpen(false)}>
              Annuller
            </Button>
            <Button variant="destructive" onClick={confirmDeleteSelected}>
              Slet permanent ({selectedIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteContractId)} onOpenChange={open => !open && setDeleteContractId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Slet kontrakt?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">Kontrakten slettes permanent. Handlingen kan ikke fortrydes.</span>
              {selectedContract && (
                <span className="block">
                  Det sletter også {selectedContract.contract_attachments?.length ?? 0} bilag/allonge{(selectedContract.contract_attachments?.length ?? 0) === 1 ? "" : "r"}
                  , {selectedContract.contract_comments?.length ?? 0} besked{(selectedContract.contract_comments?.length ?? 0) === 1 ? "" : "er"}
                  {getValidation(selectedContract) ? " og den tilknyttede validering/AI-gennemgang" : ""}.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteContractId(null)}>
              Annuller
            </Button>
            <Button variant="destructive" onClick={confirmDeleteContract}>
              Slet permanent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
