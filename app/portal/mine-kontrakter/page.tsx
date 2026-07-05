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
  contract_attachments?: Contract["contract_attachments"] | null;
};

const CONTRACT_SELECT_WITH_ATTACHMENTS = "id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, created_at, works(id, title, year), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes), contract_attachments(id, type, title, pdf_url, created_at)";
const CONTRACT_SELECT_BASE = "id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, created_at, works(id, title, year), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes)";

function getWorkRelation(row: WorkAssignmentRow) {
  return Array.isArray(row.works) ? row.works[0] ?? null : row.works;
}

function isWorkRelation(work: WorkRelation | null): work is WorkRelation {
  return Boolean(work);
}

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isMissingAttachmentRelationError(error: { message?: string; code?: string } | null) {
  return Boolean(
    error &&
    (
      error.code === "PGRST200" ||
      error.code === "42P01" ||
      error.message?.includes("contract_attachments")
    )
  );
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
    .maybeSingle();

  let contracts: unknown[] = [];
  if (rh) {
    const withAttachments = await db
      .from("contracts")
      .select(CONTRACT_SELECT_WITH_ATTACHMENTS)
      .eq("rights_holder_id", rh.id)
      .order("created_at", { ascending: false });

    if (withAttachments.error && isMissingAttachmentRelationError(withAttachments.error)) {
      const fallback = await db
        .from("contracts")
        .select(CONTRACT_SELECT_BASE)
        .eq("rights_holder_id", rh.id)
        .order("created_at", { ascending: false });
      if (fallback.error) {
        console.error("Kunne ikke hente kontrakter:", fallback.error.message);
      } else {
        contracts = fallback.data ?? [];
      }
    } else if (withAttachments.error) {
      console.error("Kunne ikke hente kontrakter:", withAttachments.error.message);
    } else {
      contracts = withAttachments.data ?? [];
    }
  }

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
    contract_attachments: Array.isArray(contract.contract_attachments) ? contract.contract_attachments : [],
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
