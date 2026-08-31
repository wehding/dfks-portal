import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const canonicalPath = path.join(root, "AI_CODING_RULES.md");
const entrypoints = ["AGENTS.md", "CLAUDE.md"];
const findings = [];
const versionPattern = /DFKS_AI_RULES_VERSION:\s*([0-9]+\.[0-9]+\.[0-9]+)/;

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    findings.push(`${relativePath}: filen mangler`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

const canonical = read("AI_CODING_RULES.md");
const canonicalVersion = canonical.match(versionPattern)?.[1] ?? null;
if (!canonicalVersion) findings.push("AI_CODING_RULES.md: versionsmarkør mangler");

for (const heading of [
  "## Change classification",
  "## Sensitive-flow requirements",
  "## Performance requirements",
  "## Database and Supabase requirements",
  "## Required verification",
  "## Documentation and handoff",
  "## Part 1 operating mode",
]) {
  if (!canonical.includes(heading)) findings.push(`AI_CODING_RULES.md: mangler ${heading}`);
}

for (const entrypoint of entrypoints) {
  const content = read(entrypoint);
  const version = content.match(versionPattern)?.[1] ?? null;
  if (version !== canonicalVersion) {
    findings.push(`${entrypoint}: version ${version ?? "mangler"} matcher ikke ${canonicalVersion ?? "ukendt"}`);
  }
  if (!content.includes("AI_CODING_RULES.md")) findings.push(`${entrypoint}: mangler reference til fælles regler`);
  for (const term of ["audit", "RLS", "performance", "produktionsmigration"]) {
    if (!content.toLocaleLowerCase("da-DK").includes(term.toLocaleLowerCase("da-DK"))) {
      findings.push(`${entrypoint}: kritisk kortregel mangler ${term}`);
    }
  }
}

const packageJson = JSON.parse(read("package.json") || "{}");
for (const script of ["agent:rules", "audit:coverage", "test:audit-lifecycle", "test:list-performance", "check", "build"]) {
  if (!packageJson.scripts?.[script]) findings.push(`package.json: mangler script ${script}`);
}

if (findings.length) {
  console.warn(`Agent rule findings (${findings.length}):\n${findings.map(item => `- ${item}`).join("\n")}`);
  if (strict) process.exit(1);
} else {
  console.log(`Agent rules verified: version ${canonicalVersion}, Codex and Claude aligned`);
}
