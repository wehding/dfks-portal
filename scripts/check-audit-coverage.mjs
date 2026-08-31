import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const shouldWrite = process.argv.includes("--write");
const registryPath = path.join(root, "config/audit-coverage.json");
const matrixPath = path.join(root, "docs/security/c57921-logdaekningsmatrix.md");
const gapReportPath = path.join(root, "docs/security/c57921-audit-gap-report.md");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const structuralFailures = [];
const findings = [];
const required = [
  "path", "processing", "categories", "members", "purpose", "legalBasis",
  "action", "component", "targetResolution", "failClosed", "test", "owner",
];
const seen = new Set();
const classified = new Set();
const registeredPaths = new Set((registry.entries ?? []).map(entry => entry.path));
const candidateClassifications = [
  ...(registry.candidateClassifications ?? []),
  ...(registry.classificationGroups ?? []).flatMap(group => (group.paths ?? []).map(item => ({
    ...group,
    paths: undefined,
    ...(typeof item === "string" ? { path: item } : item),
  }))),
].filter(candidate => !registeredPaths.has(candidate.path));

if (registry.schemaVersion !== 3) structuralFailures.push("Registry skal bruge schemaVersion 3");
if (!registry.lastReviewed) structuralFailures.push("Registry mangler lastReviewed");
if (!Array.isArray(registry.processingActivities) || !registry.processingActivities.length) {
  structuralFailures.push("Registry mangler behandlingsaktiviteter");
}

for (const entry of registry.entries ?? []) {
  for (const field of required) {
    if (entry[field] === undefined || entry[field] === "" || (Array.isArray(entry[field]) && !entry[field].length)) {
      structuralFailures.push(`${entry.path || "ukendt"}: mangler ${field}`);
    }
  }
  if (seen.has(entry.path)) structuralFailures.push(`${entry.path}: dublet`);
  seen.add(entry.path);
  classified.add(entry.path);
  const sourcePath = path.join(root, entry.path);
  const implementationPath = path.join(root, entry.auditImplementation ?? entry.path);
  if (!fs.existsSync(sourcePath)) structuralFailures.push(`${entry.path}: filen findes ikke`);
  if (!fs.existsSync(implementationPath)) structuralFailures.push(`${entry.path}: audit-implementeringen findes ikke`);
  else {
    const implementation = fs.readFileSync(implementationPath, "utf8");
    if (!implementation.includes("recordAuditEvent(") && !implementation.includes("withMemberDataAudit(")) {
      findings.push(`${entry.path}: semantisk audit-event kan ikke bekræftes statisk i ${entry.auditImplementation ?? entry.path}`);
    }
  }
  if (!fs.existsSync(path.join(root, entry.test))) structuralFailures.push(`${entry.path}: testreferencen findes ikke`);
}

const allowedDispositions = new Set(["instrument", "delegate", "exclude"]);
for (const candidate of candidateClassifications) {
  for (const field of ["path", "disposition", "rationale", "owner", "test", "status"]) {
    if (!candidate[field]) structuralFailures.push(`${candidate.path || "ukendt kandidat"}: mangler ${field}`);
  }
  if (!allowedDispositions.has(candidate.disposition)) {
    structuralFailures.push(`${candidate.path || "ukendt kandidat"}: ugyldig disposition ${candidate.disposition}`);
  }
  if (classified.has(candidate.path)) structuralFailures.push(`${candidate.path}: dubletklassifikation`);
  classified.add(candidate.path);
  const sourcePath = path.join(root, candidate.path);
  if (!fs.existsSync(sourcePath)) structuralFailures.push(`${candidate.path}: klassificeret fil findes ikke`);
  if (!fs.existsSync(path.join(root, candidate.test))) structuralFailures.push(`${candidate.path}: klassifikationens test findes ikke`);
  if (candidate.disposition === "delegate") {
    if (!candidate.auditImplementation) structuralFailures.push(`${candidate.path}: delegation mangler auditImplementation`);
    else if (!fs.existsSync(path.join(root, candidate.auditImplementation))) structuralFailures.push(`${candidate.path}: delegeret auditImplementation findes ikke`);
  }
  if (candidate.status !== "verified") {
    findings.push(`${candidate.path}: ${candidate.disposition} er klassificeret, men status er ${candidate.status}`);
  }
}

const exclusions = new Map();
for (const exclusion of registry.exclusions ?? []) {
  for (const field of ["path", "reason", "owner", "test"]) {
    if (!exclusion[field]) structuralFailures.push(`${exclusion.path || "ukendt udeladelse"}: mangler ${field}`);
  }
  if (!fs.existsSync(path.join(root, exclusion.path))) structuralFailures.push(`${exclusion.path}: udeladt fil findes ikke`);
  if (!fs.existsSync(path.join(root, exclusion.test))) structuralFailures.push(`${exclusion.path}: udeladelsens test findes ikke`);
  exclusions.set(exclusion.path, exclusion);
  classified.add(exclusion.path);
}

function filesBelow(directory, predicate) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(item => {
    const relative = path.join(directory, item.name);
    return item.isDirectory() ? filesBelow(relative, predicate) : predicate(relative) ? [relative] : [];
  });
}

function looksSensitive(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const pathSignal = /(contract|kontrakt|member|medlem|rettighed|audit|ocr|statistic|statistik|salary|løn|document|dokument|profile|profil|claim|screening|export|download)/i.test(relativePath);
  const sourceSignal = /(rettighedshavere|contracts|contract_documents|salary|løn|ocr|audit|targetMember|memberId|recordAuditEvent|withMemberDataAudit)/i.test(source);
  return pathSignal || sourceSignal;
}

