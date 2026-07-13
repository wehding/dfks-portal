"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Building2, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { getOrganisationSettings, updateOrganisationSettings } from "@/app/actions/organisation-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormState = {
  short_name: string;
  long_name: string;
  logo_url: string;
  primary_color: string;
  from_email: string;
  coeditor_word: string;
  role_labels: string[];
};

const emptyForm: FormState = {
  short_name: "",
  long_name: "",
  logo_url: "",
  primary_color: "#111827",
  from_email: "",
  coeditor_word: "medklipper",
  role_labels: ["B-klipper", "Klipper", "Konceptuerende klipper"],
};

export default function OrganisationSettingsPage() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void getOrganisationSettings()
      .then(settings => {
        if (!active) return;
        setForm({
          short_name: settings.short_name,
          long_name: settings.long_name,
          logo_url: settings.logo_url ?? "",
          primary_color: settings.primary_color,
          from_email: settings.from_email ?? "",
          coeditor_word: settings.coeditor_word,
          role_labels: settings.role_labels,
        });
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
          coeditor_word: form.coeditor_word,
          role_labels: form.role_labels,
        });
        toast.success("Organisationsindstillinger gemt");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Kunne ikke gemme organisationen.");
      }
    });
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
        <Button onClick={handleSave} disabled={isPending || !canSave}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Gem ændringer
        </Button>
      </div>

      <section className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold">Branding</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bruges i menu, portal og invitationsmails.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Kort navn</Label>
            <Input value={form.short_name} onChange={event => setForm(f => ({ ...f, short_name: event.target.value }))} placeholder="DFKS" />
          </div>
          <div className="space-y-2">
            <Label>Fuldt navn</Label>
            <Input value={form.long_name} onChange={event => setForm(f => ({ ...f, long_name: event.target.value }))} placeholder="Dansk Filmklipperselskab" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Logo-url</Label>
            <Input value={form.logo_url} onChange={event => setForm(f => ({ ...f, logo_url: event.target.value }))} placeholder="https://..." />
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
        <h2 className="text-base font-semibold">Invitationer</h2>
        <p className="mt-1 text-sm text-muted-foreground">Afsender-mailen skal være verificeret i mailudbyderen.</p>
        <div className="mt-4 space-y-2">
          <Label>Afsender-mail</Label>
          <Input value={form.from_email} onChange={event => setForm(f => ({ ...f, from_email: event.target.value }))} placeholder="kontakt@organisation.dk" />
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
            <Label>Rollebetegnelser</Label>
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
        </div>
      </section>
    </div>
  );
}
