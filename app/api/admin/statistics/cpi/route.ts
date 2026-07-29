import { NextResponse } from "next/server";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { syncStatisticsCpi } from "@/lib/statistics-cpi";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

export async function POST() {
  const caller = await assertAdminRole(await createClient(), USER_ADMIN_ROLES);
  if (!caller) return NextResponse.json({ error: "Ingen statistikadgang" }, { status: 403 });
  try {
    return NextResponse.json(await syncStatisticsCpi());
  } catch (error) {
    console.error("[statistics-cpi]", error instanceof Error ? error.message : "Ukendt fejl");
    return NextResponse.json({ error: "Inflationsdata kunne ikke opdateres." }, { status: 502 });
  }
}
