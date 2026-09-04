import { createHmac } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const endpoint = process.env.INSIGHTS_INGEST_URL;
const secret = process.env.PERFORMANCE_INGEST_SECRET;
if (!endpoint || !secret) {
  console.log("Insights-ingestion er ikke konfigureret; performance-artifact bevares i GitHub.");
  process.exit(0);
}

const routes = {
  "member-contracts": "/portal/mine-kontrakter",
  "member-works": "/portal/mine-vaerker",
  "admin-contracts": "/admin/kontrakter",
  "admin-works": "/admin/vaerker",
  "member-dashboard": "/portal",
  "contract-reviews": "/admin/kontraktgennemgang",
  "admin-producers": "/admin/producenter",
  "organisation-settings": "/admin/organisation",
};
let files = [];
try { files = await readdir("performance-report/results"); } catch { process.exit(0); }
const results = [];
for (const file of files.filter(name => name.endsWith(".json"))) {
  const item = JSON.parse(await readFile(`performance-report/results/${file}`, "utf8"));
  const median = item.median ?? {};
  results.push({
    routeName: item.routeName,
    route: routes[item.routeName],
    project: item.project,
    scenario: item.scenario,
    firstRowMs: median.firstRowMs ?? median.shellMs,
    completeMs: median.completeMs ?? median.textsMs,
    requestCount: median.requestCount,
    bytes: median.bytes,
    passed: item.passed !== false,
    thresholds: item.thresholds ?? {},
  });
}
const payload = JSON.stringify({
  runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`,
  runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined,
  commitSha: process.env.GITHUB_SHA,
  branch: process.env.GITHUB_REF_NAME,
  rowCount: Number(process.env.PERFORMANCE_ROW_COUNT || 0) || undefined,
  observedAt: new Date().toISOString(),
  results,
});
const signature = createHmac("sha256", secret).update(payload).digest("hex");
const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-dfks-signature": signature }, body: payload });
if (!response.ok) throw new Error(`Insights-ingestion fejlede med HTTP ${response.status}`);
console.log(`Publicerede ${results.length} performance-resultater til Insights.`);
