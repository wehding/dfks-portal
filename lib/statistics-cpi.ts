import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

const DST_CPI_URL = "https://api.statbank.dk/v1/data/PRIS01/CSV?VAREGR=000000&ENHED=100&Tid=*";

function csvCells(line: string) {
  return line.split(";").map(cell => cell.replace(/^"|"$/g, "").replaceAll('""', '"'));
}

export async function syncStatisticsCpi() {
  const response = await fetch(DST_CPI_URL, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Danmarks Statistik svarede med ${response.status}.`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  const rows = lines.slice(1).flatMap(line => {
    const cells = csvCells(line);
    const period = cells.find(cell => /^\d{4}M\d{2}$/.test(cell));
    const rawValue = cells.at(-1)?.replace(".", "").replace(",", ".");
    const value = Number(rawValue);
    if (!period || !Number.isFinite(value)) return [];
    const [year, month] = period.split("M").map(Number);
    return [{
      period_month: `${year}-${String(month).padStart(2, "0")}-01`,
      index_value: value,
      source: "Danmarks Statistik PRIS01",
      source_updated_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    }];
  });
  if (!rows.length) throw new Error("PRIS01 returnerede ingen brugbare indeksværdier.");
  const db = createServiceClient().schema("analytics");
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await db.from("cpi_monthly").upsert(rows.slice(index, index + 500), { onConflict: "period_month" });
    if (error) throw new Error(error.message);
  }
  return { count: rows.length, latest: rows.at(-1)?.period_month ?? null, source: "PRIS01" };
}

export async function getAnnualCpi() {
  const { data, error } = await createServiceClient().schema("analytics").from("cpi_monthly")
    .select("period_month,index_value").order("period_month");
  if (error) throw new Error(error.message);
  const groups = new Map<number, number[]>();
  for (const row of data ?? []) {
    const year = Number(String(row.period_month).slice(0, 4));
    groups.set(year, [...(groups.get(year) ?? []), Number(row.index_value)]);
  }
  return [...groups.entries()].map(([year, values]) => ({
    year,
    index: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100,
  }));
}
