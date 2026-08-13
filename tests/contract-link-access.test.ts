import assert from "node:assert/strict";
import test from "node:test";
import { canLinkContractWork } from "../lib/contract-link-access";

test("et medlem kan kun forbinde sit eget kontrakt- og rettighedshaver-id", () => {
  assert.equal(canLinkContractWork({
    canManageContract: false,
    ownRightsHolderId: "holder-a",
    contractRightsHolderId: "holder-a",
    requestedRightsHolderId: "holder-a",
  }), true);
  assert.equal(canLinkContractWork({
    canManageContract: false,
    ownRightsHolderId: "holder-a",
    contractRightsHolderId: "holder-b",
  }), false);
  assert.equal(canLinkContractWork({
    canManageContract: false,
    ownRightsHolderId: "holder-a",
    contractRightsHolderId: "holder-a",
    requestedRightsHolderId: "holder-b",
  }), false);
});

test("staff med skriveret kan forbinde kontrakten efter organisationskontrollen", () => {
  assert.equal(canLinkContractWork({
    canManageContract: true,
    ownRightsHolderId: null,
    contractRightsHolderId: "holder-b",
    requestedRightsHolderId: "holder-b",
  }), true);
});
