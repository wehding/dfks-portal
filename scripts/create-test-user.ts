/**
 * Opretter en test-member bruger til lokal udvikling.
 * Kør: npx tsx scripts/create-test-user.ts
 */
import { createClient } from "@supabase/supabase-js";

const EMAIL = "test@dfks.dk";
const PASSWORD = "test1234";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  // Opret bruger (eller ignorer hvis allerede findes)
  const { data: existing } = await supabase
    .from("rettighedshavere")
    .select("id, user_id, onboarding_completed")
    .eq("email", EMAIL)
    .maybeSingle();

  if (existing?.user_id) {
    console.log(`✅ Test-bruger eksisterer allerede`);
    console.log(`   Email:    ${EMAIL}`);
    console.log(`   Password: ${PASSWORD}`);
    console.log(`   Onboarding gennemført: ${existing.onboarding_completed}`);

    if (existing.onboarding_completed) {
      // Nulstil onboarding så den kan testes igen
      await supabase
        .from("rettighedshavere")
        .update({ onboarding_completed: false })
        .eq("id", existing.id);
      console.log(`   → Onboarding nulstillet til false`);
    }
    return;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { role: "member" },
  });

  if (error) {
    console.error("Fejl:", error.message);
    process.exit(1);
  }

  console.log(`✅ Test-bruger oprettet`);
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log(`   User ID:  ${data.user.id}`);
  console.log(`\n→ Gå til http://localhost:3000 og log ind`);
}

main();
