import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("isSeries detekterer manuelle serier korrekt", () => {
  const evaluateIsSeries = (
    manualWorkMode: boolean,
    manualWorkType: string,
    selectedWorkResultType: string | null | undefined,
    activeWorkType: string | null | undefined,
  ) => {
    return (manualWorkMode ? manualWorkType : (selectedWorkResultType ?? activeWorkType ?? "")).includes("serie");
  };

  // Manuelt oprettet TV-serie
  assert.equal(evaluateIsSeries(true, "tv-serie", null, null), true);
  // Manuelt oprettet spillefilm
  assert.equal(evaluateIsSeries(true, "spillefilm", null, null), false);
  // Eksisterende værk valgt som TV-serie
  assert.equal(evaluateIsSeries(false, "", "tv-serie", null), true);
  // Eksisterende tilknyttet værk af typen TV-serie
  assert.equal(evaluateIsSeries(false, "", null, "tv-serie"), true);
  // Eksisterende spillefilm
  assert.equal(evaluateIsSeries(false, "", "spillefilm", null), false);
  // Intet værk
  assert.equal(evaluateIsSeries(false, "", null, null), false);
});

test("samtidighedskontrol (expected_snapshot) detekterer ændringer foretaget af anden bruger", () => {
  const checkSnapshotConflict = (
    existing: Record<string, unknown>,
    expectedSnapshot: Record<string, unknown>,
  ) => {
    const s = expectedSnapshot;
    return (
      (s.type !== undefined && s.type !== (existing.type ?? undefined)) ||
      (s.overenskomst !== undefined && s.overenskomst !== (existing.overenskomst ?? null)) ||
      (s.work_id !== undefined && s.work_id !== (existing.work_id ?? null)) ||
      (s.employer_id !== undefined && s.employer_id !== (existing.employer_id ?? null)) ||
      (s.contract_date !== undefined && s.contract_date !== (existing.contract_date ?? null)) ||
      (s.start_date !== undefined && s.start_date !== (existing.start_date ?? null)) ||
      (s.end_date !== undefined && s.end_date !== (existing.end_date ?? null)) ||
      (s.working_title !== undefined && s.working_title !== (existing.working_title ?? null)) ||
      (s.season_number !== undefined && s.season_number !== (existing.season_number ?? null)) ||
      (s.episode_numbers !== undefined && JSON.stringify(s.episode_numbers ?? []) !== JSON.stringify(existing.episode_numbers ?? []))
    );
  };

  const baseline = {
    type: "a-løn",
    overenskomst: "de4-fiktion",
    work_id: "work-1",
    employer_id: "producer-1",
    contract_date: "2026-01-15",
    start_date: "2026-02-01",
    end_date: "2026-05-01",
    working_title: "Arbejdstitel",
    season_number: 1,
    episode_numbers: [1, 2],
  };

  // Uændret database -> Ingen konflikt
  assert.equal(checkSnapshotConflict({ ...baseline }, { ...baseline }), false);

  // En anden bruger ændrede værk i mellemtiden -> Konflikt opdaget!
  assert.equal(checkSnapshotConflict({ ...baseline, work_id: "work-2" }, { ...baseline }), true);

  // En anden bruger ændrede afsnit i mellemtiden -> Konflikt opdaget!
  assert.equal(checkSnapshotConflict({ ...baseline, episode_numbers: [1, 2, 3] }, { ...baseline }), true);

  // En anden bruger ændrede overenskomst -> Konflikt opdaget!
  assert.equal(checkSnapshotConflict({ ...baseline, overenskomst: "faf" }, { ...baseline }), true);
});

test("valideret kontrakt nedgraderes ikke utilsigtet til kladde", () => {
  const resolveEffectiveStatus = (existingStatus: string, requestedStatus: string | undefined) => {
    const shouldPreserveValidated = existingStatus === "valideret" && requestedStatus === "kladde";
    return shouldPreserveValidated ? undefined : requestedStatus;
  };

  // Almindelig gemning uden eksplicit statusændring (requestedStatus === undefined)
  assert.equal(resolveEffectiveStatus("valideret", undefined), undefined);
  assert.equal(resolveEffectiveStatus("kladde", undefined), undefined);

  // Gammel klient state sender 'kladde' mod valideret kontrakt i DB -> Status bevares uændret (undefined)
  assert.equal(resolveEffectiveStatus("valideret", "kladde"), undefined);

  // Eksplicit arkivering/afvisning er fortsat tilladt
  assert.equal(resolveEffectiveStatus("valideret", "arkiveret"), "arkiveret");

  // Almindelig kladde kan fortsat opdateres med status kladde
  assert.equal(resolveEffectiveStatus("kladde", "kladde"), "kladde");
});

test("ContractWorkbenchClient og member-contracts overholder integritetsmønster", () => {
  const workbenchSrc = fs.readFileSync(
    new URL("../app/admin/kontrakter/[id]/rediger/ContractWorkbenchClient.tsx", import.meta.url),
    "utf8",
  );
  const memberContractsSrc = fs.readFileSync(
    new URL("../app/actions/member-contracts.ts", import.meta.url),
    "utf8",
  );

  // 1. isSeries inkluderer manualWorkMode
  assert.match(workbenchSrc, /manualWorkMode \? manualWork\.type :/);

  // 2. expected_snapshot sendes i ContractWorkbenchClient
  assert.match(workbenchSrc, /expected_snapshot/);
  assert.match(workbenchSrc, /result\.conflict/);

  // 3. updateAdminContract modtager og tjekker expected_snapshot
  assert.match(memberContractsSrc, /export type AdminContractSnapshot = {/);
  assert.match(memberContractsSrc, /expected_snapshot\?: AdminContractSnapshot/);
  assert.match(memberContractsSrc, /if \(values\.expected_snapshot\) {/);

  // 4. Statusbeskyttelse mod utilsigtet nedgradering
  assert.match(memberContractsSrc, /shouldPreserveValidated = existing\.status === "valideret" && requestedStatus === "kladde"/);
});
