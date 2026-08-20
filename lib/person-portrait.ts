const ALLOWED_PORTRAIT_HOSTS = new Set([
  "image.tmdb.org",
  "www.dfi.dk",
  "dfi.dk",
  "api.dfi.dk",
  "data.dfi.dk",
  "dfi-dam.qonqord.cloud",
]);

export function isAllowedPortraitSource(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:" && ALLOWED_PORTRAIT_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
