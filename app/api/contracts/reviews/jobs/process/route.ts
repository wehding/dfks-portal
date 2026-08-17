import { after, NextRequest, NextResponse } from "next/server";
import { getInternalWorkerSecret } from "@/lib/api-auth";
import { triggerContractReviewWorker } from "@/lib/contract-review-intake";
import { isContractReviewWorkerAuthorized } from "@/lib/contract-review-worker-auth";
import { processPendingContractReviewJobs } from "@/lib/server/contract-review-job-processor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(request: NextRequest, method: "GET" | "POST") {
  const authorized = isContractReviewWorkerAuthorized({
    method,
    authorization: request.headers.get("authorization"),
    cronSecret: process.env.CRON_SECRET,
    workerSecret: getInternalWorkerSecret("contract-review"),
  });
  if (!authorized) {
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }

  try {
    const result = await processPendingContractReviewJobs();
    if (result.hasMore) {
      after(triggerContractReviewWorker(request.nextUrl.origin));
    }
    return NextResponse.json(result);
  } catch {
    console.error("[contract-review-worker] queue processing failed");
    return NextResponse.json({ error: "Kontraktgennemgangskøen kunne ikke behandles." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request, "GET");
}

export async function POST(request: NextRequest) {
  return run(request, "POST");
}
