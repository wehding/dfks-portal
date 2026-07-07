"use client";

import React, { useState } from "react";
import { completeOnboarding } from "@/app/actions/member-profile";
import { searchOnboardingCredits, importApprovedOnboardingWorks, type OnboardingCredit } from "@/app/actions/dfi";
import { useRouter } from "next/navigation";
import { CheckCircle, ArrowRight, ArrowLeft, Loader2, Search } from "lucide-react";

const STEPS = [
  { id: 1, title: "Velkommen", icon: "👋" },
  { id: 2, title: "Dine oplysninger", icon: "👤" },
  { id: 3, title: "Film & Serier", icon: "🎬" },
  { id: 4, title: "Privatliv & Data", icon: "🔒" },
  { id: 5, title: "Bekræft & Start", icon: "✅" },
];

export default function OnboardingClient({
  rh,
  user,
}: {
  rh: any;
  user: any;
}) {
  const router = useRouter();
  const loginEmail = user?.email || "";
  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [shareStatistics, setShareStatistics] = useState(true);

  // DFI & TMDB-tilstand
  const [dfiPersonId, setDfiPersonId] = useState<number | null>(null);
  const [tmdbPersonId, setTmdbPersonId] = useState<number | null>(null);
  const [dfiCredits, setDfiCredits] = useState<OnboardingCredit[]>([]);
  const [selectedDfiCredits, setSelectedDfiCredits] = useState<Record<string, boolean>>({});
  const [dfiSearchQuery, setDfiSearchQuery] = useState(rh?.full_name || "");
  const [isSearchingDfi, setIsSearchingDfi] = useState(false);
  const [dfiError, setDfiError] = useState<string | null>(null);
  const [isImportingDfi, setIsImportingDfi] = useState(false);

  // Import timer
  const [importSeconds, setImportSeconds] = useState(0);

  // Formulardata præ-udfyldt fra rettighedshaveren
  const existingName = rh?.full_name || "";
  const nameParts = existingName.split(" ");
  const [formData, setFormData] = useState({
    first_name: nameParts[0] || "",
    last_name: nameParts.slice(1).join(" ") || "",
    email: rh?.email || user?.email || "",
    phone: rh?.phone || "",
    address: rh?.address || "",
    zip: "",
    city: "",
    cpr: rh?.cpr_no || "",
    bank_account: rh?.bank_account || "",
    gender: rh?.gender || "ikke_oplyst",
  });

  const handleField = (field: string, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleComplete = async () => {
    setIsSaving(true);
    const payload = new FormData();
    Object.entries(formData).forEach(([k, v]) => payload.set(k, v));
    payload.set("opt_out_statistics", String(!shareStatistics));

    const result = await completeOnboarding(payload);
    if (result.success) {
      router.push("/portal/mine-vaerker");
      router.refresh();
    } else {
      alert(result.error || "Der opstod en fejl. Prøv igen.");
      setIsSaving(false);
    }
  };

  const handleManualDfiSearch = async () => {
    if (!dfiSearchQuery.trim()) return;
    setIsSearchingDfi(true);
    setDfiError(null);
    setDfiCredits([]);
    setDfiPersonId(null);
    setTmdbPersonId(null);
    try {
      const searchResult = await searchOnboardingCredits(undefined, undefined, dfiSearchQuery);
      if (searchResult.success && searchResult.credits?.length > 0) {
        setDfiPersonId(searchResult.dfiPersonId);
        setTmdbPersonId(searchResult.tmdbPersonId);
        setDfiCredits(searchResult.credits);
        const sel: Record<string, boolean> = {};
        searchResult.credits.forEach((c) => { sel[c.id] = true; });
        setSelectedDfiCredits(sel);
      } else {
        setDfiError(`Ingen film fundet for "${dfiSearchQuery}" i DFI eller TMDb.`);
      }
    } catch {
      setDfiError("Der opstod en fejl under søgningen.");
    } finally {
      setIsSearchingDfi(false);
    }
  };

  const handleNextStep = async () => {
    if (step === 2) {
      // Krav 1: Validering af fornavn, efternavn og e-mail
      if (!formData.first_name.trim() || !formData.last_name.trim() || !formData.email.trim()) {
        alert("Venligst udfyld fornavn, efternavn og e-mailadresse for at gå videre.");
        return;
      }

      setIsSearchingDfi(true);
      setDfiError(null);

      // Krav 1: Sæt det indtastede navn i søgefeltet som default
      const fullName = `${formData.first_name} ${formData.last_name}`.trim();
      setDfiSearchQuery(fullName);

      try {
        const searchResult = await searchOnboardingCredits(formData.first_name, formData.last_name);
        if (searchResult.success && searchResult.credits?.length > 0) {
          setDfiPersonId(searchResult.dfiPersonId);
          setTmdbPersonId(searchResult.tmdbPersonId);
          setDfiCredits(searchResult.credits);
          const sel: Record<string, boolean> = {};
          searchResult.credits.forEach((c) => { sel[c.id] = true; });
          setSelectedDfiCredits(sel);
        }
      } catch {
        setDfiError("Kunne ikke kontakte DFI Filmdatabasen.");
      } finally {
        setIsSearchingDfi(false);
        setStep(3);
      }
    } else if (step === 3) {
      const approved = dfiCredits.filter((c) => selectedDfiCredits[c.id]);
      if (approved.length > 0) {
        setIsImportingDfi(true);
        setImportSeconds(0);
        const timerInterval = setInterval(() => {
          setImportSeconds((s) => s + 1);
        }, 1000);
        try {
          await importApprovedOnboardingWorks(dfiPersonId, tmdbPersonId, approved);
        } catch { /* ignorer importfejl */ } finally {
          clearInterval(timerInterval);
          setIsImportingDfi(false);
          setStep(4);
        }
      } else {
        setStep(4);
      }
    } else {
      setStep((s) => s + 1);
    }
  };

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

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
          </div>

          <div style={{ padding: "20px", backgroundColor: "var(--surface-container-low)", borderRadius: "8px", border: "1px solid var(--outline-variant)" }}>
            <div style={{ fontSize: "32px", fontWeight: 800, color: "var(--primary)", fontFamily: "monospace" }}>
              {Math.floor(importSeconds / 60)}:{(importSeconds % 60).toString().padStart(2, '0')}
            </div>
            <div style={{ fontSize: "12px", color: "var(--on-surface-variant)", marginTop: "4px" }}>
              Tid gået
            </div>
          </div>

          {approvedCount >= 5 && (
            <p style={{ fontSize: "13px", color: "#B45309", fontWeight: 600, margin: 0, lineHeight: 1.6 }}>
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
      padding: "24px",
    }}>
      <div style={{ width: "100%", maxWidth: "640px", display: "flex", flexDirection: "column", gap: "24px" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "8px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="DFKS" style={{ height: "48px", objectFit: "contain" }} />
        </div>

        {/* Fremskridtsindikator */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
            {STEPS.map((s) => (
              <div key={s.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flex: 1 }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "16px",
                  backgroundColor: step > s.id ? "#374151" : step === s.id ? "#111827" : "#F3F4F6",
                  color: step >= s.id ? "#FFFFFF" : "#9CA3AF",
                  transition: "all 0.3s ease", fontWeight: 700,
                }}>
                  {step > s.id ? <CheckCircle size={18} color="white" /> : s.icon}
                </div>
                <div style={{ fontSize: "11px", fontWeight: 600, textAlign: "center", color: step === s.id ? "var(--on-surface)" : "var(--on-surface-variant)" }}>
                  {s.title}
                </div>
              </div>
            ))}
          </div>
          <div style={{ height: "4px", backgroundColor: "#E5E7EB", borderRadius: "2px", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, backgroundColor: "#111827", borderRadius: "2px", transition: "width 0.4s ease" }} />
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
            <div style={{ padding: "40px" }}>
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
                Det tager ca. 2 minutter.
              </p>
            </div>
          )}

          {/* Trin 2: Dine oplysninger */}
          {step === 2 && (
            <div style={{ padding: "40px" }}>
              <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 8px", color: "var(--on-surface)" }}>Dine oplysninger</h2>
              <p style={{ color: "var(--on-surface-variant)", fontSize: "14px", margin: "0 0 24px" }}>
                Kontrollér dine oplysninger. E-mailadressen er låst til den bruger, du er logget ind med.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                {[
                  { label: "Fornavn", key: "first_name", placeholder: "Dit fornavn" },
                  { label: "Efternavn", key: "last_name", placeholder: "Dit efternavn" },
                  { label: "Telefon", key: "phone", placeholder: "+45 12 34 56 78" },
                  { label: "Adresse", key: "address", placeholder: "Gadenavn 1", full: true },
                  { label: "Postnr.", key: "zip", placeholder: "1234" },
                  { label: "By", key: "city", placeholder: "København" },
                ].map((f: any) => (
                  <div key={f.key} style={{ gridColumn: f.full ? "1 / -1" : undefined }}>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px", color: "var(--on-surface-variant)" }}>
                      {f.label}
                    </label>
                    <input
                      value={(formData as any)[f.key]}
                      onChange={(e) => handleField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      style={{ width: "100%", padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #D1D5DB", outline: "none", color: "var(--on-surface)" }}
                    />
                  </div>
                ))}
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px", color: "var(--on-surface-variant)" }}>
                    E-mail
                  </label>
                  <input
                    value={formData.email}
                    onChange={(e) => handleField("email", e.target.value)}
                    placeholder="din.email@eksempel.dk"
                    style={{ width: "100%", padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #D1D5DB", outline: "none", color: "var(--on-surface)" }}
                  />
                </div>
              </div>

              <div style={{ marginTop: "24px", padding: "16px", backgroundColor: "#F9FAFB", borderRadius: "8px", border: "1px solid #E5E7EB" }}>
                <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "8px", color: "var(--on-surface)" }}>🏦 Bankoplysninger (til udbetaling)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  {[
                    { label: "CPR-nummer", key: "cpr", placeholder: "DDMMÅÅ-XXXX" },
                    { label: "NemKonto / Kontonr.", key: "bank_account", placeholder: "Reg.nr. + kontonr." },
                  ].map((f) => (
                    <div key={f.key}>
                      <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px", color: "var(--on-surface-variant)" }}>
                        {f.label}
                      </label>
                      <input
                        value={(formData as any)[f.key]}
                        onChange={(e) => handleField(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        style={{ width: "100%", padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #D1D5DB", outline: "none", backgroundColor: "#F9FAFB", color: "var(--on-surface)" }}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: "16px", display: "flex", gap: "10px", padding: "12px 14px", backgroundColor: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: "6px" }}>
                  <span style={{ fontSize: "16px" }}>🔒</span>
                  <p style={{ fontSize: "12px", color: "#065F46", margin: 0, lineHeight: 1.5 }}>
                    <strong>Sikkerhed & Kryptering:</strong> Dit CPR-nummer og kontonummer krypteres automatisk i din browser, før de sendes afsted, og opbevares i krypteret form i vores database. Al kommunikation og dataoverførsel sker over en fuldt krypteret og sikret forbindelse.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Trin 3: DFI & TMDB Værker */}
          {step === 3 && (
            <div style={{ padding: "40px" }}>
              <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 8px", color: "var(--on-surface)" }}>
                🎬 Dine film og serier i DFI & TMDb
              </h2>
              <p style={{ color: "var(--on-surface-variant)", fontSize: "14px", margin: "0 0 24px", lineHeight: 1.6 }}>
                Vi har slået dit navn op i DFI Filmdatabasen og TMDb. Bekræft de titler, du har medvirket til at skabe.
              </p>

              <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                <input
                  type="text"
                  placeholder="Søg under et andet navn..."
                  value={dfiSearchQuery}
                  onChange={(e) => setDfiSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleManualDfiSearch(); }}
                  style={{ flex: 1, padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #D1D5DB", outline: "none", color: "var(--on-surface)" }}
                />
                <button
                  onClick={handleManualDfiSearch}
                  disabled={isSearchingDfi}
                  style={{ padding: "10px 16px", display: "flex", gap: "6px", alignItems: "center", borderRadius: "6px", border: "1px solid #D1D5DB", backgroundColor: "transparent", color: "#374151", cursor: "pointer" }}
                >
                  {isSearchingDfi ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={16} />}
                  Søg
                </button>
              </div>

              {dfiError && (
                <div style={{ padding: "12px 16px", backgroundColor: "var(--error-container)", color: "var(--on-error-container)", borderRadius: "var(--radius-default)", border: "1px solid var(--error)", marginBottom: "20px", fontSize: "14px" }}>
                  {dfiError}
                </div>
              )}

              {isSearchingDfi ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "40px 0" }}>
                  <Loader2 size={36} style={{ animation: "spin 1s linear infinite", color: "var(--primary)" }} />
                  <div style={{ color: "var(--on-surface-variant)", fontSize: "14px" }}>Søger i DFI og TMDb...</div>
                </div>
              ) : dfiCredits.length > 0 ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--on-surface-variant)" }}>
                      Fundet {dfiCredits.length} titler
                    </div>
                    <button
                      onClick={() => {
                        const allSelected = Object.values(selectedDfiCredits).every((v) => v);
                        const next: Record<string, boolean> = {};
                        dfiCredits.forEach((c) => { next[c.id] = !allSelected; });
                        setSelectedDfiCredits(next);
                      }}
                      style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "4px", border: "1px solid #D1D5DB", backgroundColor: "transparent", color: "#374151", cursor: "pointer" }}
                    >
                      {Object.values(selectedDfiCredits).every((v) => v) ? "Fravælg alle" : "Vælg alle"}
                    </button>
                  </div>
                  <div style={{
                    maxHeight: "350px", overflowY: "auto",
                    border: "2px solid #9CA3AF",
                    borderRadius: "8px",
                    backgroundColor: "var(--surface-container-low)",
                    display: "flex", flexDirection: "column",
                    boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.05)",
                  }}>
                    {dfiCredits.map((c, i) => (
                      <label key={`${c.id}-${i}`} style={{
                        display: "flex", alignItems: "flex-start", gap: "12px",
                        padding: "14px 16px",
                        borderBottom: i === dfiCredits.length - 1 ? "none" : "1px solid #D1D5DB",
                        cursor: "pointer",
                        backgroundColor: selectedDfiCredits[c.id] ? "var(--surface-container-high)" : "transparent",
                        userSelect: "none",
                        transition: "background-color 0.2s ease",
                      }}>
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
                          <div style={{ fontSize: "12px", color: "var(--on-surface-variant)", display: "flex", gap: "8px" }}>
                            <span style={{ fontWeight: 500, color: "var(--tertiary)" }}>{c.role}</span>
                            <span>•</span>
                            <span>{c.category}</span>
                          </div>
                        </div>
                      </label>
                    ))}
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
          {step === 4 && (
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
                        style={{ width: "100%", maxWidth: "240px", padding: "10px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #D1D5DB", backgroundColor: "var(--surface-container-lowest)", color: "var(--on-surface)", outline: "none" }}
                      >
                        <option value="ikke_oplyst">Vil ikke oplyse</option>
                        <option value="kvinde">Kvinde</option>
                        <option value="mand">Mand</option>
                        <option value="andet">Andet / Non-binær</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Trin 5: Bekræft */}
          {step === 5 && (
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
                  { label: "Køn (statistik)", value: formData.gender === "kvinde" ? "Kvinde" : formData.gender === "mand" ? "Mand" : formData.gender === "andet" ? "Andet / Non-binær" : "Ikke oplyst" },
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
              style={{ padding: "10px 20px", fontSize: "14px", borderRadius: "6px", border: "1px solid #D1D5DB", backgroundColor: "transparent", color: "#374151", cursor: step === 1 ? "default" : "pointer", opacity: step === 1 ? 0.3 : 1, display: "flex", alignItems: "center", gap: "6px" }}
            >
              <ArrowLeft size={16} /> Tilbage
            </button>

            {step < STEPS.length ? (
              <button
                onClick={handleNextStep}
                disabled={isSearchingDfi || isImportingDfi}
                style={{ padding: "10px 24px", fontSize: "14px", borderRadius: "6px", border: "none", backgroundColor: "#111827", color: "#FFFFFF", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", opacity: isSearchingDfi || isImportingDfi ? 0.6 : 1 }}
              >
                Fortsæt <ArrowRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={isSaving}
                style={{ padding: "12px 28px", fontSize: "15px", borderRadius: "6px", border: "none", backgroundColor: "#111827", color: "#FFFFFF", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", opacity: isSaving ? 0.6 : 1 }}
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
