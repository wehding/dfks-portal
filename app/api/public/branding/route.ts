import { NextRequest, NextResponse } from "next/server";
import { resolveBranding } from "@/lib/branding";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/uuid";

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org")?.trim();
  if (!orgId || !isUuid(orgId)) {
    return NextResponse.json({ error: "Ugyldig organisation." }, { status: 400 });
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("organisations")
    .select("name, logo_url, branding")
    .eq("id", orgId)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Organisationen blev ikke fundet." }, { status: 404 });
  }

  const branding = resolveBranding(data as never);
  return NextResponse.json({
    logo_url: data.logo_url ?? null,
    short_name: branding.short_name,
    long_name: branding.long_name,
    primary_color: branding.primary_color,
  }, {
    // Branding er offentligt og skifter sjældent — cache på edge/CDN for at dæmpe UUID-enumerering
    // og gentagne opslag (afbødning; ikke en fuld rate-limit).
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
