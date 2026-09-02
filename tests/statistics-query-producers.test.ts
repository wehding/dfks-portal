import assert from "node:assert/strict";
import test from "node:test";
import { resolveStatisticsProducerNames, type ProducerRegistryEmployer } from "../lib/statistics-query-producers";

const nordiskFilmRoot = "11111111-1111-4111-8111-111111111111";
const nordiskFilmProduction = "22222222-2222-4222-8222-222222222222";
const nordiskFilmTv = "33333333-3333-4333-8333-333333333333";
const zentropa = "44444444-4444-4444-8444-444444444444";
const nimbusFilm = "55555555-5555-4555-8555-555555555555";

const employers: ProducerRegistryEmployer[] = [
  { id: nordiskFilmRoot, name: "Nordisk Film", parent_id: null, employer_aliases: [], employer_legal_entities: [] },
  { id: nordiskFilmProduction, name: "NORDISK FILM PRODUCTION A/S", parent_id: nordiskFilmRoot, employer_aliases: [], employer_legal_entities: [] },
  { id: nordiskFilmTv, name: "NORDISK FILM TV", parent_id: nordiskFilmRoot, employer_aliases: [], employer_legal_entities: [] },
  { id: zentropa, name: "Zentropa", parent_id: null, employer_aliases: [], employer_legal_entities: [] },
  { id: nimbusFilm, name: "Nimbus Film", parent_id: null, employer_aliases: [], employer_legal_entities: [] },
];

test("bredt producentnavn samles til overordnet producentgruppe", () => {
  const result = resolveStatisticsProducerNames(["Nordisk Film"], "Vis lønkurve for producent Nordisk Film", employers);
  assert.equal(result.ambiguous, null);
  assert.deepEqual(result.resolved, [{
    ids: [nordiskFilmRoot, nordiskFilmProduction, nordiskFilmTv],
    name: "Nordisk Film",
    scope: "group",
  }]);
});

test("match på underenhed bruger producentgruppen når spørgsmålet ikke beder om juridisk enhed", () => {
  const result = resolveStatisticsProducerNames(["Nordisk Film Production"], "Vis lønkurve for producent Nordisk Film Production", employers);
  assert.equal(result.ambiguous, null);
  assert.deepEqual(result.resolved[0].ids, [nordiskFilmRoot, nordiskFilmProduction, nordiskFilmTv]);
  assert.equal(result.resolved[0].scope, "group");
});

test("fuldt selskabsnavn med A/S behandles som specifik juridisk enhed", () => {
  const result = resolveStatisticsProducerNames(["Nordisk Film Production A/S"], "Vis lønkurve for Nordisk Film Production A/S", employers);
  assert.equal(result.ambiguous, null);
  assert.deepEqual(result.resolved, [{
    ids: [nordiskFilmProduction],
    name: "NORDISK FILM PRODUCTION A/S",
    scope: "legal_entity",
  }]);
});

test("kun-formulering kan vælge en konkret underenhed", () => {
  const result = resolveStatisticsProducerNames(["Nordisk Film TV"], "Vis lønkurve kun for Nordisk Film TV", employers);
  assert.equal(result.ambiguous, null);
  assert.deepEqual(result.resolved, [{
    ids: [nordiskFilmTv],
    name: "NORDISK FILM TV",
    scope: "legal_entity",
  }]);
});

test("reel tvetydighed på tværs af grupper bevares", () => {
  const result = resolveStatisticsProducerNames(["Film"], "Vis lønkurve for producent Film", employers);
  assert.equal(result.resolved.length, 0);
  assert.equal(result.ambiguous?.query, "Film");
  assert.ok((result.ambiguous?.candidates.length ?? 0) > 1);
});
