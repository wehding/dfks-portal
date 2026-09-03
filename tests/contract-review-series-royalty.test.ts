import assert from "node:assert/strict";
import test from "node:test";
import {
  hasExplicitSeriesEpisodeScope,
  resolveContractReviewProductionType,
  royaltyRequirementForProductionType,
} from "../lib/contract-review-domain-rules";

const sommerdahlContract = `
KLIPPER AF 2 EPISODER (5+6) samt sammenklip af FILM 3,
til en fiktionsproduktion, hvis foreløbige titel er SOMMERDAHL 8
`;

test("et konkret episodeomfang klassificeres deterministisk som tv-serie", () => {
  assert.equal(hasExplicitSeriesEpisodeScope(sommerdahlContract), true);
  assert.equal(resolveContractReviewProductionType("spillefilm", sommerdahlContract), "tvserie");
  assert.equal(resolveContractReviewProductionType("ukendt", sommerdahlContract), "tvserie");
});

test("arbejde på nummererede afsnit klassificeres deterministisk som tv-serie", () => {
  const contract = "Producenten engagerer Medarbejderen som Klipper på afsnit 1 og 4";
  assert.equal(hasExplicitSeriesEpisodeScope(contract), true);
  assert.equal(resolveContractReviewProductionType("spillefilm", contract), "tvserie");
});

test("en nummereret titel eller juridisk afsnitshenvisning bruges ikke som seriesignal", () => {
  assert.equal(hasExplicitSeriesEpisodeScope("Fiktionsproduktion med titlen SOMMERDAHL 8"), false);
  assert.equal(hasExplicitSeriesEpisodeScope("Royalty beregnes som beskrevet i afsnit 4"), false);
  assert.equal(resolveContractReviewProductionType("spillefilm", "Fiktionsproduktion med titlen SOMMERDAHL 8"), "spillefilm");
});

test("royaltykravet gælder spillefilm, men ikke tv-serier", () => {
  assert.match(royaltyRequirementForProductionType("spillefilm"), /ROYALTY PÅKRÆVET/);
  assert.equal(royaltyRequirementForProductionType("tvserie"), "");
});
