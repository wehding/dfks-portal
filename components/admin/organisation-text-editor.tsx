"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Braces, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { getOrganisationTextSettings, updateOrganisationTextTemplate } from "@/app/actions/organisation-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { RichTextContent } from "@/components/ui/rich-text-content";
import {
  insertTextAtSelection,
  placeholdersForTemplate,
  renderOrganisationTemplate,
  unknownOrganisationPlaceholders,
  type OrganisationTextTemplate,
  type OrganisationTextTemplateId,
} from "@/lib/organisation-text-templates";
import { addCalendarDays, formatBetaDate, todayInCopenhagen } from "@/lib/beta-test";

const META: Record<OrganisationTextTemplateId, { label: string; description: string }> = {
  invite: { label: "Almindelig invitation", description: "Teksten over knappen i invitationsmailen." },
  reminder: { label: "Påmindelse om invitation", description: "Teksten, der bruges, når en invitation gensendes." },
  beta_invite: { label: "Betatest-invitation", description: "Invitation med en informativ start- og slutdato. Betatesterstatus udløber ikke." },
  member_work_invite: { label: "Værksinvitation til medlem", description: "Invitation til et medlem med organisationens registrerede værker." },
  non_member_work_invite: { label: "Værksinvitation til ikke-medlem", description: "Invitation til en ikke-medlem med registrerede værker." },
  welcome: { label: "Velkomstbesked", description: "Første besked i et nyt medlems indbakke. En tom tekst slår beskeden fra." },
};

type TemplateMap = Record<OrganisationTextTemplateId, Omit<OrganisationTextTemplate, "id" | "label" | "description">>;
type ActiveField = "subject" | "body";

function loadingMark(stage: "start" | "complete") {
  if (typeof performance === "undefined") return;
  performance.mark(`dfks:organisation-texts:${stage}`);
  if (stage === "complete" && performance.getEntriesByName("dfks:organisation-texts:start").length) {
    performance.measure("dfks:organisation-texts", "dfks:organisation-texts:start", "dfks:organisation-texts:complete");
  }
}

