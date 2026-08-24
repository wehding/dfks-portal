import assert from "node:assert/strict";
import test from "node:test";
import {
  ContractImportPipelineError,
  classifyContractImportFailure,
  contractImportRetryDelayMs,
} from "../lib/contract-import-job";
import {
  CONTRACT_EXTRACTION_JSON_SCHEMA,
  contractExtractionResponseSchema,
  hasUsableContractExtraction,
  mergeContractExtractionChunks,
  normalizeContractExtraction,
  splitContractTextForExtraction,
} from "../lib/contract-extraction-schema";
import { contractProductionTypeToWorkType } from "../lib/contract-import";

test("retryplan bruger 1, 5, 15, 60 og 360 minutter uden jitter ved random 0,5", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(attempt => contractImportRetryDelayMs(attempt, () => 0.5)), [
    60_000, 300_000, 900_000, 3_600_000, 21_600_000, 21_600_000,
  ]);
});

test("konfigurations- og betalingsfejl blokerer uden at bruge et forsøg", () => {
  const config = classifyContractImportFailure(new ContractImportPipelineError({
    message: "API key missing", code: "invalid_key", failureClass: "configuration", httpStatus: 401,
  }), 1);
  assert.equal(config.status, "blocked");
  assert.equal(config.failureClass, "configuration");
  assert.equal(config.refundAttempt, true);

  const billing = classifyContractImportFailure(new ContractImportPipelineError({
    message: "credit balance too low", code: "insufficient_credit", failureClass: "billing",
  }), 3);
  assert.equal(billing.status, "blocked");
  assert.equal(billing.refundAttempt, true);
});

test("rate limit følger Retry-After og ugyldig JSON prøves kun én ekstra gang", () => {
  const now = new Date("2026-08-14T10:00:00.000Z");
  const limited = classifyContractImportFailure(new ContractImportPipelineError({
    message: "rate limited", code: "rate_limit", failureClass: "rate_limit", httpStatus: 429, retryAfterMs: 42_000,
  }), 1, now, () => 0.5);
  assert.equal(limited.status, "retry_wait");
  assert.equal(limited.nextAttemptAt, "2026-08-14T10:00:42.000Z");

  const firstInvalid = classifyContractImportFailure(new ContractImportPipelineError({
    message: "invalid json", code: "invalid_json", failureClass: "invalid_output",
  }), 1, now, () => 0.5);
  const secondInvalid = classifyContractImportFailure(new ContractImportPipelineError({
    message: "invalid json", code: "invalid_json", failureClass: "invalid_output",
  }), 2, now, () => 0.5);
  assert.equal(firstInvalid.status, "retry_wait");
  assert.equal(secondInvalid.status, "dead");
});

test("for lidt tekst markeres som OCR-opgave", () => {
  const decision = classifyContractImportFailure(new ContractImportPipelineError({
    message: "insufficient", code: "insufficient_text", failureClass: "input",
  }), 1);
  assert.equal(decision.status, "dead");
  assert.equal(decision.itemStatus, "needs_ocr");
});

test("tomt AI-resultat bliver ikke registreret som en vellykket aflæsning", () => {
  assert.equal(hasUsableContractExtraction({ copydan: false, svod: false, signatureStatus: "unknown" }), false);
  assert.equal(hasUsableContractExtraction({ workTitle: "Reservatet", copydan: false }), true);
  const decision = classifyContractImportFailure(new ContractImportPipelineError({
    message: "ingen felter", code: "no_usable_contract_data", failureClass: "invalid_output",
  }), 1);
  assert.equal(decision.status, "dead");
  assert.equal(decision.errorCode, "no_usable_contract_data");
  assert.match(decision.safeMessage, /ingen genkendelige kontraktoplysninger/i);
});

test("store kontrakter opdeles uden at miste slutningen eller underskriftssiden", () => {
  const page1 = `START ${"A".repeat(140)}`;
  const page2 = `MIDTE ${"B".repeat(140)}`;
  const page3 = `UNDERSKRIFTSSIDE ${"C".repeat(140)}`;
  const chunks = splitContractTextForExtraction(`${page1}\f${page2}\f${page3}`, 220);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every(chunk => chunk.length <= 220));
  assert.match(chunks.join("\n"), /START/);
  assert.match(chunks.join("\n"), /MIDTE/);
  assert.match(chunks.join("\n"), /UNDERSKRIFTSSIDE/);
});

test("chunkresultater flettes deterministisk og positive rettighedsfund vinder", () => {
  const merged = mergeContractExtractionChunks([
    { workTitle: "Værket", copydan: false, signatureStatus: "unknown", signatureMethod: "none", salary: 12_000 },
    { workTitle: "Andet gæt", copydan: true, signatureStatus: "yes", signatureMethod: "digital", signaturePage: 9 },
  ]);
  assert.equal(merged.workTitle, "Værket");
  assert.equal(merged.salary, 12_000);
  assert.equal(merged.copydan, true);
  assert.equal(merged.signatureStatus, "yes");
  assert.equal(merged.signatureMethod, "digital");
  assert.equal(merged.signaturePage, 9);
});

