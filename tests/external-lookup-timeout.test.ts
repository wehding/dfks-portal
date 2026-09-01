import assert from "node:assert/strict";
import test from "node:test";
import {
  externalLookupWarning,
  runExternalLookup,
  runWithLookupDeadline,
} from "../lib/external-lookup";

test("eksternt opslag afsluttes ved tidsgrænsen", async () => {
  const started = Date.now();
  const result = await runExternalLookup("dfi", () => new Promise(resolve => setTimeout(() => resolve("for sent"), 100)), 10);
  assert.equal(result.status, "timeout");
  assert.ok(Date.now() - started < 80);
});

test("den generiske deadline kan bruges omkring et samlet serveropslag", async () => {
  const result = await runWithLookupDeadline(() => new Promise(resolve => setTimeout(resolve, 100)), 10);
  assert.equal(result.status, "timeout");
});

test("vellykket eksternt opslag returnerer værdien", async () => {
  const result = await runExternalLookup("tmdb", async () => ["resultat"], 50);
  assert.deepEqual(result, { source: "tmdb", status: "success", value: ["resultat"] });
});

test("fejl og abort klassificeres sikkert", async () => {
  const failure = await runExternalLookup("dfi", async () => { throw new Error("netværksfejl"); }, 50);
  const timeout = await runExternalLookup("tmdb", async () => { throw new DOMException("aborted", "AbortError"); }, 50);
  assert.equal(failure.status, "error");
  assert.equal(timeout.status, "timeout");
});

test("advarsel forklarer at manuel indtastning er mulig", () => {
  assert.equal(
    externalLookupWarning({ dfi: "timeout", tmdb: "success" }, "da"),
    "DFI svarede ikke. Du kan fortsætte med lokal eller manuel indtastning.",
  );
});
