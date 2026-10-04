import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openTrainingsAt, TRAINING_FEATURES, type TrainingFeatures } from "@/lib/ai/training/features";
import { checkGolden, explainTraining, levelOf, parseTrainingBundle, predictTraining, toVector } from "@/lib/ai/training/model";

const DIR = path.resolve(__dirname, "../../../models/training/formation-logreg-v1-20260930");
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const bundle = parseTrainingBundle(readJson("model.json"));

const feats = (o: Partial<TrainingFeatures>): TrainingFeatures =>
  ({ ...Object.fromEntries(TRAINING_FEATURES.map((k) => [k, 0])), log_days_to_due: Math.log(60), days_to_due: 60, ...o }) as TrainingFeatures;

describe("bundle FORMATION : parité Python / TypeScript", () => {
  it("golden.json (200 lignes) reproduit à 1e-9 près", () => {
    const g = readJson("golden.json") as { x: number[]; p: number }[];
    expect(g).toHaveLength(200);
    const r = checkGolden(bundle, g);
    expect(r.maxDiff).toBeLessThan(1e-12);
    for (const row of g.slice(0, 20)) expect(predictTraining(bundle, row.x)).toBeCloseTo(row.p, 12);
  });

  it("refuse un bundle dont les paramètres de variables divergent du calcul TypeScript", () => {
    const raw = readJson("model.json");
    expect(() => parseTrainingBundle({ ...raw, feature_params: { ...raw.feature_params, horizon_days: 90 } })).toThrow(/horizon_days/);
    expect(() => parseTrainingBundle({ ...raw, coef: raw.coef.slice(1) })).toThrow(/dimensions/);
    expect(() => parseTrainingBundle({ ...raw, features: [...raw.features.slice(1), "salaire"] })).toThrow();
  });

  it("imputation par les valeurs du bundle ; niveaux par seuils de probabilité", () => {
    const x = toVector(bundle, feats({ emp_margin_days: null, team_late_rate_12m: null }));
    expect(x[bundle.features.indexOf("emp_margin_days")]).toBe(bundle.impute.emp_margin_days);
    expect(levelOf(bundle, bundle.levels.high)).toBe("ELEVE");
    expect(levelOf(bundle, bundle.levels.high - 1e-9)).toBe("MOYEN");
    expect(levelOf(bundle, bundle.levels.medium - 1e-9)).toBe("FAIBLE");
  });

  it("une échéance proche d'une formation non commencée augmente le risque ; facteurs en hausse, 3 au plus, libellés manager sans chiffre", () => {
    const near = feats({ days_to_due: 3, log_days_to_due: Math.log(3), tenure_months: 120, log_tenure: Math.log1p(120), emp_past_n: 2, emp_margin_days: -20 });
    const far = feats({ days_to_due: 110, log_days_to_due: Math.log(110), tenure_months: 120, log_tenure: Math.log1p(120) });
    const xn = toVector(bundle, near);
    expect(predictTraining(bundle, xn)).toBeGreaterThan(predictTraining(bundle, toVector(bundle, far)));
    const f = explainTraining(bundle, near, xn, 1);
    expect(f.length).toBeGreaterThan(0);
    expect(f.length).toBeLessThanOrEqual(3);
    expect(f[0]).toMatchObject({ group: "ECHEANCE", direction: "HAUSSE", phraseManager: "Échéance proche" });
    expect(f[0].phraseRh).toContain("3 jours");
    for (const x of f) {
      expect(x.contribution).toBeGreaterThan(0);
      expect(x.phraseManager).not.toMatch(/\d/);
    }
  });
});

// Parité des variables : recalcul TypeScript sur la base d'entraînement (si présente) des lignes tirées par Python.
const DB = path.resolve(__dirname, "../../../data/dev-ai-train.db");
describe.skipIf(!fs.existsSync(DB))("variables FORMATION : parité avec ml/training/panel.py (data/dev-ai-train.db)", () => {
  it("golden-features.json : mêmes valeurs à 1e-9 près, mêmes manquantes", () => {
    const all = readJson("golden-features.json") as { training_id: number; as_of: string; features: Record<string, number | null> }[];
    // 12 coupures réparties sur l'historique, dont la dernière (celle de l'inférence)
    const cuts = [...new Set(all.map((r) => r.as_of))].sort();
    const kept = new Set(cuts.filter((_, i) => i % Math.ceil(cuts.length / 11) === 0 || i === cuts.length - 1));
    const rows = all.filter((r) => kept.has(r.as_of));
    const sqlite = new Database(DB, { readonly: true, fileMustExist: true });
    try {
      const byAsOf = new Map<string, typeof rows>();
      for (const r of rows) byAsOf.set(r.as_of, [...(byAsOf.get(r.as_of) ?? []), r]);
      let checked = 0;
      for (const [asOf, list] of byAsOf) {
        const got = new Map(openTrainingsAt(sqlite, asOf, { trainingIds: new Set(list.map((r) => r.training_id)) }).map((o) => [o.id, o]));
        for (const r of list) {
          const o = got.get(r.training_id);
          expect(o, `${r.training_id} @ ${asOf}`).toBeDefined();
          for (const k of TRAINING_FEATURES) {
            const a = r.features[k];
            const b = o!.features[k];
            if (a == null || b == null) expect(b, `${k} ${r.training_id} @ ${asOf}`).toBe(a);
            else expect(Math.abs(a - b), `${k} ${r.training_id} @ ${asOf}`).toBeLessThan(1e-9);
            checked++;
          }
        }
      }
      expect(checked).toBe(rows.length * TRAINING_FEATURES.length);
    } finally {
      sqlite.close();
    }
  });
});
