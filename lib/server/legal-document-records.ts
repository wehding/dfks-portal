import "server-only";

import { createHash } from "node:crypto";
import type { createServiceClient } from "@/lib/supabase/service";
import {
  DEFAULT_LEGAL_DOCUMENT_COPY,
  LEGAL_DOCUMENT_AUDIENCES,
  LEGAL_DOCUMENT_TYPES,
  type LegalDocumentAudience,
  type LegalDocumentRecord,
  type LegalDocumentType,
} from "@/lib/legal-documents";

type ServiceDb = ReturnType<typeof createServiceClient>;

type VersionRow = {
  id: string;
  document_type: string;
  audience: string;
  title: string | null;
  body: string | null;
  version: number | null;
  content_hash: string | null;
  published_at: string | null;
};

export function hashLegalDocumentBody(body: string) {
  return createHash("sha256").update(body, "utf8").digest("hex");
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

function normalizeVersionRow(row: VersionRow, documentType: LegalDocumentType, audience: LegalDocumentAudience): LegalDocumentRecord {
  const fallback = fallbackDocument(documentType, audience);
  return {
    id: row.id,
    document_type: documentType,
    audience,
    title: row.title?.trim() || fallback.title,
    body: row.body ?? fallback.body,
    version: Number(row.version ?? 0),
    content_hash: row.content_hash,
    published_at: row.published_at,
  };
}

export async function listCurrentLegalDocuments(
  db: ServiceDb,
  orgId: string,
  audience: LegalDocumentAudience,
): Promise<LegalDocumentRecord[]> {
  const { data, error } = await db
    .from("legal_document_versions")
    .select("id,document_type,audience,title,body,version,content_hash,published_at")
    .eq("org_id", orgId)
    .eq("audience", audience)
    .eq("status", "published")
    .order("version", { ascending: false });

  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw new Error(error.message);
  const rows = (data ?? []) as VersionRow[];

  return LEGAL_DOCUMENT_TYPES.map(documentType => {
    const row = rows.find(candidate => candidate.document_type === documentType && candidate.audience === audience);
    return row ? normalizeVersionRow(row, documentType, audience) : fallbackDocument(documentType, audience);
  });
}

export async function recordLegalDocumentAcceptances(
  db: ServiceDb,
  params: {
    userId: string;
    rightsHolderId: string;
    orgId: string;
    audience: LegalDocumentAudience;
    acceptedDocumentIds: string[];
  },
) {
  const currentDocuments = await listCurrentLegalDocuments(db, params.orgId, params.audience);
  const missingPersistedDocuments = currentDocuments.filter(document => !document.id);
  if (missingPersistedDocuments.length) {
    throw new Error("Organisationens juridiske tekster er ikke publiceret endnu.");
  }

  const accepted = new Set(params.acceptedDocumentIds);
  const missingAcceptedDocuments = currentDocuments.filter(document => document.id && !accepted.has(document.id));
  if (missingAcceptedDocuments.length) {
    throw new Error("Du skal acceptere de aktuelle rettighedstekster for at fortsætte.");
  }

  const now = new Date().toISOString();
  const rows = currentDocuments.map(document => ({
    org_id: params.orgId,
    rights_holder_id: params.rightsHolderId,
    user_id: params.userId,
    document_version_id: document.id!,
    document_type: document.document_type,
    document_version: document.version,
    audience: document.audience,
    content_hash: document.content_hash ?? hashLegalDocumentBody(document.body),
    accepted_at: now,
    superseded_at: null,
    superseded_by_document_version_id: null,
  }));

  const { error } = await db
    .from("legal_document_acceptances")
    .upsert(rows, { onConflict: "org_id,rights_holder_id,document_type,audience,document_version_id" });
  if (error) throw new Error(error.message);
}

export function allLegalDocumentAudiences() {
  return LEGAL_DOCUMENT_AUDIENCES;
}
