import assert from "node:assert/strict";
import test from "node:test";
import { contractDocumentPresentation, contractEpisodeNumbersFromLayout, contractEvidencePage, contractSeriesBaseTitle, fieldEvidence, findContractTypeEvidence, findCopydanEvidence, findSvodEvidence, findSignatureEvidence, findProducerEvidence, pdfBboxToViewportRect, safeContractReturnTo, suggestLocalContractWork } from "../lib/contract-workbench";
import { calculatePdfEvidenceScale, calculatePdfFitWidthScale, CONTRACT_WORKBENCH_SPLIT_MIN_WIDTH, usesContractWorkbenchSplitLayout } from "../lib/contract-workbench-responsive";
import { extractBaseSeriesTitle, parseSeasonNumberFromTitle } from "../lib/dfi-metadata";

test("kontraktarbejdsfladen accepterer kun retur-URL'er i kontraktadministrationen", () => {
  assert.equal(
    safeContractReturnTo(encodeURIComponent("/admin/kontrakter?tab=arkiv&page=3&search=film")),
    "/admin/kontrakter?tab=arkiv&page=3&search=film",
  );
  assert.equal(safeContractReturnTo("https://example.com"), "/admin/kontrakter?tab=arkiv");
  assert.equal(safeContractReturnTo("//example.com/admin/kontrakter"), "/admin/kontrakter?tab=arkiv");
});

test("dokumentversioner skelner mellem juridisk original, Word-visning og konverteret PDF", () => {
  assert.deepEqual(contractDocumentPresentation({
    originalPath: "org/contract.docx",
    originalViewPath: "org/processed/original-view.pdf",
    commentedPath: "org/processed/normalised.pdf",
    processingStatus: "ready",
  }), {
    sourceFormat: "docx",
    hasOriginal: true,
    hasOriginalView: true,
    hasCommentedPdf: true,
    processingLabel: "Konverteret PDF klar",
    processingTone: "success",
  });
});

test("dokumentstatus lover ikke en konverteret PDF for en ubehandlet original", () => {
  const state = contractDocumentPresentation({
    originalPath: "org/contract.pdf",
    processingStatus: "processing",
  });
  assert.equal(state.hasOriginal, true);
  assert.equal(state.hasCommentedPdf, false);
  assert.equal(state.processingLabel, "Dokument behandles");
});

test("kildebevis kobler citat og klausul uden at gætte koordinater", () => {
  const evidence = fieldEvidence(
    "producer",
    "employerName",
    { employerName: "Producent ApS", employerName_clause_id: "clause-1" },
    {
      type: "pdf",
      pageCount: 2,
      fragmentCount: 1,
      clauses: [{ id: "clause-1", page: 2, text: "Producent ApS", bold: false, numbered: false }],
    },
  );

  assert.equal(evidence.quote, "Producent ApS");
  assert.equal(evidence.clause?.page, 2);
  assert.equal(evidence.clause?.pdfBbox, undefined);
  assert.equal(contractEvidencePage(evidence), 2);
});

test("kildenavigation bruger gemt side når klausulkoordinater mangler", () => {
  const evidence = fieldEvidence(
    "signatureEvidence",
    "signatureEvidence",
    {
      signatureEvidence: "Digitalt underskrevet 05.06.2025",
      signatureEvidence_page: "4",
    },
    null,
  );

  assert.equal(evidence.quote, "Digitalt underskrevet 05.06.2025");
  assert.equal(evidence.clause, null);
  assert.equal(contractEvidencePage(evidence), 4);
});

test("felter uden dokumentkilde aktiverer ikke en falsk kilde", () => {
  const evidence = fieldEvidence("royalty", "royalty", {}, null);
  assert.equal(evidence.quote, null);
  assert.equal(contractEvidencePage(evidence), null);
});

test("PDF-koordinater omregnes ens til udsnit og fuld dokumentmarkering", () => {
  const rect = pdfBboxToViewportRect(
    { x: 50, y: 100, width: 200, height: 20 },
    { pdfWidth: 600, pdfHeight: 800, renderedWidth: 1200, renderedHeight: 1600 },
  );
  assert.deepEqual(rect, { left: 100, top: 1360, width: 400, height: 40 });
});

