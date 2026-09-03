import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const source = fs.readFileSync("app/actions/rights-funds.ts", "utf8")

test("rettighedshandlinger returnerer ikke rå databasefejl til klienten", () => {
    assert.match(source, /return "Handlingen kunne ikke gennemføres\. Prøv igen eller kontakt en administrator\."/)
    assert.doesNotMatch(source, /return \[message, details, hint\]/)
    assert.doesNotMatch(source, /error: String\(err\)/)
})

test("politikversioner oprettes kun under en politik i samme organisation", () => {
    const createVersion = source.slice(
        source.indexOf("export async function createPolicyVersion"),
        source.indexOf("export async function activatePolicyVersion"),
    )

    assert.match(createVersion, /from\("distribution_policies"\)[\s\S]*eq\("id", policyId\)[\s\S]*eq\("org_id", orgId\)/)
    assert.match(createVersion, /from\("distribution_policy_versions"\)[\s\S]*eq\("policy_id", policyId\)[\s\S]*eq\("org_id", orgId\)/)
})

test("aktivering binder version og politik sammen før statusændringer", () => {
    const activateVersion = source.slice(source.indexOf("export async function activatePolicyVersion"))

    assert.match(activateVersion, /select\("prepared_by, policy_id, status, used_in_calculation"\)/)
    assert.match(activateVersion, /version\.policy_id !== policyId/)
    assert.match(activateVersion, /eq\("id", versionId\)[\s\S]*eq\("policy_id", policyId\)[\s\S]*eq\("org_id", orgId\)/)
    assert.match(activateVersion, /if \(supersedeErr\) throw supersedeErr/)
})
