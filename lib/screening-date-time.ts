const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function isValidCalendarDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function toIsoDate(year: number, month: number, day: number) {
  if (!isValidCalendarDate(year, month, day)) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseScreeningDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    if (value.getUTCFullYear() >= 1970) return value.toISOString().slice(0, 10);

    // Simply.TV eksporterer Broadcast Date med Excel-formatet [hh].mm.ss:
    // samlede timer = år, minutter = måned, sekunder = dag. ExcelJS
    // fortolker fx 2026.07.01 som 84 dage + 10:07:01 siden 1899-12-30.
    const elapsedSeconds = Math.round((value.getTime() - EXCEL_EPOCH_UTC) / 1000);
    const encodedYear = Math.floor(elapsedSeconds / 3600);
    const encodedMonth = Math.floor((elapsedSeconds % 3600) / 60);
    const encodedDay = elapsedSeconds % 60;
    if (encodedYear >= 1970 && encodedYear <= 2100) {
      return toIsoDate(encodedYear, encodedMonth, encodedDay);
    }
    return undefined;
  }

  if (typeof value === "number") {
    if (value < 25569) return undefined;
    return new Date(Math.round((value - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (!match) return undefined;
    const year = Number(match[1]);
    if (year < 1970) return undefined;
    return toIsoDate(year, Number(match[2]), Number(match[3]));
  }

  return undefined;
}

export function parseScreeningTime(value: unknown): string | undefined {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/);
    if (!match) return undefined;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] ?? 0);
    if (hours > 23 || minutes > 59 || seconds > 59) return undefined;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  if (typeof value === "number" && value >= 0 && value < 1) {
    const totalSeconds = Math.round(value * 86400) % 86400;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  if (value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}:${String(value.getUTCSeconds()).padStart(2, "0")}`;
  }

  return undefined;
}

export function formatScreeningDateTime(date?: string, time?: string) {
  const validDate = parseScreeningDate(date);
  const validTime = parseScreeningTime(time);
  const formattedDate = validDate
    ? new Intl.DateTimeFormat("da-DK", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${validDate}T00:00:00Z`))
    : "Ukendt dato";
  return validTime ? `${formattedDate} kl. ${validTime.slice(0, 5)}` : formattedDate;
}
