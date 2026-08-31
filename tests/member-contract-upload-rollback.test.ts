import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const sourcePath = new URL("../app/actions/member-contracts.ts", import.meta.url);

test("et usikkert database-resultat kan aldrig slette den uploadede original", async () => {
  const source = await readFile(sourcePath, "utf8");
  const uncertainStart = source.indexOf("if (atomicCreate.error || !atomicCreate.data)");
  const uncertainEnd = source.indexOf("const uploadIdentity: MemberUploadIdentity", uncertainStart);
  assert.ok(uncertainStart > 0 && uncertainEnd > uncertainStart, "atomic recovery block was not found");

  const uncertainBlock = source.slice(uncertainStart, uncertainEnd);
  assert.match(uncertainBlock, /rpc\("create_member_uploaded_contract", atomicCreateParams\)/);
  assert.doesNotMatch(uncertainBlock, /storage\.from\(BUCKET\)\.remove/);
  assert.doesNotMatch(uncertainBlock, /from\("contracts"\)\.delete/);
  assert.doesNotMatch(uncertainBlock, /from\("contract_upload_intents"\)\s*\.select/);

  const directStart = source.indexOf("if (createResult.error || !createResult.data)");
  const directEnd = source.indexOf("const uploadIdentity: MemberUploadIdentity", directStart);
  assert.ok(directStart > 0 && directEnd > directStart, "direct upload recovery block was not found");
  const directBlock = source.slice(directStart, directEnd);
  assert.match(directBlock, /rpc\("create_member_uploaded_contract", createParams\)/);
  assert.doesNotMatch(directBlock, /storage\.from\(BUCKET\)\.remove/);
  assert.doesNotMatch(directBlock, /from\("contract_upload_intents"\)\s*\.select/);
});

test("fejl efter commit bruger kun den atomiske rollback-RPC", async () => {
  const source = await readFile(sourcePath, "utf8");
  const guidedStart = source.indexOf("export async function saveUploadedContract");
  const committedStart = source.indexOf("const uploadIdentity: MemberUploadIdentity", guidedStart);
  const committedEnd = source.indexOf("export async function prepareMemberContractUpload", committedStart);
  assert.ok(committedStart > 0 && committedEnd > committedStart, "post-commit upload block was not found");

  const committedBlock = source.slice(committedStart, committedEnd);
  assert.match(source, /rpc\("rollback_member_uploaded_contract"/);
  assert.match(source, /p_finalization_token: identity\.finalizationToken/);
  assert.match(committedBlock, /claimMemberUploadFinalization/);
  assert.match(committedBlock, /finish_member_uploaded_contract_finalization/);
  assert.match(committedBlock, /rollbackMemberUploadOrReport/g);
  assert.doesNotMatch(committedBlock, /storage\.from\(BUCKET\)\.remove/);
  assert.doesNotMatch(committedBlock, /from\("contracts"\)\.delete/);
});

test("færdiggørelse serialiseres med request-hash og token", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /memberUploadRequestHash\("guided"/);
  assert.match(source, /claim_member_uploaded_contract_finalization/);
  assert.match(source, /p_finalization_token: claimToken/);
  assert.match(source, /outcome === "in_progress"/);
  assert.match(source, /outcome === "recovery_required"/);
  assert.match(source, /outcome === "already_finalized"/);

  const guidedStart = source.indexOf("export async function saveUploadedContract");
  const guidedEnd = source.indexOf("export async function prepareMemberContractUpload", guidedStart);
  const guidedBlock = source.slice(guidedStart, guidedEnd);
  const producerIndex = guidedBlock.indexOf("syncContractProducerRelations");
  const finishIndex = guidedBlock.indexOf("finish_member_uploaded_contract_finalization");
  assert.ok(producerIndex > 0 && finishIndex > producerIndex, "producer sync must precede atomic scope finalization");
  assert.doesNotMatch(guidedBlock, /from\("contract_validations"\)\.insert/);
  assert.doesNotMatch(guidedBlock, /upsertMemberSeriesEpisodeScope/);
});
