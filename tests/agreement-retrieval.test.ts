import test from "node:test";
import assert from "node:assert/strict";
import { detectAgreementReferences } from "../lib/agreement-detection";

test("detects the agreement families used as contract-review sources", () => {
  assert.deepEqual(detectAgreementReferences("Kontrakten følger De4-overenskomsten."), ["de4"]);
  assert.deepEqual(detectAgreementReferences("FAF dokumentar-overenskomst"), ["faf-dokumentar"]);
  assert.deepEqual(detectAgreementReferences("TV-overenskomst mellem DJ og Producentforeningen"), ["dj-tv"]);
  assert.deepEqual(detectAgreementReferences("Danmarks Radio følger aftalen med Dansk Metal"), ["dr-metal"]);
});

test("does not return duplicate agreement references", () => {
  assert.deepEqual(detectAgreementReferences("De4 og DE-4 overenskomst"), ["de4"]);
});
