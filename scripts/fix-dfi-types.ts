/**
 * Henter korrekt type fra DFI for alle works med dfi_id og opdaterer DB.
 * Kør: npx dotenvx run -f .env.local -- npx tsx scripts/fix-dfi-types.ts
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function fetchDFIFilm(dfiId: string) {
  const username = process.env.DFI_API_USERNAME;
  const password = process.env.DFI_API_PASSWORD;
  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  const res = await fetch(`https://data.dfi.dk/v1/film/${dfiId}`, {
    headers: { Authorization: authHeader, Accept: "application/json", "Accept-Language": "da-DK" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

function detectType(film: any): string {
  const combined = ((film.Category || "") + " " + (film.Type || "")).toLowerCase();
  if (combined.includes("dokumentar") && combined.includes("serie")) return "serie";
  if (combined.includes("dokumentar")) return "dokumentar";
  if (combined.includes("serie") || combined.includes("tv-")) return "serie";
  if (combined.includes("kort")) return "kortfilm";
  return "fiktion";
}

async function main() {
  const { data: works } = await supabase
    .from("works")
    .select("id, title, type, dfi_id")
    .not("dfi_id", "is", null);

  if (!works?.length) { console.log("Ingen works med dfi_id"); return; }

  console.log(`Tjekker ${works.length} works mod DFI...`);
  let updated = 0, unchanged = 0, failed = 0;

  for (const work of works) {
    try {
      const film = await fetchDFIFilm(work.dfi_id!);
      if (!film) { console.warn(`  ⚠ Kunne ikke hente DFI ${work.dfi_id} (${work.title})`); failed++; continue; }

      const correctType = detectType(film);
      if (correctType === work.type) { unchanged++; continue; }

      await supabase.from("works").update({ type: correctType }).eq("id", work.id);
      console.log(`  ✓ "${work.title}": ${work.type} → ${correctType}`);
      updated++;

      // Lille pause for ikke at overbelaste DFI API
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      console.error(`  ✗ Fejl for "${work.title}":`, err.message);
      failed++;
    }
  }

  console.log(`\nFærdig: ${updated} opdateret, ${unchanged} uændret, ${failed} fejl`);
}

main();
