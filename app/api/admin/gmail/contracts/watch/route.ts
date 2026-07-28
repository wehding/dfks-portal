import { NextRequest, NextResponse } from "next/server";
import { requireCronOrAdminApi } from "@/lib/api-auth";
import { configureGmailContractWatch, syncGmailContractMailbox } from "@/lib/gmail-contract-import";

export const dynamic = "force-dynamic";

async function run(req: NextRequest) {
  const auth = await requireCronOrAdminApi(req, ["superadmin"]);
  if (!auth.ok) return auth.response;
  try {
    const watch = await configureGmailContractWatch();
    const sync = await syncGmailContractMailbox();
    return NextResponse.json({ ok: true, watch, sync });
  } catch (error) {
    console.error("[gmail-contract-watch] Opsætning fejlede", error instanceof Error ? error.message : "Ukendt fejl");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gmail-overvågningen fejlede" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
