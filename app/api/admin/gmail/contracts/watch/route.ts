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
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

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
    // Start også workeren, når Gmail-synkroniseringen kun fandt dubletter.
    // Der kan ligge ældre køjob fra et tidligere afbrudt webhook-kald.
    after(triggerContractReviewWorker(req.nextUrl.origin));
    const status = await getGmailContractImportStatus();
    await recordSensitiveFlow({ actor: { userId: "isCron" in auth ? null : auth.userId, orgId: "isCron" in auth ? null : auth.orgId, role: "isCron" in auth ? "integration" : auth.role, source: "isCron" in auth ? "cron" : "admin" }, action: "sync", component: "admin.gmail.contract-watch", entityType: "contract_reviews", orgIds: "isCron" in auth ? [] : [auth.orgId], purposeCode: "contract_review_import", legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)", dataCategories: ["contract_data", "communication_data", "contact_data"] });
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
