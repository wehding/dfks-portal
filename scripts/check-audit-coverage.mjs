import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const registryPath = path.join(root, "config/audit-coverage.json");
const matrixPath = path.join(root, "docs/security/c57921-logdaekningsmatrix.md");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const required = ["path", "processing", "categories", "members", "purpose", "legalBasis", "action", "component", "targetResolution", "failClosed", "test", "owner"];
const failures = [];
const seen = new Set();
for (const entry of registry.entries ?? []) {
  for (const field of required) if (entry[field] === undefined || entry[field] === "" || (Array.isArray(entry[field]) && !entry[field].length)) failures.push(`${entry.path || "ukendt"}: mangler ${field}`);
  if (seen.has(entry.path)) failures.push(`${entry.path}: dublet`);
  seen.add(entry.path);
  const sourcePath = path.join(root, entry.path);
  const implementationPath = path.join(root, entry.auditImplementation ?? entry.path);
  if (!fs.existsSync(sourcePath)) failures.push(`${entry.path}: filen findes ikke`);
  if (!fs.existsSync(implementationPath)) failures.push(`${entry.path}: audit-implementeringen findes ikke`);
  else if (!fs.readFileSync(implementationPath, "utf8").includes("recordAuditEvent(")) failures.push(`${entry.path}: mangler semantisk audit-event`);
  if (!fs.existsSync(path.join(root, entry.test))) failures.push(`${entry.path}: testreferencen findes ikke`);
}

const exclusions = new Map();
for (const exclusion of registry.exclusions ?? []) {
  for (const field of ["path", "reason", "owner", "test"]) if (!exclusion[field]) failures.push(`${exclusion.path || "ukendt udeladelse"}: mangler ${field}`);
  if (!fs.existsSync(path.join(root, exclusion.path))) failures.push(`${exclusion.path}: udeladt fil findes ikke`);
  if (!fs.existsSync(path.join(root, exclusion.test))) failures.push(`${exclusion.path}: udeladelsens test findes ikke`);
  exclusions.set(exclusion.path, exclusion);
}

function routeFiles(directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(item => {
    const relative = path.join(directory, item.name);
    return item.isDirectory() ? routeFiles(relative) : item.name === "route.ts" ? [relative] : [];
  });
}

for (const coverageRoot of registry.coverageRoots ?? []) {
  for (const route of routeFiles(coverageRoot)) {
    if (!seen.has(route) && !exclusions.has(route)) failures.push(`${route}: følsomt endpoint mangler i registry eller dokumenteret udeladelse`);
  }
}
const esc = value => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const rows = [...registry.entries].sort((a, b) => a.path.localeCompare(b.path)).map(entry =>
  `| ${esc(entry.path)} | ${esc(entry.processing)} | ${esc(entry.categories.join(", "))} | ${esc(entry.members)} | ${esc(entry.purpose)} | ${esc(entry.legalBasis)} | ${esc(entry.action)} / ${esc(entry.component)} | ${esc(entry.targetResolution)} | ${entry.failClosed ? "Ja" : "Nej"} | ${esc(entry.test)} | ${esc(entry.owner)} |`);
const exclusionRows = [...exclusions.values()].sort((a, b) => a.path.localeCompare(b.path))
  .map(item => `| ${esc(item.path)} | ${esc(item.reason)} | ${esc(item.test)} | ${esc(item.owner)} |`);
const matrix = `# C-579/21 logdækningsmatrix\n\nMaskingenereret fra \`config/audit-coverage.json\`. Senest kontrolleret: ${registry.lastReviewed}. CI scanner alle \`route.ts\` under de registrerede følsomme områder og afviser nye endpoints uden auditregistrering eller en dokumenteret udeladelse.\n\n| Endpoint/serverhandling | Behandling | Datakategorier | Berørte medlemmer | Formål | Retsgrundlag | Audit-event | Målmedlem | Fejler lukket | Test | Ejer |\n|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n\n## Dokumenterede udeladelser\n\n| Endpoint | Begrundelse | Test | Ejer |\n|---|---|---|---|\n${exclusionRows.join("\n")}\n`;
if (process.argv.includes("--write")) fs.writeFileSync(matrixPath, matrix);
else if (!fs.existsSync(matrixPath) || fs.readFileSync(matrixPath, "utf8") !== matrix) failures.push("Den genererede logdækningsmatrix er ikke opdateret (kør npm run audit:coverage:write)");
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`Audit coverage verified: ${registry.entries.length} flows`);