test("kontraktarbejdsfladen skifter mellem mobil og delt tabletvisning ved samme breakpoint", () => {
  assert.equal(CONTRACT_WORKBENCH_SPLIT_MIN_WIDTH, 760);
  assert.equal(usesContractWorkbenchSplitLayout(759), false);
  assert.equal(usesContractWorkbenchSplitLayout(760), true);
  assert.equal(usesContractWorkbenchSplitLayout(933), true);
});

test("PDF-skalaen holder hele siden inden for dokumentkolonnens bredde", () => {
  assert.equal(calculatePdfFitWidthScale(632, 600), 1);
  assert.equal(calculatePdfFitWidthScale(332, 600), 0.5);
  assert.equal(calculatePdfFitWidthScale(120, 600), 0.26666666666666666);
});

test("PDF-kildefokus zoomer navnet så det fylder ca. to tredjedele af skærmområdet", () => {
  const tabletScale = calculatePdfEvidenceScale({ containerWidth: 480, containerHeight: 700, boxWidth: 140, boxHeight: 18 });
  assert.ok(Math.abs(tabletScale - 2.285) < 0.05);
  assert.equal(calculatePdfEvidenceScale({ containerWidth: 900, containerHeight: 700, boxWidth: 80, boxHeight: 18 }), 2.4);
  assert.ok(calculatePdfEvidenceScale({ containerWidth: 900, containerHeight: 700, boxWidth: 520, boxHeight: 110 }) < 1.2);
  assert.equal(calculatePdfEvidenceScale({ containerWidth: 0, containerHeight: 700, boxWidth: 80, boxHeight: 18 }), 1);
});

test("juridiske kilder bruger hele klausulens boks frem for kun første OCR-linje", () => {
  const evidence = fieldEvidence(
    "copydan",
    "copydan",
    { copydan: "Copydan-forbehold", copydan_clause_id: "rights" },
    {
      type: "pdf",
      pageCount: 1,
      fragmentCount: 1,
      clauses: [{ id: "rights", page: 1, text: "Hele Copydan-forbeholdet\nfortsætter på næste linje", bold: false, numbered: false, pdfBbox: { x: 40, y: 300, width: 510, height: 58 } }],
    },
    { copydan: { quote: "Copydan-forbehold", page: 1, bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.02, space: "normalized_top_left" }, coordinateSource: "spatial_v3", confidence: 0.98 } },
  );
  assert.deepEqual(evidence.bbox, { x: 40, y: 300, width: 510, height: 58, space: "pdf_bottom_left" });
  assert.deepEqual(evidence.bboxes, [{ x: 40, y: 300, width: 510, height: 58, space: "pdf_bottom_left" }]);
  assert.equal(evidence.coordinateSource, "legacy_layout");
});

test("juridiske kilder samler sammenhængende PDF-linjer og stopper ved næste afsnit", () => {
  const evidence = fieldEvidence(
    "copydan",
    "copydan",
    { copydan: "Copydan-forbehold", copydan_clause_id: "line-1" },
    {
      type: "pdf",
      pageCount: 1,
      fragmentCount: 4,
      clauses: [
        { id: "line-1", page: 1, text: "Første linje", bold: false, numbered: false, pdfBbox: { x: 70, y: 670, width: 450, height: 10 } },
        { id: "line-2", page: 1, text: "Anden linje", bold: false, numbered: false, pdfBbox: { x: 71, y: 648, width: 451, height: 10 } },
        { id: "line-3", page: 1, text: "Tredje linje", bold: false, numbered: false, pdfBbox: { x: 70, y: 626, width: 320, height: 10 } },
        { id: "next", page: 1, text: "Næste afsnit", bold: false, numbered: false, pdfBbox: { x: 70, y: 570, width: 450, height: 10 } },
      ],
    },
    { copydan: { quote: "Copydan-forbehold", page: 1, bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.02, space: "normalized_top_left" }, coordinateSource: "spatial_v3", confidence: 0.98 } },
  );
  assert.deepEqual(evidence.bbox, { x: 70, y: 626, width: 452, height: 54, space: "pdf_bottom_left" });
});

