import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content Security Policy.
 *
 * `script-src` allows the measurement hosts the storefront may load (Meta and TikTok
 * pixels) and the inline bootstrap Next.js requires in the App Router. A nonce based
 * policy would be stricter but needs an edge hook; until then the policy still blocks
 * unknown third parties, object embeds and framing.
 *
 * `'unsafe-eval'` is added in development only: the Next.js dev overlay and React
 * Refresh reconstruct call stacks with `eval()`, and without it the browser logs
 * "eval() is not supported in this environment" on every page. Production builds never
 * call `eval()`, so the relaxation is not shipped.
 */
/**
 * Storage origins the browser may upload to / download from.
 *
 * Media uploads PUT directly to presigned S3 URLs, so `connect-src` must cover
 * the configured storage. Both the exact origin (path-style URLs) and its
 * subdomains (virtual-hosted-style `bucket.host` URLs) are allowlisted. Local
 * development with `STORAGE_DRIVER=local` needs nothing extra (`'self'`).
 */
function storageConnectSources(): string[] {
  const sources = new Set<string>();
  for (const value of [process.env.S3_ENDPOINT, process.env.S3_PUBLIC_BASE_URL]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      sources.add(url.origin);
      sources.add(`${url.protocol}//*.${url.hostname}`);
    } catch {
      // Invalid URLs are reported by env validation at runtime; ignore here.
    }
  }
  return [...sources];
}

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://connect.facebook.net https://analytics.tiktok.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  ["connect-src 'self'", ...storageConnectSources(), "https://connect.facebook.net https://analytics.tiktok.com"].join(" "),
  "frame-src https://www.facebook.com https://td.doubleclick.net https://www.youtube.com https://player.vimeo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "bcryptjs", "pdfkit", "exceljs"],
  experimental: {
    // The generated Prisma client is TypeScript; it must run on the server only.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  images: {
    remotePatterns: [
      // Public media is served from S3-compatible object storage. Exact hosts
      // are configured through S3_PUBLIC_BASE_URL / next.config environment.
      { protocol: "https", hostname: "**" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Never cache authenticated areas publicly.
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
