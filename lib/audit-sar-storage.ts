import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAuditEvents } from "@/lib/audit-log-server";
import {
  contentSha256,
  subjectAccessCsv,
  subjectAccessEvents,
  subjectAccessJson,
  subjectAccessPdf,
} from "@/lib/audit-sar";

export const SUBJECT_ACCESS_BUCKET = "subject-access-exports";
export const SUBJECT_ACCESS_LINK_TTL_SECONDS = 10 * 60;
export const SUBJECT_ACCESS_FILE_TTL_MS = 24 * 60 * 60 * 1000;

export type SubjectAccessFormat = "pdf" | "json" | "csv";

type SubjectAccessRequestRow = {
  id: string;
  org_id: string;
  target_member_uuid: string;
  target_member_label: string | null;
  date_from: string | null;
  date_to: string | null;
  data_categories: string[] | null;
  status: string;
  mask_staff_names: boolean;
};

type GeneratedExport = {
  id: string;
  format: SubjectAccessFormat;
  content_hash: string;
  storage_path: string;
  expires_at: string;
};

const MIME_TYPES: Record<SubjectAccessFormat, string> = {
  pdf: "application/pdf",
  json: "application/json",
  csv: "text/csv",
};

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function loadSubjectAccessEvents(service: SupabaseClient, sar: SubjectAccessRequestRow) {
  const rows = [];
  let cursor: string | undefined;
  do {
    const page = await fetchAuditEvents(service, {
      userId: "00000000-0000-0000-0000-000000000000",
      orgId: sar.org_id,
      role: "superadmin",
    }, {
      orgId: sar.org_id,
      targetMemberUuid: sar.target_member_uuid,
      from: sar.date_from ?? undefined,
      to: sar.date_to ?? undefined,
      cursor,
    }, 1000);
    rows.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && rows.length < 50_000);
  if (cursor) throw new Error("subject_access_export_too_large");
  const filtered = sar.data_categories?.length
    ? rows.filter(event => event.dataCategories.some(category => sar.data_categories?.includes(category)))
    : rows;
  return subjectAccessEvents(filtered, sar.id, sar.mask_staff_names);
}

export async function ensureSubjectAccessExports(
  service: SupabaseClient,
  sar: SubjectAccessRequestRow,
  generatedBy: string,
): Promise<GeneratedExport[]> {
  if (!["approved", "generated", "delivered"].includes(sar.status)) {
    throw new Error("subject_access_request_not_approved");
  }
  const now = new Date().toISOString();
  const { data: current, error: currentError } = await service
    .from("subject_access_exports")
    .select("id,format,content_hash,storage_path,expires_at")
    .eq("request_id", sar.id)
    .is("deleted_at", null)
    .gt("expires_at", now);
  if (currentError) throw new Error(`subject_access_exports_lookup_failed:${currentError.code ?? "database"}`);
  const existing = new Map((current ?? []).filter(item => item.storage_path).map(item => [item.format, item]));
  if (["pdf", "json", "csv"].every(format => existing.has(format))) {
    return [...existing.values()] as GeneratedExport[];
  }

  const events = await loadSubjectAccessEvents(service, sar);
  const contents: Record<SubjectAccessFormat, Uint8Array> = {
    pdf: await subjectAccessPdf(events, sar.target_member_label || sar.target_member_uuid),
    json: subjectAccessJson(events),
    csv: subjectAccessCsv(events),
  };
  const expiresAt = new Date(Date.now() + SUBJECT_ACCESS_FILE_TTL_MS).toISOString();
  const exports: GeneratedExport[] = [];

  for (const format of ["pdf", "json", "csv"] as const) {
    const alreadyGenerated = existing.get(format);
    if (alreadyGenerated) {
      exports.push(alreadyGenerated as GeneratedExport);
      continue;
    }
    const content = contents[format];
    const hash = contentSha256(content);
    const path = [
      safePathSegment(sar.org_id),
      safePathSegment(sar.target_member_uuid),
      safePathSegment(sar.id),
      `${format}-${hash.slice(0, 16)}.${format}`,
    ].join("/");
    const { data: uploaded, error: uploadError } = await service.storage
      .from(SUBJECT_ACCESS_BUCKET)
      .upload(path, Buffer.from(content), {
        contentType: MIME_TYPES[format],
        cacheControl: "no-store",
        upsert: false,
      });
    if (uploadError && !/already exists/i.test(uploadError.message)) {
      throw new Error(`subject_access_upload_failed:${uploadError.message}`);
    }
    const { data: exportId, error: registrationError } = await service.rpc("register_subject_access_export", {
      p_request_id: sar.id,
      p_format: format,
      p_content_hash: hash,
      p_row_count: events.length,
      p_mask_staff_names: sar.mask_staff_names,
      p_generated_by: generatedBy,
      p_expires_at: expiresAt,
      p_storage_bucket: SUBJECT_ACCESS_BUCKET,
      p_storage_path: path,
      p_mime_type: MIME_TYPES[format],
      p_byte_size: content.byteLength,
      p_storage_generation: uploaded?.id ?? null,
    });
    if (registrationError || !exportId) {
      await service.storage.from(SUBJECT_ACCESS_BUCKET).remove([path]);
      throw new Error(`subject_access_export_registration_failed:${registrationError?.code ?? "database"}`);
    }
    exports.push({ id: String(exportId), format, content_hash: hash, storage_path: path, expires_at: expiresAt });
  }
  return exports;
}

