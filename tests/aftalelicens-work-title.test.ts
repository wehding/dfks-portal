import assert from "node:assert/strict";
import test from "node:test";
import { formatAftalelicensWorkTitle } from "../lib/aftalelicens-work-title";

test("viser serie, episodetitel og polstret sæson-/afsnitskode", () => {
  assert.equal(
    formatAftalelicensWorkTitle({
      rawTitle: "Friheden",
      episodeTitle: "Jeg har en meget sart næse",
      season: 2,
      episode: 3,
    }),
    "Friheden - Jeg har en meget sart næse: S02-E03",
  );
});

test("falder tilbage til sæson-/afsnitskode når episodetitlen mangler", () => {
  assert.equal(
    formatAftalelicensWorkTitle({ rawTitle: "Friheden", season: 2, episode: 3 }),
    "Friheden: S02-E03",
  );
});

test("bevarer originaltitlen når alle episodefelter mangler", () => {
  assert.equal(
    formatAftalelicensWorkTitle({ rawTitle: "Friheden" }),
    "Friheden",
  );
});
