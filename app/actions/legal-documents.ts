"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { recordAuditEvent } from "@/lib/audit-log-server";
import {
  DEFAULT_LEGAL_DOCUMENT_COPY,
  LEGAL_DOCUMENT_AUDIENCES,
  LEGAL_DOCUMENT_TYPES,
  isLegalDocumentAudience,
  isLegalDocumentType,
  normalizeDanishLegalText,
  type LegalDocumentAudience,
  type LegalDocumentRecord,
  type LegalDocumentType,
} from "@/lib/legal-documents";
import { hashLegalDocumentBody } from "@/lib/server/legal-document-records";

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const;
const MAX_LEGAL_DOCUMENT_BODY_LENGTH = 30_000;

type LegalDocumentSettingsRow = {
  documentType: LegalDocumentType;
  audience: LegalDocumentAudience;
  active: LegalDocumentRecord;
  draft: LegalDocumentRecord | null;
};

type VersionRow = {
  id: string;
  document_type: string;
  audience: string;
  version: number;
  status: "draft" | "published";
  title: string;
  body: string;
  content_hash: string;
  published_at: string | null;
  updated_at: string | null;
};

async function currentAdminOrg() {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES);
  if (!caller?.orgId) throw new Error("Din bruger er ikke knyttet til en organisation.");
  const { data: { user } } = await supabase.auth.getUser();
  return { orgId: caller.orgId, userId: user?.id ?? null };
}

function fallbackDocument(documentType: LegalDocumentType, audience: LegalDocumentAudience): LegalDocumentRecord {
  const copy = DEFAULT_LEGAL_DOCUMENT_COPY[audience][documentType];
  return {
    id: null,
    document_type: documentType,
    audience,
    title: copy.title,
    body: copy.body,
    version: 0,
    content_hash: null,
    published_at: null,
  };
}

function rowToDocument(row: VersionRow, documentType: LegalDocumentType, audience: LegalDocumentAudience): LegalDocumentRecord {
  return {
    id: row.id,
    document_type: documentType,
    audience,
    title: normalizeDanishLegalText(row.title),
    body: normalizeDanishLegalText(row.body),
    version: row.version,
    content_hash: row.content_hash,
    published_at: row.published_at,
  };
}

function cleanDocumentInput(input: { documentType: unknown; audience: unknown; title?: unknown; body?: unknown }) {
  if (!isLegalDocumentType(input.documentType)) throw new Error("Dokumenttypen er ugyldig.");
  if (!isLegalDocumentAudience(input.audience)) throw new Error("Målgruppen er ugyldig.");
  const fallback = DEFAULT_LEGAL_DOCUMENT_COPY[input.audience][input.documentType];
  const title = normalizeDanishLegalText(typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 180) : fallback.title);
  const body = normalizeDanishLegalText(typeof input.body === "string" ? input.body.trim() : "");
  if (!body) throw new Error("Teksten må ikke være tom.");
  if (body.length > MAX_LEGAL_DOCUMENT_BODY_LENGTH) throw new Error("Teksten er for lang.");
  return { documentType: input.documentType, audience: input.audience, title, body };
}

export async function getOrganisationLegalDocuments(): Promise<{
  documents: LegalDocumentSettingsRow[];
  schemaReady: boolean;
  schemaMessage: string | null;
}> {
  const { orgId } = await currentAdminOrg();
  const db = createServiceClient();
  const { data, error } = await db
    .from("legal_document_versions")
    .select("id,document_type,audience,version,status,title,body,content_hash,published_at,updated_at")
    .eq("org_id", orgId)
    .in("status", ["draft", "published"])
    .order("version", { ascending: false });

  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw new Error(error.message);
  const schemaReady = !(error && (error.code === "42P01" || error.code === "PGRST205"));
  const rows = (data ?? []) as VersionRow[];

  return {
    schemaReady,
    schemaMessage: schemaReady ? null : "Database-migrationerne til juridisk onboarding er ikke kørt endnu.",
    documents: LEGAL_DOCUMENT_AUDIENCES.flatMap(audience =>
      LEGAL_DOCUMENT_TYPES.map(documentType => {
        const matching = rows.filter(row => row.document_type === documentType && row.audience === audience);
        const activeRow = matching.find(row => row.status === "published");
        const draftRow = matching.find(row => row.status === "draft") ?? null;
        return {
          documentType,
          audience,
          active: activeRow ? rowToDocument(activeRow, documentType, audience) : fallbackDocument(documentType, audience),
          draft: draftRow ? rowToDocument(draftRow, documentType, audience) : null,
        };
      }),
    ),
  };
}

