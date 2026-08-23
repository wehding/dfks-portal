import assert from "node:assert/strict";
import test from "node:test";
import { buildCompleteEpisodeOptions, buildDfiEpisodeOptions, mergeEpisodeOptionsByPriority } from "../lib/series-episodes";

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

test("udfylder manglende DFI-afsnit ud fra totalen i 1:6-notationen", () => {
  assert.deepEqual(buildDfiEpisodeOptions({
    titles: ["Velkommen til frontlinjen 1:6 - Første dag"],
  }), [
    { number: 1, title: "Første dag" },
    { number: 2, title: "Afsnit 2" },
    { number: 3, title: "Afsnit 3" },
    { number: 4, title: "Afsnit 4" },
    { number: 5, title: "Afsnit 5" },
    { number: 6, title: "Afsnit 6" },
  ]);
});

test("samler lokale, DFI- og TMDB-afsnit i prioriteret rækkefølge", () => {
  assert.deepEqual(mergeEpisodeOptionsByPriority(
    [{ number: 1, title: "Lokalt afsnit" }, { number: 2, title: "Afsnit 2" }],
    [{ number: 2, title: "DFI-afsnit" }, { number: 3, title: "DFI tre" }],
    [{ number: 1, title: "TMDB et" }, { number: 3, title: "TMDB tre" }, { number: 4, title: "TMDB fire" }],
  ), [
    { number: 1, title: "Lokalt afsnit" },
    { number: 2, title: "DFI-afsnit" },
    { number: 3, title: "DFI tre" },
    { number: 4, title: "TMDB fire" },
  ]);
});
