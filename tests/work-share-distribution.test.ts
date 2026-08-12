import assert from "node:assert/strict";
import test from "node:test";
import {
  expandSeasonShare,
  isCompleteShareResolution,
  normalizeSharePercent,
  requiresOwnShare,
  shareResolutionTotal,
} from "../lib/work-share-distribution";

test("normalizes Danish decimal percentages and rejects invalid values", () => {
  assert.equal(normalizeSharePercent("33,333"), 33.333);
  assert.equal(normalizeSharePercent(100), 100);
  assert.equal(normalizeSharePercent(-1), null);
  assert.equal(normalizeSharePercent(101), null);
});

test("known co-editors or a new co-editor require an own share", () => {
  assert.equal(requiresOwnShare({ knownRightsHolderCount: 1, addedCoEditorCount: 0 }), false);
  assert.equal(requiresOwnShare({ knownRightsHolderCount: 2, addedCoEditorCount: 0 }), true);
  assert.equal(requiresOwnShare({ knownRightsHolderCount: 1, addedCoEditorCount: 1 }), true);
});

test("admin resolution includes the future-claim reserve in 100 percent", () => {
  assert.equal(shareResolutionTotal([40, 35], 25), 100);
  assert.equal(isCompleteShareResolution([40, 35], 25), true);
  assert.equal(isCompleteShareResolution([40, 35], 0), false);
});

test("a season percentage is copied unchanged to each selected episode", () => {
  assert.deepEqual(expandSeasonShare([3, 1, 3], 40), [
    { episodeNumber: 1, percent: 40 },
    { episodeNumber: 3, percent: 40 },
  ]);
});
