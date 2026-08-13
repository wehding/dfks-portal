import "server-only";

import { getInternalWorkerSecret } from "@/lib/api-auth";
import { resolveOnboardingWorkerOrigin } from "@/lib/onboarding-worker-origin";

export function driveImportWorkerSecret() {
  return getInternalWorkerSecret("drive-import");
}

export async function triggerDriveImportWorker(runId: string) {
  const secret = driveImportWorkerSecret();
  const origin = resolveOnboardingWorkerOrigin({
    nodeEnv: process.env.NODE_ENV,
    vercelUrl: process.env.VERCEL_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (!secret || !origin) return false;
  try {
    const response = await fetch(new URL("/api/import-connections/process", origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
