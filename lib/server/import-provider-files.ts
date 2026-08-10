import "server-only";

import { MAX_CONTRACT_IMPORT_BYTES } from "@/lib/contract-import";
import { decryptIntegrationCredentials, providerOAuthConfig, type ImportConnectionKind, type ImportProvider } from "@/lib/server/import-connection-oauth";

type Credentials = { refreshToken?: string };
export type ProviderFile = {
  id: string;
  name: string;
  revision: string;
  size: number;
  contentType: string | null;
  downloadPath?: string;
};

export type ProviderBrowseEntry = ProviderFile & {
  kind: "file" | "folder";
};

function googleDriveQueryValue(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

export async function browseGoogleDrive(input: {
  encryptedCredentials: string;
  connectionKind: ImportConnectionKind;
  folderId?: string;
  pageToken?: string;
  sharedWithMe?: boolean;
  pageSize?: number;
}) {
  const token = await providerAccessToken("google_drive", input.encryptedCredentials, input.connectionKind);
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  const q = input.sharedWithMe
    ? "sharedWithMe=true and trashed=false"
    : `'${googleDriveQueryValue(input.folderId || "root")}' in parents and trashed=false`;
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,version)");
  url.searchParams.set("pageSize", String(Math.min(200, Math.max(10, input.pageSize ?? 100))));
  url.searchParams.set("orderBy", "folder,name_natural");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Google Drive-forbindelsen skal godkendes igen");
    throw new Error("Google Drive-mappen kunne ikke læses");
  }
  const json = await response.json() as {
    nextPageToken?: string;
    files?: Array<{ id: string; name: string; mimeType?: string; size?: string; modifiedTime?: string; md5Checksum?: string; version?: string }>;
  };
  const entries: ProviderBrowseEntry[] = (json.files ?? []).map(file => ({
    id: file.id,
    name: file.name,
    size: Number(file.size) || 0,
    contentType: file.mimeType ?? null,
    revision: file.md5Checksum ?? file.version ?? file.modifiedTime ?? "unknown",
    kind: file.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file",
  }));
  return { entries, nextPageToken: json.nextPageToken ?? null };
}

export async function providerAccessToken(provider: ImportProvider, encryptedCredentials: string, connectionKind: ImportConnectionKind = "organisation") {
  const credentials = decryptIntegrationCredentials<Credentials>(encryptedCredentials);
  if (!credentials.refreshToken) throw new Error("Forbindelsen mangler et refresh-token");
  const config = providerOAuthConfig(provider, "http://localhost/oauth-callback", connectionKind);
  const body = new URLSearchParams({
    refresh_token: credentials.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = await response.json() as { access_token?: string };
  if (!response.ok || !json.access_token) throw new Error("Drevforbindelsen skal godkendes igen");
  return json.access_token;
}

async function listGoogleFolder(token: string, folderId: string, recursive: boolean) {
  const output: ProviderFile[] = [];
  const pending = [folderId];
  while (pending.length) {
    const parent = pending.shift()!;
    let pageToken = "";
    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", `'${googleDriveQueryValue(parent)}' in parents and trashed=false`);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,version)");
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Google Drive-mappen kunne ikke læses");
      const json = await response.json() as { nextPageToken?: string; files?: Array<{ id: string; name: string; mimeType?: string; size?: string; modifiedTime?: string; md5Checksum?: string; version?: string }> };
      for (const file of json.files ?? []) {
        if (file.mimeType === "application/vnd.google-apps.folder") {
          if (recursive) pending.push(file.id);
          continue;
        }
        const size = Number(file.size) || 0;
        output.push({ id: file.id, name: file.name, size, contentType: file.mimeType ?? null, revision: file.md5Checksum ?? file.version ?? file.modifiedTime ?? "unknown" });
      }
      pageToken = json.nextPageToken ?? "";
    } while (pageToken);
  }
  return output;
}