export async function issueSubjectAccessDownload(
  service: SupabaseClient,
  requestId: string,
  format: SubjectAccessFormat,
): Promise<{ url: string; contentHash: string; expiresIn: number }> {
  const { data: item, error } = await service
    .from("subject_access_exports")
    .select("id,content_hash,storage_bucket,storage_path,expires_at,deleted_at")
    .eq("request_id", requestId)
    .eq("format", format)
    .is("deleted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !item?.storage_path || item.storage_bucket !== SUBJECT_ACCESS_BUCKET) {
    throw new Error("subject_access_export_unavailable");
  }
  const { data: signed, error: signedError } = await service.storage
    .from(SUBJECT_ACCESS_BUCKET)
    .createSignedUrl(item.storage_path, SUBJECT_ACCESS_LINK_TTL_SECONDS, {
      download: `dfks-indsigt-${requestId}.${format}`,
    });
  if (signedError || !signed?.signedUrl) throw new Error("subject_access_link_failed");
  await service.from("subject_access_exports")
    .update({ last_link_issued_at: new Date().toISOString() })
    .eq("id", item.id);
  return { url: signed.signedUrl, contentHash: item.content_hash, expiresIn: SUBJECT_ACCESS_LINK_TTL_SECONDS };
}

export async function cleanupExpiredSubjectAccessExports(service: SupabaseClient): Promise<number> {
  const now = new Date().toISOString();
  const { data: expired, error } = await service
    .from("subject_access_exports")
    .select("id,storage_bucket,storage_path")
    .is("deleted_at", null)
    .lte("expires_at", now)
    .limit(500);
  if (error) throw new Error(`subject_access_cleanup_lookup_failed:${error.code ?? "database"}`);
  const candidates = (expired ?? []).filter(item => item.storage_bucket === SUBJECT_ACCESS_BUCKET && item.storage_path);
  if (!candidates.length) return 0;
  const { error: removeError } = await service.storage
    .from(SUBJECT_ACCESS_BUCKET)
    .remove(candidates.map(item => item.storage_path));
  if (removeError) throw new Error(`subject_access_cleanup_storage_failed:${removeError.message}`);
  const ids = candidates.map(item => item.id);
  const { error: updateError } = await service.from("subject_access_exports")
    .update({ deleted_at: now })
    .in("id", ids);
  if (updateError) throw new Error(`subject_access_cleanup_metadata_failed:${updateError.code ?? "database"}`);
  return ids.length;
}
