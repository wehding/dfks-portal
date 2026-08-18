import "server-only";

import { createHmac } from "node:crypto";
import { getRequiredEnv } from "@/lib/env";

/**
 * Produces an organisation- and epoch-scoped key for statistics facts. The raw
 * rights-holder id must not be persisted in statistics-only tables.
 */
export function statisticsPseudonym(orgId: string, rightsHolderId: string, epoch = "v1") {
  const secret = getRequiredEnv("STATISTICS_PSEUDONYM_SECRET");
  return createHmac("sha256", secret)
    .update(`${epoch}\u0000${orgId}\u0000${rightsHolderId}`)
    .digest("base64url");
}
