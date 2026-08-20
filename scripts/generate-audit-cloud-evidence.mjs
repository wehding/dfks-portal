import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, "").split("="); return [key, rest.join("=")];
}));
const project = args.project;
const region = args.region || "europe-north1";
if (!project) throw new Error("Brug --project=<google-cloud-project>");
const service = "dfks-audit-siem-worker";
const bucket = args.bucket || `dfks-audit-worm-${project}`;

function gcloud(parts) {
  const value = execFileSync("gcloud", [...parts, "--project", project, "--format=json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(value || "null");
}

function attempt(label, parts) {
  try { return { label, ok: true, data: gcloud(parts) }; }
  catch (error) { return { label, ok: false, error: error?.stderr?.toString().trim() || error.message }; }
}

const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  project,
  region,
  evidence: [
    attempt("cloudRunService", ["run", "services", "describe", service, "--region", region]),
    attempt("cloudRunIam", ["run", "services", "get-iam-policy", service, "--region", region]),
    attempt("kmsKey", ["kms", "keys", "describe", "audit-signing", "--keyring", "dfks-audit", "--location", region]),
    attempt("kmsVersions", ["kms", "keys", "versions", "list", "--key", "audit-signing", "--keyring", "dfks-audit", "--location", region]),
    attempt("scheduler", ["scheduler", "jobs", "list", "--location", region, "--filter", "name:dfks-audit"]),
    attempt("wormBucket", ["storage", "buckets", "describe", `gs://${bucket}`]),
    attempt("wormBucketIam", ["storage", "buckets", "get-iam-policy", `gs://${bucket}`]),
    attempt("alerts", ["monitoring", "policies", "list", "--filter", "displayName:DFKS audit"]),
  ],
};
const canonical = JSON.stringify(evidence, null, 2);
const digest = createHash("sha256").update(canonical).digest("hex");
const outputDir = path.resolve(args.output || "artifacts/audit-evidence");
fs.mkdirSync(outputDir, { recursive: true });
const stamp = evidence.generatedAt.replaceAll(":", "-");
const output = path.join(outputDir, `cloud-evidence-${stamp}.json`);
fs.writeFileSync(output, `${canonical}\n`);
fs.writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`);
console.log(JSON.stringify({ output, digest, complete: evidence.evidence.every(item => item.ok) }, null, 2));
