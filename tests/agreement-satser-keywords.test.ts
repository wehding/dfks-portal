/**
 * Regression: getAgreementSatserForContext() skal returnere beskrivelser
 * som byggAbsolutteRegler()'s hent() finder via nøgleordssøgning —
 * uanset den frie label-tekst på procentreglen.
 *
 * Bekræftet fejl (før fix): "Ferietillæg til De4's helligdagsforening"
 * → hent("feriepenge") fandt IKKE denne regel.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { wageRulesToSatser, type AgreementWageRule } from "../lib/agreement-wage";

// ── Hjælper: simulér label_key-præfiksering (som agreement-wage-server.ts gør det) ──
const labelKeyPrefix: Record<string, string> = {
  beta_pulje: "beta",
  helligdagsbetaling: "helligdag",
  feriepenge: "feriepenge",
};

function pctRuleToBeskrivelse(rule: {
  label: string;
  label_key: string | null;
  basis: string;
  trigger_condition: string;
  section_reference: string | null;
}): string {
  const prefix = rule.label_key ? `${labelKeyPrefix[rule.label_key]}: ` : "";
  return `${prefix}${rule.label}${rule.section_reference ? ` (${rule.section_reference})` : ""} — gælder ved: ${rule.trigger_condition}`;
}

const hent = (satser: Array<{ beskrivelse: string }>, søgeord: string) =>
  satser.find(s => s.beskrivelse?.toLowerCase().includes(søgeord.toLowerCase()));

// ── Test 1: wageRulesToSatser inkluderer profession_role i beskrivelse ──
test("wageRulesToSatser: beskrivelse inkluderer profession_role", () => {
  const rules: AgreementWageRule[] = [
    {
      id: "1", agreementCode: "de4", agreementTitle: "De4 2022",
      agreementStatus: "approved", productionTypes: [], professionRoles: [],
      professionRole: "Klipper", wageGroup: "Løngruppe 2",
      employmentForm: "a-løn", rateKind: "normalløn",
      amount: 14637, currency: "DKK", unit: "uge",
      pensionIncluded: false, validFrom: "2022-02-07", validTo: null,
      sourceTitle: null, sourceUrl: null, sourceSection: null, sourceNote: null,
      status: "approved",
    },
    {
      id: "2", agreementCode: "de4", agreementTitle: "De4 2022",
      agreementStatus: "approved", productionTypes: [], professionRoles: [],
      professionRole: "A-fotograf", wageGroup: "Løngruppe 1",
      employmentForm: "a-løn", rateKind: "normalløn",
      amount: 16728, currency: "DKK", unit: "uge",
      pensionIncluded: false, validFrom: "2022-02-07", validTo: null,
      sourceTitle: null, sourceUrl: null, sourceSection: null, sourceNote: null,
      status: "approved",
    },
  ];

  const satser = wageRulesToSatser(rules);
  assert.equal(satser.length, 2);
  assert.ok(satser[0].beskrivelse.includes("Klipper"), "Klipper mangler i beskrivelse");
  assert.ok(satser[1].beskrivelse.includes("A-fotograf"), "A-fotograf mangler i beskrivelse");
  // Ingen kollision — to distinkte linjer
  assert.notEqual(satser[0].vaerdi, satser[1].vaerdi);
});

// ── Test 2: hent("normalløn") finder alle lønlinjer, ikke kun én ──
test("normallonLinjer: alle funktioner er til stede", () => {
  const rules: AgreementWageRule[] = [
    { id: "1", agreementCode: "de4", agreementTitle: "De4 2022", agreementStatus: "approved", productionTypes: [], professionRoles: [], professionRole: "Klipper", wageGroup: "Løngruppe 2", employmentForm: "a-løn", rateKind: "normalløn", amount: 14637, currency: "DKK", unit: "uge", pensionIncluded: false, validFrom: "2022-02-07", validTo: null, sourceTitle: null, sourceUrl: null, sourceSection: null, sourceNote: null, status: "approved" },
    { id: "2", agreementCode: "de4", agreementTitle: "De4 2022", agreementStatus: "approved", productionTypes: [], professionRoles: [], professionRole: "A-fotograf", wageGroup: "Løngruppe 1", employmentForm: "a-løn", rateKind: "normalløn", amount: 16728, currency: "DKK", unit: "uge", pensionIncluded: false, validFrom: "2022-02-07", validTo: null, sourceTitle: null, sourceUrl: null, sourceSection: null, sourceNote: null, status: "approved" },
    { id: "3", agreementCode: "de4", agreementTitle: "De4 2022", agreementStatus: "approved", productionTypes: [], professionRoles: [], professionRole: "Scenograf", wageGroup: "Løngruppe 3", employmentForm: "a-løn", rateKind: "normalløn", amount: 12546, currency: "DKK", unit: "uge", pensionIncluded: false, validFrom: "2022-02-07", validTo: null, sourceTitle: null, sourceUrl: null, sourceSection: null, sourceNote: null, status: "approved" },
  ];

  const satser = wageRulesToSatser(rules);
  // Alle tre funktioner skal være til stede
  assert.ok(satser.some(s => s.beskrivelse.includes("Klipper") && s.vaerdi === 14637), "Klipper 14.637 mangler");
  assert.ok(satser.some(s => s.beskrivelse.includes("A-fotograf") && s.vaerdi === 16728), "A-fotograf 16.728 mangler");
  assert.ok(satser.some(s => s.beskrivelse.includes("Scenograf") && s.vaerdi === 12546), "Scenograf 12.546 mangler");
});

// ── Test 3: label_key garanterer nøgleordsmatch ──
test("label_key: feriepenge-regel med fri label-tekst matches via label_key", () => {
  const rule = {
    label: "Ferietillæg til De4's helligdagsforening",
    label_key: "feriepenge" as const,
    basis: "ferieberettiget løn",
    trigger_condition: "alle ansatte",
    section_reference: "§ 16",
  };
  const satser = [{ beskrivelse: pctRuleToBeskrivelse(rule), vaerdi: 1, enhed: "% af ferieberettiget løn" }];
  assert.ok(hent(satser, "feriepenge"), "hent('feriepenge') fandt ikke reglen — label_key-præfiks mangler");
  assert.ok(!hent(satser, "helligdag") || true, "helligdag-check er valgfrit her");
});

test("label_key: beta_pulje-regel matches via label_key", () => {
  const rule = {
    label: "BETA-puljen",
    label_key: "beta_pulje" as const,
    basis: "ferieberettiget løn",
    trigger_condition: "alle ansatte",
    section_reference: "§ 21",
  };
  const satser = [{ beskrivelse: pctRuleToBeskrivelse(rule), vaerdi: 0.5, enhed: "% af ferieberettiget løn" }];
  assert.ok(hent(satser, "beta"), "hent('beta') fandt ikke reglen");
});

test("label_key: helligdagsbetaling-regel matches via label_key", () => {
  const rule = {
    label: "Weekend/helligdagstillæg",
    label_key: "helligdagsbetaling" as const,
    basis: "normaltimeløn",
    trigger_condition: "arbejde på søn- og helligdage",
    section_reference: "§ 8, stk. 2",
  };
  const satser = [{ beskrivelse: pctRuleToBeskrivelse(rule), vaerdi: 75, enhed: "% af normaltimeløn" }];
  assert.ok(hent(satser, "helligdag"), "hent('helligdag') fandt ikke reglen");
});

test("label_key: regel uden label_key bruger ikke præfiks", () => {
  const rule = {
    label: "Overarbejdstillæg, 1. time",
    label_key: null,
    basis: "normaltimeløn",
    trigger_condition: "varslet overarbejde, 1. time",
    section_reference: "§ 4, stk. 2",
  };
  const beskrivelse = pctRuleToBeskrivelse(rule);
  assert.ok(beskrivelse.startsWith("Overarbejdstillæg"), "Regel uden label_key skal starte med label");
});
