"use client";

import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { sanitiseAnalyticsEvent, sanitiseSpeedEvent } from "@/lib/observability/privacy";

export function VercelObservability() {
  return (
    <>
      <Analytics beforeSend={sanitiseAnalyticsEvent} />
      <SpeedInsights beforeSend={sanitiseSpeedEvent} />
    </>
  );
}
