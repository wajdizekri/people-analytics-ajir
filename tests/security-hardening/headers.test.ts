import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

// Point 1 : en-têtes posés par next.config.ts (en plus de Caddy en production).
async function headersFor(env: "production" | "development"): Promise<{ source: string; h: Record<string, string> }> {
  vi.stubEnv("NODE_ENV", env);
  const rules = await nextConfig.headers!();
  expect(rules.map((r) => r.source)).toEqual(["/:path*", "/powerbi"]);
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
    expect(d["frame-src"]).toEqual(["'self'", "https://app.powerbi.com"]);
    const all = Object.entries(d)
      .filter(([k]) => k !== "frame-src")
      .flatMap(([, v]) => v);
    expect(all.some((s) => s === "*" || /^https?:/.test(s))).toBe(false);
  });

  it("Power BI : Report Server sur site ajouté à frame-src s'il est déclaré en https, ignoré sinon ; COOP assoupli sur /powerbi seulement", async () => {
    vi.stubEnv("POWERBI_REPORT_SERVER_ORIGIN", "https://bi.ajir.local:8443/");
    expect(csp((await headersFor("production")).h["Content-Security-Policy"])["frame-src"]).toEqual(["'self'", "https://app.powerbi.com", "https://bi.ajir.local:8443"]);
    for (const bad of ["http://bi.ajir.local", "https://bi.ajir.local/reports", "*", "https://a.b 'unsafe-inline'"]) {
      vi.stubEnv("POWERBI_REPORT_SERVER_ORIGIN", bad);
      expect(csp((await headersFor("production")).h["Content-Security-Policy"])["frame-src"], bad).toEqual(["'self'", "https://app.powerbi.com"]);
    }
    const rules = await nextConfig.headers!();
    const pbi = rules.find((r) => r.source === "/powerbi")!;
    expect(pbi.headers).toEqual([{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }]);
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