const discovered = new Set();
for (const directory of registry.discoveryRoots ?? ["app/api"]) {
  for (const file of filesBelow(directory, candidate => candidate.endsWith("/route.ts") && looksSensitive(candidate))) discovered.add(file);
}
for (const directory of registry.serverActionRoots ?? ["app/actions"]) {
  for (const file of filesBelow(directory, candidate => /\.(ts|tsx)$/.test(candidate))) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    if (source.includes('"use server"') && looksSensitive(file)) discovered.add(file);
  }
}

for (const file of [...discovered].sort()) {
  if (!classified.has(file)) findings.push(`${file}: følsomt flow er ikke klassificeret i registry eller som dokumenteret udeladelse`);
}

for (const coverageRoot of registry.coverageRoots ?? []) {
  for (const route of filesBelow(coverageRoot, candidate => candidate.endsWith("/route.ts"))) {
    if (!classified.has(route)) {
      structuralFailures.push(`${route}: endpoint under obligatorisk dækningsområde mangler registry eller dokumenteret udeladelse`);
    }
  }
}

const esc = value => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
const rows = [...(registry.entries ?? [])].sort((a, b) => a.path.localeCompare(b.path)).map(entry =>
  `| ${esc(entry.path)} | ${esc(entry.processing)} | ${esc(entry.lifecycleStage ?? "Ikke klassificeret")} | ${esc(entry.status ?? "implemented")} | ${esc(entry.categories.join(", "))} | ${esc(entry.members)} | ${esc(entry.purpose)} | ${esc(entry.legalBasis)} | ${esc(entry.action)} / ${esc(entry.component)} | ${esc(entry.targetResolution)} | ${entry.failClosed ? "Ja" : "Nej"} | ${esc(entry.test)} | ${esc(entry.owner)} |`);
const exclusionRows = [...exclusions.values()].sort((a, b) => a.path.localeCompare(b.path))
  .map(item => `| ${esc(item.path)} | ${esc(item.reason)} | ${esc(item.test)} | ${esc(item.owner)} |`);
const classificationRows = [...candidateClassifications].sort((a, b) => a.path.localeCompare(b.path))
  .map(item => `| ${esc(item.path)} | ${esc(item.disposition)} | ${esc(item.status)} | ${esc(item.auditImplementation ?? "-")} | ${esc(item.rationale)} | ${esc(item.test)} | ${esc(item.owner)} |`);
const activityRows = (registry.processingActivities ?? []).map(item =>
  `| ${esc(item.id)} | ${esc(item.name)} | ${esc(item.lifecycleStages?.join(", ") ?? item.lifecyclePhase)} | ${esc(item.owner)} |`);
const matrix = `# C-579/21 logdækningsmatrix\n\nMaskingenereret fra \`config/audit-coverage.json\`. Senest kontrolleret: ${registry.lastReviewed}. Registry er autoritativ; den brede kildekodescanning rapporterer nye kandidater uden at blokere udvikling i del 1. Streng håndhævelse aktiveres først i del 2.\n\n## Behandlingsaktiviteter\n\n| ID | Aktivitet | Livscyklus | Ejer |\n|---|---|---|---|\n${activityRows.join("\n")}\n\n## Registrerede flows\n\n| Endpoint/serverhandling | Behandling | Livscyklus | Status | Datakategorier | Berørte medlemmer | Formål | Retsgrundlag | Audit-event | Målmedlem | Fejler lukket | Test | Ejer |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n\n## Klassificerede kandidater\n\n| Endpoint/serverhandling | Disposition | Status | Auditimplementation | Begrundelse | Test | Ejer |\n|---|---|---|---|---|---|---|\n${classificationRows.join("\n")}\n\n## Dokumenterede udeladelser\n\n| Endpoint | Begrundelse | Test | Ejer |\n|---|---|---|---|\n${exclusionRows.join("\n")}\n`;
const gapReport = `# Audit-gaprapport\n\nGenereret for registry-review ${registry.lastReviewed} fra schema version ${registry.schemaVersion}. Tilstand: ${registry.mode ?? "reporting"}.\n\n## Resultat\n\n- Registrerede flows: ${registry.entries?.length ?? 0}\n- Dokumenterede udeladelser: ${registry.exclusions?.length ?? 0}\n- Automatisk fundne følsomme kandidater: ${discovered.size}\n- Rapporterede fund: ${findings.length}\n- Strukturelle fejl: ${structuralFailures.length}\n\n## Rapporterede fund\n\n${findings.length ? findings.map(item => `- ${item}`).join("\n") : "Ingen åbne fund."}\n\n## Strukturelle fejl\n\n${structuralFailures.length ? structuralFailures.map(item => `- ${item}`).join("\n") : "Ingen strukturelle fejl."}\n`;

if (shouldWrite) {
  fs.writeFileSync(matrixPath, matrix);
  fs.writeFileSync(gapReportPath, gapReport);
} else {
  if (!fs.existsSync(matrixPath) || fs.readFileSync(matrixPath, "utf8") !== matrix) {
    structuralFailures.push("Den genererede logdækningsmatrix er ikke opdateret (kør npm run audit:coverage:write)");
  }
  if (!fs.existsSync(gapReportPath) || fs.readFileSync(gapReportPath, "utf8") !== gapReport) {
    structuralFailures.push("Audit-gaprapporten er ikke opdateret (kør npm run audit:coverage:write)");
  }
}

if (structuralFailures.length || (strict && findings.length)) {
  console.error([...structuralFailures, ...(strict ? findings : [])].join("\n"));
  process.exit(1);
}
if (findings.length) console.warn(`Audit coverage reporting: ${findings.length} fund; se ${path.relative(root, gapReportPath)}`);
console.log(`Audit coverage verified: ${registry.entries?.length ?? 0} registrerede flows, ${discovered.size} automatisk fundne kandidater`);