export default function OrganisationTextEditor({ organisationName }: { organisationName: string }) {
  const [templates, setTemplates] = useState<TemplateMap | null>(null);
  const [selectedId, setSelectedId] = useState<OrganisationTextTemplateId>("invite");
  const [draft, setDraft] = useState<OrganisationTextTemplate | null>(null);
  const [saved, setSaved] = useState<OrganisationTextTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [activeField, setActiveField] = useState<ActiveField>("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    loadingMark("start");
    void getOrganisationTextSettings()
      .then(result => {
        if (!active) return;
        const map = result as TemplateMap;
        setTemplates(map);
        const initial = { id: "invite" as const, ...META.invite, ...map.invite };
        setDraft(initial);
        setSaved(initial);
        loadingMark("complete");
      })
      .catch(error => toast.error(error instanceof Error ? error.message : "Teksterne kunne ikke hentes."))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const hasChanges = Boolean(draft && saved && (draft.subject !== saved.subject || draft.body !== saved.body || draft.durationDays !== saved.durationDays));
  const unknown = useMemo(() => draft ? unknownOrganisationPlaceholders(draft.id, draft.subject ?? "", draft.body) : [], [draft]);
  const previewValues = useMemo(() => {
    const start = todayInCopenhagen();
    const end = addCalendarDays(start, Math.min(365, Math.max(1, draft?.durationDays ?? 10)));
    return {
      name: "Anna Jensen",
      organisation: organisationName || "Organisationen",
      primaryWork: "Eksempelværk",
      worksText: "Eksempelværk og Dokumentarserien",
      invitationLink: "https://portal.eksempel.dk/invitation",
      startDate: formatBetaDate(start),
      endDate: formatBetaDate(end),
    };
  }, [draft?.durationDays, organisationName]);

  function selectTemplate(nextId: OrganisationTextTemplateId) {
    if (!templates || nextId === selectedId) return;
    if (hasChanges && !window.confirm("Du har ændringer, der ikke er gemt. Vil du skifte tekst uden at gemme?")) return;
    const next = { id: nextId, ...META[nextId], ...templates[nextId] };
    setSelectedId(nextId);
    setDraft(next);
    setSaved(next);
    setActiveField(next.subject == null ? "body" : "subject");
  }

  function insertPlaceholder(key: string) {
    if (!draft) return;
    const token = `{${key}}`;
    const ref = activeField === "subject" && draft.subject != null ? subjectRef : bodyRef;
    const value = activeField === "subject" && draft.subject != null ? draft.subject : draft.body;
    const element = ref.current;
    const inserted = insertTextAtSelection(value, token, element?.selectionStart ?? value.length, element?.selectionEnd ?? value.length);
    setDraft(current => current ? { ...current, [activeField === "subject" && current.subject != null ? "subject" : "body"]: inserted.value } : current);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  }

  function save() {
    if (!draft || unknown.length) return;
    startTransition(async () => {
      try {
        await updateOrganisationTextTemplate({ templateId: draft.id, subject: draft.subject, body: draft.body, durationDays: draft.durationDays });
        setTemplates(current => current ? { ...current, [draft.id]: { subject: draft.subject, body: draft.body, durationDays: draft.durationDays } } : current);
        setSaved(draft);
        toast.success("Teksten er gemt");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Teksten kunne ikke gemmes.");
      }
    });
  }

  if (loading || !draft) return <div className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Henter redigerbare tekster...</div>;

  const previewSubject = draft.subject ? renderOrganisationTemplate(draft.subject, previewValues) : null;
  const previewBody = renderOrganisationTemplate(draft.body, previewValues);

  return (
    <div data-performance-route="organisation-settings" data-performance-ready="texts">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Tekstindhold</h3>
          <p className="mt-1 text-sm text-muted-foreground">Ændringer gemmes særskilt for den valgte teksttype.</p>
        </div>
        <Button type="button" onClick={save} disabled={isPending || !hasChanges || unknown.length > 0}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Gem tekst
        </Button>
      </div>

      <div className="mt-5 max-w-xl space-y-2">
        <Label htmlFor="organisation-text-type">Teksttype</Label>
        <select id="organisation-text-type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedId} onChange={event => selectTemplate(event.target.value as OrganisationTextTemplateId)}>
          {(Object.keys(META) as OrganisationTextTemplateId[]).map(id => <option key={id} value={id}>{META[id].label}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{draft.description}</p>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-4">
          {draft.durationDays != null && <div className="max-w-xs space-y-2"><Label htmlFor="beta-duration">Standardvarighed i dage</Label><Input id="beta-duration" type="number" min={1} max={365} value={draft.durationDays} onChange={event => setDraft(current => current ? { ...current, durationDays: Number(event.target.value) } : current)} /></div>}
          {draft.subject != null && <div className="space-y-2"><Label htmlFor="organisation-text-subject">Emne</Label><Input ref={subjectRef} id="organisation-text-subject" value={draft.subject} onFocus={() => setActiveField("subject")} onSelect={() => setActiveField("subject")} onChange={event => setDraft(current => current ? { ...current, subject: event.target.value } : current)} /></div>}
          <div className="space-y-2">
            <Label htmlFor="organisation-text-body">Tekst</Label>
            <RichTextEditor
              id="organisation-text-body"
              textareaRef={bodyRef}
              rows={14}
              className="min-h-[300px] leading-6"
              value={draft.body}
              onFocus={() => setActiveField("body")}
              onSelect={() => setActiveField("body")}
              onChange={body => setDraft(current => current ? { ...current, body } : current)}
            />
            <p className="text-xs text-muted-foreground">Markér tekst og brug værktøjslinjen til fed, kursiv, understregning, overskrift, punkt eller tekststørrelse.</p>
          </div>
          {unknown.length > 0 && <p className="text-sm text-destructive">Ukendte dynamiske felter: {unknown.map(value => `{${value}}`).join(", ")}</p>}
          <div className="rounded-md bg-muted/40 p-3 text-sm" aria-label="Forhåndsvisning">
            <p className="font-medium">Eksempel</p>
            {previewSubject && <p className="mt-3 font-semibold">{previewSubject}</p>}
            <RichTextContent value={previewBody || "Ingen tekst"} className="mt-2 text-muted-foreground" />
          </div>
        </div>
        <aside className="h-fit rounded-md border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm font-medium"><Braces className="h-4 w-4" />Indsæt dynamisk felt</div>
          <div className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:items-stretch">
            {placeholdersForTemplate(draft.id).map(key => <Button key={key} type="button" variant="ghost" size="sm" className="justify-start font-mono text-xs" onMouseDown={event => event.preventDefault()} onClick={() => insertPlaceholder(key)}>{`{${key}}`}</Button>)}
          </div>
        </aside>
      </div>
    </div>
  );
}
