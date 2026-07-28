import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyIdentityCandidates,
  identityLevel,
  identityTitleVariants,
  isInheritedEpisodeIdentity,
  scoreIdentityCandidate,
  validImdbId,
} from "../lib/work-identity";

test("DFI's tekniske oversigtstitel giver en kanonisk serietitel", () => {
  assert.deepEqual(identityTitleVariants({ title: "Velkommen til frontlinjen – oversigt", alternativeTitles: ["Denmark at War"] }), [
    "Velkommen til frontlinjen – oversigt",
    "Velkommen til frontlinjen",
    "Denmark at War",
  ]);
});

test("serie, film og afsnit får hvert sit identitetsniveau", () => {
  assert.equal(identityLevel("dokumentar-serie"), "series");
  assert.equal(identityLevel("spillefilm"), "movie");
  assert.equal(identityLevel("dokumentar-serie", { title: "Serie" }), "episode");
});

test("direkte Wikidata/TMDb-relation godkendes automatisk", () => {
  const input = { title: "Velkommen til frontlinjen", year: 2024, type: "dokumentar-serie" };
  const score = scoreIdentityCandidate(input, { title: input.title, year: 2024, type: "series", directExternalLink: true });
  assert.equal(score.confidence, 100);
  const result = classifyIdentityCandidates([{ imdbId: "tt33485491", title: input.title, year: 2024, type: "series", confidence: score.confidence, sources: ["wikidata"], matchedBy: score.matchedBy }]);
  assert.equal(result.status, "matched");
});

test("entydigt OMDb-sæson/afsnit godkendes automatisk", () => {
  const input = { title: "Velkommen til frontlinjen - S01E01", year: 2024, type: "dokumentar-serie", parent: { title: "Velkommen til frontlinjen" }, seasonNumber: 1, episodeNumber: 1 };
  const score = scoreIdentityCandidate(input, { title: "Vi kommer med fred", year: 2024, type: "episode", exactEpisodeRelation: true });
  assert.equal(score.confidence, 95);
  const result = classifyIdentityCandidates([{ imdbId: "tt33501746", title: "Vi kommer med fred", year: 2024, type: "episode", confidence: score.confidence, sources: ["omdb"], matchedBy: score.matchedBy }]);
  assert.equal(result.status, "matched");
});

test("usikre resultater gemmes ikke automatisk", () => {
  const result = classifyIdentityCandidates([{ imdbId: "tt1234567", title: "Anden titel", confidence: 50, sources: ["omdb"], matchedBy: [] }]);
  assert.equal(result.status, "not_found");
});

test("to stærke, forskellige IMDb-ID'er kræver manuel kontrol", () => {
  const result = classifyIdentityCandidates([
    { imdbId: "tt1234567", title: "Titel", confidence: 95, sources: ["wikidata"], matchedBy: ["external_id"] },
    { imdbId: "tt7654321", title: "Titel", confidence: 90, sources: ["omdb"], matchedBy: ["provider_match"] },
  ]);
  assert.equal(result.status, "review_required");
});

test("et afsnits kopierede serie-ID identificeres som arvet", () => {
  assert.equal(isInheritedEpisodeIdentity("tt33485491", "tt33485491"), true);
  assert.equal(isInheritedEpisodeIdentity("tt33501746", "tt33485491"), false);
  assert.equal(isInheritedEpisodeIdentity(null, "tt33485491"), false);
  assert.equal(validImdbId("tt33501746"), true);
});
