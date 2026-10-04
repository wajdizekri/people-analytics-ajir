import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { project, type EffectifBundle, type MasseBundle, type Projection, type Scenario, type WorkforceState } from "@/lib/ai/workforce/engine";
import { buildState } from "@/lib/ai/workforce/state";

const ROOT = path.resolve(process.cwd(), "models", "workforce");
const latest = (prefix: string) =>
  fs
    .readdirSync(ROOT)
    .filter((d) => d.startsWith(prefix) && fs.existsSync(path.join(ROOT, d, "model.json")))
    .sort()
    .at(-1)!;
const read = <T>(dir: string, file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, dir, file), "utf8")) as T;

const eDir = latest("effectif-");
const mDir = latest("masse-");
const be = read<EffectifBundle>(eDir, "model.json");
const bm = read<MasseBundle>(mDir, "model.json");
type Golden = { bundles: { EFFECTIF: string; MASSE_SALARIALE: string }; state: WorkforceState; scenario: Scenario; output: Projection };

// Écart relatif (absolu sous 1) : même tolérance que le scorer turnover
function diffs(a: unknown, b: unknown, at = "$", out: string[] = []): string[] {
  if (typeof b === "number" && typeof a === "number") {
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b))) out.push(`${at}: ${a} ≠ ${b}`);
  } else if (Array.isArray(b)) {
    if (!Array.isArray(a) || a.length !== b.length) out.push(`${at}: longueur`);
    else b.forEach((v, i) => diffs(a[i], v, `${at}[${i}]`, out));
  } else if (b && typeof b === "object") {
    if (!a || typeof a !== "object") out.push(`${at}: objet attendu`);
    else for (const k of Object.keys(b)) diffs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`, out);
  } else if (a !== b) out.push(`${at}: ${String(a)} ≠ ${String(b)}`);
  return out;
}

describe("parité Python / TypeScript du moteur de projection", () => {
  for (const [label, dir] of [
    ["EFFECTIF", eDir],
    ["MASSE_SALARIALE", mDir],
  ] as const) {
    it(`golden ${label} (${dir}) reproduit à 1e-9`, () => {
      const golden = read<Golden[]>(dir, "golden.json");
      expect(golden.length).toBeGreaterThanOrEqual(10);
      for (const [i, g] of golden.entries()) {
        expect(g.bundles.EFFECTIF).toBe(be.version);
        expect(g.bundles.MASSE_SALARIALE).toBe(bm.version);
        const out = project(be, bm, g.state, g.scenario);
        expect(diffs(out, g.output, `cas ${i}`)).toEqual([]);
      }
    });
  }

  it("les deux bundles sont appariés et portent des quantiles d'intervalle par horizon", () => {
    expect(bm.effectif_version).toBe(be.version);
    for (const q of [be.interval.TAUX!, bm.interval.TAUX!]) {
      expect(q.dept).toHaveLength(be.horizon);
      expect(q.total).toHaveLength(be.horizon);
      expect(q.dept.every((v, i) => i === 0 || v >= q.dept[i - 1])).toBe(true);
    }
    expect(bm.season).toHaveLength(12);
  });
});

// État + projection de référence recalculés en TypeScript sur la base utilisée par l'entraînement (si disponible)
const refDb = path.resolve(process.cwd(), "data", "dev-ai-wf.db");
type Reference = { asOf: string; state: Record<string, number>; total_hc: number[]; total_mass: number[]; dept_hc12: Record<string, number>; exits_12: Record<string, number> };
describe.skipIf(!fs.existsSync(refDb))("parité de l'état sur la base de travail", () => {
  it("TypeScript reproduit la projection de référence calculée par Python", () => {
    const ref = (be.metrics as { reference: Reference }).reference;
    const sqlite = new Database(refDb, { readonly: true });
    try {
      const { state } = buildState(sqlite, ref.asOf, be, bm, null);
      const out = project(be, bm, state, { hiringPct: 100 });
      expect(state.members).toHaveLength(ref.state.members);
      for (const k of ["qCdd", "qRet", "raise", "drift", "levelTotal"] as const) expect(state[k]).toBeCloseTo(ref.state[k], 9);
      expect(diffs(out.total.hc, ref.total_hc)).toEqual([]);
      expect(diffs(out.total.mass, ref.total_mass)).toEqual([]);
      for (const d of out.departments) expect(d.hc[d.hc.length - 1]).toBeCloseTo(ref.dept_hc12[d.code], 6);
    } finally {
      sqlite.close();
    }
  });
});
