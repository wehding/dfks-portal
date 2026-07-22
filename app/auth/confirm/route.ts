import { type NextRequest, NextResponse } from "next/server";
import { accountAccessPath, isAccountAccessMode } from "@/lib/auth/account-access";
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE } from "@/lib/auth/invite-gate";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const mode = isAccountAccessMode(type) ? type : "invite";

  if (!tokenHash || !isAccountAccessMode(type)) {
    return NextResponse.redirect(
      new URL(accountAccessPath(mode, "invalid_link"), request.url)
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  const destination = error
    ? accountAccessPath(mode, "invalid_link")
    : accountAccessPath(mode);
  const response = NextResponse.redirect(new URL(destination, request.url));

  if (!error && process.env.INVITE_CODE) {
    response.cookies.set(INVITE_COOKIE, process.env.INVITE_CODE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: INVITE_COOKIE_MAX_AGE,
      path: "/",
    });
  }

  return response;
}
