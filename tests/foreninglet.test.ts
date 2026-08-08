import assert from "node:assert/strict";
import test from "node:test";
import { findStaleForeningLetMemberIds, normalizeForeningLetMember, parseForeningLetMemberPayload } from "../lib/foreninglet";

test("normalizes the PascalCase member format returned by ForeningLet", () => {
  const members = parseForeningLetMemberPayload([{
    MemberId: 42,
    MemberNumber: "007",
    FirstName: "Ada",
    LastName: "Lovelace",
    Email: "ada@example.dk",
    Mobile: "12345678",
    Password: "must-not-be-cached",
  }]);
  const member = normalizeForeningLetMember(members[0]);

  assert.equal(member?.id, 42);
  assert.equal(member?.display_id, "007");
  assert.equal(member?.first_name, "Ada");
  assert.equal(member?.last_name, "Lovelace");
  assert.equal(member?.mobile, "12345678");
  assert.equal(Object.hasOwn(member?.raw ?? {}, "Password"), false);
});

test("accepts common response envelopes", () => {
  assert.equal(parseForeningLetMemberPayload({ Members: [{ MemberId: 1 }] }).length, 1);
  assert.equal(parseForeningLetMemberPayload({ data: [{ id: 2 }] }).length, 1);
});

test("removes cached members that are absent from the active organisation response", () => {
  const cached = [
    { foreninglet_id: "dfks-1", status: "active" },
    { foreninglet_id: "other-association", status: "active" },
    { foreninglet_id: "old-resigned", status: "resigned" },
  ];
  assert.deepEqual(findStaleForeningLetMemberIds(cached, ["dfks-1"], true), ["other-association", "old-resigned"]);
  assert.deepEqual(findStaleForeningLetMemberIds(cached, ["dfks-1"], false), ["other-association"]);
});
