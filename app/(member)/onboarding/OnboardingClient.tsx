"use client";

import React, { useState } from "react";
import Image from "next/image";
import { completeOnboarding } from "@/app/actions/member-profile";
import { resolveOnboardingEpisodeOptions, searchOnboardingCreditsForCurrentUser, type OnboardingCredit } from "@/app/actions/dfi";
import { getOnboardingWorkImportStatus, retryOnboardingWorkImport, startOnboardingWorkImport, type OnboardingImportStatus } from "@/app/actions/onboarding-work-import";
import { useRouter } from "next/navigation";
import { CheckCircle, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { confirmExternalPersonIdentity, discoverPersonCandidates, type PersonCandidate } from "@/app/actions/person-discovery";
import { PersonIdentityPicker } from "@/components/works/person-identity-picker";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { validateOnboardingField, type OnboardingField } from "@/lib/onboarding-validation";
import { parseOnboardingAddress } from "@/lib/onboarding-address";
import { isTransientNetworkError, retryTransientNetwork } from "@/lib/transient-network-retry";
import { checkNameVariantAvailability } from "@/app/actions/rights-holder-names";
import { isDuplicateProfileName } from "@/lib/rights-holder-name";
import { SeriesEpisodeSelector } from "@/components/works/series-episode-selector";
import { buildCompleteEpisodeOptions, type SeriesEpisodeOption } from "@/lib/series-episodes";
import { parseSeasonNumberFromTitle } from "@/lib/dfi-metadata";
import { seasonLookupMessage } from "@/lib/season-selection";
import { LEGAL_DOCUMENT_TYPE_LABELS, PRIVACY_POLICY_URL, type LegalDocumentRecord } from "@/lib/legal-documents";

type OnboardingProfile = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  cpr_no?: string | null;
  bank_account?: string | null;
  gender?: string | null;
  alternative_names?: string[] | null;
  is_member?: boolean | null;
  statistics_participation?: boolean | null;
  professional_start_year?: number | null;
  primary_profession_type_id?: string | null;
  usual_work_mode?: string | null;
  primary_work_region_code?: string | null;
};

type OnboardingUser = {
  email?: string | null;
};

type FormKey = "email" | "phone" | "address" | "zip" | "city" | "cpr" | "bank_account" | "gender" | "professional_start_year" | "primary_profession_type_id" | "usual_work_mode" | "primary_work_region_code";

type StatisticsProfileOptions = {
  config: Record<string, boolean>;
  professionLabel: string;
  professionTypes: Array<{ id: string; name: string }>;
  workRegions: Array<{ code: string; nameDa: string; nameEn: string }>;
  secondaryProfessionTypeIds: string[];
};

type FormField = {
  label: string;
  key: FormKey;
  placeholder: string;
  full?: boolean;
};

