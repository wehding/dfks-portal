import { after, NextRequest, NextResponse } from "next/server";
import { requireCronOrAdminApi } from "@/lib/api-auth";
import {
  configureGmailContractWatch,
  getGmailContractConfigurationStatus,
  getGmailContractImportStatus,
  getSafeGmailContractImportError,
  reconcileRecentGmailContractMessages,
  syncGmailContractMailbox,
} from "@/lib/gmail-contract-import";
import { triggerContractReviewWorker } from "@/lib/contract-review-intake";

export const dynamic = "force-dynamic";

async function run(req: NextRequest) {
  const auth = await requireCronOrAdminApi(req, ["superadmin"]);
  if (!auth.ok) return auth.response;
  const configuration = getGmailContractConfigurationStatus();
  try {
    const watch = await configureGmailContractWatch();
    const sync = await syncGmailContractMailbox();
    const reconciliation = sync.mode === "reconciliation"
      ? null
      : await reconcileRecentGmailContractMessages();
    const imported = sync.imported + (reconciliation?.imported ?? 0);
    if (imported > 0) after(triggerContractReviewWorker(req.nextUrl.origin));
    const status = await getGmailContractImportStatus();
    return NextResponse.json({ ok: true, configuration, watch, sync, reconciliation, status });
  } catch (error) {
    console.error("[gmail-contract-watch] Opsætning fejlede", getSafeGmailContractImportError(error));
    return NextResponse.json({
      ok: false,
      configuration,
      error: "Gmail-overvågningen kunne ikke opdateres.",
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
