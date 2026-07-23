import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["canvas"],
  // Lokal udvikling tilgås også fra telefonen via denne Tailscale-adresse.
  // Indstillingen påvirker kun Next.js' development server.
  allowedDevOrigins: ["100.112.99.59"],
};

export default nextConfig;
