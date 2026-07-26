import assert from "node:assert/strict";
import test from "node:test";
import { detectWordFormat } from "../lib/word-format";

test("genkender gamle binære DOC-filer ud fra filsignaturen", () => {
  const buffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
  assert.equal(detectWordFormat(buffer, "forkert.docx"), "doc");
});

test("genkender DOCX-filer ud fra ZIP-signaturen", () => {
  assert.equal(detectWordFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04]), "kontrakt.docx"), "docx");
});

test("bruger filendelsen som fallback og afviser andre formater", () => {
  assert.equal(detectWordFormat(Buffer.from("tekst"), "kontrakt.DOC"), "doc");
  assert.equal(detectWordFormat(Buffer.from("tekst"), "kontrakt.docx"), "docx");
  assert.equal(detectWordFormat(Buffer.from("tekst"), "kontrakt.pdf"), null);
});