async function listOneDriveFolder(token: string, folderId: string, recursive: boolean) {
  const output: ProviderFile[] = [];
  const pending = [folderId];
  while (pending.length) {
    const id = pending.shift()!;
    let nextUrl: string | null = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(id)}/children?$select=id,name,size,file,folder,eTag,lastModifiedDateTime&$top=999`;
    while (nextUrl) {
      const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("OneDrive-mappen kunne ikke læses");
      const json = await response.json() as { value?: Array<{ id: string; name: string; size?: number; file?: { mimeType?: string }; folder?: unknown; eTag?: string; lastModifiedDateTime?: string }>; "@odata.nextLink"?: string };
      for (const file of json.value ?? []) {
        if (file.folder) {
          if (recursive) pending.push(file.id);
          continue;
        }
        output.push({ id: file.id, name: file.name, size: file.size ?? 0, contentType: file.file?.mimeType ?? null, revision: file.eTag ?? file.lastModifiedDateTime ?? "unknown" });
      }
      nextUrl = json["@odata.nextLink"] ?? null;
    }
  }
  return output;
}

async function listDropboxFolder(token: string, folderPath: string, recursive: boolean) {
  const output: ProviderFile[] = [];
  let response = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: folderPath === "/" ? "" : folderPath, recursive, include_deleted: false }),
    cache: "no-store",
  });
  let json = await response.json() as { entries?: Array<{ ".tag": string; id?: string; name: string; path_lower?: string; size?: number; rev?: string }>; cursor?: string; has_more?: boolean };
  while (true) {
    if (!response.ok) throw new Error("Dropbox-mappen kunne ikke læses");
    for (const file of json.entries ?? []) {
      if (file[".tag"] !== "file" || !file.id) continue;
      output.push({ id: file.id, name: file.name, size: file.size ?? 0, contentType: null, revision: file.rev ?? "unknown", downloadPath: file.path_lower });
    }
    if (!json.has_more || !json.cursor) break;
    response = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cursor: json.cursor }),
      cache: "no-store",
    });
    json = await response.json() as typeof json;
  }
  return output;
}

export async function listProviderFiles(input: {
  provider: ImportProvider;
  encryptedCredentials: string;
  folderId: string;
  recursive: boolean;
  connectionKind?: ImportConnectionKind;
}) {
  const token = await providerAccessToken(input.provider, input.encryptedCredentials, input.connectionKind);
  const files = input.provider === "google_drive"
    ? await listGoogleFolder(token, input.folderId, input.recursive)
    : input.provider === "onedrive"
      ? await listOneDriveFolder(token, input.folderId, input.recursive)
      : await listDropboxFolder(token, input.folderId, input.recursive);
  return { token, files };
}

export async function getProviderFile(provider: ImportProvider, token: string, id: string): Promise<ProviderFile> {
  if (!id || id.length > 1024) throw new Error("Ugyldig filreference");
  if (provider === "google_drive") {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,md5Checksum,version`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("Google Drive-filen kunne ikke læses");
    const file = await response.json() as { id: string; name: string; mimeType?: string; size?: string; modifiedTime?: string; md5Checksum?: string; version?: string };
    return { id: file.id, name: file.name, contentType: file.mimeType ?? null, size: Number(file.size) || 0, revision: file.md5Checksum ?? file.version ?? file.modifiedTime ?? "unknown" };
  }
  if (provider === "onedrive") {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(id)}?$select=id,name,size,file,eTag,lastModifiedDateTime`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("OneDrive-filen kunne ikke læses");
    const file = await response.json() as { id: string; name: string; size?: number; file?: { mimeType?: string }; eTag?: string; lastModifiedDateTime?: string };
    return { id: file.id, name: file.name, contentType: file.file?.mimeType ?? null, size: file.size ?? 0, revision: file.eTag ?? file.lastModifiedDateTime ?? "unknown" };
  }
  const response = await fetch("https://api.dropboxapi.com/2/files/get_metadata", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: id }), cache: "no-store" });
  if (!response.ok) throw new Error("Dropbox-filen kunne ikke læses");
  const file = await response.json() as { id: string; name: string; path_lower?: string; size?: number; rev?: string };
  return { id: file.id, name: file.name, contentType: null, size: file.size ?? 0, revision: file.rev ?? "unknown", downloadPath: file.path_lower };
}

export async function downloadProviderFile(provider: ImportProvider, token: string, file: ProviderFile) {
  if (file.size > MAX_CONTRACT_IMPORT_BYTES) throw new Error("Filen er større end 25 MB");
  const response = provider === "google_drive"
    ? await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
    : provider === "onedrive"
      ? await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(file.id)}/content`, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow", cache: "no-store" })
      : await fetch("https://content.dropboxapi.com/2/files/download", { headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": JSON.stringify({ path: file.downloadPath ?? file.id }) }, cache: "no-store" });
  if (!response.ok) throw new Error("Filen kunne ikke hentes fra drevet");
  const contentLength = Number(response.headers.get("content-length")) || file.size;
  if (contentLength > MAX_CONTRACT_IMPORT_BYTES) throw new Error("Filen er større end 25 MB");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_CONTRACT_IMPORT_BYTES) throw new Error("Filen er større end 25 MB");
  return buffer;
}

export async function revokeProviderCredentials(provider: ImportProvider, encryptedCredentials: string) {
  if (provider !== "google_drive") return;
  const credentials = decryptIntegrationCredentials<Credentials>(encryptedCredentials);
  if (!credentials.refreshToken) return;
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(credentials.refreshToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      cache: "no-store",
    });
  } catch {
    // Best effort: a local disconnect must still remove the encrypted token.
  }
}
