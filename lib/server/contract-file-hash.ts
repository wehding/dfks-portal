import { createHash } from "node:crypto";

export function contractFileHash(buffer: Buffer | Uint8Array) {
  return createHash("sha256").update(buffer).digest("hex");
}