test("otherSupplements sammenlægges på tværs af chunks — et tidligt tomt array låser ikke feltet", () => {
  const merged = mergeContractExtractionChunks([
    { workTitle: "Værket", otherSupplements: [] },
    { otherSupplements: [{ category: "genetillaeg", amount: 3000, unit: "pr. uge", note: "Over- og forskudttid", sourceText: "[s1_c4] Fast tillæg for over- og forskudttid: kr. 3.000" }] },
  ]);
  assert.equal(Array.isArray(merged.otherSupplements), true);
  const supplements = merged.otherSupplements as Array<Record<string, unknown>>;
  assert.equal(supplements.length, 1);
  assert.equal(supplements[0].category, "genetillaeg");
  assert.equal(supplements[0].amount, 3000);
});

test("normalisering fjerner ukendte felter og accepterer danske tal", () => {
  const normalized = normalizeContractExtraction({
    workTitle: "  Min film  ", salary: "14.637,50", copydan: "ja",
    seasonNumber: "4", episodeNumbers: [3, 1, 3], privateKey: "må ikke gemmes",
  });
  assert.equal(normalized.workTitle, "Min film");
  assert.equal(normalized.salary, 14_637.5);
  assert.equal(normalized.copydan, true);
  assert.equal(normalized.seasonNumber, 4);
  assert.deepEqual(normalized.episodeNumbers, [1, 3]);
  assert.equal("privateKey" in normalized, false);
});

test("det fælles AI-skema er et lukket JSON-objekt med centrale felter", () => {
  assert.equal(CONTRACT_EXTRACTION_JSON_SCHEMA.type, "object");
  assert.equal(CONTRACT_EXTRACTION_JSON_SCHEMA.additionalProperties, false);
  const properties = CONTRACT_EXTRACTION_JSON_SCHEMA.properties as Record<string, unknown>;
  for (const field of ["workTitle", "rightsHolderName", "seasonNumber", "episodeNumbers", "salary", "copydan", "signatureStatus", "_sources"]) {
    assert.ok(field in properties);
  }
  const sourceProperties = (properties._sources as { properties: Record<string, unknown> }).properties;
  assert.ok("creditedRoles" in sourceProperties);
  assert.ok("creditedRoles_clause_id" in sourceProperties);
});

test("normalisering bevarer krediteringskilden og klausul-id'et", () => {
  const normalized = normalizeContractExtraction({
    creditedRoles: "Klipper",
    _sources: {
      creditedRoles: "[s1_c10] Der er aftalt følgende vedrørende kreditering: Klipper Sofie Steenberger",
      creditedRoles_clause_id: "s1_c10",
    },
  });
  assert.equal((normalized._sources as Record<string, unknown>).creditedRoles_clause_id, "s1_c10");
});

test("normalisering bevarer strukturerede arbejdsfaser og tillæg", () => {
  const workPhase = { phase: "post_edit_finishing", weeks: 1, paymentType: "included_in_salary", amount: 9200, amountType: "calculated", note: "Lydmix", sourceText: "[s2_c7] deltagelse i lydmix" };
  const supplement = { category: "efterarbejde", amount: 2000, unit: "engangsbeløb", note: "Lydmix", sourceText: "[s2_c8] tillæg 2.000 kr." };
  const normalized = normalizeContractExtraction({ workPhases: [workPhase], otherSupplements: [supplement] });
  assert.deepEqual(normalized.workPhases, [workPhase]);
  assert.deepEqual(normalized.otherSupplements, [supplement]);
});

test("arbejdsfaser sammenlægges på tværs af kontraktdele", () => {
  const merged = mergeContractExtractionChunks([
    { workPhases: [{ phase: "preproduction", weeks: 1 }] },
    { workPhases: [{ phase: "post_edit_finishing", weeks: 1 }] },
  ]);
  assert.equal((merged.workPhases as unknown[]).length, 2);
});

test("Anthropic bruger JSON-prompten når det fulde schema overskrider providergrænserne", () => {
  assert.equal(contractExtractionResponseSchema("anthropic"), undefined);
  assert.equal(contractExtractionResponseSchema("google"), CONTRACT_EXTRACTION_JSON_SCHEMA);
});

test("AI-produktionstyper mappes til portalens fælles værkstyper", () => {
  assert.equal(contractProductionTypeToWorkType("documentary"), "dokumentarfilm");
  assert.equal(contractProductionTypeToWorkType("docSeries"), "dokumentar-serie");
  assert.equal(contractProductionTypeToWorkType("tvEntertainment"), "tv-serie");
  assert.equal(contractProductionTypeToWorkType("short"), "kortfilm");
});
