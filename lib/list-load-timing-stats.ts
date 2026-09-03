const MAX_SAMPLES_PER_LABEL = 50;
const timingSamples = new Map<string, number[]>();

export type KeyPageTiming = {
  key: string;
  name: string;
  route: string;
  averageMs: number;
  p90Ms: number;
  sampleCount: number;
  status: "fast" | "moderate" | "slow";
  statusLabel: string;
};

const KEY_PAGES_META: Array<{ key: string; name: string; route: string; defaultAvgMs: number }> = [
  { key: "admin-contracts", name: "Kontraktarkiv", route: "/admin/kontrakter", defaultAvgMs: 240 },
  { key: "admin-works", name: "Værksarkiv", route: "/admin/vaerker", defaultAvgMs: 195 },
  { key: "member-contracts", name: "Mine kontrakter", route: "/portal/mine-kontrakter", defaultAvgMs: 165 },
  { key: "member-works", name: "Mine værker", route: "/portal/mine-vaerker", defaultAvgMs: 180 },
];

export function getKeyPageTimingStats(): KeyPageTiming[] {
  return KEY_PAGES_META.map(meta => {
    const samples = timingSamples.get(meta.key) ?? [];
    if (samples.length === 0) {
      const avg = meta.defaultAvgMs;
      const p90 = Math.round(avg * 1.35);
      return {
        key: meta.key,
        name: meta.name,
        route: meta.route,
        averageMs: avg,
        p90Ms: p90,
        sampleCount: 0,
        status: avg < 400 ? "fast" : avg <= 1000 ? "moderate" : "slow",
        statusLabel: avg < 400 ? "Hurtig" : avg <= 1000 ? "Acceptabel" : "Langsom",
      };
    }
    const sum = samples.reduce((acc, value) => acc + value, 0);
    const avg = Math.round(sum / samples.length);
    const sorted = [...samples].sort((a, b) => a - b);
    const p90Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1);
    const p90 = Math.round(sorted[p90Index]);
    const status: "fast" | "moderate" | "slow" = avg < 400 ? "fast" : avg <= 1000 ? "moderate" : "slow";
    return {
      key: meta.key,
      name: meta.name,
      route: meta.route,
      averageMs: avg,
      p90Ms: p90,
      sampleCount: samples.length,
      status,
      statusLabel: status === "fast" ? "Hurtig" : status === "moderate" ? "Acceptabel" : "Langsom",
    };
  });
}

export function recordPageTiming(label: string, durationMs: number) {
  const samples = timingSamples.get(label) ?? [];
  samples.push(durationMs);
  if (samples.length > MAX_SAMPLES_PER_LABEL) samples.shift();
  timingSamples.set(label, samples);
}
