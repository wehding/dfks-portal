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

// Baggrundsworkers skal kunne nå deres egen route gennem invite-gaten. Ruten
// håndhæver selv et scoped bearer-secret (eller en autentificeret admin), så
// den må være et eksakt match og ikke et bredt public prefix.
const PUBLIC_EXACT_PATHS = new Set([
  "/api/contracts/jobs/process",
  "/api/internal/document-processing/claim",
  "/api/internal/document-processing/complete",
  "/api/internal/document-processing/heartbeat",
  "/api/internal/document-processing/upload-authorisation",
]);

export function isPublicPath(pathname: string) {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;

  // Callbacken validerer selv Supabase-session, engangs-state og rolle. Den skal
  // nå ruten, så OAuth-koden ikke flyttes til /invite som en query-parameter.
  return /^\/api\/admin\/import-connections\/(google_drive|onedrive|dropbox)\/callback$/.test(pathname);
}
