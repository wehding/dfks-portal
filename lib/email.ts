/**
 * lib/email.ts
 *
 * Abstraktionslag for e-mailafsendelse.
 * Udbyderen skiftes ét sted her — resten af koden kalder bare sendEmail().
 *
 * Nuværende udbyder: Resend (nemt at skifte til Brevo ved at ændre send()-funktionen)
 * Env var: RESEND_API_KEY
 */

export interface EmailPayload {
    to: string
    subject: string
    html: string
    replyTo?: string
    from?: string
}

const DEFAULT_FROM = "DFKS <noreply@dfks.dk>"

export async function sendEmail(payload: EmailPayload): Promise<{ ok: boolean; error?: string }> {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
        console.error("[email] RESEND_API_KEY er ikke sat")
        return { ok: false, error: "E-mail ikke konfigureret" }
    }

    const body = {
        from: payload.from ?? DEFAULT_FROM,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
    }

    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        })

        if (!res.ok) {
            const err = await res.text()
            console.error("[email] Resend fejl:", err)
            return { ok: false, error: `Resend API fejl ${res.status}` }
        }

        return { ok: true }
    } catch (err: any) {
        console.error("[email] Uventet fejl:", err)
        return { ok: false, error: err.message }
    }
}

// ── Skabeloner ─────────────────────────────────────────────────

// Invitationsmail med login-link. orgName + primaryColor styres af foreningens branding.
export function inviteEmailHtml(params: {
    recipientName: string
    inviteUrl: string
    orgName: string
    primaryColor?: string
}): string {
    const { recipientName, inviteUrl, orgName } = params
    const color = params.primaryColor ?? "#111827"
    const safeName = recipientName?.trim() || "der"
    return `
<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #111827;">
  <h2 style="color: ${color}; font-size: 20px;">Velkommen til ${orgName}</h2>
  <p>Hej ${safeName},</p>
  <p>Du er blevet inviteret til ${orgName}s portal. Klik på knappen for at oprette din adgang:</p>
  <p style="margin: 24px 0;">
    <a href="${inviteUrl}" style="background: ${color}; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Opret min adgang</a>
  </p>
  <p style="font-size: 13px; color: #6b7280;">Linket er gyldigt i 24 timer. Virker knappen ikke, kan du kopiere denne adresse ind i din browser:<br>
    <span style="word-break: break-all;">${inviteUrl}</span>
  </p>
</div>`.trim()
}

// ── Skift til Brevo ────────────────────────────────────────────
// Udskift sendEmail() ovenfor med nedenstående og ret env var til BREVO_API_KEY:
//
// export async function sendEmail(payload: EmailPayload) {
//   const res = await fetch("https://api.brevo.com/v3/smtp/email", {
//     method: "POST",
//     headers: { "Content-Type": "application/json", "api-key": process.env.BREVO_API_KEY! },
//     body: JSON.stringify({
//       sender: { name: "DFKS", email: "noreply@dfks.dk" },
//       to: [{ email: payload.to }],
//       subject: payload.subject,
//       htmlContent: payload.html,
//     }),
//   })
//   return { ok: res.ok }
// }
