import assert from "node:assert/strict";
import test from "node:test";
import { experienceGroupAt, experienceYearsAt } from "../lib/experience-groups";

test("erfaring beregnes i kontraktåret", () => {
  assert.equal(experienceYearsAt(2020, 2023), 3);
  assert.equal(experienceYearsAt(2020, 2019), null);
});

test("erfaringsgrupper overlapper ikke ved grænserne", () => {
  assert.equal(experienceGroupAt(2020, 2023), "new_graduate");
  assert.equal(experienceGroupAt(2020, 2024), "early_career");
  assert.equal(experienceGroupAt(2020, 2027), "early_career");
  assert.equal(experienceGroupAt(2020, 2028), "experienced");
  assert.equal(experienceGroupAt(2020, 2037), "experienced");
  assert.equal(experienceGroupAt(2020, 2038), "veteran");
});

test("manglende startår giver ingen gruppe", () => {
  assert.equal(experienceGroupAt(null, 2024), null);
});
