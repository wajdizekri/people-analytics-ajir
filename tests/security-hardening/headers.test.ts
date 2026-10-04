import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

// Point 1 : en-têtes posés par next.config.ts (en plus de Caddy en production).
async function headersFor(env: "production" | "development"): Promise<{ source: string; h: Record<string, string> }> {
  vi.stubEnv("NODE_ENV", env);
  const rules = await nextConfig.headers!();
  expect(rules).toHaveLength(1);
  return { source: rules[0].source, h: Object.fromEntries(rules[0].headers.map((x) => [x.key, x.value])) };
}

function csp(value: string): Record<string, string[]> {
  return Object.fromEntries(
    value
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((p) => p[0])
      .map(([name, ...src]) => [name, src]),
  );
}

afterEach(() => vi.unstubAllEnvs());

describe("en-têtes de sécurité", () => {
  it("production : CSP, HSTS, Permissions-Policy, COOP sur toutes les routes ; en-têtes historiques conservés", async () => {
    const { source, h } = await headersFor("production");
    expect(source).toBe("/:path*");
    expect(h).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "same-origin",
      "Strict-Transport-Security": "max-age=31536000",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    for (const f of ["camera", "microphone", "geolocation", "payment", "usb"]) expect(h["Permissions-Policy"]).toContain(`${f}=()`);
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("CSP compatible Next.js sans nonce, sans 'unsafe-eval' en production, et restrictive ailleurs", async () => {
    const d = csp((await headersFor("production")).h["Content-Security-Policy"]);
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d["img-src"]).toEqual(["'self'", "data:"]);
    expect(d["connect-src"]).toEqual(["'self'"]);
    expect(d["frame-ancestors"]).toEqual(["'self'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    const all = Object.values(d).flat();
    expect(all.some((s) => s === "*" || /^https?:/.test(s))).toBe(false);
  });

  it("ECharts reste compatible : rendu canvas (aucune origine externe), styles en ligne des infobulles, export d'image en data:", async () => {
    const d = csp((await headersFor("production")).h["Content-Security-Policy"]);
    expect(d["style-src"]).toContain("'unsafe-inline'");
    expect(d["img-src"]).toContain("data:");
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/components/charts/echart.tsx", "utf8");
    expect(src).not.toMatch(/renderer:\s*["']svg["']|https?:\/\//);
  });

  it("développement : pas de HSTS, 'unsafe-eval' autorisé pour React", async () => {
    const { h } = await headersFor("development");
    expect(h["Strict-Transport-Security"]).toBeUndefined();
    expect(csp(h["Content-Security-Policy"])["script-src"]).toContain("'unsafe-eval'");
  });
});
