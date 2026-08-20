import { createHash, timingSafeEqual } from "node:crypto";
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

function deliveryRequest(adapter, endpoint, token, signedEnvelope) {
  const headers = { "content-type": "application/json", "user-agent": "dfks-audit-siem-worker/1.0" };
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
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const response = await client.request({
    url: `https://cloudkms.googleapis.com/v1/${keyName}:asymmetricSign`,
    method: "POST",
    data: { digest: { sha256: Buffer.from(digestHex, "hex").toString("base64") } },
  });
  const signature = response.data?.signature;
  if (!signature) throw new Error("KMS returned no signature");
  return signature;
}

export async function deliverAuditBatch() {
  const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: settings, error: settingsError } = await supabase
    .from("audit_control_settings")
    .select("siem_enabled,siem_adapter,kms_key_id")
    .eq("id", 1)
    .single();
  if (settingsError) throw new Error(`settings_failed:${settingsError.code || "database"}`);
  if (!settings?.siem_enabled) return { delivered: 0, disabled: true };
  const endpoint = required("SIEM_ENDPOINT");
  const configuredKeyName = String(settings.kms_key_id || "").trim();
  const keyName = configuredKeyName || required("GOOGLE_CLOUD_KMS_KEY_NAME");
  const environmentKeyName = process.env.GOOGLE_CLOUD_KMS_KEY_NAME?.trim();
  if (environmentKeyName && environmentKeyName !== keyName) throw new Error("KMS key configuration mismatch");
  const adapter = String(settings.siem_adapter || "generic").trim();
  if (!["generic", "splunk", "sentinel", "elastic"].includes(adapter)) throw new Error("Unsupported SIEM adapter");
  const batchSize = Math.min(Math.max(Number(process.env.SIEM_BATCH_SIZE || 100), 1), 500);
  const { data: claimed, error: claimError } = await supabase.rpc("claim_audit_siem_batch", { p_limit: batchSize });
  if (claimError) throw new Error(`claim_failed:${claimError.code || "database"}`);
  if (!claimed?.length) return { delivered: 0, empty: true };
  const batchId = claimed[0].batch_id;
  const payload = {
    schemaVersion: 1,
    batchId,
    firstSequence: claimed[0].sequence_no,
    lastSequence: claimed.at(-1).sequence_no,
    events: claimed.map(item => item.event_payload),
  };
  const canonicalPayload = stableStringify(payload);
  const envelopeHash = sha256(canonicalPayload);
  try {
    const signature = await kmsSignature(envelopeHash, keyName);
    const signedEnvelope = {
      payload,
      integrity: { algorithm: "SHA256_WITH_KMS_ASYMMETRIC_SIGN", keyId: keyName, envelopeHash, signature },
    };
    const target = deliveryRequest(adapter, endpoint, process.env.SIEM_AUTH_TOKEN?.trim(), signedEnvelope);
    const response = await fetch(target.endpoint, {
      method: "POST",
      headers: target.headers,
      body: target.body,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`siem_http_${response.status}`);
    const remoteReceipt = response.headers.get("x-request-id")?.slice(0, 200) ?? null;
    const destinationFingerprint = sha256(new URL(endpoint).origin + new URL(endpoint).pathname);
    const { error: completeError } = await supabase.rpc("complete_audit_siem_batch", {
      p_batch_id: batchId,
      p_success: true,
      p_adapter: adapter,
      p_destination_fingerprint: destinationFingerprint,
      p_key_id: keyName,
      p_signature_algorithm: "SHA256_WITH_KMS_ASYMMETRIC_SIGN",
      p_envelope_hash: envelopeHash,
      p_remote_receipt_id: remoteReceipt,
    });
    if (completeError) throw new Error(`receipt_failed:${completeError.code || "database"}`);
    return { delivered: claimed.length, batchId, envelopeHash };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : "delivery_failed";
    await supabase.rpc("complete_audit_siem_batch", { p_batch_id: batchId, p_success: false, p_error_code: errorCode });
    throw error;
  }
}
