import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { predictGroup, validateBundle, type WorkloadBundle, type WorkloadScope } from "@/lib/ai/workload/model";
import { FEATURES, groupRows, groupSeries, loadPanel } from "@/lib/ai/workload/panel";
import { latestBundleDir } from "./setup";

type GoldenRow = { scope: WorkloadScope; h: number; x: number[]; zbar12: number; s: number | null; value: number; lower: number; upper: number };
type GoldenFeature = { scope: WorkloadScope; key: number; h: number; n: number; x: number[]; zbar12: number; s: number | null; I12: number };
type Golden = { rows: GoldenRow[]; features: { as_of: string; groups: GoldenFeature[] } };

const dir = latestBundleDir();
const bundle = JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8")) as WorkloadBundle;
const golden = JSON.parse(fs.readFileSync(path.join(dir, "golden.json"), "utf8")) as Golden;

describe("bundle charge de travail", () => {
  it("est complet et suit le contrat des variables TypeScript", () => {
    expect(() => validateBundle(bundle)).not.toThrow();
    expect(bundle.features).toEqual([...FEATURES]);
    expect(bundle.horizons).toEqual([1, 2, 3]);
    expect(bundle.interval.level).toBe(0.8);
    expect(bundle.tension.threshold_h).toBeGreaterThan(0);
  });

  it("reproduit les 200 prévisions du golden Python à 1e-9 près", () => {
    expect(golden.rows.length).toBe(200);
    let max = 0;
    for (const r of golden.rows) {
      const p = predictGroup(bundle, r.scope, r.h, r.x, r.zbar12, r.s);
      max = Math.max(max, Math.abs(p.value - r.value), Math.abs(p.lower - r.lower), Math.abs(p.upper - r.upper));
      expect(p.lower).toBeLessThanOrEqual(p.value);
      expect(p.value).toBeLessThanOrEqual(p.upper);
    }
    expect(max).toBeLessThan(1e-9);
  });

  it("utilise l'échelle de bruit par défaut quand le groupe n'en a pas", () => {
    const r = golden.rows[0];
    const a = predictGroup(bundle, r.scope, r.h, r.x, r.zbar12, null);
    const b = predictGroup(bundle, r.scope, r.h, r.x, r.zbar12, bundle.interval.s_default[r.scope]);
    expect(a).toEqual(b);
  });
});

// Parité des variables calculées depuis la base (Python features.py vs panel.ts) : base d'entraînement du bundle,
// longue à charger, donc seulement si WORKLOAD_PARITY_DB est défini (ex. data/dev-ai-load.db).
const parityDb = process.env.WORKLOAD_PARITY_DB;
describe.skipIf(!parityDb || !fs.existsSync(parityDb))("parité des variables sur la base d'entraînement", () => {
  it("recalcule en TypeScript les variables de la dernière origine à 1e-9 près", () => {
    const sqlite = new Database(parityDb!, { readonly: true });
    try {
      const panel = loadPanel(sqlite, golden.features.as_of.slice(0, 7))!;
      const dept = groupSeries(panel, "DEPARTEMENT");
      const rows = [...groupRows(panel, "EQUIPE", dept).rows, ...groupRows(panel, "DEPARTEMENT", dept).rows];
      const ts = new Map(rows.map((r) => [`${r.scope}:${r.key}:${r.h}`, r]));
      expect(rows.length).toBe(golden.features.groups.length);
      let max = 0;
      for (const py of golden.features.groups) {
        const r = ts.get(`${py.scope}:${py.key}:${py.h}`);
        expect(r, `${py.scope} ${py.key} h=${py.h}`).toBeDefined();
        expect(r!.n).toBe(py.n);
        expect(r!.s == null).toBe(py.s == null);
        max = Math.max(max, ...py.x.map((v, j) => Math.abs(v - r!.x[j])), Math.abs(py.zbar12 - r!.zbar12), Math.abs((py.s ?? 0) - (r!.s ?? 0)), Math.abs(py.I12 - r!.I12));
      }
      expect(max).toBeLessThan(1e-9);
    } finally {
      sqlite.close();
    }
  });
});
