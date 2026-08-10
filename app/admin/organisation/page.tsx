"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertCircle, Building2, CheckCircle2, Copy, ImageIcon, Loader2, Plus, Save, Trash2, Upload, Wifi } from "lucide-react";
import { getOrganisationSettings, removeOrganisationLogo, testOrganisationForeningLetConnection, updateOrganisationSettings, uploadOrganisationLogo } from "@/app/actions/organisation-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ImportConnectionsSettings } from "@/components/admin/import-connections-settings";

type FormState = {
  org_id: string;
  short_name: string;
  long_name: string;
  logo_url: string;
  primary_color: string;
  from_email: string;
  invite_email_text: string;
  invite_reminder_text: string;
  welcome_message_text: string;
  coeditor_word: string;
  role_labels: string[];
  producer_categories: string[];
  statistics_contract_scope: "validated_only" | "validated_and_drafts";
  statistics_profile_config: {
    professional_start_year: boolean;
    primary_profession_type: boolean;
    secondary_profession_types: boolean;
    usual_work_mode: boolean;
    primary_work_region: boolean;
  };
  statistics_work_regions: string[];
  onboarding_keywords: string[];
  contract_review_retention_months: number;
  foreninglet_base_url: string;
  foreninglet_username: string;
  foreninglet_password: string;
  foreninglet_enabled: boolean;
  foreninglet_has_credentials: boolean;
  foreninglet_has_username: boolean;
  foreninglet_has_password: boolean;
  foreninglet_credential_source: "organisation" | "missing";
};

const emptyForm: FormState = {
  org_id: "",
  short_name: "",
  long_name: "",
  logo_url: "",
  primary_color: "#111827",
  from_email: "",
  invite_email_text: "",
  invite_reminder_text: "",
  welcome_message_text: "",
  coeditor_word: "medskaber",
  role_labels: ["Medskaber"],
  producer_categories: [],
  statistics_contract_scope: "validated_only",
  statistics_profile_config: { professional_start_year: true, primary_profession_type: false, secondary_profession_types: false, usual_work_mode: false, primary_work_region: false },
  statistics_work_regions: [],
  onboarding_keywords: ["klip", "edit"],
  contract_review_retention_months: 24,
  foreninglet_base_url: "https://foreninglet.dk/api/members",
  foreninglet_username: "",
  foreninglet_password: "",
  foreninglet_enabled: true,
  foreninglet_has_credentials: false,
  foreninglet_has_username: false,
  foreninglet_has_password: false,
  foreninglet_credential_source: "missing",
};

