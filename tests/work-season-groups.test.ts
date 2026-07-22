import test from "node:test";
import assert from "node:assert/strict";
import { groupWorksBySeason, stripSeasonEpisodes } from "../lib/work-season-groups";

const episode = (id: string, season: number, number: number, role = "Klipper") => ({
  id,
  title: `Frontlinjen - S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}`,
  type: "tv-serie",
  year: 2026,
  parent_work_id: "series-1",
  season_number: season,
  episode_number: number,
  assignment_id: `assignment-${id}`,
  role,
  contract_count: number === 1 ? 1 : 0,
  parent: { id: "series-1", title: "Frontlinjen", type: "tv-serie", year: 2026 },
});

test("groups episode works into one list item per season", () => {
  const groups = groupWorksBySeason([
    episode("ep-2", 1, 2),
    episode("ep-1", 1, 1),
    episode("ep-3", 2, 1),
  ]);
  assert.equal(groups.length, 2);
  const first = groups.find(group => group.kind === "season" && group.seasonNumber === 1);
  assert.ok(first && first.kind === "season");
  assert.deepEqual(first.workIds, ["ep-2", "ep-1"]);
  assert.deepEqual(first.episodes.map(item => item.id), ["ep-1", "ep-2"]);
  assert.equal(first.contractCount, 1);
});

test("keeps assignments and roles individual while summarising a season", () => {
  const [group] = groupWorksBySeason([
    episode("ep-1", 1, 1, "Klipper"),
    episode("ep-2", 1, 2, "B-klipper"),
  ]);
  assert.equal(group.kind, "season");
  if (group.kind !== "season") return;
  assert.equal(group.roleSummary, "Flere roller");
  assert.deepEqual(group.assignmentIds, ["assignment-ep-1", "assignment-ep-2"]);
  assert.equal(group.episodes[0].role, "Klipper");
  assert.equal(group.episodes[1].role, "B-klipper");
});

test("does not expose episode details in a compact season summary", () => {
  const [group] = groupWorksBySeason([episode("ep-1", 1, 1)]);
  const summary = stripSeasonEpisodes(group);
  assert.equal("episodes" in summary, false);
});

test("leaves films and ambiguous legacy rows standalone", () => {
  const rows = [
    { id: "film-1", title: "Filmen", type: "spillefilm", year: 2026 },
    { id: "legacy", title: "Serie S01E01", type: "tv-serie", year: 2026, season_number: 1, episode_number: 1 },
  ];
  const groups = groupWorksBySeason(rows);
  assert.equal(groups.length, 2);
  assert.ok(groups.every(group => group.kind === "work"));
});
