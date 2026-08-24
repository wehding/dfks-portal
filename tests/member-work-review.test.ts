import assert from "node:assert/strict";
import test from "node:test";
import { memberWorkReviewGroupKey, uniqueMemberWorkReviewCount, type MemberWorkReviewTask } from "../lib/member-work-review";

test("a series season is counted once across episode and co-editor tasks", () => {
  const tasks: MemberWorkReviewTask[] = [
    {
      key: "scope",
      groupKey: "season:series:4",
      kind: "episode_selection",
      title: "Series",
      seriesWorkId: "series",
      seasonNumber: 4,
      episodeScopeId: "scope",
    },
    {
      key: "episode-1",
      groupKey: memberWorkReviewGroupKey({ workId: "episode-1", parentWorkId: "series", seasonNumber: 4 }),
      kind: "coeditor_review",
      title: "Episode 1",
      workId: "episode-1",
      assignmentId: "assignment-1",
      parentWorkId: "series",
      seasonNumber: 4,
      episodeNumber: 1,
      existingCoEditors: [],
    },
    {
      key: "episode-2",
      groupKey: memberWorkReviewGroupKey({ workId: "episode-2", parentWorkId: "series", seasonNumber: 4 }),
      kind: "coeditor_review",
      title: "Episode 2",
      workId: "episode-2",
      assignmentId: "assignment-2",
      parentWorkId: "series",
      seasonNumber: 4,
      episodeNumber: 2,
      existingCoEditors: [],
    },
  ];
  assert.equal(uniqueMemberWorkReviewCount(tasks), 1);
});

test("separate films and seasons count as separate works", () => {
  const groupKeys = [
    memberWorkReviewGroupKey({ workId: "film" }),
    memberWorkReviewGroupKey({ workId: "episode", parentWorkId: "series", seasonNumber: 1 }),
    memberWorkReviewGroupKey({ workId: "episode", parentWorkId: "series", seasonNumber: 2 }),
  ];
  assert.deepEqual(groupKeys, ["work:film", "season:series:1", "season:series:2"]);
  assert.equal(new Set(groupKeys).size, 3);
});

test("episode tasks share the same season key as their episode selection", () => {
  const episodeSelectionKey = memberWorkReviewGroupKey({
    workId: "series",
    parentWorkId: "series",
    seasonNumber: 2,
  });
  const episodeReviewKey = memberWorkReviewGroupKey({
    workId: "episode-4",
    parentWorkId: "series",
    seasonNumber: 2,
  });

  assert.equal(episodeSelectionKey, "season:series:2");
  assert.equal(episodeReviewKey, episodeSelectionKey);
});
