import { after, NextRequest, NextResponse } from "next/server";
import { verifyPubSubPushToken } from "@/lib/gmail-contract-client";
import { parsePubSubNotificationBody } from "@/lib/gmail-contract-import-core";
import { syncGmailContractMailbox } from "@/lib/gmail-contract-import";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await verifyPubSubPushToken(req.headers.get("authorization"));
    const notification = parsePubSubNotificationBody(await req.json());
    after(async () => {
      try {
        await syncGmailContractMailbox(notification.historyId);
      } catch (error) {
        console.error("[gmail-contract-import] Synkronisering fejlede", error instanceof Error ? error.message : "Ukendt fejl");
      }
    });
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    console.warn("[gmail-contract-import] Pub/Sub-kald afvist", error instanceof Error ? error.message : "Ukendt fejl");
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }
}
