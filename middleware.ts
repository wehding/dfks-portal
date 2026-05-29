import { NextRequest, NextResponse } from "next/server"

// Invite-kode gate — kun aktiv når INVITE_CODE env var er sat (dvs. i produktion/test).
// Lokalt udvikling: springer over, ingen gate.

const INVITE_COOKIE = "dfks_invite"
const PUBLIC_PATHS = ["/invite", "/api/auth/invite", "/_next", "/favicon", "/api/auth/"]

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl

    // Lokalt: INVITE_CODE er ikke sat → ingen gate
    if (!process.env.INVITE_CODE) return NextResponse.next()

    // Offentlige stier der altid er tilgængelige
    if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next()

    // Tjek for gyldig invite-cookie
    const token = req.cookies.get(INVITE_COOKIE)?.value
    if (token === process.env.INVITE_CODE) return NextResponse.next()

    // Ingen gyldig invite → send til invite-siden
    const url = req.nextUrl.clone()
    url.pathname = "/invite"
    url.searchParams.set("from", pathname)
    return NextResponse.redirect(url)
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.svg|.*\\.ico).*)"],
}
