export type GoogleDriveConnectionKind = "organisation" | "member";

type ServerEnvironment = Record<string, string | undefined>;

export function googleDriveOAuthCredentials(kind: GoogleDriveConnectionKind, environment: ServerEnvironment) {
  const prefix = kind === "member" ? "GOOGLE_DRIVE_MEMBER" : "GOOGLE_DRIVE_ADMIN";
  const clientId = environment[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = environment[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(kind === "member"
      ? "Google Drive for medlemmer er ikke konfigureret"
      : "Google Drive for organisationen er ikke konfigureret");
  }
  return { clientId, clientSecret };
}
