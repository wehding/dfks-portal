import { after, NextRequest, NextResponse } from "next/server";
import { verifyPubSubPushToken } from "@/lib/gmail-contract-client";
import { parsePubSubNotificationBody } from "@/lib/gmail-contract-import-core";
import { getSafeGmailContractImportError, syncGmailContractMailbox } from "@/lib/gmail-contract-import";
import { triggerContractReviewWorker } from "@/lib/contract-review-intake";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await verifyPubSubPushToken(req.headers.get("authorization"));
    const notification = parsePubSubNotificationBody(await req.json());
    const origin = req.nextUrl.origin;
    after(async () => {
      try {
        const sync = await syncGmailContractMailbox(notification.historyId);
        if (sync.imported > 0) await triggerContractReviewWorker(origin);
      } catch (error) {
        console.error("[gmail-contract-import] Synkronisering fejlede", getSafeGmailContractImportError(error));
      }
    });
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    console.warn("[gmail-contract-import] Pub/Sub-kald afvist", error instanceof Error ? error.message : "Ukendt fejl");
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }
}
