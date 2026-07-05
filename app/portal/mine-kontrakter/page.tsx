export const dynamic = "force-dynamic";

import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import MineKontrakterClient from "./MineKontrakterClient";
import type { Contract } from "./MineKontrakterClient";

type WorkRelation = { id: string; title: string; year: number | null; type: string };
type WorkAssignmentRow = { works: WorkRelation | WorkRelation[] | null };
type RawContract = Omit<Contract, "works" | "employers"> & {
  works: Contract["works"] | Contract["works"][];
  employers: Contract["employers"] | Contract["employers"][];
};

function getWorkRelation(row: WorkAssignmentRow) {
  return Array.isArray(row.works) ? row.works[0] ?? null : row.works;
}

function isWorkRelation(work: WorkRelation | null): work is WorkRelation {
  return Boolean(work);
}

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function MineKontrakterPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/")

  const db = createServiceClient();

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();

  const { data: contracts } = rh
    ? await db
        .from("contracts")
        .select("id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, created_at, works(id, title, year), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes), contract_attachments(id, type, title, pdf_url, created_at)")
        .eq("rights_holder_id", rh.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  // Brugerens egne værker til work-kobling
  const { data: myWorks } = rh
    ? await db
        .from("work_assignments")
        .select("works(id, title, year, type)")
        .eq("rights_holder_id", rh.id)
    : { data: [] };

  const uniqueWorks = Object.values(
    Object.fromEntries(
      ((myWorks ?? []) as WorkAssignmentRow[])
        .map(getWorkRelation)
        .filter(isWorkRelation)
        .map(w => [w.id, w])
    )
  ) as { id: string; title: string; year: number | null; type: string }[];

  const normalizedContracts: Contract[] = ((contracts ?? []) as RawContract[]).map(contract => ({
    ...contract,
    works: firstRelation(contract.works),
    employers: firstRelation(contract.employers),
  }));

  return (
    <Suspense>
      <MineKontrakterClient
        initialContracts={normalizedContracts}
        myWorks={uniqueWorks}
      />
    </Suspense>
  );
}
