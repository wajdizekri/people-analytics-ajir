import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { openSqlite } from "@/db/client";
import { FEATURES, features, forecastUnit, validateBundle } from "@/lib/ai/absenteeism/model";
import { AbsCalendar, activeAt, computeSeries, loadOrg, mEnd, mi, parentOf } from "@/lib/ai/absenteeism/series";
import { DEV_DB, latestBundleDir, loadBundleDir } from "./helpers";

const dir = latestBundleDir();

describe.skipIf(!dir)("parité Python / TypeScript du bundle ABSENTEISME", () => {
  const { bundle, golden } = loadBundleDir(dir!);

  it("bundle conforme au contrat de variables", () => {
    expect(() => validateBundle(bundle)).not.toThrow();
    expect(bundle.features).toEqual([...FEATURES]);
    expect(golden.cases.length).toBeGreaterThanOrEqual(200);
  });

  it("variables, prévision et bornes identiques à 1e-9 sur les cas golden", () => {
    let maxErr = 0;
    for (const c of golden.cases) {
      const x = features(c.h, c.scope, c.own, c.parent, c.company, c.cal_t, c.cal_t12);
      x.forEach((v, j) => (maxErr = Math.max(maxErr, Math.abs(v - c.x[j]))));
      const f = forecastUnit(bundle, c.h, c.scope, c.own, c.parent, c.company, c.cal_t, c.cal_t12);
      maxErr = Math.max(maxErr, Math.abs(f.value - c.value), Math.abs(f.lower - c.lower), Math.abs(f.upper - c.upper));
    }
    expect(maxErr).toBeLessThan(1e-9);
  });

  // Séries reconstruites en TypeScript sur la base d'entraînement (copie locale) : mêmes unités, mêmes valeurs qu'en Python.
  it.skipIf(!fs.existsSync(DEV_DB))("séries et prévisions au dernier mois identiques sur la base d'entraînement", () => {
    const sqlite = openSqlite(DEV_DB, { readonly: true });
    try {
      const org = loadOrg(sqlite);
      const cal = AbsCalendar.load(sqlite);
      const o = mi(golden.series.as_of.slice(0, 7));
      const series = computeSeries(sqlite, org, cal, o - 11, o, mEnd(o) + bundle.visibility_lag_days);
      const active = activeAt(org, mEnd(o));
      const eligible = [...active.entries()].filter(([u, n]) => n >= bundle.min_group && (series.get(u)?.den[11] ?? 0) > 0).map(([u]) => u).sort();
      expect(eligible).toEqual(Object.keys(golden.series.units).sort());
      let maxErr = 0;
      for (const [u, g] of Object.entries(golden.series.units)) {
        const s = series.get(u)!;
        expect(parentOf(org, u, mEnd(o))).toBe(g.parent_unit);
        s.num.forEach((v, k) => (maxErr = Math.max(maxErr, Math.abs(v - g.own[0][k]))));
        expect(s.den).toEqual(g.own[1]);
      }
      expect(maxErr).toBeLessThan(1e-9);
      for (const f of golden.series.forecasts.slice(0, 60)) {
        const own = series.get(f.unit)!;
        const p = series.get(parentOf(org, f.unit, mEnd(o)))!;
        const e = series.get("E")!;
        const scope = f.unit === "E" ? "ENTREPRISE" : f.unit.startsWith("D") ? "DEPARTEMENT" : "EQUIPE";
        const r = forecastUnit(bundle, f.h, scope, [own.num, own.den], [p.num, p.den], [e.num, e.den], cal.monthFeatures(o + f.h), cal.monthFeatures(o + f.h - 12));
        expect(Math.abs(r.value - f.value)).toBeLessThan(1e-9);
      }
    } finally {
      sqlite.close();
    }
  });
});
