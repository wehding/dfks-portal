import assert from "node:assert/strict";
import test from "node:test";
import { statisticsBoolean, statisticsDataValue, statisticsNumber, statisticsTriState } from "../lib/statistics-values";

test("statistiktal læser både AI-tal og danske formater", () => {
  assert.equal(statisticsNumber(45_000), 45_000);
  assert.equal(statisticsNumber("45.000 kr."), 45_000);
  assert.equal(statisticsNumber("12,5 %"), 12.5);
  assert.equal(statisticsNumber("ukendt"), null);
});

test("statistikbooleans behandler strengen false som false", () => {
  assert.equal(statisticsBoolean("false"), false);
  assert.equal(statisticsBoolean("ja"), true);
  assert.equal(statisticsBoolean("uklart"), null);
});

test("nested rettighedsdata og implicit overenskomst normaliseres", () => {
  const data = { rightsOverview: { copydanforbehold: "implicit via overenskomst" } };
  const value = statisticsDataValue(data, ["copydan", "rightsOverview.copydanforbehold"]);
  assert.equal(statisticsTriState(value), "implicit");
});
