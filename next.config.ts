import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad para todas las rutas. Sin iframes (el panel admin tiene
 * botones destructivos que no deben poder montarse en otra página), sin
 * adivinar tipos MIME y sin mandar la ruta completa a sitios externos.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
