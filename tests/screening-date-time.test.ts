import assert from "node:assert/strict";
import test from "node:test";
import { formatScreeningDateTime, parseScreeningDate, parseScreeningTime } from "../lib/screening-date-time";

test("rekonstruerer Simply.TV [hh].mm.ss-dato", () => {
  assert.equal(parseScreeningDate(new Date("1900-03-24T10:07:01.000Z")), "2026-07-01");
});

test("afviser almindelige ugyldige 1900-datoer", () => {
  assert.equal(parseScreeningDate(new Date("1900-01-02T00:00:00.000Z")), undefined);
  assert.equal(parseScreeningDate("1900-03-24"), undefined);
});

test("bevarer gyldig ISO-dato og normaliserer klokkeslæt", () => {
  assert.equal(parseScreeningDate("2026-07-01T10:00:00Z"), "2026-07-01");
  assert.equal(parseScreeningTime("0:25"), "00:25:00");
  assert.equal(formatScreeningDateTime("2026-07-01", "00:25:00"), "01.07.2026 kl. 00:25");
  assert.equal(formatScreeningDateTime("1900-03-24", "00:25:00"), "Ukendt dato kl. 00:25");
});
