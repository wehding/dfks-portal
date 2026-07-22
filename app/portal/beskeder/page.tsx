import { redirect } from "next/navigation";

// Beskeder er integreret i Overblik (/portal). Denne side består kun som
// redirect, så gamle mail-links (?thread=...) stadig virker.
export default async function LegacyBeskederRedirect({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { thread } = await searchParams;
  redirect(thread ? `/portal?thread=${encodeURIComponent(thread)}` : "/portal");
}
