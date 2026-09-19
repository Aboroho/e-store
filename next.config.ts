import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// Presigned browser uploads must be permitted by CSP, without opening arbitrary connections.
const storageOrigins = new Set<string>();
for (const candidate of [process.env.S3_ENDPOINT, process.env.S3_PUBLIC_BASE_URL]) {
  if (candidate) { const url = new URL(candidate); if (["https:", "http:"].includes(url.protocol)) storageOrigins.add(url.origin); }
}
if (process.env.S3_BUCKET && /^[a-z0-9.-]+$/.test(process.env.S3_BUCKET)) {
  storageOrigins.add(`https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION ?? "us-east-1"}.amazonaws.com`);
  storageOrigins.add(`https://${process.env.S3_BUCKET}.s3.amazonaws.com`);
}

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
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://connect.facebook.net https://analytics.tiktok.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https://connect.facebook.net https://analytics.tiktok.com ${[...storageOrigins].join(" ")}`,
  `media-src 'self' blob: https: ${[...storageOrigins].join(" ")}`,
  "frame-src https://www.facebook.com https://td.doubleclick.net https://www.youtube.com https://player.vimeo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  isProduction ? "frame-ancestors 'self'" : "frame-ancestors 'self' https://arena.ai https://*.arena.ai",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  ...(isProduction ? [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] : []),
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
  allowedDevOrigins: ["*.e2b.app"],
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "bcryptjs", "pdfkit", "exceljs"],
  experimental: {
    // The generated Prisma client is TypeScript; it must run on the server only.
    serverActions: {
      bodySizeLimit: "4mb",
      ...(!isProduction ? { allowedOrigins: ["*.e2b.app"] } : {}),
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
