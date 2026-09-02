import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { isSpatialV3Artifact, type SpatialV3Artifact } from "@/lib/contract-field-evidence";

const MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024 * 1024;

export function parseVerifiedSpatialV3Artifact(compressed: Buffer, expectedSha256: string): SpatialV3Artifact {
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw new Error("Spatial-artefaktet er for stort");
  const actualSha256 = createHash("sha256").update(compressed).digest("hex");
  if (!expectedSha256 || actualSha256 !== expectedSha256.toLowerCase()) throw new Error("Spatial-artefaktets hash stemmer ikke");
  const json = gunzipSync(compressed, { maxOutputLength: MAX_JSON_BYTES });
  const parsed: unknown = JSON.parse(json.toString("utf8"));
  if (!isSpatialV3Artifact(parsed)) throw new Error("Spatial-artefaktet er ikke version 3 eller er ikke verificeret");
  return parsed;
}
