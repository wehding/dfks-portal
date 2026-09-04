const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_TOKEN_RE = /^[A-Za-z0-9_-]{16,}$/;
const NUMBER_RE = /^\d+$/;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const UUID_IN_TEXT_RE = /\b[0-9a-f]{8}-[0-9a-f-]{27,36}\b/gi;
const TOKEN_IN_TEXT_RE = /\b(?:eyJ[A-Za-z0-9._-]+|[A-Za-z0-9_-]{32,})\b/g;

const ALLOWED_SPEED_ROUTES = new Set([
  "/",
  "/portal",
  "/portal/mine-kontrakter",
  "/portal/mine-vaerker",
  "/admin/kontrakter",
  "/admin/vaerker",
  "/admin/kontraktgennemgang",
  "/admin/producenter",
  "/admin/organisation",
]);

export function normalizeRoute(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const parsed = new URL(input, "https://dfks.invalid");
    const parts = parsed.pathname.split("/").filter(Boolean).map(part => {
      if (UUID_RE.test(part) || NUMBER_RE.test(part) || LONG_TOKEN_RE.test(part)) return "[id]";
      return part.slice(0, 80);
    });
    return `/${parts.join("/")}` || "/";
  } catch {
    return null;
  }
}

export function sanitiseAnalyticsEvent<T extends { url: string }>(event: T): T | null {
  const route = normalizeRoute(event.url);
  if (!route) return null;
  try {
    const parsed = new URL(event.url);
    return { ...event, url: `${parsed.origin}${route}` };
  } catch {
    return { ...event, url: route };
  }
}

export function sanitiseSpeedEvent<T extends { url: string }>(event: T): T | null {
  const route = normalizeRoute(event.url);
  if (!route || !ALLOWED_SPEED_ROUTES.has(route)) return null;
  try {
    const parsed = new URL(event.url);
    return { ...event, url: `${parsed.origin}${route}` };
  } catch {
    return { ...event, url: route };
  }
}

export function sanitiseRuntimeMessage(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(EMAIL_RE, "[email]")
    .replace(UUID_IN_TEXT_RE, "[id]")
    .replace(TOKEN_IN_TEXT_RE, "[token]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 300);
}

export function isAllowedSpeedRoute(route: string): boolean {
  return ALLOWED_SPEED_ROUTES.has(route);
}
