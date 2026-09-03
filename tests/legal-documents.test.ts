import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_LEGAL_DOCUMENT_COPY,
  LEGAL_DOCUMENT_AUDIENCES,
  LEGAL_DOCUMENT_TYPES,
  PRIVACY_POLICY_URL,
  normalizeDanishLegalText,
} from "../lib/legal-documents";

test("alle juridiske dokumenttyper findes for medlemmer og ikke-medlemmer", () => {
  for (const audience of LEGAL_DOCUMENT_AUDIENCES) {
    for (const documentType of LEGAL_DOCUMENT_TYPES) {
      const copy = DEFAULT_LEGAL_DOCUMENT_COPY[audience][documentType];
      assert.equal(typeof copy.title, "string");
      assert.ok(copy.title.length > 0);
      assert.equal(typeof copy.body, "string");
      assert.ok(copy.body.length > 40);
    }
  }
});

test("ikke-medlemstekster nævner ikke KODA", () => {
  const combined = LEGAL_DOCUMENT_TYPES
    .map(documentType => DEFAULT_LEGAL_DOCUMENT_COPY.non_member[documentType].body)
    .join("\n");
  assert.equal(/\bKODA\b/i.test(combined), false);
});

test("privatlivstekster linker til fuld privatlivspolitik", () => {
  assert.ok(DEFAULT_LEGAL_DOCUMENT_COPY.member.privacy_notice.body.includes(PRIVACY_POLICY_URL));
  assert.ok(DEFAULT_LEGAL_DOCUMENT_COPY.non_member.privacy_notice.body.includes(PRIVACY_POLICY_URL));
});

test("statistikvalg er oplysning for medlemmer og aktivt valg for ikke-medlemmer", () => {
  assert.match(DEFAULT_LEGAL_DOCUMENT_COPY.member.privacy_notice.body, /Som medlem er du oplyst/i);
  assert.match(DEFAULT_LEGAL_DOCUMENT_COPY.non_member.contract_analysis_notice.body, /frivilligt vælge/i);
});

test("danske juridiske standardtekster bruger æ, ø og å", () => {
  const combined = LEGAL_DOCUMENT_AUDIENCES.flatMap(audience =>
    LEGAL_DOCUMENT_TYPES.flatMap(documentType => {
      const copy = DEFAULT_LEGAL_DOCUMENT_COPY[audience][documentType];
      return [copy.title, copy.body];
    }),
  ).join("\n");
  assert.doesNotMatch(combined, /\b(?:raadgiv|loen|foer|stoette|gennemsoeg|afgoer|fremhaev|udtraek|vaerktoej|vilkaar|ansaett|traen|vaelg)\w*/i);
});

test("ældre publicerede tekster vises med dansk stavning uden at ændre versionen", () => {
  assert.equal(
    normalizeDanishLegalText("Brugervilkaar: Laes om loen og raadgivning, foer du vaelger."),
    "Brugervilkår: Læs om løn og rådgivning, før du vælger.",
  );
});

test("juridisk onboarding bruger rettighedshaverens eksisterende tidsstempel", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260901203139_fix_legal_onboarding_timestamp.sql"),
    "utf8",
  );
  assert.match(migration, /set onboarding_required_at = required_at/);
  assert.doesNotMatch(migration, /set onboarding_required_at = required_at,\s*updated_at/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function[\s\S]*authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*service_role/);
});