export default function OrganisationSettingsPage() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [logoPending, setLogoPending] = useState(false);
  const [connectionPending, setConnectionPending] = useState(false);
  const [loginUrl, setLoginUrl] = useState("");

  useEffect(() => {
    let active = true;
    void getOrganisationSettings()
      .then(settings => {
        if (!active) return;
        setForm({
          org_id: settings.id,
          short_name: settings.short_name,
          long_name: settings.long_name,
          logo_url: settings.logo_url ?? "",
          primary_color: settings.primary_color,
          from_email: settings.from_email ?? "",
          invite_email_text: settings.invite_email_text ?? "",
          invite_reminder_text: settings.invite_reminder_text ?? "",
          welcome_message_text: settings.welcome_message_text ?? "",
          coeditor_word: settings.coeditor_word,
          role_labels: settings.role_labels,
          producer_categories: settings.producer_categories,
          statistics_contract_scope: settings.statistics_contract_scope,
          statistics_profile_config: settings.statistics_profile_config,
          statistics_work_regions: settings.statistics_work_regions,
          onboarding_keywords: settings.onboarding_keywords,
          contract_review_retention_months: settings.contract_review_retention_months,
          foreninglet_base_url: settings.foreninglet.base_url,
          foreninglet_username: "",
          foreninglet_password: "",
          foreninglet_enabled: settings.foreninglet.enabled,
          foreninglet_has_credentials: settings.foreninglet.has_credentials,
          foreninglet_has_username: settings.foreninglet.has_username,
          foreninglet_has_password: settings.foreninglet.has_password,
          foreninglet_credential_source: settings.foreninglet.credential_source,
        });
        setLoginUrl(`${window.location.origin}/?org=${settings.id}`);
      })
      .catch(error => toast.error(error instanceof Error ? error.message : "Kunne ikke hente organisationen."))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const canSave = useMemo(() => {
    return form.short_name.trim() && form.long_name.trim() && form.coeditor_word.trim() && form.role_labels.some(role => role.trim());
  }, [form]);

  function updateRole(index: number, value: string) {
    setForm(current => ({
      ...current,
      role_labels: current.role_labels.map((role, roleIndex) => roleIndex === index ? value : role),
    }));
  }

  function removeRole(index: number) {
    setForm(current => ({
      ...current,
      role_labels: current.role_labels.filter((_, roleIndex) => roleIndex !== index),
    }));
  }

  function updateKeyword(index: number, value: string) {
    setForm(current => ({
      ...current,
      onboarding_keywords: current.onboarding_keywords.map((keyword, keywordIndex) => keywordIndex === index ? value : keyword),
    }));
  }

  function removeKeyword(index: number) {
    setForm(current => ({
      ...current,
      onboarding_keywords: current.onboarding_keywords.filter((_, keywordIndex) => keywordIndex !== index),
    }));
  }

  function handleSave() {
    if (!canSave) {
      toast.error("Udfyld navn, fagord og mindst én rolle.");
      return;
    }

    startTransition(async () => {
      try {
        await updateOrganisationSettings({
          short_name: form.short_name,
          long_name: form.long_name,
          logo_url: form.logo_url || null,
          primary_color: form.primary_color,
          from_email: form.from_email || null,
          invite_email_text: form.invite_email_text || null,
          invite_reminder_text: form.invite_reminder_text || null,
          welcome_message_text: form.welcome_message_text || null,
          coeditor_word: form.coeditor_word,
          role_labels: form.role_labels,
          producer_categories: form.producer_categories,
          statistics_contract_scope: form.statistics_contract_scope,
          statistics_profile_config: form.statistics_profile_config,
          statistics_work_regions: form.statistics_work_regions,
          onboarding_keywords: form.onboarding_keywords,
          contract_review_retention_months: form.contract_review_retention_months,
          foreninglet_base_url: form.foreninglet_base_url || null,
          foreninglet_username: form.foreninglet_username || null,
          foreninglet_password: form.foreninglet_password || null,
          foreninglet_enabled: form.foreninglet_enabled,
        });
        const settings = await getOrganisationSettings();
        setForm(current => ({
          ...current,
          foreninglet_username: "",
          foreninglet_password: "",
          foreninglet_has_credentials: settings.foreninglet.has_credentials,
          foreninglet_has_username: settings.foreninglet.has_username,
          foreninglet_has_password: settings.foreninglet.has_password,
          foreninglet_credential_source: settings.foreninglet.credential_source,
        }));
        toast.success("Organisationsindstillinger gemt");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Kunne ikke gemme organisationen.");
      }
    });
  }

  async function handleLogoUpload(file: File | undefined) {
    if (!file) return;
    setLogoPending(true);
    try {
      const data = new FormData();
      data.set("logo", file);
      const result = await uploadOrganisationLogo(data);
      setForm(current => ({ ...current, logo_url: result.logo_url }));
      toast.success("Logo uploadet");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke uploade logoet.");
    } finally {
      setLogoPending(false);
    }
  }

  async function handleLogoRemove() {
    setLogoPending(true);
    try {
      await removeOrganisationLogo();
      setForm(current => ({ ...current, logo_url: "" }));
      toast.success("Logo fjernet");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke fjerne logoet.");
    } finally {
      setLogoPending(false);
    }
  }

  async function handleConnectionTest() {
    setConnectionPending(true);
    try {
      const result = await testOrganisationForeningLetConnection();
      toast.success(`Forbindelsen virker. ${result.count} medlemmer fundet.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Forbindelsen kunne ikke oprettes.");
    } finally {
      setConnectionPending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Henter organisationsindstillinger...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            Opsætning
          </div>
          <h1 className="text-2xl font-semibold">Opsætning</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tilpas navn, logo, afsender-mail og de fagord organisationens brugere ser i portalen.
          </p>
        </div>
        <Button className="w-full sm:w-auto" onClick={handleSave} disabled={isPending || !canSave}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Gem ændringer
        </Button>
      </div>

      <ImportConnectionsSettings />

      <section className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold">Branding</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bruges i menu, portal og invitationsmails.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Kort navn</Label>
            <Input value={form.short_name} onChange={event => setForm(f => ({ ...f, short_name: event.target.value }))} placeholder="Kort navn" />
          </div>
          <div className="space-y-2">
            <Label>Fuldt navn</Label>
            <Input value={form.long_name} onChange={event => setForm(f => ({ ...f, long_name: event.target.value }))} placeholder="Organisationens fulde navn" />
          </div>
          <div className="space-y-3 sm:col-span-2">
            <Label>Organisationens logo</Label>
            <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center">
              <div className="flex h-20 w-full items-center justify-center bg-muted/30 sm:w-44">
                {form.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logo_url} alt={form.short_name || "Organisationens logo"} className="max-h-16 max-w-[156px] object-contain" />
                ) : (
                  <ImageIcon className="h-7 w-7 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" asChild disabled={logoPending}>
                  <label className="cursor-pointer">
                    {logoPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    {form.logo_url ? "Udskift logo" : "Upload logo"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      disabled={logoPending}
                      onChange={event => void handleLogoUpload(event.target.files?.[0])}
                    />
                  </label>
                </Button>
                {form.logo_url && (
                  <Button type="button" variant="outline" onClick={() => void handleLogoRemove()} disabled={logoPending}>
                    <Trash2 className="mr-2 h-4 w-4" />Fjern
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG eller WebP. Højst 2 MB.</p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Organisationsspecifikt loginlink</Label>
            <div className="flex gap-2">
              <Input value={loginUrl} readOnly />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Kopiér loginlink"
                onClick={() => {
                  void navigator.clipboard.writeText(loginUrl);
                  toast.success("Loginlink kopieret");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Primær farve</Label>
            <div className="flex gap-2">
              <Input value={form.primary_color} onChange={event => setForm(f => ({ ...f, primary_color: event.target.value }))} placeholder="#111827" />
              <input
                aria-label="Vælg primær farve"
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(form.primary_color) ? form.primary_color : "#111827"}
                onChange={event => setForm(f => ({ ...f, primary_color: event.target.value }))}
                className="h-10 w-12 rounded-md border bg-background"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold">Opbevaring af kontraktgennemgange</h2>
        <p className="mt-1 text-sm text-muted-foreground">Afsluttede gennemgange soft-slettes først. Originalfil, mailreference og afledte AI-data slettes efter perioden. Juridisk hold stopper automatisk sletning.</p>
        <div className="mt-4 max-w-xs space-y-2">
          <Label htmlFor="review-retention">Opbevaringsperiode i måneder</Label>
          <Input id="review-retention" type="number" min={1} max={120} value={form.contract_review_retention_months} onChange={event => setForm(current => ({ ...current, contract_review_retention_months: Number(event.target.value) }))} />
          <p className="text-xs text-muted-foreground">Standard er 24 måneder. Tilladte værdier er 1–120 måneder. Lange perioder øger mængden af persondata, organisationen opbevarer.</p>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold">Statistikgrundlag</h2>
        <p className="mt-1 text-sm text-muted-foreground">Vælg om kladder må indgå. Kladder kan indeholde ufuldstændige eller endnu ikke kontrollerede data.</p>
        <div className="mt-4 max-w-md space-y-2">
          <Label htmlFor="statistics-contract-scope">Kontrakter i statistik</Label>
          <select
            id="statistics-contract-scope"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={form.statistics_contract_scope}
            onChange={event => setForm(current => ({ ...current, statistics_contract_scope: event.target.value as FormState["statistics_contract_scope"] }))}
          >
            <option value="validated_only">Kun validerede kontrakter</option>
            <option value="validated_and_drafts">Validerede kontrakter og kladder</option>
          </select>
        </div>
        <div className="mt-6 space-y-3 border-t pt-5">
          <div>
            <h3 className="text-sm font-semibold">Statistikprofil i onboarding og Min profil</h3>
            <p className="text-xs text-muted-foreground">Aktivér kun spørgsmål, der giver mening for organisationens fagområde. Alle statistikspørgsmål er frivillige.</p>
          </div>
          {([
            ["professional_start_year", "Professionelt startår"],
            ["primary_profession_type", "Primær faggruppe"],
            ["secondary_profession_types", "Yderligere faggrupper"],
            ["usual_work_mode", "Typisk arbejdsform"],
            ["primary_work_region", "Primært arbejdsområde"],
          ] as const).map(([key, label]) => <div key={key} className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
            <Label htmlFor={`statistics-profile-${key}`}>{label}</Label>
            <Switch id={`statistics-profile-${key}`} checked={form.statistics_profile_config[key]} disabled={key === "secondary_profession_types" && !form.statistics_profile_config.primary_profession_type} onCheckedChange={checked => setForm(current => ({ ...current, statistics_profile_config: { ...current.statistics_profile_config, [key]: checked } }))} />
          </div>)}
          {form.statistics_profile_config.primary_work_region && <div className="space-y-2 rounded-md border p-3">
            <Label>Valgbare arbejdsområder</Label>
            <p className="text-xs text-muted-foreground">Brug brede områder. Indsaml ikke adresse eller postnummer til statistik.</p>
            {form.statistics_work_regions.map((region, index) => <div key={index} className="flex gap-2"><Input value={region} onChange={event => setForm(current => ({ ...current, statistics_work_regions: current.statistics_work_regions.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} /><Button type="button" size="icon" variant="outline" onClick={() => setForm(current => ({ ...current, statistics_work_regions: current.statistics_work_regions.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 className="h-4 w-4" /></Button></div>)}
            <Button type="button" size="sm" variant="outline" onClick={() => setForm(current => ({ ...current, statistics_work_regions: [...current.statistics_work_regions, ""] }))}><Plus className="mr-2 h-4 w-4" />Tilføj område</Button>
          </div>}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold">Invitationer</h2>
        <p className="mt-1 text-sm text-muted-foreground">Systemmails sendes gennem Google Workspace fra bestyrelsen@danskfilmklipperselskab.dk med organisationens navn som afsendernavn. Svar sendes til adressen nedenfor.</p>
        <div className="mt-4 grid gap-4">
          <div className="space-y-2">
            <Label>Svaradresse (Reply-To)</Label>
            <Input type="email" value={form.from_email} onChange={event => setForm(f => ({ ...f, from_email: event.target.value }))} placeholder="kontakt@organisation.dk" />
          </div>
          <div className="space-y-2">
            <Label>Invitationstekst</Label>
            <Textarea
              value={form.invite_email_text}
              onChange={event => setForm(f => ({ ...f, invite_email_text: event.target.value }))}
              placeholder="Skriv den tekst, der skal stå over knappen i invitationsmailen."
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label>Rykkertekst</Label>
            <Textarea
              value={form.invite_reminder_text}
              onChange={event => setForm(f => ({ ...f, invite_reminder_text: event.target.value }))}
              placeholder="Skriv den tekst, der skal bruges, når en invitation gensendes som rykker."
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label>Velkomstbesked</Label>
            <p className="text-xs text-muted-foreground">
              Lægges automatisk som første besked i nye medlemmers indbakke på Overblik.
              Lades feltet stå tomt, oprettes ingen velkomstbesked.
            </p>
            <Textarea
              value={form.welcome_message_text}
              onChange={event => setForm(f => ({ ...f, welcome_message_text: event.target.value }))}
              placeholder="Skriv velkomstbeskeden til nye medlemmer."
              rows={8}
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold">Medlems-API</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Bruges til at hente medlemslisten fra den aktive organisations medlemssystem. Hver organisation skal have sit eget login; oplysningerne gemmes krypteret og vises ikke igen.
        </p>
        <div className={`mt-4 flex items-start gap-3 rounded-md border px-3 py-3 ${
          !form.foreninglet_enabled
            ? "bg-muted/30"
            : form.foreninglet_has_credentials
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-destructive/30 bg-destructive/5"
        }`}>
          {!form.foreninglet_enabled ? (
            <AlertCircle className="mt-0.5 h-5 w-5 text-muted-foreground" />
          ) : form.foreninglet_has_credentials ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
          ) : (
            <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
          )}
          <div>
            <p className="text-sm font-medium">
              {!form.foreninglet_enabled ? "ForeningLet-import er deaktiveret" : form.foreninglet_has_credentials ? "Loginoplysninger er gemt" : "Loginoplysninger mangler"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Brugernavn: {form.foreninglet_has_username ? "gemt" : "mangler"} · Kodeord: {form.foreninglet_has_password ? "gemt" : "mangler"}
              {form.foreninglet_credential_source === "organisation" ? " · Kun denne organisation" : ""}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>ForeningLet API-adresse</Label>
            <Input
              value={form.foreninglet_base_url}
              onChange={event => setForm(f => ({ ...f, foreninglet_base_url: event.target.value }))}
              placeholder="https://foreninglet.dk/api/members"
            />
          </div>
          <div className="space-y-2">
            <Label>Brugernavn</Label>
            <Input
              value={form.foreninglet_username}
              onChange={event => setForm(f => ({ ...f, foreninglet_username: event.target.value }))}
              placeholder={form.foreninglet_has_username ? "Behold gemt brugernavn" : "Brugernavn"}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label>Kodeord</Label>
            <Input
              type="password"
              value={form.foreninglet_password}
              onChange={event => setForm(f => ({ ...f, foreninglet_password: event.target.value }))}
              placeholder={form.foreninglet_has_password ? "Behold gemt kodeord" : "Kodeord"}
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 sm:col-span-2">
            <div>
              <Label>Aktivér ForeningLet-import</Label>
              <p className="text-xs text-muted-foreground">
                Tomme loginfelter bevarer de oplysninger, der allerede er gemt.
              </p>
            </div>
            <Switch
              checked={form.foreninglet_enabled}
              onCheckedChange={checked => setForm(f => ({ ...f, foreninglet_enabled: checked }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => void handleConnectionTest()} disabled={connectionPending || !form.foreninglet_enabled || !form.foreninglet_has_credentials}>
              {connectionPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
              Test forbindelse
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold">Fagord og roller</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Disse ord vises i værksflows, onboarding, hjælpetekster og relevante beskeder.
        </p>
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Ord for “medskaber”</Label>
            <Input value={form.coeditor_word} onChange={event => setForm(f => ({ ...f, coeditor_word: event.target.value }))} placeholder="medskaber" />
          </div>
          <div className="space-y-2">
            <Label>Faggruppetyper</Label>
            <p className="text-xs text-muted-foreground">De faggrupper, organisationens rettighedshavere kan tilknyttes, fx klipper og medklipper.</p>
            <div className="space-y-2">
              {form.role_labels.map((role, index) => (
                <div key={index} className="flex gap-2">
                  <Input value={role} onChange={event => updateRole(index, event.target.value)} />
                  <Button type="button" variant="outline" size="icon" onClick={() => removeRole(index)} disabled={form.role_labels.length <= 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, role_labels: [...f.role_labels, ""] }))}>
              <Plus className="mr-2 h-4 w-4" />
              Tilføj rolle
            </Button>
          </div>
          <div className="space-y-2">
            <Label>Producenttyper</Label>
            <p className="text-xs text-muted-foreground">Organisationens egne kategorier, fx filmproducent, teater eller broadcaster.</p>
            <div className="space-y-2">
              {form.producer_categories.map((category, index) => (
                <div key={index} className="flex gap-2">
                  <Input value={category} onChange={event => setForm(current => ({ ...current, producer_categories: current.producer_categories.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} />
                  <Button type="button" variant="outline" size="icon" onClick={() => setForm(current => ({ ...current, producer_categories: current.producer_categories.filter((_, itemIndex) => itemIndex !== index) }))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setForm(current => ({ ...current, producer_categories: [...current.producer_categories, ""] }))}>
              <Plus className="mr-2 h-4 w-4" />
              Tilføj producenttype
            </Button>
          </div>
          <div className="space-y-2">
            <Label>Onboarding-søgeord</Label>
            <p className="text-xs text-muted-foreground">
              Kun krediteringer, der matcher et af disse søgeord (fx “klip”, “edit”), medtages når nye
              medlemmer slås op i DFI og TMDb under onboarding.
            </p>
            <div className="space-y-2">
              {form.onboarding_keywords.map((keyword, index) => (
                <div key={index} className="flex gap-2">
                  <Input value={keyword} onChange={event => updateKeyword(index, event.target.value)} />
                  <Button type="button" variant="outline" size="icon" onClick={() => removeKeyword(index)} disabled={form.onboarding_keywords.length <= 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, onboarding_keywords: [...f.onboarding_keywords, ""] }))}>
              <Plus className="mr-2 h-4 w-4" />
              Tilføj søgeord
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
