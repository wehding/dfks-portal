import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const page = fs.readFileSync("app/admin/ai-kontrolrum/page.tsx", "utf8")
const route = fs.readFileSync("app/api/legal-notes/route.ts", "utf8")

test("sletning kræver en tydelig destruktiv bekræftelse", () => {
    assert.match(page, /<AlertDialog open=\{noteToDelete !== null\}/)
    assert.match(page, /Slet notering permanent\?/)
    assert.match(page, /Sletningen kan ikke fortrydes i AI-kontrolrummet/)
    assert.match(page, /confirmationTitle: noteToDelete\.title/)
    assert.match(route, /existing\.title !== confirmationTitle/)
})

test("fortryd redigering gendanner kladden uden at slette noteringen", () => {
    assert.match(page, /const \[editSnapshot, setEditSnapshot\]/)
    assert.match(page, /const cancelEditing = \(\) =>/)
    assert.match(page, /editSnapshot\.id \? editSnapshot : n/)
    assert.match(page, /Fortryd redigering/)
    assert.match(page, /Noteringen er ikke slettet/)
})

test("redigeringsfelter gemmes samlet og normaliseres efter serverens svar", () => {
    assert.match(page, /const saved = await apiPatch/)
    assert.match(page, /exclude_for_overenskomst: note\.exclude_for_overenskomst \? \["alle"\] : \[\]/)
    assert.match(page, /normalizeLegalNote/)
    assert.match(route, /"exclude_for_overenskomst"/)
})
