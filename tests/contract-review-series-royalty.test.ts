import assert from "node:assert/strict";
import test from "node:test";
import {
  hasExplicitFictionSeriesScope,
  resolveContractReviewProductionType,
  royaltyRequirementForProductionType,
} from "../lib/contract-review-domain-rules";

const sommerdahlContract = `
KLIPPER AF 2 EPISODER (5+6) samt sammenklip af FILM 3,
til en fiktionsproduktion, hvis foreløbige titel er SOMMERDAHL 8
`;

test("episodeomfang og fiktionssignal klassificeres deterministisk som tv-serie", () => {
  assert.equal(hasExplicitFictionSeriesScope(sommerdahlContract), true);
  assert.equal(resolveContractReviewProductionType("spillefilm", sommerdahlContract), "tvserie");
  assert.equal(resolveContractReviewProductionType("ukendt", sommerdahlContract), "tvserie");
});

test("en nummereret titel alene bruges ikke som seriesignal", () => {
  assert.equal(hasExplicitFictionSeriesScope("Fiktionsproduktion med titlen SOMMERDAHL 8"), false);
  assert.equal(resolveContractReviewProductionType("spillefilm", "Fiktionsproduktion med titlen SOMMERDAHL 8"), "spillefilm");
});

test("royaltykravet gælder spillefilm, men ikke tv-serier", () => {
  assert.match(royaltyRequirementForProductionType("spillefilm"), /ROYALTY PÅKRÆVET/);
  assert.equal(royaltyRequirementForProductionType("tvserie"), "");
});
