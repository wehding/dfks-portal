import assert from "node:assert/strict";
import test from "node:test";
import { shouldAutoOpenContextualHelp } from "../lib/contextual-help";
import { adminHelpForPath } from "../lib/admin-help";
import { portalHelpForPath } from "../lib/portal-help";

test("alle navigerbare adminsider har sidespecifik hjælp", () => {
  const sections = [
    "kontrakter",
    "vaerker",
    "aftalelicens",
    "rettighedshavere",
    "producenter",
    "kontraktgennemgang",
    "statistik",
    "indbetalinger",
    "udbetalinger",
    "streaming",
    "stamdata",
    "gennemsigtighed",
    "ai-kontrolrum",
    "organisation",
    "brugere",
    "min-profil",
    "organisationer",
  ];

  for (const section of sections) {
    const result = adminHelpForPath(`/admin/${section}`);
    assert.equal(result.section, section);
    assert.notEqual(result.content.title, "Hjælp til administration");
  }
});

test("alle navigerbare portalsider har sidespecifik hjælp", () => {
  const sections = [
    "mine-vaerker",
    "mine-kontrakter",
    "okonomi",
    "mine-visninger",
    "kontraktgennemgang",
    "min-profil",
    "beskeder",
    "aftalelicens",
  ];

  for (const section of sections) {
    const result = portalHelpForPath(`/portal/${section}`);
    assert.equal(result.section, section);
    assert.notEqual(result.content.title, "Hjælp til portalen");
  }
});

test("adminhjælp åbner aldrig automatisk", () => {
  assert.equal(shouldAutoOpenContextualHelp({
    autoOpenOnFirstVisit: false,
    storageKey: "dfks-admin-help-producenter-v1",
    seen: false,
  }), false);
});

test("brugerhjælp åbner kun automatisk første gang", () => {
  assert.equal(shouldAutoOpenContextualHelp({
    autoOpenOnFirstVisit: true,
    storageKey: "dfks-portal-help-mine-kontrakter-v1",
    seen: false,
  }), true);
  assert.equal(shouldAutoOpenContextualHelp({
    autoOpenOnFirstVisit: true,
    storageKey: "dfks-portal-help-mine-kontrakter-v1",
    seen: true,
  }), false);
});