test("kontraktens sæsonangivelse fjernes kun fra det lokale værkmatch", () => {
  assert.equal(contractSeriesBaseTitle("SOMMERDAHL VI"), "SOMMERDAHL");
  assert.equal(contractSeriesBaseTitle("Forbrydelsen sæson 2"), "Forbrydelsen");
  assert.equal(contractSeriesBaseTitle("1917"), "1917");
});

test("et entydigt lokalt serie-parentværk foreslås uden at blive tilknyttet automatisk", () => {
  const works = [
    { id: "parent", title: "Sommerdahl", type: "tv-serie" },
    { id: "episode", title: "Sommerdahl - S05E01", type: "tv-serie" },
  ];
  assert.equal(suggestLocalContractWork("SOMMERDAHL VI", works)?.id, "parent");
  assert.equal(suggestLocalContractWork("Ukendt serie II", works), null);
});

test("et tvetydigt lokalt titelmatch foreslås ikke", () => {
  const works = [
    { id: "one", title: "Sommerdahl", type: "tv-serie" },
    { id: "two", title: "SOMMERDAHL", type: "tv-serie" },
  ];
  assert.equal(suggestLocalContractWork("Sommerdahl VI", works), null);
});

test("A-løn får et forsigtigt dokumentbevis fra en lønpassage", () => {
  const evidence = findContractTypeEvidence("a-løn", {
    type: "pdf",
    pageCount: 2,
    fragmentCount: 2,
    clauses: [
      { id: "intro", page: 1, text: "Producenten indgår denne aftale.", bold: false, numbered: false },
      { id: "salary", page: 2, text: "Medarbejderens grundløn udgør en ugeløn på 18.500 kr.", bold: false, numbered: false },
    ],
  });

  assert.equal(evidence?.clauseId, "salary");
  assert.equal(evidence?.page, 2);
  assert.match(evidence?.quote ?? "", /ugeløn/i);
});

test("A-løn genkender kontraktens formulering aftalt løn pr. uge", () => {
  const evidence = findContractTypeEvidence("a-løn", {
    type: "pdf",
    pageCount: 1,
    fragmentCount: 1,
    clauses: [
      { id: "salary", page: 1, text: "Aftalt løn kr.: 14.824 pr. uge", bold: false, numbered: false },
    ],
  });

  assert.equal(evidence?.clauseId, "salary");
  assert.equal(evidence?.focusText?.toLocaleLowerCase("da"), "aftalt løn");
});

test("afsnitsnumre kan aflæses fra kontraktens egen episodepassage", () => {
  assert.deepEqual(contractEpisodeNumbersFromLayout({
    type: "pdf",
    pageCount: 1,
    fragmentCount: 1,
    clauses: [{ id: "work", page: 1, text: "KLIPPER AF 2 EPISODER (5 + 6) samt sammenklip", bold: false, numbered: false }],
  }), [5, 6]);
  assert.deepEqual(contractEpisodeNumbersFromLayout({
    type: "pdf",
    pageCount: 1,
    fragmentCount: 1,
    clauses: [{ id: "ocr", page: 1, text: "KLIPPERAF2EPISODER(5+6)samtsammenklip", bold: false, numbered: false }],
  }), [5, 6]);
});

test("Copydan-klausul identificeres automatisk ud fra layout-klausuler", () => {
  const evidence = findCopydanEvidence({
    type: "pdf",
    pageCount: 4,
    fragmentCount: 2,
    clauses: [
      { id: "c1", page: 1, text: "Ansættelsesaftale for klipper", bold: true, numbered: false },
      { id: "c2", page: 4, text: "Parterne bevarer hver især deres ret til at oppebære vederlag, forvaltet af Copy-Dan i henhold til ophavsretsloven § 50 stk. 1 jf. §§ 13,17, 35 og 39", bold: false, numbered: false },
    ],
  });
  assert.equal(evidence?.clauseId, "c2");
  assert.equal(evidence?.page, 4);
});

test("SVOD- og Netflix-kompensationsklausul identificeres automatisk ud fra layout", () => {
  const evidence = findSvodEvidence({
    type: "pdf",
    pageCount: 4,
    fragmentCount: 2,
    clauses: [
      { id: "c1", page: 1, text: "TV-serien produceres for Netflix", bold: false, numbered: false },
      { id: "c14", page: 4, text: "10. Copydan Kompensation. Filmarbejderen modtager en kompensation for Netflixs manglende anerkendelse af et Copydan forbehold", bold: false, numbered: true },
    ],
  });
  assert.equal(evidence?.clauseId, "c14");
  assert.equal(evidence?.page, 4);
});

