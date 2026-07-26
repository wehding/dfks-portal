import test from "node:test"
import assert from "node:assert/strict"
import { ADMIN_CONTRACT_UPLOAD_ACCEPT, isSupportedAdminContractFile } from "../lib/contract-upload-format"

test("kontraktadmin accepterer samme gamle DOC-format som Word-parseren", () => {
    assert.match(ADMIN_CONTRACT_UPLOAD_ACCEPT, /(?:^|,)\.doc(?:,|$)/)
    assert.equal(isSupportedAdminContractFile("Normalkontrakt.doc"), true)
    assert.equal(isSupportedAdminContractFile("Normalkontrakt.DOC"), true)
})

test("kontraktadmin accepterer de øvrige dokumentformater og afviser ukendte filer", () => {
    assert.equal(isSupportedAdminContractFile("kontrakt.pdf"), true)
    assert.equal(isSupportedAdminContractFile("kontrakt.docx"), true)
    assert.equal(isSupportedAdminContractFile("kontrakt.txt"), true)
    assert.equal(isSupportedAdminContractFile("kontrakt.pages"), false)
})
