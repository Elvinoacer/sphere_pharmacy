import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.STANDALONE === "true" ? { output: "standalone" } : {}),
  reactStrictMode: true,
  // The documentation portal reads the canonical corpus at build time and the
  // docs assistant re-reads it at runtime — include those files in standalone
  // output traces so the deployed server can access them.
  outputFileTracingIncludes: {
    "/docs/**": ["./docs/**/*", "./openapi/**/*", "./prisma/schema.prisma", "./README.md", "./AGENTS.md"],
    "/api/docs-index": ["./docs/**/*", "./openapi/**/*", "./prisma/schema.prisma", "./README.md", "./AGENTS.md"],
    "/api/docs-assistant": ["./docs/**/*", "./README.md", "./AGENTS.md"],
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.r2.dev https://*.cloudflarestorage.com; font-src 'self' data:; connect-src 'self'; upgrade-insecure-requests" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }]
  },
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.r2.dev",
      },
      {
        protocol: "https",
        hostname: "**.cloudflarestorage.com",
      },
    ],
  },
};

export default nextConfig;

