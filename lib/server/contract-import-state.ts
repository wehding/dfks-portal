import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export async function getContractImportStatesForOrg(
  db: SupabaseClient,
  orgId: string,
  contractIds: string[],
) {
  const ids = [...new Set(contractIds.filter(Boolean))].slice(0, 500);
  if (!ids.length) {
    return { success: true as const, states: {} as Record<string, string>, withAiData: [] as string[], needsManualSalaryReview: [] as string[] };
  }

  const [importRes, validationRes] = await Promise.all([
    db.from("contract_import_items")
      .select("contract_id,status,created_at")
      .eq("org_id", orgId)
      .in("contract_id", ids)
      .order("created_at", { ascending: false }),
    db.from("contract_validations")
      .select("contract_id,extracted_data")
      .in("contract_id", ids)
      .not("extracted_data", "is", null)
      .neq("extracted_data", "{}"),
  ]);

  if (importRes.error) {
    return { success: false as const, error: "Importstatus kunne ikke hentes", states: {} as Record<string, string>, withAiData: [] as string[], needsManualSalaryReview: [] as string[] };
  }
  if (validationRes.error) {
    return { success: false as const, error: "AI-status kunne ikke hentes", states: {} as Record<string, string>, withAiData: [] as string[], needsManualSalaryReview: [] as string[] };
  }

  const states: Record<string, string> = {};
  for (const item of importRes.data ?? []) {
    if (item.contract_id && !states[item.contract_id]) states[item.contract_id] = item.status;
  }
  const withAiData = (validationRes.data ?? []).map(row => row.contract_id as string);
  const needsManualSalaryReview = (validationRes.data ?? [])
    .filter(row => (row.extracted_data as Record<string, unknown>)?.needsManualSalaryReview === true)
    .map(row => row.contract_id as string);

  return { success: true as const, states, withAiData, needsManualSalaryReview };
}
