import "server-only";

import { decryptValue, encryptValue, isEncryptedValue } from "@/lib/encryption";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ForeningLetConfig = {
  username: string;
  password: string;
};

export type PublicForeningLetIntegration = {
  provider: "foreninglet";
  base_url: string;
  enabled: boolean;
  has_credentials: boolean;
};

const DEFAULT_FORENINGLET_BASE_URL = "https://foreninglet.dk/api/members";
const OFFICIAL_FORENINGLET_HOST = "foreninglet.dk";

function assertAllowedForeningLetUrl(rawUrl: string | null | undefined): string {
  const value = rawUrl?.trim() || DEFAULT_FORENINGLET_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("ForeningLet-URL er ugyldig.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAllowedHost =
    hostname === OFFICIAL_FORENINGLET_HOST ||
    hostname.endsWith(`.${OFFICIAL_FORENINGLET_HOST}`);

  if (parsed.protocol !== "https:" || !isAllowedHost) {
    throw new Error("ForeningLet-URL skal bruge https og ligge på foreninglet.dk.");
  }

  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

function parseConfig(value: string | null | undefined): Partial<ForeningLetConfig> {
  if (!value) return {};
  try {
    const decrypted = isEncryptedValue(value) ? decryptValue(value) : value;
    const parsed = JSON.parse(decrypted) as Partial<ForeningLetConfig>;
    return {
      username: typeof parsed.username === "string" ? parsed.username : "",
      password: typeof parsed.password === "string" ? parsed.password : "",
    };
  } catch {
    return {};
  }
}

export async function getForeningLetIntegration(
  db: SupabaseClient,
  orgId: string
): Promise<PublicForeningLetIntegration> {
  const { data } = await db
    .from("org_integrations")
    .select("base_url, config_encrypted, enabled")
    .eq("org_id", orgId)
    .eq("provider", "foreninglet")
    .maybeSingle();

  const config = parseConfig(data?.config_encrypted as string | null | undefined);
  return {
    provider: "foreninglet",
    base_url: assertAllowedForeningLetUrl(data?.base_url as string | null),
    enabled: data?.enabled !== false,
    has_credentials: Boolean(config.username && config.password),
  };
}

export async function resolveForeningLetCredentials(
  db: SupabaseClient,
  orgId: string
): Promise<{ baseUrl: string; username: string; password: string; source: "org" | "env" }> {
  const { data } = await db
    .from("org_integrations")
    .select("base_url, config_encrypted, enabled")
    .eq("org_id", orgId)
    .eq("provider", "foreninglet")
    .maybeSingle();

  if (data?.enabled !== false) {
    const config = parseConfig(data?.config_encrypted as string | null | undefined);
    const orgBaseUrl = data?.base_url as string | null;
    if (config.username && config.password) {
      return {
        baseUrl: assertAllowedForeningLetUrl(orgBaseUrl),
        username: config.username,
        password: config.password,
        source: "org",
      };
    }
    if (orgBaseUrl && assertAllowedForeningLetUrl(orgBaseUrl) !== DEFAULT_FORENINGLET_BASE_URL) {
      throw new Error("Organisationens ForeningLet-URL kræver egne credentials.");
    }
  }

  const username = process.env.FORENINGLET_USERNAME;
  const password = process.env.FORENINGLET_PASSWORD;
  if (!username || !password) {
    throw new Error("ForeningLet-login mangler i miljøet eller i organisationens opsætning.");
  }
  const envBaseUrl = assertAllowedForeningLetUrl(process.env.FORENINGLET_BASE_URL || DEFAULT_FORENINGLET_BASE_URL);
  if (envBaseUrl !== assertAllowedForeningLetUrl(DEFAULT_FORENINGLET_BASE_URL)) {
    throw new Error("Globale ForeningLet-credentials må kun bruges mod standard ForeningLet-URL'en.");
  }
  return {
    baseUrl: envBaseUrl,
    username,
    password,
    source: "env",
  };
}

export async function upsertForeningLetIntegration(
  db: SupabaseClient,
  orgId: string,
  input: { base_url?: string | null; username?: string | null; password?: string | null; enabled: boolean }
) {
  const { data: existing } = await db
    .from("org_integrations")
    .select("config_encrypted")
    .eq("org_id", orgId)
    .eq("provider", "foreninglet")
    .maybeSingle();

  const existingConfig = parseConfig(existing?.config_encrypted as string | null | undefined);
  const username = input.username?.trim() || existingConfig.username || "";
  const password = input.password?.trim() || existingConfig.password || "";
  const config = username || password ? encryptValue(JSON.stringify({ username, password })) : null;

  const { error } = await db
    .from("org_integrations")
    .upsert({
      org_id: orgId,
      provider: "foreninglet",
      base_url: assertAllowedForeningLetUrl(input.base_url),
      config_encrypted: config,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: "org_id,provider" });

  if (error) throw new Error(error.message);
}
