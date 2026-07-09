type EnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "SUPABASE_SERVICE_KEY"
  | "ANTHROPIC_API_KEY"
  | "TMDB_API_KEY"
  | "FORENINGLET_USERNAME"
  | "FORENINGLET_PASSWORD";

export function getRequiredEnv(key: EnvKey) {
  const value = process.env[key];
  if (!value) throw new Error(`Miljøvariablen ${key} mangler`);
  return value;
}

export function getOptionalEnv(key: EnvKey) {
  return process.env[key] || undefined;
}

export function getSupabaseServiceKey() {
  const key = getOptionalEnv("SUPABASE_SERVICE_ROLE_KEY") ?? getOptionalEnv("SUPABASE_SERVICE_KEY");
  if (!key) throw new Error("Supabase service-role miljøvariabler mangler");
  return key;
}