async function kickOnboardingImport(jobId: string) {
  const response = await fetch("/api/onboarding/work-import/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
  if (!response.ok) throw new Error("Baggrundsimporten kunne ikke startes.");
}

export default function OnboardingClient({
  rh,
  user,
  statisticsProfile,
  legalDocuments,
  isRepeatOnboarding,
}: {
  rh: OnboardingProfile | null;
  user: OnboardingUser | null;
  statisticsProfile: StatisticsProfileOptions;
  legalDocuments: LegalDocumentRecord[];
  isRepeatOnboarding: boolean;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const steps = [
    { id: 1, title: t("onboarding.stepWelcome"), icon: "👋" },
    { id: 2, title: t("onboarding.stepInfo"), icon: "👤" },
    { id: 3, title: t("onboarding.stepName"), icon: "🔎" },
    { id: 4, title: t("onboarding.stepWorks"), icon: "🎬" },
    { id: 5, title: t("onboarding.stepPrivacy"), icon: "🔒" },
    { id: 6, title: t("onboarding.stepConfirm"), icon: "✅" },
  ];
  const firstStep = isRepeatOnboarding ? 5 : 1;
  const [step, setStep] = useState(firstStep);
  const [isSaving, setIsSaving] = useState(false);
  const isOrganisationMember = Boolean(rh?.is_member);
  const [shareStatistics, setShareStatistics] = useState<boolean | null>(
    isOrganisationMember
      ? true
      : typeof rh?.statistics_participation === "boolean"
        ? rh.statistics_participation
        : null,
  );
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [secondaryProfessionTypeIds, setSecondaryProfessionTypeIds] = useState<string[]>(statisticsProfile.secondaryProfessionTypeIds);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<OnboardingField, string>>>({});

  // DFI & TMDB-tilstand
  const [dfiPersonId, setDfiPersonId] = useState<number | null>(null);
  const [tmdbPersonId, setTmdbPersonId] = useState<number | null>(null);
  const [dfiCredits, setDfiCredits] = useState<OnboardingCredit[]>([]);
  const [selectedDfiCredits, setSelectedDfiCredits] = useState<Record<string, boolean>>({});
  const [dfiSearchQuery, setDfiSearchQuery] = useState(rh?.full_name || "");
  const [isSearchingDfi, setIsSearchingDfi] = useState(false);
  const [isImportingDfi, setIsImportingDfi] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importJob, setImportJob] = useState<OnboardingImportStatus | null>(null);
  const [personCandidates, setPersonCandidates] = useState<PersonCandidate[]>([]);
  const [selectedPersonCandidates, setSelectedPersonCandidates] = useState<Record<string, boolean>>({});
  const [personSearchError, setPersonSearchError] = useState<string | null>(null);
  const [personSourceErrors, setPersonSourceErrors] = useState<{ dfi?: boolean; tmdb?: boolean; wikidata?: boolean }>({});
  const [alternativeNames, setAlternativeNames] = useState<string[]>(rh?.alternative_names ?? []);
  const [newAlternativeName, setNewAlternativeName] = useState("");
  const [variantAvailability, setVariantAvailability] = useState<{ loading: boolean; available: boolean; error: string | null }>({ loading: false, available: false, error: null });
  const [selectedPortraitUrl, setSelectedPortraitUrl] = useState<string | null>(null);
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});
  const [seriesSeasons, setSeriesSeasons] = useState<Record<string, number>>({});
  const [seriesEpisodes, setSeriesEpisodes] = useState<Record<string, number[]>>({});
  const [episodeOptions, setEpisodeOptions] = useState<Record<string, SeriesEpisodeOption[]>>({});
  const [episodeLoading, setEpisodeLoading] = useState<Record<string, boolean>>({});
  const [episodeErrors, setEpisodeErrors] = useState<Record<string, string | null>>({});
  const episodeRequestIds = React.useRef<Record<string, number>>({});

  // Import-fremdrift
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; title: string } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollCount = 0;
    const refresh = async () => {
      try {
        const result = await retryTransientNetwork(() => getOnboardingWorkImportStatus(importJob?.id));
        if (cancelled || !result.success || !result.job) return;
        setImportJob(result.job);
        if (result.job.status === "queued" || result.job.status === "processing") {
          if (pollCount % 6 === 0) void retryTransientNetwork(() => kickOnboardingImport(result.job!.id)).catch(() => undefined);
          pollCount += 1;
          timer = setTimeout(refresh, 2500);
        }
      } catch {
        if (!cancelled) timer = setTimeout(refresh, 5000);
      }
    };
    const initial = setTimeout(refresh, 0);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      if (timer) clearTimeout(timer);
    };
  }, [importJob?.id]);

  // Formulardata præ-udfyldt fra rettighedshaveren
  const invitedName = rh?.full_name?.trim() || "";
  const parsedInitialAddress = parseOnboardingAddress(rh?.address || "");
  const [formData, setFormData] = useState({
    email: user?.email || rh?.email || "",
    phone: rh?.phone || "",
    address: parsedInitialAddress.street,
    zip: parsedInitialAddress.postalCode,
    city: parsedInitialAddress.city,
    cpr: rh?.cpr_no || "",
    bank_account: rh?.bank_account || "",
    gender: rh?.gender || "prefer_not_to_say",
    professional_start_year: rh?.professional_start_year ? String(rh.professional_start_year) : "",
    primary_profession_type_id: rh?.primary_profession_type_id || "",
    usual_work_mode: rh?.usual_work_mode || "",
    primary_work_region_code: rh?.primary_work_region_code || "",
  });

  const handleField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === "phone" || field === "cpr" || field === "bank_account") {
      setFieldErrors(current => ({ ...current, [field]: undefined }));
    }
  };

  const validateField = (field: OnboardingField, value: string) => {
    const error = validateOnboardingField(field, value);
    setFieldErrors(current => ({ ...current, [field]: error ?? undefined }));
    return !error;
  };

  const fullNameValue = invitedName;

  React.useEffect(() => {
    const value = newAlternativeName.trim();
    if (!value || isDuplicateProfileName({ candidate: value, canonicalName: invitedName, variants: alternativeNames })) {
      setVariantAvailability({ loading: false, available: false, error: value ? "Navnet findes allerede på din profil." : null });
      return;
    }
    let cancelled = false;
    setVariantAvailability({ loading: true, available: false, error: null });
    const timer = setTimeout(() => {
      void checkNameVariantAvailability(value).then(result => {
        if (!cancelled) setVariantAvailability({ loading: false, available: result.available, error: result.error });
      });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [alternativeNames, invitedName, newAlternativeName]);

  const isSeriesCredit = (credit: OnboardingCredit) => {
    const category = `${credit.category} ${credit.raw?.media_type ?? ""} ${credit.raw?.type ?? ""}`.toLowerCase();
    return category.includes("serie") || category.includes("tv");
  };

  const seasonForCredit = (credit: OnboardingCredit) => {
    const rawTitle = credit.raw?.title ?? credit.raw?.name ?? credit.raw?.Title ?? credit.raw?.DanishTitle;
    return credit.season_number ?? parseSeasonNumberFromTitle(credit.title) ?? parseSeasonNumberFromTitle(rawTitle) ?? 1;
  };

  const displayEpisodeOptions = (credit: OnboardingCredit) => {
    const season = seriesSeasons[credit.id] ?? seasonForCredit(credit);
    if (episodeOptions[credit.id]) return episodeOptions[credit.id];
    return buildCompleteEpisodeOptions({
      episodeCount: Math.max(Number(credit.raw?.episode_count ?? credit.raw?.number_of_episodes ?? 0) || 0, credit.episode_options?.length ?? 0),
      externalOptions: credit.episode_options ?? [],
      localChildren: Array.isArray(credit.raw?.__local_children) ? credit.raw.__local_children : [],
      seasonNumber: season,
    });
  };

  const selectedEpisodesForCredit = (credit: OnboardingCredit) => {
    if (Object.prototype.hasOwnProperty.call(seriesEpisodes, credit.id)) return seriesEpisodes[credit.id];
    const available = new Set(displayEpisodeOptions(credit).map(option => option.number));
    return (credit.suggested_episodes ?? []).filter(number => available.has(number));
  };

  const loadEpisodesForSeason = async (credit: OnboardingCredit, season: number) => {
    const requestId = (episodeRequestIds.current[credit.id] ?? 0) + 1;
    episodeRequestIds.current[credit.id] = requestId;
    setEpisodeLoading(current => ({ ...current, [credit.id]: true }));
    setEpisodeErrors(current => ({ ...current, [credit.id]: null }));
    const result = await resolveOnboardingEpisodeOptions(credit, season);
    if (episodeRequestIds.current[credit.id] !== requestId) return;
    if (result.success) {
      setEpisodeOptions(current => ({ ...current, [credit.id]: result.options }));
      setSeriesEpisodes(current => {
        if (Object.prototype.hasOwnProperty.call(current, credit.id)) return current;
        const available = new Set(result.options.map(option => option.number));
        return { ...current, [credit.id]: (credit.suggested_episodes ?? []).filter(number => available.has(number)) };
      });
    } else {
      setEpisodeOptions(current => ({ ...current, [credit.id]: [] }));
      setSeriesEpisodes(current => ({ ...current, [credit.id]: [] }));
      setEpisodeErrors(current => ({ ...current, [credit.id]: seasonLookupMessage(locale, result.status === "error" ? "error" : "not_found", season) }));
    }
    setEpisodeLoading(current => ({ ...current, [credit.id]: false }));
  };

  const revealCreditsProgressively = async (credits: OnboardingCredit[]) => {
    setDfiCredits([]);
    const delay = credits.length > 25 ? 25 : 65;
    for (let index = 0; index < credits.length; index += 1) {
      setDfiCredits(credits.slice(0, index + 1));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  };

  const handleRetryBackgroundImport = async () => {
    if (!importJob) return;
    const result = await retryOnboardingWorkImport(importJob.id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setImportJob(current => current ? { ...current, status: "queued", failedItems: 0, errorMessage: null } : current);
    await retryTransientNetwork(() => kickOnboardingImport(importJob.id)).catch(() => undefined);
  };

  const handleComplete = async () => {
    setIsSaving(true);
    const payload = new FormData();
    Object.entries(formData).forEach(([k, v]) => payload.set(k, v));
    // Serveren afgør medlemsstatus. Værdien bruges kun som onboardingvalg for
    // ikke-medlemmer; aktive medlemmer får ikke spørgsmålet i onboarding.
    payload.set("opt_out_statistics", String(shareStatistics !== true));
    payload.set("statistics_participation_choice", shareStatistics === null ? "" : String(shareStatistics));
    payload.set("accepted_legal_document_ids", JSON.stringify(legalDocuments.map(document => document.id).filter(Boolean)));
    payload.set("secondary_profession_type_ids", JSON.stringify(secondaryProfessionTypeIds));

    const result = await completeOnboarding(payload);
    if (result.success && result.destination) {
      router.replace(result.destination);
      router.refresh();
    } else {
      toast.error(result.error || "Der opstod en fejl. Prøv igen.");
      setIsSaving(false);
    }
  };

  const handlePersonSearch = async (query = dfiSearchQuery, merge = false, nameVariants = alternativeNames) => {
    if (!query.trim()) return;
    setIsSearchingDfi(true);
    setPersonSearchError(null);
    try {
      const result = await discoverPersonCandidates(query.trim(), nameVariants);
      const candidates = result.success ? result.candidates : [];
      const errors: { dfi?: boolean; tmdb?: boolean; wikidata?: boolean } = result.success ? result.sourceErrors ?? {} : {};
      setPersonSourceErrors(current => merge
        ? { dfi: Boolean(current.dfi || errors.dfi), tmdb: Boolean(current.tmdb || errors.tmdb), wikidata: Boolean(current.wikidata || errors.wikidata) }
        : errors);
      setPersonCandidates(current => merge ? Array.from(new Map([...current, ...candidates].map(candidate => [candidate.key, candidate])).values()).sort((a, b) => b.score - a.score) : candidates);
      setSelectedPersonCandidates(current => ({ ...(merge ? current : {}), ...Object.fromEntries(candidates.filter(candidate => candidate.score >= 0.78).map(candidate => [candidate.key, true])) }));
      const portrait = candidates.find(candidate => candidate.imageUrl)?.imageUrl ?? null;
      if (isOrganisationMember && portrait && (!merge || !selectedPortraitUrl)) setSelectedPortraitUrl(portrait);
      if (!result.success) setPersonSearchError(result.error ?? "Kunne ikke søge efter navneprofiler.");
    } catch {
      setPersonSearchError("Kunne ikke kontakte persondatabaserne.");
    } finally {
      setIsSearchingDfi(false);
    }
  };

  const addAlternativeName = async () => {
    const value = newAlternativeName.trim();
    if (!value || isDuplicateProfileName({ candidate: value, canonicalName: invitedName, variants: alternativeNames })) return;
    const availability = await checkNameVariantAvailability(value);
    if (!availability.available) {
      setVariantAvailability({ loading: false, available: false, error: availability.error });
      return;
    }
    const nextNames = [...alternativeNames, value];
    setAlternativeNames(nextNames);
    setNewAlternativeName("");
    await handlePersonSearch(value, true, nextNames);
  };

  const handleNextStep = async () => {
    if (step === 2) {
      // Navnet kommer fra invitationens rettighedshaverprofil og kan ikke redigeres her.
      const fullName = invitedName;
      const valid = [
        validateField("name", fullName),
        validateField("email", formData.email),
        validateField("phone", formData.phone),
        validateField("cpr", formData.cpr),
        validateField("bank_account", formData.bank_account),
      ].every(Boolean);
      if (!valid) {
        return;
      }

      setDfiSearchQuery(fullName);
      await handlePersonSearch(fullName);
      setStep(3);
    } else if (step === 3) {
      const selected = Object.entries(selectedPersonCandidates)
        .filter(([, active]) => active)
        .map(([key]) => personCandidates.find(candidate => candidate.key === key))
        .filter((candidate): candidate is PersonCandidate => Boolean(candidate));
      if (personCandidates.length > 0 && selected.length === 0) {
        setPersonSearchError("Vælg mindst én navneprofil, der er dig.");
        return;
      }
      setIsSearchingDfi(true);
      setPersonSearchError(null);
      try {
        const confirmation = await retryTransientNetwork(() => confirmExternalPersonIdentity(selected, dfiSearchQuery, alternativeNames, isOrganisationMember ? selectedPortraitUrl : null));
        if (!confirmation.success) {
          setPersonSearchError(confirmation.error ?? "Personmatch kunne ikke gemmes.");
          return;
        }
        setDfiCredits([]);
        setSelectedDfiCredits({});
        setExpandedSeries({});
        setSeriesEpisodes({});
        setEpisodeOptions({});
        const searchResult = await retryTransientNetwork(() => searchOnboardingCreditsForCurrentUser());
        setPersonSourceErrors(current => ({
          ...current,
          dfi: Boolean(current.dfi || searchResult.sourceErrors?.dfi),
          tmdb: Boolean(current.tmdb || searchResult.sourceErrors?.tmdb),
        }));
        if (searchResult.success && searchResult.credits?.length > 0) {
          setDfiPersonId(searchResult.dfiPersonId);
          setTmdbPersonId(searchResult.tmdbPersonId);
          const selectedCredits: Record<string, boolean> = {};
          searchResult.credits.forEach(credit => { selectedCredits[credit.id] = true; });
          setSelectedDfiCredits(selectedCredits);
          await revealCreditsProgressively(searchResult.credits);
        }
        setStep(4);
      } catch (error) {
        setPersonSearchError(isTransientNetworkError(error) ? t("onboarding.networkError") : t("onboarding.searchError"));
      } finally {
        setIsSearchingDfi(false);
      }
    } else if (step === 4) {
      const approved = dfiCredits
        .filter((c) => selectedDfiCredits[c.id])
        .map((c) => isSeriesCredit(c)
          ? {
              ...c,
              season_number: seriesSeasons[c.id] ?? seasonForCredit(c),
              selected_episodes: selectedEpisodesForCredit(c),
            }
          : c
        );
      if (approved.length > 0) {
        setIsImportingDfi(true);
        setImportError(null);
        setImportProgress({ current: 0, total: approved.length, title: "Forbereder baggrundsimport" });
        try {
          const result = await retryTransientNetwork(
            () => startOnboardingWorkImport(dfiPersonId, tmdbPersonId, approved),
            { attempts: 2, delayMs: 750 }
          );
          if (!result.success) {
            setImportError(result.error);
            return;
          }
          setImportJob(result.job);
          void retryTransientNetwork(() => kickOnboardingImport(result.job.id)).catch(() => undefined);
          setStep(5);
        } catch (error: unknown) {
          setImportError(isTransientNetworkError(error) ? t("onboarding.networkError") : "Værkerne kunne ikke importeres. Prøv igen.");
        } finally {
          setImportProgress(null);
          setIsImportingDfi(false);
        }
      } else {
        setStep(5);
      }
    } else if (step === 5) {
      if (!legalAccepted) {
        toast.error("Du skal acceptere de aktuelle rettighedstekster for at fortsætte.");
        return;
      }
      if (!isOrganisationMember && shareStatistics === null) {
        toast.error("Vælg om dine overordnede vilkår må bruges til anonym markedsstatistik.");
        return;
      }
      setStep(6);
    } else {
      setStep((s) => s + 1);
    }
  };

  const portraitOptions = isOrganisationMember ? Array.from(
    new Map(
      personCandidates
        .filter(candidate => selectedPersonCandidates[candidate.key])
        .flatMap(candidate => (candidate.portraitUrls?.length ? candidate.portraitUrls : candidate.imageUrl ? [candidate.imageUrl] : []).map(url => [url, candidate] as const))
    ).entries()
  ) : [];

  const progress = ((step - 1) / (steps.length - 1)) * 100;
  const workImportPercent = importJob?.totalItems
    ? Math.round(((importJob.completedItems + importJob.failedItems) / importJob.totalItems) * 100)
    : 0;
  const workImportStatusLabel = importJob?.status === "complete"
    ? t("onboarding.importComplete")
    : importJob?.status === "partial" || importJob?.status === "error"
      ? t("onboarding.importNeedsRetry")
      : t("onboarding.importRunning");
  const privacyDocument = legalDocuments.find(document => document.document_type === "privacy_notice");
  const privacyStepBlocked = step === 5 && (!legalAccepted || (!isOrganisationMember && shareStatistics === null));

  if (isImportingDfi) {
    const approvedCount = dfiCredits.filter((c) => selectedDfiCredits[c.id]).length;
    return (
      <div style={{
        minHeight: "100vh",
        backgroundColor: "var(--background)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}>
        <div style={{ width: "100%", maxWidth: "540px", textAlign: "center", display: "flex", flexDirection: "column", gap: "24px", padding: "40px", backgroundColor: "var(--surface-container-lowest)", borderRadius: "var(--radius-lg)", border: "1px solid var(--outline-variant)", boxShadow: "0px 4px 12px rgba(15, 23, 42, 0.08)" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Loader2 size={48} style={{ animation: "spin 2s linear infinite", color: "var(--primary)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "var(--on-surface)" }}>
              Importerer film og serier...
            </h2>
            <p style={{ fontSize: "14px", color: "var(--on-surface-variant)", margin: 0 }}>
              Vi henter detaljeret metadata for dine {approvedCount} valgte titler fra DFI og TMDb.
            </p>
            {importProgress && (
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--on-surface)", margin: 0 }}>
                Henter: {importProgress.title} ({importProgress.current}/{importProgress.total})
              </p>
            )}
          </div>

          {approvedCount >= 5 && (
            <p style={{ fontSize: "13px", color: "var(--foreground)", fontWeight: 600, margin: 0, lineHeight: 1.6 }}>
              ⚠️ Vær tålmodig. Du har klippet mange film! Dette kan tage lidt tid.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "var(--background)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
    }}>
      <div style={{ width: "100%", maxWidth: "640px", display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "4px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="DFKS" style={{ height: "40px", objectFit: "contain" }} />
        </div>

        {/* Fremskridtsindikator */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
            {steps.map((s) => (
              <div key={s.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", flex: 1 }}>
                <div style={{
                  width: "32px", height: "32px", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "14px",
                  backgroundColor: step > s.id ? "var(--foreground)" : step === s.id ? "var(--foreground)" : "var(--muted)",
                  color: step >= s.id ? "var(--card)" : "var(--border)",
                  transition: "all 0.3s ease", fontWeight: 700,
                }}>
                  {step > s.id ? <CheckCircle size={16} color="white" /> : s.icon}
                </div>
                <div style={{ fontSize: "10px", fontWeight: 600, textAlign: "center", color: step === s.id ? "var(--on-surface)" : "var(--on-surface-variant)" }}>
                  {s.title}
                </div>
              </div>
            ))}
          </div>
          <div style={{ height: "4px", backgroundColor: "var(--border)", borderRadius: "2px", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, backgroundColor: "var(--foreground)", borderRadius: "2px", transition: "width 0.4s ease" }} />
          </div>
        </div>

        {/* Kortindhold */}
        <div style={{
          backgroundColor: "var(--surface-container-lowest)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--outline-variant)",
          overflow: "hidden",
          boxShadow: "0px 4px 12px rgba(15, 23, 42, 0.08)",
        }}>

          {/* Trin 1: Velkommen */}
          {step === 1 && (
            <div className="p-5 sm:p-10">
              <div style={{ textAlign: "center", marginBottom: "32px" }}>
                <div style={{ fontSize: "48px", marginBottom: "16px" }}>👋</div>
                <h1 style={{ fontSize: "28px", fontWeight: 800, margin: "0 0 12px", color: "var(--on-surface)" }}>
                  {isRepeatOnboarding ? t("onboarding.repeatTitle") : "Velkommen til DFKS Rettighedssystem"}
                </h1>
                <p style={{ color: "var(--on-surface-variant)", fontSize: "16px", lineHeight: 1.7, margin: 0 }}>
                  {isRepeatOnboarding
                    ? t("onboarding.repeatIntro")
                    : "Vi hjælper dig igennem en kort opsætning, så du er klar til at administrere dine rettigheder, kontrakter og udbetalinger."}
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "32px" }}>
                {[
                  { icon: "📋", text: "Bekræft dine personlige oplysninger" },
                  { icon: "🎬", text: "Importer dine film fra DFI Filmdatabasen og TMDb" },
                  { icon: "🔒", text: "Vælg dine privatlivsindstillinger" },
                ].map((item) => (
                  <div key={item.text} style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "14px 16px",
                    backgroundColor: "var(--surface-container-low)",
                    border: "1px solid var(--outline-variant)",
                    borderRadius: "var(--radius-default)",
                  }}>
                    <span style={{ fontSize: "20px" }}>{item.icon}</span>
                    <span style={{ fontSize: "15px", fontWeight: 500, color: "var(--on-surface)" }}>{item.text}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: "13px", color: "var(--on-surface-variant)", textAlign: "center" }}>
                Det tager ca. 2-5 minutter.
              </p>
            </div>
          )}

          {/* Trin 2: Dine oplysninger */}
          {step === 2 && (
            <div className="p-5 sm:p-10">
              <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 8px", color: "var(--on-surface)" }}>Dine oplysninger</h2>
              <p style={{ color: "var(--on-surface-variant)", fontSize: "14px", margin: "0 0 24px" }}>
                Kontrollér dine oplysninger. E-mailadressen er låst til den bruger, du er logget ind med.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div style={{ gridColumn: "1 / -1", padding: "14px 16px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--muted)" }}>
                  <p style={{ margin: "0 0 4px", color: "var(--on-surface-variant)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {t("profile.name")}
                  </p>
                  <p style={{ margin: 0, color: "var(--on-surface)", fontSize: "17px", fontWeight: 600 }}>
                    {fullNameValue || t("onboarding.missingName")}
                  </p>
                  {fieldErrors.name && <p id="onboarding-name-error" role="alert" style={{ margin: "6px 0 0", color: "var(--destructive)", fontSize: "12px" }}>{fieldErrors.name}</p>}
                </div>
                {([
                  { label: t("profile.phone"), key: "phone", placeholder: "+45 12 34 56 78" },
                  { label: t("profile.address"), key: "address", placeholder: "Gadenavn 1", full: true },
                  { label: t("profile.postalCode"), key: "zip", placeholder: "1234" },
                  { label: t("profile.city"), key: "city", placeholder: "København" },
                ] satisfies FormField[]).map((f) => (
                  <div key={f.key} style={{ gridColumn: f.full ? "1 / -1" : undefined }}>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px", color: "var(--on-surface-variant)" }}>
                      {f.label}
                    </label>
                    <input
                      className="focus-visible:ring-2 focus-visible:ring-ring"
                      value={formData[f.key]}
                      onChange={(e) => handleField(f.key, e.target.value)}
                      onBlur={() => f.key === "phone" && validateField("phone", formData.phone)}
                      inputMode={f.key === "phone" || f.key === "zip" ? "numeric" : undefined}
                      placeholder={f.placeholder}
                      aria-invalid={f.key === "phone" ? Boolean(fieldErrors.phone) : undefined}
                      aria-describedby={f.key === "phone" && fieldErrors.phone ? "onboarding-phone-error" : undefined}
                      style={{ width: "100%", padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: `1px solid ${f.key === "phone" && fieldErrors.phone ? "var(--destructive)" : "var(--input)"}`, outline: "none", color: "var(--on-surface)" }}
                    />
                    {f.key === "phone" && fieldErrors.phone && <p id="onboarding-phone-error" role="alert" style={{ margin: "6px 0 0", color: "var(--destructive)", fontSize: "12px" }}>{fieldErrors.phone}</p>}
                  </div>
                ))}
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px", color: "var(--on-surface-variant)" }}>
                    {t("profile.email")}
                  </label>
                  <input
                    className="focus-visible:ring-2 focus-visible:ring-ring"
                    value={formData.email}
                    readOnly
                    aria-readonly="true"
                    type="email"
                    onBlur={() => validateField("email", formData.email)}
                    placeholder="din.email@eksempel.dk"
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? "onboarding-email-error" : undefined}
                    style={{ width: "100%", padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: `1px solid ${fieldErrors.email ? "var(--destructive)" : "var(--input)"}`, outline: "none", color: "var(--on-surface)", background: "var(--muted)" }}
                  />
                  {fieldErrors.email && <p id="onboarding-email-error" role="alert" style={{ margin: "6px 0 0", color: "var(--destructive)", fontSize: "12px" }}>{fieldErrors.email}</p>}
                </div>
              </div>

              <div style={{ marginTop: "24px", padding: "16px", backgroundColor: "var(--muted)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "8px", color: "var(--on-surface)" }}>{t("onboarding.bankInfo")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  {([
                    { label: t("profile.cpr"), key: "cpr", placeholder: "DDMMÅÅ-XXXX" },
                    { label: "NemKonto / Kontonr.", key: "bank_account", placeholder: "Reg.nr. + kontonr." },
                  ] satisfies FormField[]).map((f) => (
                    <div key={f.key}>
                      <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px", color: "var(--on-surface-variant)" }}>
                        {f.label}
                      </label>
                      <input
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                        value={formData[f.key]}
                        onChange={(e) => handleField(f.key, e.target.value)}
                        onBlur={() => validateField(f.key === "cpr" ? "cpr" : "bank_account", formData[f.key])}
                        inputMode="numeric"
                        placeholder={f.placeholder}
                        aria-invalid={Boolean(fieldErrors[f.key === "cpr" ? "cpr" : "bank_account"])}
                        aria-describedby={fieldErrors[f.key === "cpr" ? "cpr" : "bank_account"] ? `onboarding-${f.key}-error` : undefined}
                        style={{ width: "100%", padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: `1px solid ${fieldErrors[f.key === "cpr" ? "cpr" : "bank_account"] ? "var(--destructive)" : "var(--input)"}`, outline: "none", backgroundColor: "var(--muted)", color: "var(--on-surface)" }}
                      />
                      {fieldErrors[f.key === "cpr" ? "cpr" : "bank_account"] && <p id={`onboarding-${f.key}-error`} role="alert" style={{ margin: "6px 0 0", color: "var(--destructive)", fontSize: "12px" }}>{fieldErrors[f.key === "cpr" ? "cpr" : "bank_account"]}</p>}
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: "16px", display: "flex", gap: "10px", padding: "12px 14px", backgroundColor: "var(--muted)", border: "1px solid var(--border)", borderRadius: "6px" }}>
                  <span style={{ fontSize: "16px" }}>🔒</span>
                  <p style={{ fontSize: "12px", color: "var(--foreground)", margin: 0, lineHeight: 1.5 }}>
                    <strong>{t("onboarding.securityTitle")}</strong> {t("onboarding.securityText")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Trin 3: DFI & TMDB Værker */}
          {step === 3 && (
            <div style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "var(--on-surface)" }}>{t("onboarding.chooseProfiles")}</h2>
                <p style={{ fontSize: "14px", color: "var(--on-surface-variant)", margin: "8px 0 0", lineHeight: 1.6 }}>
                  {t("onboarding.chooseProfilesIntro")}
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--muted)" }}>
                <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.5, color: "var(--on-surface-variant)" }}>
                  {t("onboarding.searchCreditName")}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--on-surface-variant)" }}>{t("onboarding.nameFromInfo")}</span>
                  <div style={{ padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid var(--input)", background: "var(--card)", color: "var(--foreground)", fontWeight: 600 }}>
                    {dfiSearchQuery || fullNameValue || t("onboarding.missingName")}
                  </div>
                </div>
                {alternativeNames.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {alternativeNames.map(name => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setAlternativeNames(current => current.filter(item => item !== name))}
                        title={t("onboarding.removeNameVariant")}
                        style={{ border: "1px solid var(--input)", borderRadius: "999px", padding: "5px 9px", background: "var(--card)", fontSize: "12px", cursor: "pointer", color: "var(--foreground)" }}
                      >
                        {name} ×
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <input
                    value={newAlternativeName}
                    onChange={event => setNewAlternativeName(event.target.value)}
                    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addAlternativeName(); } }}
                    placeholder={t("onboarding.addNameVariant")}
                    style={{ flex: "1 1 220px", minWidth: 0, padding: "8px 10px", fontSize: "13px", borderRadius: "6px", border: "1px solid var(--input)", color: "var(--foreground)" }}
                  />
                  <button type="button" onClick={() => void addAlternativeName()} disabled={!newAlternativeName.trim() || isSearchingDfi || variantAvailability.loading || !variantAvailability.available} style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--input)", background: "var(--card)", cursor: "pointer", color: "var(--foreground)" }}>{variantAvailability.loading ? "Kontrollerer…" : t("onboarding.addVariant")}</button>
                </div>
                {variantAvailability.error && <p className="m-0 text-xs text-destructive" role="alert">{variantAvailability.error}</p>}
              </div>
              {isOrganisationMember && portraitOptions.length > 0 && (
                <div style={{ padding: "14px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--card)", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--on-surface)" }}>{t("onboarding.choosePortrait")}</div>
                    <p style={{ fontSize: "12px", color: "var(--on-surface-variant)", lineHeight: 1.5, margin: "4px 0 0" }}>{t("profile.portraitText")}</p>
                  </div>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    {portraitOptions.map(([url, candidate]) => (
                      <button
                        key={url}
                        type="button"
                        aria-pressed={selectedPortraitUrl === url}
                        onClick={() => setSelectedPortraitUrl(url)}
                        style={{ display: "flex", alignItems: "center", gap: "8px", border: selectedPortraitUrl === url ? "2px solid var(--foreground)" : "1px solid var(--input)", borderRadius: "8px", padding: "6px 8px", background: "var(--card)", cursor: "pointer", color: "var(--foreground)" }}
                      >
                        <Image src={url} alt="" width={36} height={44} unoptimized style={{ width: "36px", height: "44px", borderRadius: "6px", objectFit: "cover" }} />
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>{candidate.source.toUpperCase()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <PersonIdentityPicker candidates={personCandidates} selected={selectedPersonCandidates} loading={isSearchingDfi} loadingLabel="Søger efter værker…" mergingLabel="Tilføjer værker fra navnevarianten…" error={personSearchError} sourceErrors={personSourceErrors} onSelect={candidate => { setSelectedPersonCandidates(current => ({ ...current, [candidate.key]: !current[candidate.key] })); setPersonSearchError(null); }} />
            </div>
          )}

          {step === 4 && (
            <div className="p-5 sm:p-10">
              <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 8px", color: "var(--on-surface)" }}>
                🎬 Dine film og serier i DFI & TMDb
              </h2>
              <p style={{ color: "var(--on-surface-variant)", fontSize: "14px", margin: "0 0 24px", lineHeight: 1.6 }}>
                Vi har slået dit navn op i DFI Filmdatabasen og TMDb. Gennemgå og bekræft de titler, du har medvirket til at skabe. Hvis der er titler der mangler kan du tilføje dem senere.
              </p>
              <div style={{ marginBottom: "20px", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--accent)", color: "var(--accent-foreground)", fontSize: "13px", lineHeight: 1.55 }}>{t("onboarding.episodesOptional")}</div>
              {(personSourceErrors.dfi || personSourceErrors.tmdb || personSourceErrors.wikidata) && (
                <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100">
                  {t("onboarding.partialSourceResults")}
                </div>
              )}
              {importError && <div style={{ marginBottom: "20px", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--destructive)", background: "var(--muted)", color: "var(--destructive)", fontSize: "13px", lineHeight: 1.55 }}>{importError}</div>}

              {isSearchingDfi && dfiCredits.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "40px 0" }}>
                  <Loader2 size={36} style={{ animation: "spin 1s linear infinite", color: "var(--primary)" }} />
                  <div style={{ color: "var(--on-surface-variant)", fontSize: "14px" }}>Søger i lokale data, DFI, TMDb og Wikidata...</div>
                </div>
              ) : dfiCredits.length > 0 ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 500, color: "var(--on-surface-variant)" }}>
                      {isSearchingDfi && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
                      <span>
                        {isSearchingDfi ? `Finder titler... ${dfiCredits.length} fundet` : `Fundet ${dfiCredits.length} titler`}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        const allSelected = Object.values(selectedDfiCredits).every((v) => v);
                        const next: Record<string, boolean> = {};
                        dfiCredits.forEach((c) => { next[c.id] = !allSelected; });
                        setSelectedDfiCredits(next);
                      }}
                      style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--input)", backgroundColor: "transparent", color: "var(--foreground)", cursor: "pointer" }}
                    >
                      {Object.values(selectedDfiCredits).every((v) => v) ? "Fravælg alle" : "Vælg alle"}
                    </button>
                  </div>
                  <div style={{
                    maxHeight: "350px", overflowY: "auto",
                    border: "2px solid var(--border)",
                    borderRadius: "8px",
                    backgroundColor: "var(--surface-container-low)",
                    display: "flex", flexDirection: "column",
                    boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.05)",
                  }}>
                    {dfiCredits.map((c, i) => {
                      const isSeries = isSeriesCredit(c);
                      return (
                        <div
                          key={c.id}
                          tabIndex={-1}
                          className="scroll-mt-24 outline-none"
                          style={{
                          padding: "14px 16px",
                          borderBottom: i === dfiCredits.length - 1 ? "none" : "1px solid var(--input)",
                          backgroundColor: selectedDfiCredits[c.id] ? "var(--surface-container-high)" : "transparent",
                          transition: "background-color 0.2s ease",
                        }}>
                          <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer", userSelect: "none" }}>
                            <input
                              type="checkbox"
                              checked={selectedDfiCredits[c.id] || false}
                              onChange={(e) => setSelectedDfiCredits((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                              style={{ width: "16px", height: "16px", marginTop: "3px", accentColor: "var(--primary)" }}
                            />
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--on-surface)" }}>
                                {c.title} {c.year ? `(${c.year})` : ""}
                              </div>
                              <div style={{ fontSize: "12px", color: "var(--on-surface-variant)", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 500, color: "var(--tertiary)" }}>{c.role}</span>
                                <span>•</span>
                                <span>{c.category}</span>
                                <span>•</span>
                                <span>{c.source.toUpperCase()}</span>
                                {c.imdb_id && <span>IMDb {c.imdb_id}</span>}
                                {isSeries && selectedDfiCredits[c.id] && <span className="font-semibold text-amber-800 dark:text-amber-200">• {displayEpisodeOptions(c).length} afsnit fundet</span>}
                              </div>
                            </div>
                          </label>
                          {isSeries && selectedDfiCredits[c.id] && (
                            <div className="ml-7 mt-3 rounded-md border bg-background p-3">
                              <button
                                type="button"
                                className="text-sm font-medium text-foreground"
                                onClick={() => {
                                  const willExpand = !expandedSeries[c.id];
                                  setExpandedSeries(current => ({ ...current, [c.id]: willExpand }));
                                  if (willExpand && displayEpisodeOptions(c).length === 0 && !episodeLoading[c.id]) {
                                    void loadEpisodesForSeason(c, seriesSeasons[c.id] ?? seasonForCredit(c));
                                  }
                                }}
                              >
                                {expandedSeries[c.id] ? "Skjul afsnit" : "Vælg afsnit"} · {selectedEpisodesForCredit(c).length} valgt
                              </button>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {c.source === "dfi" && c.episode_options?.length ? "Afsnit fra DFI" : c.source === "tmdb" ? "Afsnit fra TMDB" : displayEpisodeOptions(c).length ? "Afsnit fra lokale data eller ekstern fallback" : "Afsnit undersøges ved udfoldning"}
                              </p>
                              {expandedSeries[c.id] && (
                                <div className="mt-3 space-y-2">
                                  <SeriesEpisodeSelector
                                    season={seriesSeasons[c.id] ?? seasonForCredit(c)}
                                    onSeasonChange={season => {
                                      setSeriesSeasons(current => ({ ...current, [c.id]: season }));
                                      setSeriesEpisodes(current => ({ ...current, [c.id]: [] }));
                                      setEpisodeOptions(current => ({ ...current, [c.id]: [] }));
                                      void loadEpisodesForSeason(c, season);
                                    }}
                                    options={displayEpisodeOptions(c)}
                                    selected={selectedEpisodesForCredit(c)}
                                    onSelectedChange={episodes => setSeriesEpisodes(current => ({ ...current, [c.id]: episodes }))}
                                    loading={Boolean(episodeLoading[c.id])}
                                    error={episodeErrors[c.id]}
                                    label="Vælg afsnit"
                                  />
                                  {c.suggested_episodes?.length ? <p className="text-xs text-muted-foreground">DFI-krediterede afsnit er valgt som forslag. Du kan rette valget.</p> : null}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: "32px 24px", textAlign: "center",
                  backgroundColor: "var(--surface-container)",
                  borderRadius: "var(--radius-md)",
                  border: "1px dashed var(--outline)",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: "12px",
                }}>
                  <div style={{ fontSize: "36px" }}>🔍</div>
                  <div style={{ fontWeight: 600, fontSize: "15px", color: "var(--on-surface)" }}>Ingen film fundet automatisk</div>
                  <p style={{ fontSize: "13px", color: "var(--on-surface-variant)", margin: 0, lineHeight: 1.6, maxWidth: "400px" }}>
                    Vi kunne ikke finde dig i DFI eller TMDb under navnet <strong>{fullNameValue}</strong>.
                    Brug søgefeltet ovenfor, eller fortsæt hvis du ikke har film registreret endnu.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Trin 4: Privatliv */}
          {step === 5 && (
            <div style={{ padding: "40px" }}>
              <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 8px", color: "var(--on-surface)" }}>Privatliv & Data</h2>
              <p style={{ color: "var(--on-surface-variant)", fontSize: "14px", margin: "0 0 24px" }}>
                {privacyDocument?.title ?? "Gennemgå hvordan vi behandler dine oplysninger."}
              </p>

              {importJob && (
                <div className={`mb-5 rounded-lg border p-4 ${importJob.status === "complete" ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : importJob.status === "partial" || importJob.status === "error" ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="m-0 text-sm font-semibold">{workImportStatusLabel}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.importBackgroundInfo")}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold">{importJob.completedItems}/{importJob.totalItems}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${workImportPercent}%` }} />
                  </div>
                  {importJob.currentTitle && (importJob.status === "queued" || importJob.status === "processing") && <p className="mt-2 text-xs">{t("onboarding.importCurrent")}: {importJob.currentTitle}</p>}
                  {(importJob.status === "partial" || importJob.status === "error") && (
                    <button type="button" onClick={() => void handleRetryBackgroundImport()} className="mt-3 rounded-md border bg-background px-3 py-2 text-sm font-medium">
                      {t("onboarding.importRetry")}
                    </button>
                  )}
                </div>
              )}
              
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ backgroundColor: "var(--surface-container)", borderRadius: "var(--radius-md)", border: "1px solid var(--outline-variant)", padding: "20px 24px" }}>
                  <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--on-surface)", marginBottom: "10px" }}>
                    Dine data, dine rettigheder
                  </div>
                  <div style={{ display: "grid", gap: "12px" }}>
                    {legalDocuments.map(document => (
                      <details key={document.document_type} open={document.document_type === "privacy_notice"} style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface-container-lowest)" }}>
                        <summary style={{ cursor: "pointer", padding: "12px 14px", fontSize: "14px", fontWeight: 700, color: "var(--on-surface)" }}>
                          {LEGAL_DOCUMENT_TYPE_LABELS[document.document_type]} · version {document.version || 1}
                        </summary>
                        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px", whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.65, color: "var(--on-surface-variant)" }}>
                          {document.body}
                        </div>
                      </details>
                    ))}
                  </div>
                  <label style={{ marginTop: "16px", display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={legalAccepted}
                      onChange={event => setLegalAccepted(event.target.checked)}
                      style={{ marginTop: "3px", width: "18px", height: "18px", accentColor: "var(--primary)" }}
                    />
                    <span style={{ fontSize: "13px", lineHeight: 1.55, color: "var(--on-surface)" }}>
                      Jeg har læst og accepterer de aktuelle vilkår, privatlivsoplysninger, AI-transparens og kontraktanalysevilkår for portalen.
                    </span>
                  </label>
                  <a
                    href={PRIVACY_POLICY_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginTop: "12px", display: "inline-flex", fontSize: "13px", fontWeight: 600, color: "var(--primary)" }}
                  >
                    Læs fuld privatlivspolitik
                  </a>
                </div>

                {/* Lønstatistik */}
                <div style={{ backgroundColor: "var(--surface-container)", borderRadius: "var(--radius-md)", border: "1px solid var(--outline-variant)", overflow: "hidden" }}>
                  <div style={{ padding: "20px 24px", display: "flex", gap: "14px" }}>
                    <div style={{ fontSize: "28px", flexShrink: 0 }}>📊</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--on-surface)", marginBottom: "10px" }}>
                        Hjælp alle klippere til at forhandle bedre løn
                      </div>
                      <p style={{ fontSize: "14px", color: "var(--on-surface-variant)", lineHeight: 1.7, margin: "0 0 10px" }}>
                        Når du deler dine anonymiserede løndata, kan vi beregne realistiske branchegennemsnit — opdelt på genre.
                        Det er konkret viden til din næste lønforhandling.
                      </p>
                      <div style={{ fontSize: "12px", color: "var(--tertiary)", fontStyle: "italic", fontWeight: 500 }}>
                        🔒 Dine data behandles altid anonymiseret og aggregeret.
                      </div>
                    </div>
                  </div>
                  {isOrganisationMember ? <div style={{
                    padding: "16px 24px",
                    backgroundColor: "var(--surface-container-low)",
                    borderTop: "1px solid var(--outline-variant)",
                  }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--on-surface)" }}>
                      Du deltager som medlem af organisationen
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--on-surface-variant)", marginTop: "4px", lineHeight: 1.5 }}>
                      Som medlem er du oplyst om, at foreningen bruger overordnede kontrakt- og lønoplysninger til anonymiseret statistikarbejde under faste diskretionsgrænser.
                    </div>
                  </div> : <div style={{
                    display: "grid", gap: "10px",
                    padding: "16px 24px",
                    backgroundColor: "var(--surface-container-low)",
                    borderTop: "1px solid var(--outline-variant)",
                  }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--on-surface)" }}>
                      Hjælp branchen med at skabe gennemsigtighed
                    </div>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="share-statistics"
                        checked={shareStatistics === true}
                        onChange={() => setShareStatistics(true)}
                        style={{ marginTop: "3px", width: "18px", height: "18px", accentColor: "var(--primary)" }}
                      />
                      <span style={{ fontSize: "13px", lineHeight: 1.5, color: "var(--on-surface)" }}>
                        Ja, I må gerne bruge mine overordnede vilkår til anonym markedsstatistik.
                      </span>
                    </label>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="share-statistics"
                        checked={shareStatistics === false}
                        onChange={() => setShareStatistics(false)}
                        style={{ marginTop: "3px", width: "18px", height: "18px", accentColor: "var(--primary)" }}
                      />
                      <span style={{ fontSize: "13px", lineHeight: 1.5, color: "var(--on-surface)" }}>
                        Nej tak, brug kun min kontrakt som dokumentation for mine rettigheder og udbetalinger.
                      </span>
                    </label>
                  </div>}
                </div>

                {/* Kønsoplysninger Dropdown */}
                <div style={{ backgroundColor: "var(--surface-container)", borderRadius: "var(--radius-md)", border: "1px solid var(--outline-variant)", padding: "20px 24px" }}>
                  <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                    <div style={{ fontSize: "28px", flexShrink: 0 }}>👥</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--on-surface)", marginBottom: "6px" }}>
                        Oplysning om køn (valgfrit)
                      </div>
                      <p style={{ fontSize: "14px", color: "var(--on-surface-variant)", lineHeight: 1.6, margin: "0 0 16px" }}>
                        Vi anvender kønsoplysninger til at udarbejde anonymiseret statistik over fordeling af rettigheder, diversitet og lønforhold i filmbranchen.
                      </p>
                      
                      <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "8px", color: "var(--on-surface-variant)" }}>
                        Vælg køn
                      </label>
                      <select
                        value={formData.gender}
                        onChange={(e) => handleField("gender", e.target.value)}
                        style={{ width: "100%", maxWidth: "240px", padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid var(--input)", backgroundColor: "var(--surface-container-lowest)", color: "var(--on-surface)", outline: "none" }}
                      >
                        <option value="prefer_not_to_say">Vil ikke oplyse</option>
                        <option value="female">Kvinde</option>
                        <option value="male">Mand</option>
                        <option value="non_binary">Andet / Non-binær</option>
                      </select>
                    </div>
                  </div>
                </div>

                {statisticsProfile.config.professional_start_year && <div style={{ backgroundColor: "var(--surface-container)", borderRadius: "var(--radius-md)", border: "1px solid var(--outline-variant)", padding: "20px 24px" }}>
                  <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--on-surface)" }}>Professionel erfaring (valgfrit)</div>
                  <p style={{ fontSize: "14px", color: "var(--on-surface-variant)" }}>Hvilket år begyndte du at arbejde professionelt som {statisticsProfile.professionLabel.toLocaleLowerCase(locale === "en" ? "en" : "da")}? Året bruges kun i aggregeret statistik om anciennitet.</p>
                  <input type="number" min={1940} max={new Date().getFullYear()} value={formData.professional_start_year} onChange={event => handleField("professional_start_year", event.target.value)} style={{ width: "100%", maxWidth: "240px", padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--input)", backgroundColor: "var(--surface-container-lowest)", color: "var(--on-surface)" }} />
                </div>}

                {statisticsProfile.config.primary_profession_type && statisticsProfile.professionTypes.length > 0 && <div style={{ backgroundColor: "var(--surface-container)", borderRadius: "var(--radius-md)", border: "1px solid var(--outline-variant)", padding: "20px 24px" }}>
                  <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--on-surface)" }}>Primær faggruppe (valgfrit)</div>
                  <select value={formData.primary_profession_type_id} onChange={event => handleField("primary_profession_type_id", event.target.value)} style={{ marginTop: "12px", width: "100%", maxWidth: "360px", padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--input)", backgroundColor: "var(--surface-container-lowest)", color: "var(--on-surface)" }}><option value="">Vælg faggruppe</option>{statisticsProfile.professionTypes.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
                </div>}

                {statisticsProfile.config.secondary_profession_types && statisticsProfile.professionTypes.length > 0 && <div style={{ backgroundColor: "var(--surface-container)", borderRadius: "var(--radius-md)", border: "1px solid var(--outline-variant)", padding: "20px 24px" }}>
                  <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--on-surface)" }}>Yderligere faggrupper (valgfrit)</div>
                  <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>{statisticsProfile.professionTypes.filter(option => option.id !== formData.primary_profession_type_id).map(option => <label key={option.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" }}><input type="checkbox" checked={secondaryProfessionTypeIds.includes(option.id)} onChange={event => setSecondaryProfessionTypeIds(current => event.target.checked ? [...new Set([...current, option.id])] : current.filter(id => id !== option.id))} />{option.name}</label>)}</div>
                </div>}

                {statisticsProfile.config.usual_work_mode && <div style={{ backgroundColor: "var(--surface-container)", borderRadius: "var(--radius-md)", border: "1px solid var(--outline-variant)", padding: "20px 24px" }}>
                  <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--on-surface)" }}>Typisk arbejdsform (valgfrit)</div>
                  <select value={formData.usual_work_mode} onChange={event => handleField("usual_work_mode", event.target.value)} style={{ marginTop: "12px", width: "100%", maxWidth: "360px", padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--input)", backgroundColor: "var(--surface-container-lowest)", color: "var(--on-surface)" }}><option value="">Vælg arbejdsform</option><option value="employee">A-lønmodtager</option><option value="company">Gennem eget selskab</option><option value="both">Begge dele</option><option value="other">Andet</option><option value="prefer_not_to_say">Vil ikke oplyse</option></select>
                </div>}

                {statisticsProfile.config.primary_work_region && statisticsProfile.workRegions.length > 0 && <div style={{ backgroundColor: "var(--surface-container)", borderRadius: "var(--radius-md)", border: "1px solid var(--outline-variant)", padding: "20px 24px" }}>
                  <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--on-surface)" }}>Primært arbejdsområde (valgfrit)</div>
                  <select value={formData.primary_work_region_code} onChange={event => handleField("primary_work_region_code", event.target.value)} style={{ marginTop: "12px", width: "100%", maxWidth: "360px", padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--input)", backgroundColor: "var(--surface-container-lowest)", color: "var(--on-surface)" }}><option value="">Vælg område</option>{statisticsProfile.workRegions.map(option => <option key={option.code} value={option.code}>{locale === "en" ? option.nameEn : option.nameDa}</option>)}</select>
                </div>}
              </div>
            </div>
          )}

          {/* Trin 5: Bekræft */}
          {step === 6 && (
            <div style={{ padding: "40px" }}>
              <div style={{ textAlign: "center", marginBottom: "28px" }}>
                <div style={{ fontSize: "48px", marginBottom: "12px" }}>🎉</div>
                <h2 style={{ fontSize: "24px", fontWeight: 800, margin: "0 0 8px", color: "var(--on-surface)" }}>Du er klar!</h2>
                <p style={{ color: "var(--on-surface-variant)", fontSize: "15px", margin: 0 }}>
                  Dine oplysninger er gemt. Her er et overblik:
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "32px" }}>
                {[
                  { label: "Navn", value: fullNameValue },
                  { label: "E-mail", value: formData.email },
                  { label: "By", value: formData.city || "Ikke angivet" },
                  { label: "Køn (statistik)", value: formData.gender === "female" ? "Kvinde" : formData.gender === "male" ? "Mand" : formData.gender === "non_binary" ? "Andet / Non-binær" : "Ikke oplyst" },
                  { label: "CPR registreret", value: formData.cpr ? "✅ Ja" : "❌ Mangler" },
                  { label: "NemKonto", value: formData.bank_account ? "✅ Registreret" : "❌ Mangler" },
                  { label: "Lønstatistik", value: isOrganisationMember ? "✅ Deltager som medlem" : shareStatistics ? "✅ Deltager" : "❌ Deltager ikke" },
                  { label: "Rettighedstekster", value: legalAccepted ? "✅ Accepteret" : "❌ Mangler" },
                ].map((row) => (
                  <div key={row.label} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "12px 16px",
                    backgroundColor: "var(--surface-container-low)",
                    border: "1px solid var(--outline-variant)",
                    borderRadius: "var(--radius-default)", fontSize: "14px",
                  }}>
                    <span style={{ color: "var(--on-surface-variant)", fontWeight: 500 }}>{row.label}</span>
                    <span style={{ fontWeight: 600, color: "var(--on-surface)" }}>{row.value || "–"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Navigationsknapper */}
          <div style={{
            padding: "20px 40px",
            borderTop: "1px solid var(--outline-variant)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            backgroundColor: "var(--surface-container-low)",
          }}>
            <button
              onClick={() => setStep((s) => Math.max(firstStep, s - 1))}
              disabled={step === firstStep}
              style={{ padding: "10px 20px", fontSize: "14px", borderRadius: "6px", border: "1px solid var(--input)", backgroundColor: "transparent", color: "var(--foreground)", cursor: step === firstStep ? "default" : "pointer", opacity: step === firstStep ? 0.3 : 1, display: "flex", alignItems: "center", gap: "6px" }}
            >
              <ArrowLeft size={16} /> Tilbage
            </button>

            {step < steps.length ? (
              <button
                onClick={handleNextStep}
                disabled={isSearchingDfi || isImportingDfi || privacyStepBlocked}
                style={{ padding: "10px 24px", fontSize: "14px", borderRadius: "6px", border: "none", backgroundColor: "var(--foreground)", color: "var(--card)", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", opacity: isSearchingDfi || isImportingDfi || privacyStepBlocked ? 0.6 : 1 }}
              >
                Fortsæt <ArrowRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={isSaving}
                style={{ padding: "12px 28px", fontSize: "15px", borderRadius: "6px", border: "none", backgroundColor: "var(--foreground)", color: "var(--card)", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", opacity: isSaving ? 0.6 : 1 }}
              >
                {isSaving ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle size={16} />}
                {isSaving ? "Gemmer..." : "Kom i gang!"}
              </button>
            )}
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: "12px", color: "var(--on-surface-variant)" }}>
          Du kan altid ændre dine oplysninger under Min profil.
        </p>
      </div>
    </div>
  );
}
