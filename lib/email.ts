import "server-only"

import { sendGmailEmail } from "@/lib/email/gmail"
import type { GmailSendResult } from "@/lib/email/gmail-core"

export { inviteEmailHtml, memberNotificationEmailHtml } from "@/lib/email/templates"

export interface EmailPayload {
    to: string
    subject: string
    html: string
    fromName: string
    replyTo?: string
}

export function sendEmail(payload: EmailPayload): Promise<GmailSendResult> {
    return sendGmailEmail(payload)
}
