import type { NextConfig } from "next";

export function buildConnectSources(supabaseUrl: string | undefined): string[] {
  const sources = ["'self'", "https:"];
  if (!supabaseUrl) return sources;

  try {
    const configured = new URL(supabaseUrl);
    const isLoopback = configured.hostname === "127.0.0.1" || configured.hostname === "localhost";
    if (configured.protocol === "http:" && isLoopback) {
      sources.push(configured.origin, `ws://${configured.host}`);
    }
  } catch {
    // Environment validation reports malformed URLs. Keep the CSP closed here.
  }

  return sources;
}

const connectSources = buildConnectSources(process.env.NEXT_PUBLIC_SUPABASE_URL).join(" ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["canvas"],
  turbopack: process.env.NEXT_TURBOPACK_ROOT
    ? { root: process.env.NEXT_TURBOPACK_ROOT }
    : undefined,
  allowedDevOrigins: ["100.112.99.59"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        {
          key: "Content-Security-Policy",
          value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src ${connectSources}; frame-ancestors 'none';`,
        },
      ],
    }];
  },
};

export default nextConfig;
