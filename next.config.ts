import type { NextConfig } from "next";

// CSP sans nonce : Next.js (App Router) injecte des scripts en ligne, React et ECharts des styles en ligne.
// ECharts dessine sur <canvas> (aucune ressource externe) ; export d'image éventuel en data:. 'unsafe-eval' en
// développement seulement (React reconstruit les piles d'erreurs serveur). Même politique que deploy/caddy/Caddyfile.
function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR permet des builds isolés (tests E2E, sécurité) sans conflit sur .next/
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2", "pino"],
  poweredByHeader: false,
  async headers() {
    const production = process.env.NODE_ENV === "production";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy(!production) },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // HSTS : production seulement (ignoré par les navigateurs en HTTP, mais jamais émis en développement)
          ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
