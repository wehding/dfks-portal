export const dynamic = "force-dynamic";

import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import MineKontrakterClient from "./MineKontrakterClient";
import type { Contract } from "./MineKontrakterClient";

type WorkRelation = { id: string; title: string; year: number | null; type: string };
type WorkAssignmentRow = { works: WorkRelation | WorkRelation[] | null };
type ContractComment = { id: string; author_role: "member" | "admin"; message: string; created_at: string; member_read_at?: string | null; admin_read_at?: string | null };
type RawContract = Omit<Contract, "works" | "employers"> & {
  works: Contract["works"] | Contract["works"][];
  employers: Contract["employers"] | Contract["employers"][];
  contract_attachments?: Contract["contract_attachments"] | null;
  contract_comments?: Contract["contract_comments"] | null;
};

const CONTRACT_LIST_SELECT = "id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, working_title, created_at, works(id, title, year), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes, validated_at)";

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
  let unreadCommentsByContract: Record<string, Contract["contract_comments"]> = {};
  if (rh) {
    const listRes = await db
      .from("contracts")
      .select(CONTRACT_LIST_SELECT)
      .eq("rights_holder_id", rh.id)
      .order("created_at", { ascending: false });

    if (listRes.error && !isMissingAttachmentRelationError(listRes.error)) {
      console.error("Kunne ikke hente kontrakter:", listRes.error.message);
    } else {
      contracts = listRes.data ?? [];
      const contractIds = contracts.map(row => (row as { id?: string }).id).filter((id): id is string => Boolean(id));
      if (contractIds.length) {
        const { data: unreadComments } = await db
          .from("contract_comments")
          .select("id, contract_id, author_role, message, created_at, member_read_at, admin_read_at")
          .in("contract_id", contractIds)
          .eq("author_role", "admin")
          .is("member_read_at", null)
          .order("created_at", { ascending: true });
        unreadCommentsByContract = ((unreadComments ?? []) as Array<ContractComment & { contract_id: string }>).reduce<Record<string, Contract["contract_comments"]>>((acc, comment) => {
          if (!acc[comment.contract_id]) acc[comment.contract_id] = [];
          acc[comment.contract_id].push(comment);
          return acc;
        }, {});
      }
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
    contract_attachments: [],
    contract_comments: unreadCommentsByContract[contract.id] ?? [],
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
