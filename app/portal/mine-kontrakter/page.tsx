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
  contract_comments?: Contract["contract_comments"] | null;
};

const CONTRACT_SELECT_WITH_ATTACHMENTS = "id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, working_title, created_at, works(id, title, year), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes, extracted_data, validated_at), contract_attachments(id, type, title, pdf_url, created_at), contract_comments(id, author_role, message, created_at, member_read_at, admin_read_at)";
const CONTRACT_SELECT_BASE = "id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, working_title, created_at, works(id, title, year), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes, extracted_data, validated_at), contract_comments(id, author_role, message, created_at, member_read_at, admin_read_at)";
const CONTRACT_SELECT_LEGACY = "id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, working_title, created_at, works(id, title, year), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes, extracted_data, validated_at)";

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
      error.message?.includes("contract_attachments") ||
      error.message?.includes("contract_comments")
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
        const legacy = await db
          .from("contracts")
          .select(CONTRACT_SELECT_LEGACY)
          .eq("rights_holder_id", rh.id)
          .order("created_at", { ascending: false });
        if (legacy.error) {
          console.error("Kunne ikke hente kontrakter:", legacy.error.message);
        } else {
          contracts = legacy.data ?? [];
        }
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
    contract_comments: Array.isArray(contract.contract_comments)
      ? [...contract.contract_comments].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      : [],
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