export async function saveLegalDocumentDraft(input: {
  documentType: LegalDocumentType;
  audience: LegalDocumentAudience;
  title: string;
  body: string;
}) {
  const { orgId, userId } = await currentAdminOrg();
  const document = cleanDocumentInput(input);
  const db = createServiceClient();

  const { data: existingDraft } = await db
    .from("legal_document_versions")
    .select("id")
    .eq("org_id", orgId)
    .eq("document_type", document.documentType)
    .eq("audience", document.audience)
    .eq("status", "draft")
    .maybeSingle();

  const { data: active } = await db
    .from("legal_document_versions")
    .select("version")
    .eq("org_id", orgId)
    .eq("document_type", document.documentType)
    .eq("audience", document.audience)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const draft = {
    org_id: orgId,
    document_type: document.documentType,
    audience: document.audience,
    title: document.title,
    body: document.body,
    content_hash: hashLegalDocumentBody(document.body),
    version: Number(active?.version ?? 0) + 1,
    status: "draft",
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  const result = existingDraft?.id
    ? await db.from("legal_document_versions").update(draft).eq("id", existingDraft.id)
    : await db.from("legal_document_versions").insert({ ...draft, created_by: userId });
  if (result.error) throw new Error(result.error.message);

  revalidatePath("/admin/organisation");
  return { success: true as const };
}

export async function publishLegalDocumentVersion(input: {
  documentType: LegalDocumentType;
  audience: LegalDocumentAudience;
  title: string;
  body: string;
}) {
  const { orgId, userId } = await currentAdminOrg();
  const document = cleanDocumentInput(input);
  const db = createServiceClient();
  const now = new Date().toISOString();
  const contentHash = hashLegalDocumentBody(document.body);

  const { data: active } = await db
    .from("legal_document_versions")
    .select("id,version,content_hash")
    .eq("org_id", orgId)
    .eq("document_type", document.documentType)
    .eq("audience", document.audience)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (active?.content_hash === contentHash) {
    throw new Error("Teksten er uændret i forhold til den aktive version.");
  }

  await saveLegalDocumentDraft(document);
  const { data: draft, error: draftError } = await db
    .from("legal_document_versions")
    .select("id")
    .eq("org_id", orgId)
    .eq("document_type", document.documentType)
    .eq("audience", document.audience)
    .eq("status", "draft")
    .maybeSingle();
  if (draftError || !draft) throw new Error(draftError?.message ?? "Kladdeversionen blev ikke fundet.");

  const { error: publishError } = await db
    .from("legal_document_versions")
    .update({
      status: "published",
      version: Number(active?.version ?? 0) + 1,
      title: document.title,
      body: document.body,
      content_hash: contentHash,
      published_at: now,
      published_by: userId,
      updated_at: now,
      updated_by: userId,
    })
    .eq("id", draft.id);
  if (publishError) throw new Error(publishError.message);

  const { error: supersedeError } = await db
    .from("legal_document_acceptances")
    .update({
      superseded_at: now,
      superseded_by_document_version_id: draft.id,
    })
    .eq("org_id", orgId)
    .eq("document_type", document.documentType)
    .eq("audience", document.audience)
    .is("superseded_at", null)
    .neq("document_version_id", draft.id);
  if (supersedeError) throw new Error(supersedeError.message);

  const { error: requirementError } = await db.rpc("require_legal_onboarding_for_audience", {
    target_org_id: orgId,
    target_audience: document.audience,
    required_at: now,
  });
  if (requirementError) throw new Error(requirementError.message);

  await recordAuditEvent({
    context: { actorUserId: userId, actorOrgId: orgId, actorRole: "admin", source: "admin" },
    action: "update",
    entityType: "legal_document_version",
    entityId: draft.id,
    entityLabel: `${document.documentType}:${document.audience}`,
    orgIds: [orgId],
    changes: [{ field: "version", old: active?.version ?? null, new: Number(active?.version ?? 0) + 1 }],
  });

  revalidatePath("/admin/organisation");
  revalidatePath("/onboarding");
  revalidatePath("/portal");
  return { success: true as const };
}
