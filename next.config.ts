import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        source: "/offline.html",
        headers: [
          { key: "X-Courant-Public-Offline", value: "1" },
          { key: "Cache-Control", value: "no-store" },
          { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
        ],
      },
      {
        source: "/offline-request.html",
        headers: [
          { key: "X-Courant-Public-Request", value: "1" },
          { key: "Cache-Control", value: "no-store" },
          { key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
        ],
      },
      {
        source: "/offline-request.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "X-Courant-Public-Draft-Script", value: "1" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      // Private responses must not enter HTTP caches, even outside service-worker control.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/auth/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default config;
