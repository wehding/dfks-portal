export type NormalizedForeningLetMember = {
  id: string | number;
  display_id: string | number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  address2: string | null;
  zip: string | null;
  city: string | null;
  cpr: string | null;
  raw: Record<string, unknown>;
};

function firstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function textValue(record: Record<string, unknown>, keys: string[]) {
  const value = firstValue(record, keys);
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

export function parseForeningLetMemberPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(item => item && typeof item === "object") as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];

  const envelope = payload as Record<string, unknown>;
  for (const key of ["members", "Members", "data", "Data", "items", "Items", "results", "Results"]) {
    const value = envelope[key];
    if (Array.isArray(value)) {
      return value.filter(item => item && typeof item === "object") as Record<string, unknown>[];
    }
  }
  return [];
}

export function normalizeForeningLetMember(record: Record<string, unknown>): NormalizedForeningLetMember | null {
  const id = firstValue(record, ["id", "member_id", "MemberId", "MemberID"]);
  if (typeof id !== "string" && typeof id !== "number") return null;

  const normalized = {
    id,
    display_id: firstValue(record, ["display_id", "member_number", "MemberNumber", "MemberCode"]) as string | number | null,
    first_name: textValue(record, ["first_name", "FirstName"]),
    last_name: textValue(record, ["last_name", "LastName"]),
    email: textValue(record, ["email", "Email"]),
    phone: textValue(record, ["phone", "Phone"]),
    mobile: textValue(record, ["mobile", "Mobile"]),
    address: textValue(record, ["address", "Address"]),
    address2: textValue(record, ["address2", "Address2"]),
    zip: textValue(record, ["zip", "zipcode", "Zip", "ZipCode"]),
    city: textValue(record, ["city", "City"]),
    cpr: textValue(record, ["cpr", "cpr_no", "social_security_number", "Cpr", "CPR"]),
  };

  return {
    ...normalized,
    raw: {
      phone: normalized.phone,
      mobile: normalized.mobile,
      address: [normalized.address, normalized.address2].filter(Boolean).join(" ") || null,
      zip: normalized.zip,
      city: normalized.city,
      cpr: normalized.cpr,
      gender: textValue(record, ["gender", "Gender"]),
      enrollment_date: textValue(record, ["enrollment_date", "EnrollmentDate"]),
    },
  };
}
