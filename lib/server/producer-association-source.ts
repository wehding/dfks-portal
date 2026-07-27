import { createHash } from "node:crypto";
import {
  PRODUCENTFORENINGEN_GROUPS,
  extractAssociationScriptUrl,
  parseAssociationTableScript,
  type ProducerAssociationSourceRow,
} from "@/lib/producer-association";

const MAX_SOURCE_BYTES = 2_000_000;
const SOURCE_USER_AGENT = "DFKS-Rettighedsportal/1.0 medlemskontrol (+https://danskfilmklipperselskab.dk)";

async function fetchPublicSource(url: string, allowedHosts: string[]) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !allowedHosts.includes(parsed.hostname)) throw new Error("Kildens domæne er ikke tilladt.");
  const response = await fetch(parsed, {
    headers: { Accept: "text/html,application/javascript;q=0.9,*/*;q=0.1", "User-Agent": SOURCE_USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Kilden svarede med status ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_SOURCE_BYTES) throw new Error("Kildens svar er større end forventet.");
  const text = await response.text();
  if (text.length > MAX_SOURCE_BYTES) throw new Error("Kildens svar er større end forventet.");
  return text;
}

async function fetchGroup(group: typeof PRODUCENTFORENINGEN_GROUPS[number]) {
  const pageHtml = await fetchPublicSource(group.url, ["pro-f.dk", "www.pro-f.dk"]);
  const scriptUrl = extractAssociationScriptUrl(pageHtml);
  const script = await fetchPublicSource(scriptUrl, ["cms.workflow-automation.podio.com"]);
  return parseAssociationTableScript(script, group).map(row => ({
    ...row,
    sourceHash: createHash("sha256").update(JSON.stringify(row)).digest("hex"),
  }));
}

export async function fetchProducentforeningenMemberships() {
  const rows: ProducerAssociationSourceRow[] = [];
  // Two requests at a time keeps the manual sync quick without hammering the source.
  for (let index = 0; index < PRODUCENTFORENINGEN_GROUPS.length; index += 2) {
    const batch = PRODUCENTFORENINGEN_GROUPS.slice(index, index + 2);
    const results = await Promise.all(batch.map(fetchGroup));
    for (const groupRows of results) rows.push(...groupRows);
  }
  const seenGroups = new Set(rows.map(row => row.groupCode));
  if (seenGroups.size !== PRODUCENTFORENINGEN_GROUPS.length || rows.length < 50) {
    throw new Error("Medlemskilden er ufuldstændig. Ingen data er ændret.");
  }
  const verifiedOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { rows, verifiedOn };
}
