import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

function getKey() {
  const secret = process.env.PROFILE_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "PROFILE_ENCRYPTION_KEY mangler. Sæt en lang hemmelig nøgle i .env.local og Vercel miljøvariabler."
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptValue(value: FormDataEntryValue | string | null | undefined): string | null {
  const plainText = typeof value === "string" ? value.trim() : "";
  if (!plainText) return null;
  if (isEncryptedValue(plainText)) return plainText;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${Buffer.concat([iv, authTag, encrypted]).toString("base64url")}`;
}

export function decryptValue(value: string | null | undefined): string {
  if (!value) return "";
  if (!isEncryptedValue(value)) return value;

  try {
    const payload = Buffer.from(value.slice(PREFIX.length), "base64url");
    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (err) {
    console.error("decryptValue fejlede – data kan være krypteret med en anden nøgle:", err);
    return "";
  }
}

export function decryptRettighedshaver<
  T extends { cpr_no?: string | null; bank_account?: string | null }
>(rh: T | null): T | null {
  if (!rh) return rh;
  return {
    ...rh,
    cpr_no: decryptValue(rh.cpr_no),
    bank_account: decryptValue(rh.bank_account),
  };
}
