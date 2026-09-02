export const WORD_RECOVERY_DISPOSITION = "retry_after_pipeline_fix";

async function append_audit_event_v2(db, args) {
  return db.rpc("append_audit_event_v2", args);
}

export async function fetchWordRecoveryCandidates(db, limit) {
  const { data, error } = await db.from("contract_document_jobs")
    .select("id,contract_id,original_storage_path")
    .eq("status", "needs_review")
    .eq("error_code", "invalid_pdf")
    .or(`review_disposition.is.null,review_disposition.neq.${WORD_RECOVERY_DISPOSITION}`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function appendWordRecoveryAudit(db, { contractIds, correlationId, summary }) {
  const uniqueContractIds = [...new Set(contractIds)];
  const { data: contracts, error: contractError } = await db.from("contracts")
    .select("id,org_id,rights_holder_id")
    .in("id", uniqueContractIds);
  if (contractError || contracts?.length !== uniqueContractIds.length) {
    throw new Error("Recovery-auditens medlemsgrundlag kunne ikke fastslås");
  }

  const targetMemberUuids = [...new Set(contracts
    .map((contract) => contract.rights_holder_id)
    .filter((id) => typeof id === "string"))];
  const orgIds = [...new Set(contracts.map((contract) => contract.org_id))];
  const { data: auditEventId, error: auditError } = await append_audit_event_v2(db, {
    p_action: "create",
    p_entity_type: "contract_document_jobs",
    p_entity_id: correlationId,
    p_entity_label: "Word-kontrakt recovery",
    p_actor_type: "integration",
    p_source: "import",
    p_correlation_id: correlationId,
    p_changes: [],
    p_metadata: { counts: summary },
    p_missing_actor_context: false,
    p_target_member_uuids: targetMemberUuids,
    p_purpose_code: "document_word_recovery",
    p_legal_basis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)",
    p_data_categories: ["contract_data", "document_data", "ai_analysis"],
    p_system_component: "one-off.word-contract-recovery",
    p_outcome: "success",
    p_org_ids: orgIds,
  });
  if (auditError || !auditEventId) throw new Error("Recovery-audit kunne ikke registreres");
  return String(auditEventId);
}
