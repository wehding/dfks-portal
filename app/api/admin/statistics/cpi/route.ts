import { NextRequest, NextResponse } from "next/server";
import { syncStatisticsCpi } from "@/lib/statistics-cpi";
import { requireCronOrAdminApi } from "@/lib/api-auth";

async function run(request: NextRequest) {
  const caller = await requireCronOrAdminApi(request, ["superadmin", "admin", "org-admin"]);
  if (!caller.ok) return caller.response;
  try {
    return NextResponse.json(await syncStatisticsCpi());
  } catch (error) {
    console.error("[statistics-cpi]", error instanceof Error ? error.message : "Ukendt fejl");
    return NextResponse.json({ error: "Inflationsdata kunne ikke opdateres." }, { status: 502 });
  }
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
