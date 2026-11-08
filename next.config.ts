import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Supabase JS 在 Edge / Node 下都不需要额外 polyfill
  serverExternalPackages: [],
  async headers() {
    return [
      {
        // Service Worker 必须每次校验，否则更新永远不生效
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), notifications=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
