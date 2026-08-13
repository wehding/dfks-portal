const PUBLIC_PATH_PREFIXES = [
  "/invite",
  "/api/auth/invite",
  "/api/auth/callback",
  "/api/integrations/gmail/contracts/push",
  "/auth/confirm",
  "/auth/opret-adgang",
  "/_next",
  "/favicon",
];

export function isPublicPath(pathname: string) {
  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;

  // Callbacken validerer selv Supabase-session, engangs-state og rolle. Den skal
  // nå ruten, så OAuth-koden ikke flyttes til /invite som en query-parameter.
  return /^\/api\/admin\/import-connections\/(google_drive|onedrive|dropbox)\/callback$/.test(pathname);
}
