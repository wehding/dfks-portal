import type { NextConfig } from "next";

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
      ],
    }];
  },
};

export default nextConfig;
