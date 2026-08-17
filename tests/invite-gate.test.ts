import assert from "node:assert/strict";
import test from "node:test";
import { isInviteGateEnabled } from "../lib/auth/invite-gate";

test("aktiverer ikke testadgang alene fordi INVITE_CODE findes", () => {
  assert.equal(isInviteGateEnabled({ INVITE_CODE: "hemmelig-kode" }), false);
});

test("kræver både eksplicit opt-in og en invite-kode", () => {
  assert.equal(
    isInviteGateEnabled({
      ENABLE_INVITE_GATE: "true",
      INVITE_CODE: "hemmelig-kode",
    }),
    true
  );
  assert.equal(isInviteGateEnabled({ ENABLE_INVITE_GATE: "true" }), false);
  assert.equal(
    isInviteGateEnabled({ ENABLE_INVITE_GATE: "false", INVITE_CODE: "hemmelig-kode" }),
    false
  );
});

test("invite-gaten kan aldrig blokere Vercel Production", () => {
  assert.equal(isInviteGateEnabled({
    ENABLE_INVITE_GATE: "true",
    INVITE_CODE: "hemmelig-kode",
    VERCEL_ENV: "production",
  }), false);
});
