import { NextRequest, NextResponse } from "next/server";
import { resolveBranding } from "@/lib/branding";
import { createServiceClient } from "@/lib/supabase/service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org")?.trim();
  if (!orgId || !UUID_PATTERN.test(orgId)) {
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
  });
}
