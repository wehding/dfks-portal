import "server-only";

import { OAuth2Client } from "google-auth-library";

const verifier = new OAuth2Client();

export async function verifyOcrCloudRunRequest(request: Request): Promise<void> {
  const audience = process.env.OCR_CLOUD_RUN_AUDIENCE?.trim();
  const expectedEmail = process.env.OCR_CLOUD_RUN_SERVICE_ACCOUNT?.trim().toLowerCase();
  if (!audience || !expectedEmail) throw new Error("OCR Cloud Run-identiteten er ikke konfigureret.");

  const idToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!idToken) throw new Error("Cloud Run-kaldet mangler et identitetstoken.");

  const ticket = await verifier.verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (
    !payload
    || payload.email_verified !== true
    || payload.email?.toLowerCase() !== expectedEmail
  ) {
    throw new Error("Cloud Run-tokenet tilhører ikke den forventede servicekonto.");
  }
}
