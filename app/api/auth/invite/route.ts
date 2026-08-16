import { NextRequest, NextResponse } from "next/server"
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE, getInviteGateCode } from "@/lib/auth/invite-gate"

export async function POST(req: NextRequest) {
    const { code } = await req.json()

    const inviteCode = getInviteGateCode()
    if (!inviteCode) {
        return NextResponse.json({ error: "Testadgang er ikke aktiv" }, { status: 404 })
    }

    if (!code || code.trim() !== inviteCode) {
        return NextResponse.json({ error: "Ugyldig kode" }, { status: 401 })
    }

    const res = NextResponse.json({ ok: true })
    res.cookies.set(INVITE_COOKIE, inviteCode, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: INVITE_COOKIE_MAX_AGE,
        path: "/",
    })
    return res
}
