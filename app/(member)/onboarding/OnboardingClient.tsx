"use client";

import React, { useState } from "react";
import { completeOnboarding } from "@/app/actions/member-profile";
import { searchOnboardingCredits, importApprovedOnboardingWorks, resolveOnboardingEpisodeOptions, type OnboardingCredit } from "@/app/actions/dfi";
import { useRouter } from "next/navigation";
import { CheckCircle, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { confirmExternalPersonIdentity, discoverPersonCandidates, type PersonCandidate } from "@/app/actions/person-discovery";
import { PersonIdentityPicker } from "@/components/works/person-identity-picker";
import { SeriesEpisodeSelector } from "@/components/works/series-episode-selector";
import { buildCompleteEpisodeOptions } from "@/lib/series-episodes";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { validateOnboardingField, type OnboardingField } from "@/lib/onboarding-validation";

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
};

type OnboardingUser = {
  email?: string | null;
};

type FormKey = "first_name" | "last_name" | "email" | "phone" | "address" | "zip" | "city" | "cpr" | "bank_account" | "gender";

type FormField = {
  label: string;
  key: FormKey;
  placeholder: string;
  full?: boolean;
};

export default function OnboardingClient({
  rh,
  user,
}: {
  rh: OnboardingProfile | null;
  user: OnboardingUser | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const steps = [
    { id: 1, title: t("onboarding.stepWelcome"), icon: "👋" },
    { id: 2, title: t("onboarding.stepInfo"), icon: "👤" },
    { id: 3, title: t("onboarding.stepName"), icon: "🔎" },
    { id: 4, title: t("onboarding.stepWorks"), icon: "🎬" },
    { id: 5, title: t("onboarding.stepPrivacy"), icon: "🔒" },
    { id: 6, title: t("onboarding.stepConfirm"), icon: "✅" },
  ];
  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [shareStatistics, setShareStatistics] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<OnboardingField, string>>>({});

  // DFI & TMDB-tilstand
  const [dfiPersonId, setDfiPersonId] = useState<number | null>(null);
  const [tmdbPersonId, setTmdbPersonId] = useState<number | null>(null);
  const [dfiCredits, setDfiCredits] = useState<OnboardingCredit[]>([]);
  const [selectedDfiCredits, setSelectedDfiCredits] = useState<Record<string, boolean>>({});
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});
  const [seriesSeasons, setSeriesSeasons] = useState<Record<string, number>>({});
  const [seriesEpisodes, setSeriesEpisodes] = useState<Record<string, number[]>>({});
  const [episodeOptions, setEpisodeOptions] = useState<Record<string, Array<{ number: number; title?: string | null }>>>({});
  const [episodeLoading, setEpisodeLoading] = useState<Record<string, boolean>>({});
  const [episodeErrors, setEpisodeErrors] = useState<Record<string, string | null>>({});
  const [dfiSearchQuery, setDfiSearchQuery] = useState(rh?.full_name || "");
  const [isSearchingDfi, setIsSearchingDfi] = useState(false);
  const [isImportingDfi, setIsImportingDfi] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [personCandidates, setPersonCandidates] = useState<PersonCandidate[]>([]);
  const [selectedPersonCandidates, setSelectedPersonCandidates] = useState<Record<string, boolean>>({});
  const [personSearchError, setPersonSearchError] = useState<string | null>(null);
  const [personSourceErrors, setPersonSourceErrors] = useState<{ dfi?: boolean; tmdb?: boolean; wikidata?: boolean }>({});
  const [alternativeNames, setAlternativeNames] = useState<string[]>(rh?.alternative_names ?? []);
  const [newAlternativeName, setNewAlternativeName] = useState("");
  const [selectedPortraitUrl, setSelectedPortraitUrl] = useState<string | null>(null);
  const isOrganisationMember = Boolean(rh?.is_member);

  // Import-fremdrift
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; title: string } | null>(null);

  // Formulardata præ-udfyldt fra rettighedshaveren
  const existingName = rh?.full_name || "";
  const nameParts = existingName.split(" ");
  const parsedInitialAddress = parseAddress(rh?.address || "");
  const [formData, setFormData] = useState({
    first_name: nameParts[0] || "",
    last_name: nameParts.slice(1).join(" ") || "",
    email: user?.email || rh?.email || "",
    phone: rh?.phone || "",
    address: parsedInitialAddress.street,
    zip: parsedInitialAddress.postalCode,
    city: parsedInitialAddress.city,
    cpr: rh?.cpr_no || "",
    bank_account: rh?.bank_account || "",
    gender: rh?.gender || "prefer_not_to_say",
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

  // Ét samlet "Dit navn"-felt: gem hele navnet, men bevar for-/efternavn i datamodellen
  // ved at splitte ved sidste mellemrum (sidste ord = efternavn, resten = fornavn).
  const fullNameValue = `${formData.first_name} ${formData.last_name}`.trim();
  const handleFullName = (value: string) => {
    const parts = value.trim().split(/\s+/);
    const last = parts.length > 1 ? parts.pop()! : "";
    const first = parts.join(" ");
    setFormData((prev) => ({ ...prev, first_name: value.trim() ? first || value.trim() : "", last_name: last }));
    setFieldErrors(current => ({ ...current, name: undefined }));
  };

  const isSeriesCredit = (credit: OnboardingCredit) => {
    const category = `${credit.category} ${credit.raw?.media_type ?? ""} ${credit.raw?.type ?? ""}`.toLowerCase();
    return category.includes("serie") || category.includes("tv");
  };

  const episodeCountForCredit = (credit: OnboardingCredit) => {
    const rawCount = credit.raw?.number_of_episodes ?? credit.raw?.episode_count ?? credit.raw?.EpisodeCount;
    const parsed = Number(rawCount);
    const optionsCount = Math.max(episodeOptions[credit.id]?.length ?? 0, credit.episode_options?.length ?? 0);
    const count = Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : 0, optionsCount);
    return count > 0 ? Math.min(count, 80) : 0;
  };

  const selectedEpisodesForCredit = (credit: OnboardingCredit) => {
    const season = seriesSeasons[credit.id] ?? 1;
    // Ved sæson > 1 er kun de sæson-specifikt hentede afsnit gyldige — pad aldrig med seriens total.
    const options = season > 1
      ? episodeOptions[credit.id] ?? []
      : buildCompleteEpisodeOptions({
          episodeCount: episodeCountForCredit(credit),
          externalOptions: episodeOptions[credit.id] ?? credit.episode_options ?? [],
          localChildren: Array.isArray(credit.raw?.__local_children) ? credit.raw.__local_children : [],
          seasonNumber: 1,
        });
    return seriesEpisodes[credit.id] ?? options.map(option => option.number);
  };

  const loadEpisodes = async (credit: OnboardingCredit, season = seriesSeasons[credit.id] ?? 1) => {
    setEpisodeLoading(prev => ({ ...prev, [credit.id]: true }));
    setEpisodeErrors(prev => ({ ...prev, [credit.id]: null }));
    const result = await resolveOnboardingEpisodeOptions(credit, season);
    if (result.success) {
      setEpisodeOptions(prev => ({ ...prev, [credit.id]: result.options }));
      setSeriesEpisodes(prev => ({ ...prev, [credit.id]: result.options.map(option => option.number) }));
    } else {
      // Ryd stale afsnit fra en tidligere sæson, så fejlen ikke kan blandes med gamle valg.
      setEpisodeOptions(prev => ({ ...prev, [credit.id]: [] }));
      setSeriesEpisodes(prev => ({ ...prev, [credit.id]: [] }));
      setEpisodeErrors(prev => ({ ...prev, [credit.id]: result.error }));
    }
    setEpisodeLoading(prev => ({ ...prev, [credit.id]: false }));
  };

  const revealCreditsProgressively = async (credits: OnboardingCredit[]) => {
    setDfiCredits([]);
    const delay = credits.length > 25 ? 25 : 65;
    for (let index = 0; index < credits.length; index += 1) {
      setDfiCredits(credits.slice(0, index + 1));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  };

  const handleComplete = async () => {
    setIsSaving(true);
    const payload = new FormData();
    Object.entries(formData).forEach(([k, v]) => payload.set(k, v));
    payload.set("opt_out_statistics", String(!shareStatistics));

    const result = await completeOnboarding(payload);
    if (result.success) {
      router.push("/portal");
      router.refresh();
    } else {
      toast.error(result.error || "Der opstod en fejl. Prøv igen.");
      setIsSaving(false);
    }
  };

  const handlePersonSearch = async (query = dfiSearchQuery, merge = false) => {
    if (!query.trim()) return;
    setIsSearchingDfi(true);
    setPersonSearchError(null);
    try {
      const result = await discoverPersonCandidates(query.trim());
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
    if (!value || alternativeNames.some(name => name.localeCompare(value, "da-DK", { sensitivity: "base" }) === 0)) return;
    setAlternativeNames(current => [...current, value]);
    setNewAlternativeName("");
    await handlePersonSearch(value, true);
  };

  const handleNextStep = async () => {
    if (step === 2) {
      // Krav 1: Validering af navn og e-mail (navnet er nu ét samlet felt)
      const fullName = `${formData.first_name} ${formData.last_name}`.trim();
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
        const confirmation = await confirmExternalPersonIdentity(selected, dfiSearchQuery, alternativeNames, isOrganisationMember ? selectedPortraitUrl : null);
        if (!confirmation.success) {
          setPersonSearchError(confirmation.error ?? "Personmatch kunne ikke gemmes.");
          return;
        }
        const searchResult = await searchOnboardingCredits(undefined, undefined, dfiSearchQuery);
        if (searchResult.success && searchResult.credits?.length > 0) {
          setDfiPersonId(searchResult.dfiPersonId);
          setTmdbPersonId(searchResult.tmdbPersonId);
          const selectedCredits: Record<string, boolean> = {};
          searchResult.credits.forEach(credit => { selectedCredits[credit.id] = true; });
          setSelectedDfiCredits(selectedCredits);
          await revealCreditsProgressively(searchResult.credits);
        }
        setStep(4);
      } finally {
        setIsSearchingDfi(false);
      }
    } else if (step === 4) {
      const approved = dfiCredits
        .filter((c) => selectedDfiCredits[c.id])
        .map((c) => isSeriesCredit(c)
          ? { ...c, season_number: seriesSeasons[c.id] ?? 1, selected_episodes: selectedEpisodesForCredit(c) }
          : c
        );
      const missingSeriesEpisodes = approved.some((c) => isSeriesCredit(c) && (!c.selected_episodes || c.selected_episodes.length === 0));
      if (missingSeriesEpisodes) {
        setImportError("Vælg mindst ét afsnit for hver serie, du vil importere.");
        return;
      }
      if (approved.length > 0) {
        setIsImportingDfi(true);
        setImportError(null);
        try {
          // Importér én titel ad gangen, så brugeren kan se hvad der aktuelt hentes.
          // Serverens upserts er idempotente, så del-import er sikker.
          const collectedErrors: string[] = [];
          let anySuccess = false;
          for (let index = 0; index < approved.length; index++) {
            const credit = approved[index];
            setImportProgress({ current: index + 1, total: approved.length, title: credit.title });
            const result = await importApprovedOnboardingWorks(dfiPersonId, tmdbPersonId, [credit]);
            if (!result.success) {
              collectedErrors.push(result.error ?? `${credit.title}: import fejlede.`);
            } else {
              anySuccess = true;
              if (result.errors?.length) collectedErrors.push(...result.errors);
            }
          }
          if (!anySuccess) {
            setImportError(collectedErrors.join("\n") || "Værkerne kunne ikke importeres. Prøv igen.");
            return;
          }
          if (collectedErrors.length) setImportError(`Nogle værker mangler data: ${collectedErrors.join(" ")}`);
          setStep(5);
        } catch (error: unknown) {
          setImportError(error instanceof Error ? error.message : "Værkerne kunne ikke importeres. Prøv igen.");
        } finally {
          setImportProgress(null);
          setIsImportingDfi(false);
        }
      } else {
        setStep(5);
      }
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
                  Velkommen til DFKS Rettighedssystem
                </h1>
                <p style={{ color: "var(--on-surface-variant)", fontSize: "16px", lineHeight: 1.7, margin: 0 }}>
                  Vi hjælper dig igennem a kort opsætning, så du er klar til at administrere
                  dine rettigheder, kontrakter og udbetalinger.
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
                {/* Ét samlet navnefelt (fuld bredde) med fælles hjælpetekst */}
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px", color: "var(--on-surface-variant)" }}>
                    {t("onboarding.yourName")}
                  </label>
                  <input
                    className="focus-visible:ring-2 focus-visible:ring-ring"
                    value={fullNameValue}
                    onChange={(e) => handleFullName(e.target.value)}
                    onBlur={() => validateField("name", fullNameValue)}
                    placeholder={t("onboarding.fullNamePlaceholder")}
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={fieldErrors.name ? "onboarding-name-error" : undefined}
                    style={{ width: "100%", padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: `1px solid ${fieldErrors.name ? "var(--destructive)" : "var(--input)"}`, outline: "none", color: "var(--on-surface)" }}
                  />
                  {fieldErrors.name && <p id="onboarding-name-error" role="alert" style={{ margin: "6px 0 0", color: "var(--destructive)", fontSize: "12px" }}>{fieldErrors.name}</p>}
                </div>
                <div style={{ gridColumn: "1 / -1", marginTop: "-8px", color: "var(--on-surface-variant)", fontSize: "13px", lineHeight: 1.5 }}>
                  {t("onboarding.nameHint")}
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
                  <button type="button" onClick={() => void addAlternativeName()} disabled={!newAlternativeName.trim() || isSearchingDfi} style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--input)", background: "var(--card)", cursor: "pointer", color: "var(--foreground)" }}>{t("onboarding.addVariant")}</button>
                </div>
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
                        onClick={() => setSelectedPortraitUrl(url)}
                        style={{ display: "flex", alignItems: "center", gap: "8px", border: selectedPortraitUrl === url ? "2px solid var(--foreground)" : "1px solid var(--input)", borderRadius: "8px", padding: "6px 8px", background: "var(--card)", cursor: "pointer", color: "var(--foreground)" }}
                      >
                        <img src={url} alt="" style={{ width: "36px", height: "44px", borderRadius: "6px", objectFit: "cover" }} />
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>{candidate.source.toUpperCase()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <PersonIdentityPicker candidates={personCandidates} selected={selectedPersonCandidates} loading={isSearchingDfi} error={personSearchError} sourceErrors={personSourceErrors} onSelect={candidate => { setSelectedPersonCandidates(current => ({ ...current, [candidate.key]: !current[candidate.key] })); setPersonSearchError(null); }} />
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
              <div style={{ marginBottom: "20px", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--accent)", color: "var(--accent-foreground)", fontSize: "13px", lineHeight: 1.55 }}>For tv- og dokumentarserier skal du vælge de specifikke afsnit, som du har været med til at skabe. Åbn “Vælg afsnit” under serien, og markér afsnittene.</div>
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
                      const episodeCount = episodeCountForCredit(c);
                      const selectedEpisodes = selectedEpisodesForCredit(c);
                      return (
                        <div key={`${c.id}-${i}`} style={{
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
                              </div>
                            </div>
                          </label>
                          {isSeries && selectedDfiCredits[c.id] && (
                            <div style={{ marginTop: "12px", marginLeft: "28px", padding: "12px", border: "1px solid var(--input)", borderRadius: "6px", backgroundColor: "var(--card)" }}>
                              <button
                                type="button"
                                onClick={() => { const opening = !expandedSeries[c.id]; setExpandedSeries(prev => ({ ...prev, [c.id]: opening })); if (opening && !(episodeOptions[c.id]?.length)) void loadEpisodes(c); }}
                                style={{ border: "none", background: "transparent", padding: 0, fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "var(--foreground)" }}
                              >
                                {expandedSeries[c.id] ? "Skjul afsnit" : "Vælg afsnit"} · {selectedEpisodes.length} valgt
                              </button>
                              {expandedSeries[c.id] && (
                                <div style={{ marginTop: "10px" }}>
                                  <SeriesEpisodeSelector
                                    season={seriesSeasons[c.id] ?? 1}
                                    onSeasonChange={season => { setSeriesSeasons(prev => ({ ...prev, [c.id]: season })); void loadEpisodes(c, season); }}
                                    options={(seriesSeasons[c.id] ?? 1) > 1
                                      ? buildCompleteEpisodeOptions({ externalOptions: episodeOptions[c.id] ?? [], seasonNumber: seriesSeasons[c.id] ?? 1 })
                                      : buildCompleteEpisodeOptions({
                                          episodeCount,
                                          externalOptions: episodeOptions[c.id]?.length ? episodeOptions[c.id] : c.episode_options ?? [],
                                          localChildren: Array.isArray(c.raw?.__local_children) ? c.raw.__local_children : [],
                                          seasonNumber: 1,
                                        })}
                                    selected={selectedEpisodes}
                                    onSelectedChange={episodes => setSeriesEpisodes(prev => ({ ...prev, [c.id]: episodes }))}
                                    loading={Boolean(episodeLoading[c.id])}
                                    error={episodeErrors[c.id]}
                                    label="Vælg afsnit"
                                  />
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
                    Vi kunne ikke finde dig i DFI eller TMDb under navnet <strong>{formData.first_name} {formData.last_name}</strong>.
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
                Bestem, hvordan vi må bruge dine oplysninger.
              </p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {/* Lønstatistik Checkbox */}
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
                  <label style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "16px 24px", cursor: "pointer",
                    backgroundColor: "var(--surface-container-low)",
                    borderTop: "1px solid var(--outline-variant)",
                  }}>
                    <input
                      type="checkbox"
                      checked={shareStatistics}
                      onChange={(e) => setShareStatistics(e.target.checked)}
                      style={{ width: "18px", height: "18px", accentColor: "var(--primary)" }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--on-surface)" }}>
                        Jeg bidrager til fælles lønstatistik
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                        Mine løndata indgår anonymiseret og aggregeret i branchestatistikken.
                      </div>
                    </div>
                  </label>
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
                  { label: "Navn", value: `${formData.first_name} ${formData.last_name}`.trim() },
                  { label: "E-mail", value: formData.email },
                  { label: "By", value: formData.city || "Ikke angivet" },
                  { label: "Køn (statistik)", value: formData.gender === "female" ? "Kvinde" : formData.gender === "male" ? "Mand" : formData.gender === "non_binary" ? "Andet / Non-binær" : "Ikke oplyst" },
                  { label: "CPR registreret", value: formData.cpr ? "✅ Ja" : "❌ Mangler" },
                  { label: "NemKonto", value: formData.bank_account ? "✅ Registreret" : "❌ Mangler" },
                  { label: "Lønstatistik", value: shareStatistics ? "✅ Deltager" : "❌ Deltager ikke" },
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
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              style={{ padding: "10px 20px", fontSize: "14px", borderRadius: "6px", border: "1px solid var(--input)", backgroundColor: "transparent", color: "var(--foreground)", cursor: step === 1 ? "default" : "pointer", opacity: step === 1 ? 0.3 : 1, display: "flex", alignItems: "center", gap: "6px" }}
            >
              <ArrowLeft size={16} /> Tilbage
            </button>

            {step < steps.length ? (
              <button
                onClick={handleNextStep}
                disabled={isSearchingDfi || isImportingDfi}
                style={{ padding: "10px 24px", fontSize: "14px", borderRadius: "6px", border: "none", backgroundColor: "var(--foreground)", color: "var(--card)", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", opacity: isSearchingDfi || isImportingDfi ? 0.6 : 1 }}
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

function parseAddress(value: string) {
  const parts = value.split(",").map(part => part.trim()).filter(Boolean);
  const street = parts[0] ?? "";
  const rest = parts.slice(1).join(" ");
  const match = rest.match(/^(\d{4})\s+(.+)$/);
  return {
    street,
    postalCode: match?.[1] ?? "",
    city: match?.[2] ?? rest,
  };
}
