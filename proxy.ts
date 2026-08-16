import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { INVITE_COOKIE, getInviteGateCode } from "@/lib/auth/invite-gate"
import { mustCompleteOnboarding, resolveOnboardingStatus } from "@/lib/auth/onboarding-state"
import { isPublicPath } from "@/lib/auth/public-paths"

export async function proxy(req: NextRequest) {
    const { pathname } = req.nextUrl

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
    const { data: { user } } = await supabase.auth.getUser()

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

    // Førstegangs-onboarding og et aktiveret gen-onboardingkrav har forrang
    // over både medlems- og administratorroller. Et genkrav aktiveres først,
    // når Supabase registrerer et nyt login efter kravets tidspunkt.
    const guardsOnboarding = pathname.startsWith("/admin") || pathname.startsWith("/portal") || pathname.startsWith("/superadmin")
    if (guardsOnboarding && user) {
        const { data: holder } = await supabase
            .from("rettighedshavere")
            .select("user_id,onboarding_completed_at,onboarding_required_at")
            .eq("user_id", user.id)
            .limit(1)
            .maybeSingle()
        if (holder) {
            const status = resolveOnboardingStatus({
                hasPortalUser: Boolean(holder.user_id),
                completedAt: holder.onboarding_completed_at,
                requiredAt: holder.onboarding_required_at,
                lastSignInAt: user.last_sign_in_at,
            })
            if (mustCompleteOnboarding(status)) {
                const url = req.nextUrl.clone()
                url.pathname = "/onboarding"
                url.search = ""
                return NextResponse.redirect(url)
            }
        }
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
