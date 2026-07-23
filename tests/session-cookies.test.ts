import assert from "node:assert/strict"
import test from "node:test"
import { isMissingRefreshTokenError, isSupabaseAuthCookie } from "../lib/auth/session-cookies"

test("genkender Supabase auth-cookie og dens opdelte varianter", () => {
    assert.equal(isSupabaseAuthCookie("sb-laozsonuqagorrblrwzm-auth-token"), true)
    assert.equal(isSupabaseAuthCookie("sb-laozsonuqagorrblrwzm-auth-token.0"), true)
    assert.equal(isSupabaseAuthCookie("sb-laozsonuqagorrblrwzm-auth-token.12"), true)
    assert.equal(isSupabaseAuthCookie("dfks_invite"), false)
    assert.equal(isSupabaseAuthCookie("sb-project-other-cookie"), false)
})

test("genkender en manglende refresh-token uden at matche andre auth-fejl", () => {
    assert.equal(isMissingRefreshTokenError({ code: "refresh_token_not_found" }), true)
    assert.equal(isMissingRefreshTokenError({ message: "Invalid Refresh Token: Refresh Token Not Found" }), true)
    assert.equal(isMissingRefreshTokenError({ code: "invalid_credentials" }), false)
    assert.equal(isMissingRefreshTokenError(null), false)
})
