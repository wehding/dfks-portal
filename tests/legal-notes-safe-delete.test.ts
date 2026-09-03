import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { filterLegalNotesForContract } from "../lib/legal-note-context"

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

test("noteringer markeret for alle overenskomster udelades fra AI-konteksten", () => {
    const notes = [
        { title: "Kreditering", body: "Kun uden overenskomst", exclude_for_overenskomst: ["alle"] },
        { title: "Generel", body: "Gælder altid", exclude_for_overenskomst: [] },
    ]

    assert.deepEqual(filterLegalNotesForContract(notes, true, ["de4"]), [
        { title: "Generel", body: "Gælder altid" },
    ])
    assert.deepEqual(filterLegalNotesForContract(notes, false), [
        { title: "Kreditering", body: "Kun uden overenskomst" },
        { title: "Generel", body: "Gælder altid" },
    ])
})

test("noteringer kan udelades for en bestemt overenskomst", () => {
    const notes = [
        { title: "DE4", body: "Ikke til DE4", exclude_for_overenskomst: ["DE4"] },
        { title: "Anden", body: "Gælder", exclude_for_overenskomst: ["faf"] },
    ]

    assert.deepEqual(filterLegalNotesForContract(notes, true, ["de4"]), [
        { title: "Anden", body: "Gælder" },
    ])
})
