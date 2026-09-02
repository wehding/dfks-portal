"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Braces, FileText, Loader2, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { getOrganisationLegalDocuments, publishLegalDocumentVersion, saveLegalDocumentDraft } from "@/app/actions/legal-documents";
import {
  LEGAL_DOCUMENT_AUDIENCE_LABELS,
  LEGAL_DOCUMENT_AUDIENCES,
  LEGAL_DOCUMENT_TYPE_LABELS,
  LEGAL_DOCUMENT_TYPES,
  type LegalDocumentAudience,
  type LegalDocumentRecord,
  type LegalDocumentType,
} from "@/lib/legal-documents";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BASIC_TEXT_PLACEHOLDERS, insertTextAtSelection, unknownBasicPlaceholders } from "@/lib/organisation-text-templates";

type LegalDocumentSettingsRow = {
  documentType: LegalDocumentType;
  audience: LegalDocumentAudience;
  active: LegalDocumentRecord;
  draft: LegalDocumentRecord | null;
};

function formatPublishedAt(value: string | null) {
  return value ? new Date(value).toLocaleString("da-DK") : "Ikke publiceret";
}

function editorSource(
  rows: LegalDocumentSettingsRow[],
  documentType: LegalDocumentType,
  audience: LegalDocumentAudience,
) {
  const row = rows.find(candidate => candidate.documentType === documentType && candidate.audience === audience);
  return row?.draft ?? row?.active ?? null;
}

