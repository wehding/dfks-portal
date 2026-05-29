import { NextRequest, NextResponse } from "next/server"

const INVITE_COOKIE = "dfks_invite"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 dage

export async function POST(req: NextRequest) {
    const { code } = await req.json()

    if (!process.env.INVITE_CODE) {
        return NextResponse.json({ error: "Invite-kode ikke konfigureret" }, { status: 500 })
    }

    if (!code || code.trim() !== process.env.INVITE_CODE) {
        return NextResponse.json({ error: "Ugyldig kode" }, { status: 401 })
    }

    const res = NextResponse.json({ ok: true })
    res.cookies.set(INVITE_COOKIE, process.env.INVITE_CODE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: COOKIE_MAX_AGE,
        path: "/",
    })
    return res
}
