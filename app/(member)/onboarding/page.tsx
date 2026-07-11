import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { decryptRettighedshaver } from "@/lib/encryption";
import OnboardingClient from "./OnboardingClient";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: rh } = await supabase
    .from("rettighedshavere")
    .select("full_name, email, phone, address, cpr_no, bank_account, gender, onboarding_completed")
    .eq("user_id", user.id)
    .single();

  if (rh?.onboarding_completed) {
    redirect("/portal");
  }

  return <OnboardingClient rh={decryptRettighedshaver(rh)} user={user} />;
}
