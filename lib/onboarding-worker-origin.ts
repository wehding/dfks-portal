export function resolveOnboardingWorkerOrigin(input: {
  nodeEnv?: string;
  vercelUrl?: string;
  siteUrl?: string;
}) {
  if (input.nodeEnv !== "production") return "http://127.0.0.1:3000";
  const vercelHost = input.vercelUrl?.trim().toLowerCase();
  if (vercelHost && /^[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/.test(vercelHost)) return `https://${vercelHost}`;
  if (!input.siteUrl) return null;
  try {
    const url = new URL(input.siteUrl);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
