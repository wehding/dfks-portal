import assert from "node:assert/strict";
import test from "node:test";
import { isActionableAdminWorkShareCase, workShareParticipantSourceText } from "../lib/work-share-admin";

test("en enkelt kendt lokal klipper er ikke en administrativ arbejdsandelsopgave", () => {
  assert.equal(isActionableAdminWorkShareCase({
    work_share_participants: [{ rights_holder_id: "holder-1", source_tags: ["local"], excluded_at: null }],
  }), false);
});

test("to aktive klippere kræver afstemning", () => {
  assert.equal(isActionableAdminWorkShareCase({
    work_share_participants: [
      { rights_holder_id: "holder-1", source_tags: ["local"] },
      { rights_holder_id: "holder-2", source_tags: ["member"] },
    ],
  }), true);
});

test("en enkelt rapporteret eller uafklaret medklipper forbliver handlingskrævende", () => {
  assert.equal(isActionableAdminWorkShareCase({
    work_share_participants: [{ rights_holder_id: "holder-2", invited_by_rights_holder_id: "reporter", source_tags: ["member"] }],
  }), true);
  assert.equal(isActionableAdminWorkShareCase({
    work_share_participants: [{ rights_holder_id: null, source_tags: ["dfi"] }],
  }), true);
});

test("eksternt bekræftet lokal soloklipper opretter ikke en ekstra opgave", () => {
  assert.equal(isActionableAdminWorkShareCase({
    work_share_participants: [{ rights_holder_id: "holder-1", source_tags: ["local", "dfi", "tmdb"] }],
  }), false);
});

test("kildeteksten viser både den rapporterende bruger og eksterne kilder", () => {
  assert.equal(workShareParticipantSourceText({
    sourceTags: ["member", "dfi", "tmdb"],
    reportedByName: "Steen Johannessen",
  }), "Kilde: Indtastet af Steen Johannessen · DFI · TMDb");
  assert.equal(workShareParticipantSourceText({ sourceTags: ["local"] }), "Kilde: Lokal");
});
