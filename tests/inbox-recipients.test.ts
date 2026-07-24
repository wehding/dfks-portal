import test from "node:test";
import assert from "node:assert/strict";
import { filterInboxRecipients, selectVisibleRecipientIds } from "../lib/inbox-recipients";

const recipients = [
  { id: "1", full_name: "Søren Åberg", email: "soren@example.dk" },
  { id: "2", full_name: "Ida Jensen", email: "ida@film.dk" },
];

test("recipient search matches names, email and accent variations", () => {
  assert.deepEqual(filterInboxRecipients(recipients, "Soren Aberg").map(row => row.id), ["1"]);
  assert.deepEqual(filterInboxRecipients(recipients, "film.dk").map(row => row.id), ["2"]);
});

test("select all visible preserves hidden selections", () => {
  assert.deepEqual(selectVisibleRecipientIds(["1"], ["2"]), ["1", "2"]);
});
