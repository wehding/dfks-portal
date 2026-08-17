import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, inviteEmailHtml } from "@/lib/email";
import { resolveBranding, resolveEmailSenderName, resolveReplyToEmail } from "@/lib/branding";
import { buildAccountAccessUrl } from "@/lib/auth/account-access";
import { requireConfiguredSiteUrl } from "@/lib/site-url";
import { consumeRateLimit, requestIdentifier } from "@/lib/server/rate-limit";

const GENERIC_RESPONSE = {
  ok: true,
  message: "Hvis e-mailadressen findes, sender vi et link til at vælge en ny adgangskode.",
};

export async function POST(request: NextRequest) {
  const rateLimit = await consumeRateLimit({
    bucket: "password-reset",
    identifier: requestIdentifier(request.headers),
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(GENERIC_RESPONSE, {
      status: 202,
      headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
    });
  }

  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
  }

  try {
    const admin = createServiceClient();
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email });
    if (linkError || !linkData.properties?.hashed_token || !linkData.user) {
      return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
    }
    const user = linkData.user;
    const { data: holder } = await admin
      .from("rettighedshavere")
      .select("full_name,org_affiliations(org_id,organisations(name,from_email,branding))")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    const affiliation = Array.isArray(holder?.org_affiliations) ? holder.org_affiliations[0] : null;
    let organisation = Array.isArray(affiliation?.organisations)
      ? affiliation.organisations[0]
      : affiliation?.organisations ?? null;
    if (!organisation) {
      const { data: role } = await admin.from("user_org_roles").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
      if (role?.org_id) {
        const { data } = await admin.from("organisations").select("name,from_email,branding").eq("id", role.org_id).maybeSingle();
        organisation = data;
      }
    }

    const brand = resolveBranding(organisation as never);
    const resetUrl = buildAccountAccessUrl(requireConfiguredSiteUrl(), linkData.properties.hashed_token, "recovery");
    await sendEmail({
      to: email,
      fromName: resolveEmailSenderName(organisation as never),
      replyTo: resolveReplyToEmail(organisation as never),
      subject: `Vælg en ny adgangskode til ${brand.long_name}s portal`,
      html: inviteEmailHtml({
        recipientName: holder?.full_name ?? "",
        inviteUrl: resetUrl,
        orgName: brand.long_name,
        primaryColor: brand.primary_color,
        accessType: "recovery",
      }),
    });
  } catch (error) {
    console.error("[auth/request-password-reset] Password-reset kunne ikke afsendes", {
      reason: error instanceof Error ? error.name : "unknown",
    });
  }

  return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
}
