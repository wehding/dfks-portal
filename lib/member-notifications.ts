import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { memberNotificationEmailHtml, sendEmail } from "@/lib/email";
import { resolveBranding, resolveFromEmail } from "@/lib/branding";

type NotificationCategory = "transactional" | "broadcast";

export async function sendMemberNotification(params: {
  eventKey: string;
  eventType: string;
  orgId: string;
  rightsHolderId: string;
  category: NotificationCategory;
  subject: string;
  bodyText: string;
  path: string;
  entityType?: string;
  entityId?: string;
}) {
  const db = createServiceClient();
  const [{ data: holder }, { data: org }] = await Promise.all([
    db.from("rettighedshavere").select("id,full_name,email,email_transactional_enabled,email_broadcast_enabled,org_affiliations!inner(org_id)").eq("id", params.rightsHolderId).eq("org_affiliations.org_id", params.orgId).maybeSingle(),
    db.from("organisations").select("id,name,branding,from_email").eq("id", params.orgId).maybeSingle(),
  ]);
  if (!holder || !org) return { ok: false, skipped: true, error: "Modtager eller organisation findes ikke" };

  const { data: existing } = await db.from("notification_deliveries").select("id,status").eq("org_id", params.orgId).eq("event_key", params.eventKey).maybeSingle();
  if (existing) return { ok: existing.status === "sent", skipped: true };

  const enabled = params.category === "broadcast" ? holder.email_broadcast_enabled : holder.email_transactional_enabled;
  const { data: delivery, error: insertError } = await db.from("notification_deliveries").insert({
    org_id: params.orgId,
    rights_holder_id: params.rightsHolderId,
    event_key: params.eventKey,
    event_type: params.eventType,
    category: params.category,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    to_email: holder.email,
    subject: params.subject,
    status: enabled && holder.email ? "queued" : "skipped",
  }).select("id").single();
  if (insertError || !delivery) return { ok: false, error: insertError?.message ?? "Leverancen kunne ikke registreres" };
  if (!enabled || !holder.email) return { ok: true, skipped: true };

  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const branding = resolveBranding(org as never);
  const link = `${baseUrl}${params.path.startsWith("/") ? params.path : `/${params.path}`}`;
  const result = await sendEmail({
    to: holder.email,
    subject: params.subject,
    from: resolveFromEmail(org as never),
    html: memberNotificationEmailHtml({ recipientName: holder.full_name, orgName: branding.short_name, subject: params.subject, bodyText: params.bodyText, link, primaryColor: branding.primary_color }),
  });
  await db.from("notification_deliveries").update({
    status: result.ok ? "sent" : "failed",
    attempts: 1,
    last_error: result.error ?? null,
    sent_at: result.ok ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", delivery.id);
  return result;
}
