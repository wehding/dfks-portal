import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { INVITE_COOKIE } from "@/lib/auth/invite-gate"
import { isMissingRefreshTokenError, isSupabaseAuthCookie } from "@/lib/auth/session-cookies"

// Stier der altid er tilgængelige uden session
const PUBLIC_PATHS = [
    "/invite",
    "/api/auth/invite",
    "/api/auth/callback",
    "/auth/confirm",
    "/auth/opret-adgang",
    "/_next",
    "/favicon",
]

export async function proxy(req: NextRequest) {
    const { pathname } = req.nextUrl

    // Altid tilgængelige stier
    if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
        return NextResponse.next()
    }

    // ── Invite-kode gate ──────────────────────────────────────
    // Kun aktiv når INVITE_CODE env var er sat (produktion/test)
    if (process.env.INVITE_CODE) {
        const token = req.cookies.get(INVITE_COOKIE)?.value
        if (token !== process.env.INVITE_CODE) {
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

    let supabaseResponse = NextResponse.next({ request: req })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() { return req.cookies.getAll() },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({ request: req })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Opdater session (vigtigt — må ikke fjernes)
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    // En udløbet eller tilbagekaldt refresh-token må ikke låse login-siden i en
    // fejlsluske. Fjern kun Supabases auth-cookies; øvrige cookies bevares.
    if (isMissingRefreshTokenError(userError)) {
        req.cookies.getAll()
            .filter(({ name }) => isSupabaseAuthCookie(name))
            .forEach(({ name }) => {
                req.cookies.delete(name)
                supabaseResponse.cookies.set(name, "", { maxAge: 0, path: "/" })
            })
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
        return NextResponse.redirect(url)
    }

    // /superadmin/* kræver superadmin-rolle fra user_org_roles
    if (pathname.startsWith("/superadmin") && user) {
        const { data: roleRow } = await supabase
            .from("user_org_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("role", "superadmin")
            .limit(1)
            .single()

        if (!roleRow) {
            const url = req.nextUrl.clone()
            url.pathname = "/admin"
            return NextResponse.redirect(url)
        }
    }

    return supabaseResponse
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.svg|.*\\.ico).*)"],
}
