export function resolveConfiguredSiteUrl(input: {
  siteUrl?: string | null;
  nodeEnv?: string | null;
}) {
  const raw = input.siteUrl?.trim();
  if (!raw) return input.nodeEnv === "production" ? null : "http://localhost:3000";
  try {
    const url = new URL(raw);
    const localDevelopment = input.nodeEnv !== "production"
      && url.protocol === "http:"
      && ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
    if (url.protocol !== "https:" && !localDevelopment) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function requireConfiguredSiteUrl() {
  const siteUrl = resolveConfiguredSiteUrl({
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    nodeEnv: process.env.NODE_ENV,
  });
  if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL mangler eller er ikke en sikker HTTPS-adresse.");
  return siteUrl;
}
