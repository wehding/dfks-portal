import { NextRequest, NextResponse } from "next/server";
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE, getInviteGateCode } from "@/lib/auth/invite-gate";
import { consumeRateLimit, requestIdentifier } from "@/lib/server/rate-limit";

export async function POST(req: NextRequest) {
    const rateLimit = await consumeRateLimit({
        bucket: "auth-invite",
        identifier: requestIdentifier(req.headers),
        limit: 10,
        windowMs: 15 * 60 * 1000,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "For mange forsøg. Prøv igen senere." },
            { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
        );
    }

    const body = await req.json().catch(() => null) as { code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code.trim() : "";

    const inviteCode = getInviteGateCode();
    if (!inviteCode) {
        return NextResponse.json({ error: "Testadgang er ikke aktiv" }, { status: 404 });
    }

    if (!code || code !== inviteCode) {
        return NextResponse.json({ error: "Ugyldig kode" }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(INVITE_COOKIE, inviteCode, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: INVITE_COOKIE_MAX_AGE,
        path: "/",
    });
    return res;
}
