import { createHash, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeSecretEqual(actual, expected) {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function cloudIdentity() {
  return {
    service: process.env.K_SERVICE?.trim() || null,
    revision: process.env.K_REVISION?.trim() || null,
    imageDigest: process.env.IMAGE_DIGEST?.trim() || null,
  };
}

function structuredLog(severity, event, details = {}) {
  console.log(JSON.stringify({ severity, event, component: "dfks-audit-siem-worker", ...details }));
}

function serviceClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function authClient() {
  return new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
}

export function deliveryRequest(adapter, endpoint, token, signedEnvelope) {
  const headers = {
    "content-type": "application/json",
    "user-agent": "dfks-audit-siem-worker/2.0",
    "idempotency-key": signedEnvelope.payload.deliveryId,
    "x-dfks-batch-id": signedEnvelope.payload.batchId,
  };
  let body = signedEnvelope;
  if (adapter === "splunk") {
    if (token) headers.authorization = `Splunk ${token}`;
    body = { event: signedEnvelope };
  } else if (adapter === "elastic") {
    if (token) headers.authorization = `ApiKey ${token}`;
  } else if (token) headers.authorization = `Bearer ${token}`;
  return { endpoint, headers, body: stableStringify(body) };
}

async function kmsSignature(digestHex, keyName) {
  const client = await authClient().getClient();
  const response = await client.request({
    url: `https://cloudkms.googleapis.com/v1/${keyName}:asymmetricSign`,
    method: "POST",
    data: { digest: { sha256: Buffer.from(digestHex, "hex").toString("base64") } },
  });
  if (!response.data?.signature) throw new Error("kms_signature_missing");
  return { signature: response.data.signature, keyVersion: response.data.name || keyName };
}

async function kmsPublicKey(keyName) {
  const client = await authClient().getClient();
  const response = await client.request({ url: `https://cloudkms.googleapis.com/v1/${keyName}/publicKey`, method: "GET" });
  if (!response.data?.pem) throw new Error("kms_public_key_missing");
  return response.data.pem;
}

export function wormObjectName(prefix, firstSequence, lastSequence, batchId, now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "/");
  return `v1/${prefix}/${date}/${firstSequence}-${lastSequence}-${batchId}.json`;
}

async function uploadWormObject(bucket, objectName, body) {
  const client = await authClient().getClient();
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
  url.searchParams.set("uploadType", "media");
  url.searchParams.set("name", objectName);
  url.searchParams.set("ifGenerationMatch", "0");
  try {
    const response = await client.request({
      url: url.toString(), method: "POST", data: body,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    return response.data;
  } catch (error) {
    if (error?.response?.status !== 412) throw error;
    const metadata = await client.request({
      url: `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`,
      method: "GET",
    });
    const existing = await downloadWormObject(bucket, objectName);
    if (sha256(existing) !== sha256(body)) throw new Error("worm_object_idempotency_conflict");
    return metadata.data;
  }
}

async function downloadWormObject(bucket, objectName) {
  const client = await authClient().getClient();
  const response = await client.request({
    url: `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`,
    method: "GET",
    responseType: "text",
  });
  return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
}

async function recordRun(supabase, runType, status, startedAt, details) {
  const identity = cloudIdentity();
  const { error } = await supabase.rpc("record_audit_worker_run", {
    p_run_type: runType, p_status: status, p_started_at: startedAt,
    p_details: details, p_cloud_run_service: identity.service,
    p_cloud_run_revision: identity.revision, p_image_digest: identity.imageDigest,
  });
  if (error) structuredLog("ERROR", "audit_worker_run_record_failed", { runType, code: error.code || "database" });
}

async function verifyClaimedChain(supabase, claimed) {
  const first = Number(claimed[0].sequence_no);
  const last = Number(claimed.at(-1).sequence_no);
  const { data, error } = await supabase.rpc("verify_audit_chain", { p_from_sequence: first, p_to_sequence: last });
  if (error || !data?.length || data.some(item => !item.valid)) throw new Error("audit_chain_invalid");
  if (data.length !== claimed.length) throw new Error("audit_sequence_gap");
}

export async function deliverAuditBatch() {
  const startedAt = new Date().toISOString();
  const supabase = serviceClient();
  let runDetails = {};
  let activeBatchId = null;
  try {
    const { data: settings, error: settingsError } = await supabase.from("audit_control_settings")
      .select("siem_enabled,siem_adapter,kms_key_id").eq("singleton", true).single();
    if (settingsError) throw new Error(`settings_failed:${settingsError.code || "database"}`);
    if (!settings?.siem_enabled) {
      runDetails = { delivered: 0, disabled: true };
      await recordRun(supabase, "delivery", "success", startedAt, runDetails);
      return runDetails;
    }
    const keyName = String(settings.kms_key_id || "").trim() || required("GOOGLE_CLOUD_KMS_KEY_NAME");
    const environmentKey = process.env.GOOGLE_CLOUD_KMS_KEY_NAME?.trim();
    if (environmentKey && environmentKey !== keyName) throw new Error("kms_key_configuration_mismatch");
    const adapter = String(settings.siem_adapter || "google_native").trim();
    if (!["google_native", "generic", "splunk", "sentinel", "elastic"].includes(adapter)) throw new Error("unsupported_siem_adapter");
    const batchSize = Math.min(Math.max(Number(process.env.SIEM_BATCH_SIZE || 100), 1), 500);
    const { data: claimed, error: claimError } = await supabase.rpc("claim_audit_siem_batch", { p_limit: batchSize });
    if (claimError) throw new Error(`claim_failed:${claimError.code || "database"}`);
    if (!claimed?.length) {
      runDetails = { delivered: 0, empty: true };
      await recordRun(supabase, "delivery", "success", startedAt, runDetails);
      return runDetails;
    }
    await verifyClaimedChain(supabase, claimed);
    const batchId = claimed[0].batch_id;
    activeBatchId = batchId;
    const destinationFingerprint = adapter === "google_native"
      ? sha256(`gcs://${required("AUDIT_WORM_BUCKET")}`)
      : sha256(new URL(required("SIEM_ENDPOINT")).origin + new URL(required("SIEM_ENDPOINT")).pathname);
    const deliveryId = sha256(stableStringify({ schemaVersion: 2, adapter, destinationFingerprint, eventIds: claimed.map(item => item.event_id) }));
    const payload = {
      schemaVersion: 2, batchId, deliveryId,
      firstSequence: claimed[0].sequence_no, lastSequence: claimed.at(-1).sequence_no,
      events: claimed.map(item => item.event_payload),
    };
    const envelopeHash = sha256(stableStringify(payload));
    const signed = await kmsSignature(envelopeHash, keyName);
    const signedEnvelope = { payload, integrity: {
      algorithm: "EC_SIGN_P256_SHA256", keyId: signed.keyVersion,
      publicKeyReference: `${signed.keyVersion}/publicKey`, envelopeHash, signature: signed.signature,
    } };
    let receipt = { remoteReceiptId: null, bucket: null, object: null, generation: null, crc32c: null, createdAt: null };
    if (adapter === "google_native") {
      const bucket = required("AUDIT_WORM_BUCKET");
      const object = wormObjectName("events", payload.firstSequence, payload.lastSequence, deliveryId,
        new Date(payload.events[0]?.occurred_at || Date.now()));
      const metadata = await uploadWormObject(bucket, object, stableStringify(signedEnvelope));
      receipt = { remoteReceiptId: `${bucket}/${object}#${metadata.generation}`, bucket, object,
        generation: String(metadata.generation), crc32c: metadata.crc32c || null, createdAt: metadata.timeCreated || new Date().toISOString() };
      for (const event of payload.events) structuredLog("INFO", "audit_event_archived", {
        eventId: event.id, sequenceNo: event.sequence_no, action: event.action,
        purposeCode: event.purpose_code, systemComponent: event.system_component,
        outcome: event.outcome, batchId,
      });
    } else {
      const target = deliveryRequest(adapter, required("SIEM_ENDPOINT"), process.env.SIEM_AUTH_TOKEN?.trim(), signedEnvelope);
      const response = await fetch(target.endpoint, { method: "POST", headers: target.headers, body: target.body,
        redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`siem_http_${response.status}`);
      receipt.remoteReceiptId = response.headers.get("x-request-id")?.slice(0, 200) ?? null;
    }
    const { error: completeError } = await supabase.rpc("complete_audit_siem_batch", {
      p_batch_id: batchId, p_success: true, p_adapter: adapter,
      p_destination_fingerprint: destinationFingerprint, p_key_id: signed.keyVersion,
      p_signature_algorithm: "EC_SIGN_P256_SHA256", p_envelope_hash: envelopeHash,
      p_remote_receipt_id: receipt.remoteReceiptId, p_worm_bucket: receipt.bucket,
      p_worm_object: receipt.object, p_worm_generation: receipt.generation,
      p_worm_checksum_crc32c: receipt.crc32c, p_worm_created_at: receipt.createdAt,
      p_cloud_run_revision: cloudIdentity().revision,
    });
    if (completeError) throw new Error(`receipt_failed:${completeError.code || "database"}`);
    runDetails = { delivered: claimed.length, batchId, firstSequence: payload.firstSequence, lastSequence: payload.lastSequence, wormGeneration: receipt.generation };
    structuredLog("INFO", "audit_batch_delivery_success", runDetails);
    await recordRun(supabase, "delivery", "success", startedAt, runDetails);
    return runDetails;
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 120) : "delivery_failed";
    if (activeBatchId) {
      await supabase.rpc("complete_audit_siem_batch", { p_batch_id: activeBatchId, p_success: false, p_error_code: code });
    }
    structuredLog("ERROR", code === "audit_sequence_gap" || code === "audit_chain_invalid" ? "audit_integrity_failure" : "audit_batch_delivery_failed", { code });
    await recordRun(supabase, "delivery", "failed", startedAt, { errorCode: code });
    throw error;
  }
}

export async function signRetentionCertificate() {
  const startedAt = new Date().toISOString();
  const supabase = serviceClient();
  const { data: claimed, error } = await supabase.rpc("claim_audit_retention_certificate");
  if (error) throw new Error(`retention_claim_failed:${error.code || "database"}`);
  if (!claimed?.length) {
    await recordRun(supabase, "retention_signing", "success", startedAt, { signed: 0, empty: true });
    return { signed: 0, empty: true };
  }
  const item = claimed[0];
  try {
    const keyName = required("GOOGLE_CLOUD_KMS_KEY_NAME");
    const bucket = required("AUDIT_WORM_BUCKET");
    const digest = String(item.certificate_payload.certificate_hash);
    const signed = await kmsSignature(digest, keyName);
    const object = wormObjectName("retention-certificates", item.certificate_payload.first_sequence,
      item.certificate_payload.last_sequence, item.certificate_id,
      new Date(item.certificate_payload.created_at || Date.now()));
    const evidence = { schemaVersion: 1, certificate: item.certificate_payload, integrity: {
      algorithm: "EC_SIGN_P256_SHA256", keyId: signed.keyVersion,
      publicKeyReference: `${signed.keyVersion}/publicKey`, digest, signature: signed.signature,
    } };
    const metadata = await uploadWormObject(bucket, object, stableStringify(evidence));
    const { error: completeError } = await supabase.rpc("complete_audit_retention_signature", {
      p_certificate_id: item.certificate_id, p_success: true, p_signature: signed.signature,
      p_signature_algorithm: "EC_SIGN_P256_SHA256", p_kms_key_version: signed.keyVersion,
      p_public_key_reference: `${signed.keyVersion}/publicKey`, p_worm_bucket: bucket,
      p_worm_object: object, p_worm_generation: String(metadata.generation),
      p_worm_checksum_crc32c: metadata.crc32c || null,
    });
    if (completeError) throw new Error(`retention_receipt_failed:${completeError.code || "database"}`);
    const result = { signed: 1, certificateId: item.certificate_id, wormGeneration: String(metadata.generation) };
    structuredLog("INFO", "audit_retention_certificate_signed", result);
    await recordRun(supabase, "retention_signing", "success", startedAt, result);
    return result;
  } catch (signError) {
    const code = signError instanceof Error ? signError.message.slice(0, 120) : "signing_failed";
    await supabase.rpc("complete_audit_retention_signature", { p_certificate_id: item.certificate_id, p_success: false, p_error_code: code });
    structuredLog("ERROR", "audit_retention_signing_failed", { code, certificateId: item.certificate_id });
    await recordRun(supabase, "retention_signing", "failed", startedAt, { errorCode: code });
    throw signError;
  }
}

export async function verifyAuditArchive() {
  const startedAt = new Date().toISOString();
  const supabase = serviceClient();
  const { data: receipts, error } = await supabase.from("audit_siem_receipts").select("*")
    .eq("adapter", "google_native").order("first_sequence", { ascending: true }).limit(10_000);
  if (error) throw new Error(`receipt_lookup_failed:${error.code || "database"}`);
  let priorLast = null;
  let verified = 0;
  const failures = [];
  for (const receipt of receipts ?? []) {
    try {
      if (priorLast !== null && Number(receipt.first_sequence) !== priorLast + 1) failures.push(`sequence_gap_before_${receipt.first_sequence}`);
      const body = await downloadWormObject(receipt.worm_bucket, receipt.worm_object);
      const envelope = JSON.parse(body);
      const calculated = sha256(stableStringify(envelope.payload));
      if (calculated !== envelope.integrity.envelopeHash || calculated !== receipt.envelope_hash) failures.push(`hash_${receipt.batch_id}`);
      const pem = await kmsPublicKey(envelope.integrity.keyId);
      const valid = verifySignature(null, Buffer.from(calculated, "hex"), pem, Buffer.from(envelope.integrity.signature, "base64"));
      if (!valid) failures.push(`signature_${receipt.batch_id}`);
      priorLast = Number(receipt.last_sequence); verified += 1;
    } catch { failures.push(`worm_${receipt.batch_id}`); }
  }
  const { count: deadLetter } = await supabase.from("audit_siem_outbox").select("event_id", { count: "exact", head: true }).eq("status", "dead_letter");
  const { count: staleQueue } = await supabase.from("audit_siem_outbox").select("event_id", { count: "exact", head: true })
    .in("status", ["pending", "failed"]).lt("available_at", new Date(Date.now() - 15 * 60_000).toISOString());
  const { count: unsignedCertificates } = await supabase.from("audit_retention_signature_queue")
    .select("certificate_id", { count: "exact", head: true }).in("status", ["pending", "failed"])
    .lt("available_at", new Date(Date.now() - 15 * 60_000).toISOString());
  for (const failure of failures) {
    const event = failure.startsWith("sequence_gap") ? "audit_sequence_break"
      : failure.startsWith("signature") ? "audit_signature_invalid"
        : failure.startsWith("worm") ? "audit_worm_receipt_missing" : "audit_hash_invalid";
    structuredLog("ERROR", event, { failure });
  }
  if (deadLetter) structuredLog("ERROR", "audit_dead_letter_present", { count: deadLetter });
  if (staleQueue) structuredLog("ERROR", "audit_queue_stale", { count: staleQueue, thresholdMinutes: 15 });
  if (unsignedCertificates) structuredLog("ERROR", "audit_retention_signature_stale", { count: unsignedCertificates, thresholdMinutes: 15 });
  const details = { verified, failures, deadLetter: deadLetter ?? 0, staleQueue: staleQueue ?? 0, unsignedCertificates: unsignedCertificates ?? 0 };
  const ok = failures.length === 0 && !deadLetter && !staleQueue && !unsignedCertificates;
  structuredLog(ok ? "INFO" : "ERROR", ok ? "audit_archive_verification_success" : "audit_integrity_failure", details);
  await recordRun(supabase, "verification", ok ? "success" : "failed", startedAt, details);
  if (!ok) throw new Error("audit_archive_verification_failed");
  return details;
}
