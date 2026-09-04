import { safeRichTextToHtml } from "@/lib/safe-rich-text";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeColor(value: string | undefined): string {
  const color = value?.trim() || "#111827";
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color) ? color : "#111827";
}

export function inviteEmailHtml(params: {
  recipientName: string;
  inviteUrl: string;
  orgName: string;
  primaryColor?: string;
  title?: string;
  bodyText?: string | null;
  variant?: "invite" | "reminder" | "new_link";
  accessType?: "invite" | "recovery";
  bodyIncludesGreeting?: boolean;
}): string {
  const { recipientName, inviteUrl, orgName } = params;
  const color = safeColor(params.primaryColor);
  const safeName = escapeHtml(recipientName?.trim() || "der");
  const safeOrgName = escapeHtml(orgName);
  const safeInviteUrl = escapeHtml(inviteUrl);
  const defaultText = params.variant === "new_link"
    ? `Her følger et nyt link til ${orgName}s portal. Klik på knappen herunder for at få adgang.`
    : params.variant === "reminder"
    ? `Du får her en 2. invitation til ${orgName}s portal. Brug knappen herunder for at oprette eller færdiggøre din adgang.`
    : params.accessType === "recovery"
      ? `Du har allerede en bruger til ${orgName}s portal. Brug knappen for at vælge en ny adgangskode og åbne din adgang.`
      : `Du er blevet inviteret til ${orgName}s portal. Klik på knappen for at oprette din adgang:`;
  const bodyText = params.bodyText?.trim() || defaultText;
  const bodyHtml = safeRichTextToHtml(bodyText);
  const actionLabel = params.variant === "new_link"
    ? "Åbn portalen"
    : params.accessType === "recovery" ? "Vælg ny adgangskode" : "Opret min adgang";
  const headerTitle = params.title?.trim()
    ? escapeHtml(params.title.trim())
    : params.variant === "new_link"
      ? `Nyt link til ${safeOrgName}`
      : `Velkommen til ${safeOrgName}`;
  return `
<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #111827;">
  <h2 style="color: ${color}; font-size: 20px;">${headerTitle}</h2>
  ${params.bodyIncludesGreeting ? "" : `<p>Hej ${safeName},</p>`}
  <div style="line-height: 1.55;">${bodyHtml}</div>
  <p style="margin: 24px 0;">
    <a href="${safeInviteUrl}" style="background: ${color}; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">${actionLabel}</a>
  </p>
  <p style="font-size: 13px; color: #6b7280;">Linket er gyldigt i 7 dage og kan kun bruges én gang. Virker knappen ikke, kan du kopiere denne adresse ind i din browser:<br>
    <span style="word-break: break-all;">${safeInviteUrl}</span>
  </p>
</div>`.trim();
}

export function memberNotificationEmailHtml(params: {
  recipientName: string;
  orgName: string;
  subject: string;
  bodyText: string;
  link: string;
  primaryColor?: string;
}): string {
  const color = safeColor(params.primaryColor);
  const safeName = escapeHtml(params.recipientName?.trim() || "der");
  const safeOrgName = escapeHtml(params.orgName);
  const safeSubject = escapeHtml(params.subject);
  const safeLink = escapeHtml(params.link);
  const bodyHtml = safeRichTextToHtml(params.bodyText);
  return `
<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #111827;">
  <h2 style="color: ${color}; font-size: 20px;">${safeSubject}</h2>
  <p>Hej ${safeName},</p>
  <div style="line-height: 1.55;">${bodyHtml}</div>
  <p style="margin: 24px 0;"><a href="${safeLink}" style="background: ${color}; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Åbn ${safeOrgName}s portal</a></p>
  <p style="font-size: 13px; color: #6b7280;">Virker knappen ikke, kan du kopiere adressen:<br><span style="word-break: break-all;">${safeLink}</span></p>
</div>`.trim();
}
