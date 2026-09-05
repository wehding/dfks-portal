import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  contractUsesIdentifiedAgreement,
  detectDominantContractPeriodYear,
  hasExplicitSeriesEpisodeScope,
  legalNoteAppliesToContract,
  reconcileContractReviewDates,
  removeFeedbackMatchingExcludedLegalNotes,
  removeInvalidDe4RoyaltyWarnings,
  resolveContractReviewProductionType,
  royaltyRequirementForContract,
} from "../lib/contract-review-domain-rules";

test("kontrolrumsfravalg respekteres for en kontrakt med identificeret overenskomst", () => {
  const usesAgreement = contractUsesIdentifiedAgreement({
    kontrakttype: "a-loen",
    er_overenskomst: true,
    overenskomst_navn: "de4-fiktion",
  });
  assert.equal(usesAgreement, true);
  assert.equal(legalNoteAppliesToContract({ exclude_for_overenskomst: ["alle"] }, usesAgreement), false);
});

test("producentregisterets binding er ikke nødvendig for kontrolrummets kontraktfilter", () => {
  assert.equal(contractUsesIdentifiedAgreement({
    kontrakttype: "a-loen",
    er_overenskomst: false,
    overenskomst_navn: "de4-fiktion",
  }), true);
});

test("feedbackkort fra fravalgte kontrolrumsnoteringer fjernes deterministisk", () => {
  const points = [
    { type: "advarsel", titel: "Promoveringsret mangler", beskrivelse: "Tavshedspligten er bred" },
    { type: "advarsel", titel: "AI-beskyttelsesklausul mangler", beskrivelse: "AI-træning er ikke reguleret" },
    { type: "positiv", titel: "Pension er på plads", beskrivelse: "Korrekt pensionsgrundlag" },
  ];
  assert.deepEqual(removeFeedbackMatchingExcludedLegalNotes(points, [
    { title: "Promoveringsret for klipper" },
    { title: "AI og udnyttelse" },
  ]), [points[2]]);
});

test("andre feedbackkort bevares ved snævert titelmatch", () => {
  const points = [{ type: "positiv", titel: "Streaming er dækket", beskrivelse: "Create Denmark er nævnt" }];
  assert.deepEqual(removeFeedbackMatchingExcludedLegalNotes(points, [
    { title: "Promoveringsret for klipper" },
  ]), points);
});

const conflictingDateContract = `
Arbejdsperioden starter 31. august og slutter 26. november 2024.
Uge 1: 31. august 2026 - 4. september 2026.
Uge 2: 7. september 2026 - 11. september 2026.
Uge 3: 14. september 2026 - 18. september 2026.
Mixdag: 28. januar 2027.
Overenskomst af 7. oktober 2022.
`;

test("detaljerede datoer identificerer det dominerende produktionsår", () => {
  assert.deepEqual(detectDominantContractPeriodYear(conflictingDateContract), {
    year: 2026,
    conflictingYears: [2024],
  });
});

test("modstridende periodeår rettes og umulig flerårs-advarsel fjernes", () => {
  const result = {
    overblik: { periode: "31. august 2024 – 26. november 2024" },
    feedbackmail: { tekst: "Mixdagen er over to år efter kontraktstart. Vilkårene bør præciseres. Så I ikke skal genforhandle om to år." },
    feedbackpunkter: [
      { type: "advarsel", titel: "Mixdag planlagt januar 2027 — langt fremskudt", beskrivelse: "Mixdagen ligger over to år efter produktionsstart." },
      { type: "positiv", titel: "Løn", beskrivelse: "Korrekt" },
    ],
  };
  reconcileContractReviewDates(result, conflictingDateContract);
  assert.equal(result.overblik.periode, "31. august 2026 – 26. november 2026");
  assert.equal(result.feedbackpunkter.some(point => /Mixdag planlagt/.test(String(point.titel))), false);
  assert.equal(result.feedbackpunkter.some(point => /Modstridende årstal/.test(String(point.titel))), true);
  assert.doesNotMatch(result.feedbackmail.tekst, /over to år|om to år/i);
  assert.match(result.feedbackmail.tekst, /Vilkårene bør præciseres/);
});

test("aftaleår alene udløser ikke korrektion af produktionsperioden", () => {
  const contract = "Overenskomst af 7. oktober 2022. Ansættelsen løber fra 1. juni 2026 til 2. juli 2026.";
  assert.equal(detectDominantContractPeriodYear(contract), null);
});

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

test("negative royaltypunkter fjernes deterministisk ved De4-reference", () => {
  const points = [
    { type: "advarsel", titel: "Royalty ikke nævnt", beskrivelse: "Mangler i kontrakten" },
    { type: "positiv", titel: "Royalty dækket", beskrivelse: "Følger De4" },
    { type: "advarsel", titel: "Andet punkt", beskrivelse: "Skal undersøges" },
  ];
  assert.deepEqual(removeInvalidDe4RoyaltyWarnings(points, {
    agreementCovered: false,
    agreementName: "de4-fiktion",
  }), [points[1], points[2]]);
});

test("royaltyadvarsler bevares uden De4-reference", () => {
  const points = [{ type: "advarsel", titel: "Royalty ikke nævnt", beskrivelse: "Mangler" }];
  assert.deepEqual(removeInvalidDe4RoyaltyWarnings(points, {
    agreementCovered: false,
    agreementName: null,
  }), points);
});

test("eksplicit De4-reference i kontraktteksten aktiverer efterfilteret", () => {
  const points = [{ type: "kritisk", titel: "Manglende royalty", beskrivelse: "Ikke nævnt" }];
  assert.deepEqual(removeInvalidDe4RoyaltyWarnings(points, {
    agreementCovered: false,
    agreementName: null,
    contractText: "Kontrakten følger overenskomsten mellem Producentforeningen og De 4.",
  }), []);
});

test("promoveringsret og TDM/AI er ikke hardcoded i analyseprompten", () => {
  const source = ["analyse.ts", "mail-format-prompt.ts", "few-shot-examples.ts"]
    .map(file => readFileSync(new URL(`../lib/${file}`, import.meta.url), "utf8"))
    .join("\n");
  for (const hardcodedRule of [
    "Ingen TDM-nævnelse",
    "Manglende TDM/AI-klausul",
    "Manglende promoveringsret",
    "Tavshedspligt og selvpromovering",
    "1,5% af nettoindtægter",
    "AI-beskyttelsesklausulen",
    "tekst- og datamining",
    "DSM-direktivets artikel 4",
    "promoveringsret — tilføjes",
    "1% royalty",
  ]) {
    assert.doesNotMatch(source, new RegExp(hardcodedRule.replace("/", "\\/"), "i"));
  }
});

test("BETA og helligdagsbetaling styres af aktuelle overenskomstregler", () => {
  const analysisPrompt = readFileSync(new URL("../lib/analyse.ts", import.meta.url), "utf8");
  const mailPrompt = readFileSync(new URL("../lib/mail-format-prompt.ts", import.meta.url), "utf8");
  assert.doesNotMatch(analysisPrompt, /A-LØNSKONTRAKT:\s*\n\d+\. BETA-fond/);
  assert.match(mailPrompt, /KUN når hver regel findes i AKTUELLE SATSER/);
  assert.match(mailPrompt, /påstå ikke at beløbet vises på lønsedlen/i);
  assert.match(mailPrompt, /navngiv en modtager[\s\S]+medmindre netop dette står i den aktuelle regels betingelse/i);
});
