"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { assertRightsHolderInOrg } from "@/lib/authz";
import { encryptValue } from "@/lib/encryption";

type RightsHolderInput = {
  full_name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  cpr_no?: string | null;
  bank_account?: string | null;
  gender?: string | null;
  opt_out_statistics?: boolean | null;
};

function securePayload(input: RightsHolderInput) {
  return {
    full_name: input.full_name,
    email: input.email || null,
    phone: input.phone || null,
    address: input.address || null,
    cpr_no: encryptValue(input.cpr_no),
    bank_account: encryptValue(input.bank_account),
    ...(input.gender !== undefined ? { gender: input.gender || null } : {}),
    ...(input.opt_out_statistics !== undefined ? { opt_out_statistics: Boolean(input.opt_out_statistics) } : {}),
  };
}

export async function createRettighedshaverSecure(
  input: RightsHolderInput,
  orgId: string,
  isMember: boolean,
  memberNo?: string
) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase);
  if (!caller || caller.orgId !== orgId) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  const { data: rh, error } = await db
    .from("rettighedshavere")
    .insert(securePayload(input))
    .select("id")
    .single();

  if (error || !rh) return { success: false, error: error?.message ?? "Kunne ikke oprette rettighedshaver" };

  const { error: affiliationError } = await db.from("org_affiliations").insert({
    org_id: orgId,
    rights_holder_id: rh.id,
    is_member: isMember,
    member_no: memberNo ?? null,
  });

  if (affiliationError) {
    await db.from("rettighedshavere").delete().eq("id", rh.id);
    return { success: false, error: affiliationError.message };
  }

  revalidatePath("/admin/rettighedshavere");
  return { success: true, rightsHolder: rh };
}

export async function updateRettighedshaverSecure(
  id: string,
  orgId: string,
  input: RightsHolderInput
) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase);
  if (!caller || caller.orgId !== orgId) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  try {
    await assertRightsHolderInOrg(db, id, orgId);
  } catch {
    return { success: false, error: "Rettighedshaveren tilhører ikke din organisation" };
  }

  const { error } = await db
    .from("rettighedshavere")
    .update(Object.fromEntries(
      Object.entries(securePayload(input)).filter(([key, value]) => {
        if ((key === "cpr_no" || key === "bank_account") && value === null) return false;
        return true;
      })
    ))
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/rettighedshavere");
  return { success: true };
}
