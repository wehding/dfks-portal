import { NextResponse } from "next/server";
import { parseDrainBody, sanitiseDrainEvents } from "@/lib/observability/ingestion";
import { verifyPayloadSignature } from "@/lib/observability/signatures";
import { storeObservabilityEvents, updateObservabilitySourceStatus } from "@/lib/observability/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.VERCEL_DRAIN_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const rawBody = await request.text();
  const signature = request.headers.get("x-vercel-signature");
  if (!verifyPayloadSignature(rawBody, signature, secret, "sha1")) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  try {
    const events = sanitiseDrainEvents(parseDrainBody(rawBody));
    const result = await storeObservabilityEvents(events);
    const sources = [...new Set(events.map(event => event.source))];
    await Promise.all(sources.map(source => updateObservabilitySourceStatus({
      source,
      ok: true,
      lastEventAt: events.filter(event => event.source === source).at(-1)?.observedAt,
      details: { accepted: events.filter(event => event.source === source).length },
    })));
    return NextResponse.json({ accepted: result.stored });
  } catch {
    return NextResponse.json({ error: "ingestion_failed" }, { status: 500 });
  }
}
