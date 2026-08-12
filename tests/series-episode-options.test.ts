import assert from "node:assert/strict";
import test from "node:test";
import { buildCompleteEpisodeOptions } from "../lib/series-episodes";

test("viser aldrig null eller undefined som afsnitstitel", () => {
  assert.deepEqual(buildCompleteEpisodeOptions({ externalOptions: [
    { number: 1, title: "null" },
    { number: 2, title: "undefined" },
    { number: 3, title: null },
  ] }), [
    { number: 1, title: "Afsnit 1" },
    { number: 2, title: "Afsnit 2" },
    { number: 3, title: "Afsnit 3" },
  ]);
});
