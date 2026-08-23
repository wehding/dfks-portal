"use client";

import { useEffect } from "react";

export function ListReadinessMarker({ route, stage }: { route: string; stage: "access" | "primary" | "first-row" | "secondary" | "complete" }) {
  const mark = `dfks:${route}:${stage}`;
  useEffect(() => {
    performance.mark(mark);
    window.dispatchEvent(new CustomEvent("dfks-performance-ready", { detail: { route, stage } }));
  }, [mark, route, stage]);
  return <span hidden data-performance-route={route} data-performance-ready={stage} />;
}
