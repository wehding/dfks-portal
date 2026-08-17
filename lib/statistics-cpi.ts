import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { parseStatisticsCpiCsv } from "@/lib/statistics-cpi-parser";

const DST_CPI_URL = "https://api.statbank.dk/v1/data/PRIS01/CSV?VAREGR=000000&ENHED=100&Tid=*";

export type AnnualCpi = { year: number; index: number; latestPeriod: string };

async function fetchStatisticsCpiRows() {
  const response = await fetch(DST_CPI_URL, {
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Danmarks Statistik svarede med ${response.status}.`);
  const rows = parseStatisticsCpiCsv(await response.text());
  if (!rows.length) throw new Error("PRIS01 returnerede ingen brugbare indeksværdier.");
  return rows;
}

function annualCpiFromMonthly(rows: Awaited<ReturnType<typeof fetchStatisticsCpiRows>>): AnnualCpi[] {
  const byYear = new Map<number, typeof rows>();
  for (const row of rows) {
    const year = Number(row.period_month.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), row]);
  }
  return [...byYear.entries()].map(([year, months]) => ({
    year,
    index: Math.round(months.reduce((sum, row) => sum + row.index_value, 0) / months.length * 100) / 100,
    latestPeriod: months.map(row => row.period_month).sort().at(-1) ?? `${year}-01-01`,
  })).sort((left, right) => left.year - right.year);
}

export async function syncStatisticsCpi() {
  const rows = await fetchStatisticsCpiRows();
  const db = createServiceClient();
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await db.rpc("upsert_statistics_cpi", {
      p_rows: rows.slice(index, index + 500).map(row => ({
        period_month: row.period_month,
        index_value: row.index_value,
        source_updated_at: row.source_updated_at,
      })),
    });
    if (error) throw new Error(error.message);
  }
  return { count: rows.length, latest: rows.at(-1)?.period_month ?? null, source: "PRIS01" };
}

export async function getAnnualCpi(): Promise<AnnualCpi[]> {
  const { data, error } = await createServiceClient().rpc("get_statistics_annual_cpi");
  if (!error && data?.length) {
    const rows = data as Array<{ year: number | string; index_value: number | string; latest_period: string }>;
    return rows.map(row => ({
      year: Number(row.year),
      index: Number(row.index_value),
      latestPeriod: String(row.latest_period),
    }));
  }
  // Driftssikker fallback: en manglende/ny migration eller en tom privat tabel
  // må ikke gøre lønstatistikken ubrugelig. Der hentes kun officielle,
  // aggregerede PRIS01-indeks; ingen portaldata forlader serveren.
  return annualCpiFromMonthly(await fetchStatisticsCpiRows());
}

export async function getLatestStatisticsCpiPeriod() {
  const annual = await getAnnualCpi();
  return annual.map(row => row.latestPeriod).filter(Boolean).sort().at(-1) ?? null;
}
