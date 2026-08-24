import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { INVITE_COOKIE, getInviteGateCode } from "@/lib/auth/invite-gate"
import { isPublicPath } from "@/lib/auth/public-paths"
import { applyAuthResponse, expiredSupabaseAuthCookies, isRecoverableExpiredSession, PRIVATE_AUTH_RESPONSE_HEADERS, type PendingAuthCookie } from "@/lib/supabase/auth-response"

export async function proxy(req: NextRequest) {
    const { pathname } = req.nextUrl

    // Cookie-autentificerede mutationer må kun komme fra appens egen origin.
    // Server-til-server jobs og webhooks sender normalt ingen Origin-header og
    // godkendes fortsat af deres egne secrets/signaturer i de enkelte ruter.
    if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const origin = req.headers.get("origin")
        if (origin) {
            let allowed = false
            try { allowed = new URL(origin).origin === req.nextUrl.origin } catch { allowed = false }
            if (!allowed) return NextResponse.json({ error: "Ugyldig forespørgselskilde" }, { status: 403 })
        }
    }

    // Altid tilgængelige stier
    if (isPublicPath(pathname)) {
        return NextResponse.next()
    }

    // ── Invite-kode gate ──────────────────────────────────────
    // Testgaten kræver eksplicit opt-in. En gammel INVITE_CODE må ikke blokere
    // den almindelige login-side for nye browsere.
    const inviteCode = getInviteGateCode()
    if (inviteCode) {
        const token = req.cookies.get(INVITE_COOKIE)?.value
        if (token !== inviteCode) {
            const url = req.nextUrl.clone()
            url.pathname = "/invite"
            url.searchParams.set("from", pathname)
            return NextResponse.redirect(url)
        }
    }

    // ── Supabase session refresh ──────────────────────────────
    // Kun aktiv når Supabase env vars er sat (ikke lokalt uden .env.local)
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        return NextResponse.next()
    }

    let pendingAuthCookies: PendingAuthCookie[] = []
    let pendingAuthHeaders: Record<string, string> = { ...PRIVATE_AUTH_RESPONSE_HEADERS }
    const withAuthState = <T extends NextResponse>(response: T): T =>
        applyAuthResponse(response, pendingAuthCookies, pendingAuthHeaders)
    let supabaseResponse = withAuthState(NextResponse.next({ request: req }))

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() { return req.cookies.getAll() },
                setAll(cookiesToSet, headers) {
                    cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
                    pendingAuthCookies = [...pendingAuthCookies, ...cookiesToSet]
                    pendingAuthHeaders = { ...pendingAuthHeaders, ...headers }
                    supabaseResponse = withAuthState(NextResponse.next({ request: req }))
                },
            },
        }
    )

    // Opdater session (vigtigt — må ikke fjernes)
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (isRecoverableExpiredSession(authError)) {
        const expiredCookies = expiredSupabaseAuthCookies(
            req.cookies.getAll().map(cookie => cookie.name),
            process.env.NEXT_PUBLIC_SUPABASE_URL,
        )
        for (const cookie of expiredCookies) req.cookies.set(cookie.name, "")
        pendingAuthCookies = [...pendingAuthCookies, ...expiredCookies]
        const url = req.nextUrl.clone()
        url.pathname = "/"
        url.search = ""
        url.searchParams.set("notice", "session-expired")
        return withAuthState(NextResponse.redirect(url))
    }

    // Beskyttede stier kræver login
    const isProtected =
        pathname.startsWith("/admin") ||
        pathname.startsWith("/portal") ||
        pathname.startsWith("/superadmin") ||
        pathname.startsWith("/onboarding") ||
        pathname.startsWith("/vaerker")
    if (isProtected && !user) {
        const url = req.nextUrl.clone()
        url.pathname = "/"
        return withAuthState(NextResponse.redirect(url))
    }

    if (pathname.startsWith("/admin") && user) {
        const prototypePrefixes = [
            "/admin/indbetalinger",
            "/admin/udbetalinger",
            "/admin/streaming",
            "/admin/stamdata",
            "/admin/gennemsigtighed",
            "/admin/barselspulje",
            "/admin/helligdagsfond",
        ]
        if (process.env.VERCEL_ENV === "production" && prototypePrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
            const url = req.nextUrl.clone()
            url.pathname = "/admin"
            url.search = ""
            url.searchParams.set("notice", "module-not-ready")
            return withAuthState(NextResponse.redirect(url))
        }
    }

    return supabaseResponse
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.svg|.*\\.ico).*)"],
}
