"use server";

import { createClient } from "@/lib/supabase/server";
import { encryptValue } from "@/lib/encryption";
import { revalidatePath } from "next/cache";
import { normalizeBankAccount, normalizeCpr, validateOnboardingField } from "@/lib/onboarding-validation";

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
  const loginEmail = user.email?.trim() ?? "";
  const phone = ((formData.get("phone") as string) ?? "").trim();
  const cpr = ((formData.get("cpr") as string) ?? "").trim();
  const bankAccount = ((formData.get("bank_account") as string) ?? "").trim();
  const validationError = [
    validateOnboardingField("name", fullName),
    validateOnboardingField("email", loginEmail),
    validateOnboardingField("phone", phone),
    validateOnboardingField("cpr", cpr),
    validateOnboardingField("bank_account", bankAccount),
  ].find(Boolean);
  if (validationError) return { success: false, error: validationError };
  const street = ((formData.get("address") as string) ?? "").trim();
  const zip = ((formData.get("zip") as string) ?? "").trim();
  const city = ((formData.get("city") as string) ?? "").trim();
  const address = [street, [zip, city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

  let { error } = await supabase
    .from("rettighedshavere")
    .update({
      full_name: fullName || undefined,
      email: loginEmail,
      phone: phone || null,
      address,
      cpr_no: encryptValue(cpr ? normalizeCpr(cpr) : null),
      bank_account: encryptValue(bankAccount ? normalizeBankAccount(bankAccount) : null),
      gender: (formData.get("gender") as string) || null,
      opt_out_statistics: formData.get("opt_out_statistics") === "true",
      onboarding_completed: true,
    })
    .eq("user_id", user.id);

  if (error && error.message.includes("gender")) {
    console.warn("Gender column not found in database schema, retrying without gender field...");
    const retry = await supabase
      .from("rettighedshavere")
      .update({
        full_name: fullName || undefined,
        email: loginEmail,
        phone: phone || null,
        address,
        cpr_no: encryptValue(cpr ? normalizeCpr(cpr) : null),
        bank_account: encryptValue(bankAccount ? normalizeBankAccount(bankAccount) : null),
        opt_out_statistics: formData.get("opt_out_statistics") === "true",
        onboarding_completed: true,
      })
      .eq("user_id", user.id);
    
    error = retry.error;
  }

  if (error) {
    console.error("Onboarding fejl:", error);
    return { success: false, error: `Kunne ikke gemme onboarding-data: ${error.message} (${error.code})` };
  }

  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/portal/min-profil");
  return { success: true };
}