export function LegalDocumentSettings() {
  const [rows, setRows] = useState<LegalDocumentSettingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaReady, setSchemaReady] = useState(true);
  const [schemaMessage, setSchemaMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [documentType, setDocumentType] = useState<LegalDocumentType>("privacy_notice");
  const [audience, setAudience] = useState<LegalDocumentAudience>("member");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [activeField, setActiveField] = useState<"title" | "body">("body");
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const selected = useMemo(
    () => rows.find(row => row.documentType === documentType && row.audience === audience) ?? null,
    [audience, documentType, rows],
  );

  const editableSource = selected?.draft ?? selected?.active ?? null;
  const hasDraft = Boolean(selected?.draft);
  const activeHash = selected?.active.content_hash ?? "";
  const currentHash = editableSource?.content_hash ?? "";
  const hasChanges = !editableSource || title !== editableSource.title || body !== editableSource.body;
  const unknownPlaceholders = unknownBasicPlaceholders(title, body);
  const publishDisabled = !body.trim() || unknownPlaceholders.length > 0 || (!hasChanges && currentHash === activeHash);

  useEffect(() => {
    let active = true;
    void getOrganisationLegalDocuments()
      .then(result => {
        if (!active) return;
        setRows(result.documents);
        setSchemaReady(result.schemaReady);
        setSchemaMessage(result.schemaMessage);
        const source = editorSource(result.documents, "privacy_notice", "member");
        if (source) {
          setTitle(source.title);
          setBody(source.body);
        }
      })
      .catch(error => toast.error(error instanceof Error ? error.message : "Teksterne kunne ikke hentes."))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function refreshAfterChange(message: string) {
    void getOrganisationLegalDocuments()
      .then(result => {
        setRows(result.documents);
        setSchemaReady(result.schemaReady);
        setSchemaMessage(result.schemaMessage);
        const source = editorSource(result.documents, documentType, audience);
        if (source) {
          setTitle(source.title);
          setBody(source.body);
        }
        toast.success(message);
      })
      .catch(error => toast.error(error instanceof Error ? error.message : "Teksterne kunne ikke opdateres."));
  }

  function changeSelection(nextDocumentType: LegalDocumentType, nextAudience: LegalDocumentAudience) {
    if (hasChanges && !window.confirm("Du har ændringer, der ikke er gemt. Vil du skifte tekst uden at gemme?")) return;
    setDocumentType(nextDocumentType);
    setAudience(nextAudience);
    const source = editorSource(rows, nextDocumentType, nextAudience);
    if (source) {
      setTitle(source.title);
      setBody(source.body);
    }
  }

  function insertPlaceholder(key: string) {
    const token = `{${key}}`;
    const ref = activeField === "title" ? titleRef : bodyRef;
    const value = activeField === "title" ? title : body;
    const element = ref.current;
    const inserted = insertTextAtSelection(value, token, element?.selectionStart ?? value.length, element?.selectionEnd ?? value.length);
    if (activeField === "title") setTitle(inserted.value);
    else setBody(inserted.value);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  }

  function saveDraft() {
    startTransition(async () => {
      try {
        await saveLegalDocumentDraft({ documentType, audience, title, body });
        refreshAfterChange("Kladde gemt");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Kladde kunne ikke gemmes.");
      }
    });
  }

  function publishVersion() {
    const confirmed = window.confirm("Publicering opretter en ny aktiv version. Berørte brugere skal godkende teksterne igen ved næste login. Vil du fortsætte?");
    if (!confirmed) return;
    startTransition(async () => {
      try {
        await publishLegalDocumentVersion({ documentType, audience, title, body });
        refreshAfterChange("Ny version publiceret");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Versionen kunne ikke publiceres.");
      }
    });
  }

  if (loading) {
    return (
      <section className="rounded-lg border bg-card p-5 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Henter juridiske tekster...
      </section>
    );
  }

  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            Brugerrettigheder
          </div>
          <h2 className="text-base font-semibold">Brugerrettigheder og juridiske tekster</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Rediger de tekster, brugerne accepterer i onboarding. Publicering af en ny version kræver ny godkendelse ved næste login for den valgte målgruppe.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={saveDraft} disabled={!schemaReady || isPending || !body.trim() || !hasChanges || unknownPlaceholders.length > 0}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Gem kladde
          </Button>
          <Button type="button" onClick={publishVersion} disabled={!schemaReady || isPending || publishDisabled}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Publicér ny version
          </Button>
        </div>
      </div>

      {!schemaReady && (
        <Alert className="mt-5" variant="destructive">
          <AlertTitle>Juridisk onboarding mangler databaseopsætning</AlertTitle>
          <AlertDescription>
            {schemaMessage ?? "Kør de nyeste Supabase-migrationer, før juridiske tekster kan gemmes eller publiceres."}
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="legal-document-type">Dokument</Label>
          <select
            id="legal-document-type"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={documentType}
            onChange={event => changeSelection(event.target.value as LegalDocumentType, audience)}
          >
            {LEGAL_DOCUMENT_TYPES.map(type => <option key={type} value={type}>{LEGAL_DOCUMENT_TYPE_LABELS[type]}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="legal-document-audience">Variant</Label>
          <select
            id="legal-document-audience"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={audience}
            onChange={event => changeSelection(documentType, event.target.value as LegalDocumentAudience)}
          >
            {LEGAL_DOCUMENT_AUDIENCES.map(value => <option key={value} value={value}>{LEGAL_DOCUMENT_AUDIENCE_LABELS[value]}</option>)}
          </select>
        </div>
      </div>

      {selected && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={hasDraft ? "secondary" : "outline"}>{hasDraft ? "Kladde findes" : "Ingen kladde"}</Badge>
          <span>Aktiv version {selected.active.version || 1}</span>
          <span>·</span>
          <span>{formatPublishedAt(selected.active.published_at)}</span>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="legal-document-title">Titel</Label>
            <Input ref={titleRef} id="legal-document-title" value={title} onFocus={() => setActiveField("title")} onSelect={() => setActiveField("title")} onChange={event => setTitle(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="legal-document-body">Tekst</Label>
            <Textarea ref={bodyRef} id="legal-document-body" value={body} onFocus={() => setActiveField("body")} onSelect={() => setActiveField("body")} onChange={event => setBody(event.target.value)} rows={18} className="min-h-[420px] text-sm leading-6" />
            <p className="text-xs text-muted-foreground">Brug almindelig tekst. Links kan skrives som fulde URL&apos;er, fx https://danskfilmklipperselskab.dk/privatlivspolitik/.</p>
            {unknownPlaceholders.length > 0 && <p className="text-sm text-destructive">Ukendte dynamiske felter: {unknownPlaceholders.map(value => `{${value}}`).join(", ")}</p>}
          </div>
        </div>
        <aside className="h-fit rounded-md border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm font-medium"><Braces className="h-4 w-4" />Indsæt dynamisk felt</div>
          <div className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:items-stretch">
            {BASIC_TEXT_PLACEHOLDERS.map(key => <Button key={key} type="button" variant="ghost" size="sm" className="justify-start font-mono text-xs" onMouseDown={event => event.preventDefault()} onClick={() => insertPlaceholder(key)}>{`{${key}}`}</Button>)}
          </div>
        </aside>
      </div>
    </section>
  );
}
