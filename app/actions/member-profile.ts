"use server";

import { createClient } from "@/lib/supabase/server";
import { encryptValue } from "@/lib/encryption";
import { revalidatePath } from "next/cache";

export async function completeOnboarding(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Ikke logget ind" };

  // full_name kombineres af fornavn + efternavn
  const firstName = (formData.get("first_name") as string)?.trim() ?? "";
  const lastName = (formData.get("last_name") as string)?.trim() ?? "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  const { error } = await supabase
    .from("rettighedshavere")
    .update({
      full_name: fullName || undefined,
      email: (formData.get("email") as string) || undefined,
      phone: (formData.get("phone") as string) || null,
      address: (formData.get("address") as string) || null,
      cpr_no: encryptValue(formData.get("cpr")),
      bank_account: encryptValue(formData.get("bank_account")),
      gender: (formData.get("gender") as string) || null,
      opt_out_statistics: formData.get("opt_out_statistics") === "true",
      onboarding_completed: true,
    })
    .eq("user_id", user.id);

  if (error) {
    console.error("Onboarding fejl:", error);
    return { success: false, error: `Kunne ikke gemme onboarding-data: ${error.message} (${error.code})` };
  }

  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/portal/min-profil");
  return { success: true };
}
