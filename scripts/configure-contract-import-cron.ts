import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const workerSecret = process.env.CONTRACT_AI_JOB_SECRET?.trim();

  if (!url || !serviceKey || !siteUrl || !workerSecret) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL og CONTRACT_AI_JOB_SECRET skal findes i .env.local");
  }

  if (!siteUrl.startsWith("https://")) throw new Error("NEXT_PUBLIC_SITE_URL skal være den offentlige HTTPS-adresse");

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.rpc("configure_contract_import_cron", {
    p_worker_url: `${siteUrl}/api/contracts/jobs/process`,
    p_internal_secret: workerSecret,
  });
  if (error) throw new Error(error.message);
  console.log("Supabase Cron er konfigureret til kontraktimport hvert femte minut.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Supabase Cron kunne ikke konfigureres.");
  process.exitCode = 1;
});