test("Underskriftssektion målretter sidste side og underskriftsfelt frem for isolerede ord i teksten", () => {
  const evidence = findSignatureEvidence({
    type: "pdf",
    pageCount: 7,
    fragmentCount: 3,
    clauses: [
      { id: "intro", page: 1, text: "Nærværende kontrakt træder i kraft ved parternes underskrift.", bold: false, numbered: false },
      { id: "attest", page: 6, text: "Filmarbejderen accepterer ved underskrift af denne aftale at der indhentes børneattest.", bold: false, numbered: false },
      { id: "sig_block", page: 7, text: "København, den ______________\nFor Producenten:\n\nKøbenhavn, den ______________\nFor Lønmodtageren:", bold: false, numbered: false },
    ],
  });
  assert.equal(evidence?.clauseId, "sig_block");
  assert.equal(evidence?.page, 7);
});

test("Producent identificeres automatisk på side 1 ud fra layout og kontraktens upload-titel", () => {
  const evidence = findProducerEvidence({
    type: "pdf",
    pageCount: 7,
    fragmentCount: 5,
    clauses: [
      { id: "s1_c1", page: 1, text: "Mellem:", bold: false, numbered: false },
      { id: "s1_c2", page: 1, text: "AppleTreeProductionsApS", bold: false, numbered: false },
      { id: "s1_c3", page: 1, text: "Store Kongensgade 77", bold: false, numbered: false },
      { id: "s1_c5", page: 1, text: "CVR: 39075598", bold: false, numbered: false },
      { id: "s1_c6", page: 1, text: "herefter kaldet Producenten", bold: false, numbered: false },
    ],
  }, "EQUINOX, Apple Tree Productions, Klipper, Peter Winther Jørgensen, DFKS");

  assert.equal(evidence?.clauseId, "s1_c2");
  assert.equal(evidence?.page, 1);
  assert.equal(evidence?.producerName, "Apple Tree Productions");
});

test("Leverandøraftale identificerer Underleverandøren som kildebevis (Ternet Ninja 3)", () => {
  const evidence = findContractTypeEvidence("leverandør", {
    type: "pdf",
    pageCount: 6,
    fragmentCount: 4,
    clauses: [
      { id: "c1", page: 1, text: "Aftale om klippearbejde", bold: true, numbered: false },
      { id: "c2", page: 1, text: "Underleverandøren skal udføre Opgaven fra den 4. september 2023 til og med den 29. februar 2024", bold: false, numbered: false },
      { id: "c3", page: 2, text: "betaler A.Film et buy-out honorar til Underleverandøren på 3.673,50 kr. ekskl. moms pr. arbejdsdag.", bold: false, numbered: false },
    ],
  });

  assert.ok(evidence);
  assert.equal(evidence?.clauseId, "c3");
  assert.equal(evidence?.page, 2);
  assert.equal(evidence?.focusText, "Underleverandøren");
  assert.match(evidence?.quote ?? "", /Underleverandøren/);
});

test("Serie- og sæsongenkendelse udtrækker basistitel og sæson for DNA 2 og DNA2", () => {
  assert.equal(parseSeasonNumberFromTitle("DNA 2"), 2);
  assert.equal(parseSeasonNumberFromTitle("DNA2"), 2);
  assert.equal(parseSeasonNumberFromTitle("DNA sæson 2"), 2);

  assert.deepEqual(extractBaseSeriesTitle("DNA 2"), { baseTitle: "DNA", seasonNumber: 2 });
  assert.deepEqual(extractBaseSeriesTitle("DNA2"), { baseTitle: "DNA", seasonNumber: 2 });
  assert.deepEqual(extractBaseSeriesTitle("DNA"), { baseTitle: "DNA", seasonNumber: null });
  assert.equal(parseSeasonNumberFromTitle("Apollo13"), null);
  assert.equal(parseSeasonNumberFromTitle("District9"), null);
  assert.deepEqual(extractBaseSeriesTitle("Apollo13"), { baseTitle: "Apollo13", seasonNumber: null });
});
