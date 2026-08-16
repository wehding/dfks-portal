function csvCells(line: string) {
  return line.split(";").map(cell => cell.replace(/^"|"$/g, "").replaceAll('""', '"'));
}

export function parseStatisticsCpiCsv(csv: string) {
  return csv.trim().replace(/^\uFEFF/, "").split(/\r?\n/).slice(1).flatMap(line => {
    const cells = csvCells(line);
    const period = cells.find(cell => /^\d{4}M\d{2}$/.test(cell));
    const rawValue = cells.at(-1)?.replaceAll(".", "").replace(",", ".");
    const value = Number(rawValue);
    if (!period || !Number.isFinite(value) || value <= 0) return [];
    const [year, month] = period.split("M").map(Number);
    return [{
      period_month: `${year}-${String(month).padStart(2, "0")}-01`,
      index_value: value,
      source_updated_at: new Date().toISOString(),
    }];
  });
}
