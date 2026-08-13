import "server-only";
import { getInternalWorkerSecret } from "@/lib/api-auth";
import { resolveOnboardingWorkerOrigin } from "@/lib/onboarding-worker-origin";

export function onboardingImportWorkerSecret() {
  return getInternalWorkerSecret("onboarding-import");
}

export async function triggerOnboardingImportWorker(jobId: string) {
  const secret = onboardingImportWorkerSecret();
  const origin = resolveOnboardingWorkerOrigin({
    nodeEnv: process.env.NODE_ENV,
    vercelUrl: process.env.VERCEL_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (!secret || !origin) return false;
  try {
    const response = await fetch(new URL("/api/onboarding/work-import/process", origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
