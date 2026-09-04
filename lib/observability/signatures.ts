import { createHmac, timingSafeEqual } from "node:crypto";

export function signPayload(rawBody: string, secret: string, algorithm: "sha1" | "sha256" = "sha256"): string {
  return createHmac(algorithm, secret).update(rawBody).digest("hex");
}

export function verifyPayloadSignature(rawBody: string, signature: string | null, secret: string, algorithm: "sha1" | "sha256" = "sha256"): boolean {
  if (!signature || !secret) return false;
  const expected = signPayload(rawBody, secret, algorithm);
  const received = signature.replace(/^sha(?:1|256)=/i, "");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
