import assert from "node:assert/strict";
import test from "node:test";

import {
  contractSourceFormatFromPath,
  detectContractSourceFormat,
} from "./source-format.mjs";

test("dokumentformat bestemmes af filsignaturen", () => {
  assert.equal(detectContractSourceFormat(Buffer.from("%PDF-1.7\n")), "pdf");
  assert.equal(detectContractSourceFormat(Buffer.from([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
  ])), "doc");
  assert.equal(detectContractSourceFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04])), "docx");
  assert.equal(detectContractSourceFormat(Buffer.from("ikke et dokument")), null);
});

test("backfillformat læses konservativt fra storage-stien", () => {
  assert.equal(contractSourceFormatFromPath("org/member/contract.PDF"), "pdf");
  assert.equal(contractSourceFormatFromPath("org/member/contract.docx?x=1"), "docx");
  assert.equal(contractSourceFormatFromPath("org/member/contract.txt"), null);
  assert.equal(contractSourceFormatFromPath("org/member/no-extension"), null);
});
