const SUPABASE_AUTH_COOKIE_PATTERN = /^sb-[^-]+-auth-token(?:\.\d+)?$/

export function isSupabaseAuthCookie(name: string) {
    return SUPABASE_AUTH_COOKIE_PATTERN.test(name)
}

export function isMissingRefreshTokenError(error: unknown) {
    if (!error || typeof error !== "object") return false

    const authError = error as { code?: unknown; message?: unknown }
    return authError.code === "refresh_token_not_found" ||
        (typeof authError.message === "string" &&
            authError.message.toLowerCase().includes("refresh token not found"))
}
