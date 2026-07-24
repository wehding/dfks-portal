import { normalizeCompanyBaseName, normalizeCompanyName } from "@/lib/production-companies";

const DEFAULT_APICVR_MCP_URL = "https://mcp.apicvr.dk/mcp";

export type ApiCvrSearchResult = {
  name: string;
  cvrNumber: string;
  industryCode: string | null;
  industryDescription: string | null;
};

export type ApiCvrCompany = {
  name: string;
  cvrNumber: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  status: string | null;
  companyType: string | null;
  industryCode: string | null;
  industryDescription: string | null;
  startDate: string | null;
  endDate: string | null;
  employees: number | null;
};

type McpContent = { type?: string; text?: string };
type McpEnvelope = {
  result?: { content?: McpContent[] };
  error?: { message?: string };
};

export function parseMcpEventResponse(body: string): McpEnvelope {
  const dataLines = body
    .split(/\r?\n/)
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trim());
  const payload = dataLines.at(-1) ?? body.trim();
  if (!payload) throw new Error("apiCVR returnerede et tomt svar");
  return JSON.parse(payload) as McpEnvelope;
}

async function callApiCvrTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(process.env.APICVR_MCP_URL ?? DEFAULT_APICVR_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  const envelope = parseMcpEventResponse(await response.text());
  if (!response.ok || envelope.error) {
    throw new Error(envelope.error?.message ?? `apiCVR svarede med HTTP ${response.status}`);
  }
  const text = envelope.result?.content?.find(item => item.type === "text")?.text;
  if (!text) throw new Error("apiCVR returnerede ingen virksomhedsdata");
  return JSON.parse(text) as T;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function fuzzySearchApiCvr(companyName: string): Promise<ApiCvrSearchResult[]> {
  const variants = [...new Set([companyName.trim(), normalizeCompanyBaseName(companyName)].filter(Boolean))];
  const rowMap = new Map<string, Record<string, unknown>>();
  for (const variant of variants) {
    const payload = await callApiCvrTool<unknown>("fuzzy_search_company", { companyName: variant });
    if (!Array.isArray(payload)) continue;
    for (const row of payload as Array<Record<string, unknown>>) {
      const cvrNumber = String(row.cvr_number ?? "").replace(/\D/g, "");
      if (cvrNumber) rowMap.set(cvrNumber, row);
    }
    if (rowMap.size) break;
  }
  return [...rowMap.values()].slice(0, 25).flatMap(row => {
    const cvrNumber = String(row.cvr_number ?? "").replace(/\D/g, "");
    const name = optionalString(row.name);
    if (!name || !/^\d{7,8}$/.test(cvrNumber)) return [];
    return [{
      name,
      cvrNumber: cvrNumber.padStart(8, "0"),
      industryCode: optionalString(row.industrycode),
      industryDescription: optionalString(row.industrytext),
    }];
  });
}

export async function lookupApiCvr(cvrNumber: string): Promise<ApiCvrCompany | null> {
  const normalized = cvrNumber.replace(/\D/g, "");
  if (!/^\d{7,8}$/.test(normalized)) return null;
  const row = await callApiCvrTool<Record<string, unknown>>("lookup_company", { cvrNumber: Number(normalized) });
  const vat = String(row.vat ?? normalized).replace(/\D/g, "").padStart(8, "0");
  const units = Array.isArray(row.p_units) ? row.p_units as Array<Record<string, unknown>> : [];
  const activeUnit = units.find(unit => !unit.enddate) ?? units[0];
  const name = optionalString(row.name);
  if (!name) return null;
  return {
    name,
    cvrNumber: vat,
    address: optionalString(row.address),
    postalCode: row.zipcode == null ? null : String(row.zipcode),
    city: optionalString(row.city),
    phone: optionalString(row.phone) ?? optionalString(activeUnit?.phone),
    email: optionalString(row.email) ?? optionalString(activeUnit?.email),
    website: optionalString(row.website) ?? optionalString(activeUnit?.website),
    status: optionalString(row.status),
    companyType: optionalString(row.companytypeshort) ?? optionalString(row.companydesc),
    industryCode: optionalString(row.industrycode),
    industryDescription: optionalString(row.industrydesc),
    startDate: optionalString(row.startdate),
    endDate: optionalString(row.enddate),
    employees: typeof row.employees === "number" ? row.employees : null,
  };
}

export function formatApiCvrAddress(company: ApiCvrCompany) {
  const locality = [company.postalCode, company.city].filter(Boolean).join(" ");
  return [company.address, locality].filter(Boolean).join(", ") || null;
}

export function apiCvrNameMatchScore(candidate: string, query: string) {
  const candidateName = normalizeCompanyName(candidate);
  const queryName = normalizeCompanyName(query);
  if (!candidateName || !queryName) return 0;
  if (candidateName === queryName) return 120;
  const candidateBase = normalizeCompanyBaseName(candidate);
  const queryBase = normalizeCompanyBaseName(query);
  if (candidateBase && candidateBase === queryBase) return 110;
  if (candidateBase.replace(/\s+/g, "") === queryBase.replace(/\s+/g, "")) return 105;
  if (candidateBase.includes(queryBase) || queryBase.includes(candidateBase)) {
    return 70 + Math.round((Math.min(candidateBase.length, queryBase.length) / Math.max(candidateBase.length, queryBase.length)) * 20);
  }
  return 0;
}
