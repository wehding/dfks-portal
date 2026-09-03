import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  hasExplicitSeriesEpisodeScope,
  resolveContractReviewProductionType,
  royaltyRequirementForContract,
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

test("De4-reference gør royalty ved biografdistribution til et positivt punkt", () => {
  const rule = royaltyRequirementForContract({
    productionType: "tvserie",
    agreementCovered: true,
    agreementName: "de4-fiktion",
    distributionChannels: ["biograf", "streaming_svod"],
  });
  assert.match(rule, /POSITIV/i);
  assert.doesNotMatch(rule, /PÅKRÆVET|manglende særskilt royaltyklausul(?!\.)/i);
});

test("De4-reference forbyder royaltymangel ved tv eller streaming", () => {
  for (const distributionChannels of [["tv_lineaer"], ["streaming_svod"], ["streaming_avod"], []]) {
    const rule = royaltyRequirementForContract({
      productionType: "spillefilm",
      agreementCovered: true,
      agreementName: "de4-fiktion",
      distributionChannels,
    });
    assert.match(rule, /flag ALDRIG/i);
    assert.doesNotMatch(rule, /ROYALTY PÅKRÆVET/i);
  }
});

test("en udtrykkelig De4-reference gælder også uden ProF-medlemskab", () => {
  const rule = royaltyRequirementForContract({
    productionType: "spillefilm",
    agreementCovered: false,
    agreementName: "de4-fiktion",
    distributionChannels: ["biograf"],
  });
  assert.match(rule, /POSITIV/i);
  assert.doesNotMatch(rule, /ROYALTY PÅKRÆVET/i);
});

test("spillefilmskontrollen bevares uden De4-fiktionsoverenskomsten", () => {
  assert.match(royaltyRequirementForContract({
    productionType: "spillefilm",
    agreementCovered: false,
    agreementName: null,
    distributionChannels: ["streaming_svod"],
  }), /ROYALTY PÅKRÆVET/);
});

test("promoveringsret og TDM/AI er ikke hardcoded i analyseprompten", () => {
  const source = readFileSync(new URL("../lib/analyse.ts", import.meta.url), "utf8");
  for (const hardcodedRule of [
    "Ingen TDM-nævnelse",
    "Manglende TDM/AI-klausul",
    "Manglende promoveringsret",
    "Tavshedspligt og selvpromovering",
  ]) {
    assert.doesNotMatch(source, new RegExp(hardcodedRule.replace("/", "\\/"), "i"));
  }
});
