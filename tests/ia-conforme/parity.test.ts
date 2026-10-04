import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conformalInterval, readConformal, type ConformalInfo } from "@/lib/ai/conformal";
import { forecastUnit, validateBundle as validateAbs, type AbsBundle } from "@/lib/ai/absenteeism/model";
import { predictGroup, validateBundle as validateLoad, type WorkloadBundle, type WorkloadScope } from "@/lib/ai/workload/model";
import { project, type EffectifBundle, type MasseBundle, type Projection, type Scenario, type WorkforceState } from "@/lib/ai/workforce/engine";
import type { Golden as AbsGolden } from "../ai/absenteeism/helpers";
import { conformalDir, readJson, type ParityCase } from "./helpers";

// Versions calibrées produites par ml/<sujet>/conformal.py : parité Python ↔ TypeScript des bornes (golden.json) et du
// calcul des quantiles (conformal_parity.json), cohérence des fenêtres, version source intacte.

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const parityOf = (dir: string) => readJson<{ conformal_parity: ParityCase[] }>(path.join(dir, "conformal_parity.json")).conformal_parity;

function checkInfo(info: ConformalInfo, keys: string[]) {
  expect(info.level).toBe(0.8);
  // fenêtre de calibration entièrement antérieure aux mois de test (aucune fuite)
  expect(info.calibration.targets[1] < info.test.targets[0]).toBe(true);
  expect(info.test.months).toBeGreaterThanOrEqual(12);
  for (const k of keys) {
    const c = info.coverage[k];
    expect(c, k).toBeDefined();
    expect(c.months).toBeGreaterThan(0);
    expect(c.from >= info.test.targets[0] && c.to <= info.test.targets[1]).toBe(true);
    expect(c.coverage!).toBeGreaterThanOrEqual(0);
    expect(c.coverage!).toBeLessThanOrEqual(1);
    expect(c.target).toBe(0.8);
    expect(c.n).toBeGreaterThan(0);
  }
}

function checkParity(cases: ParityCase[], quantileOf?: (c: ParityCase) => [number, number] | undefined) {
  expect(cases.length).toBeGreaterThan(0);
  for (const c of cases) {
    const iv = conformalInterval(c.scores, c.level);
    expect(iv).not.toBeNull();
    expect(near(iv![0], c.interval[0], 1e-15) && near(iv![1], c.interval[1], 1e-15)).toBe(true);
    const q = quantileOf?.(c);
    if (q) expect(near(q[0], c.interval[0], 1e-15) && near(q[1], c.interval[1], 1e-15)).toBe(true);
  }
}

function sourceUntouched(dir: string, source: string | undefined) {
  expect(source).toBeTruthy();
  const src = path.join(path.dirname(dir), source!, "model.json");
  expect(fs.existsSync(src)).toBe(true);
  expect(readJson<{ conformal?: unknown }>(src).conformal).toBeUndefined();
}

const absDir = conformalDir("absenteeism", "abs-");
describe("version calibrée ABSENTEISME", () => {
  it("existe dans models/absenteeism (ml/absenteeism/conformal.py)", () => expect(absDir).toBeTruthy());
  describe.skipIf(!absDir)("contenu", () => {
    const load = () => ({
      b: readJson<AbsBundle & { conformal: ConformalInfo & NonNullable<AbsBundle["conformal"]> }>(path.join(absDir!, "model.json")),
      golden: readJson<AbsGolden>(path.join(absDir!, "golden.json")),
    });

    it("bornes conformes identiques à 1e-9 sur les cas golden", () => {
      const { b, golden } = load();
      expect(() => validateAbs(b)).not.toThrow();
      let maxErr = 0;
      for (const c of golden.cases) {
        const f = forecastUnit(b, c.h, c.scope, c.own, c.parent, c.company, c.cal_t, c.cal_t12);
        maxErr = Math.max(maxErr, Math.abs(f.value - c.value), Math.abs(f.lower - c.lower), Math.abs(f.upper - c.upper));
        expect(f.lower).toBeLessThanOrEqual(f.value);
        expect(f.value).toBeLessThanOrEqual(f.upper);
      }
      expect(maxErr).toBeLessThan(1e-9);
    });

    it("quantiles recalculés en TypeScript sur les scores de calibration, fenêtres et version source", () => {
      const { b } = load();
      checkParity(parityOf(absDir!), (c) => b.conformal.quantiles[c.scope as "ENTREPRISE"]?.[String(c.h)]);
      for (const scope of ["ENTREPRISE", "DEPARTEMENT", "EQUIPE"] as const)
        for (const h of b.horizons) expect(b.conformal.quantiles[scope]?.[String(h)], `${scope} h=${h}`).toBeDefined();
      checkInfo(b.conformal, ["ENTREPRISE", "DEPARTEMENT", "EQUIPE"]);
      sourceUntouched(absDir!, b.conformal.source_version);
      expect(readConformal("absenteeism", b.version)?.coverage.EQUIPE.n).toBe(b.conformal.coverage.EQUIPE!.n);
    });
  });
});

type LoadRow = { scope: WorkloadScope; h: number; x: number[]; zbar12: number; s: number | null; value: number; lower: number; upper: number };
const loadDir = conformalDir("workload", "workload-");
describe("version calibrée CHARGE_TRAVAIL", () => {
  it("existe dans models/workload (ml/workload/conformal.py)", () => expect(loadDir).toBeTruthy());
  describe.skipIf(!loadDir)("contenu", () => {
    const load = () => ({
      b: readJson<WorkloadBundle & { conformal: ConformalInfo & NonNullable<WorkloadBundle["conformal"]> }>(path.join(loadDir!, "model.json")),
      rows: readJson<{ rows: LoadRow[] }>(path.join(loadDir!, "golden.json")).rows,
    });

    it("reproduit les 200 prévisions et bornes du golden à 1e-9", () => {
      const { b, rows } = load();
      expect(() => validateLoad(b)).not.toThrow();
      expect(rows.length).toBe(200);
      let max = 0;
      for (const r of rows) {
        const p = predictGroup(b, r.scope, r.h, r.x, r.zbar12, r.s);
        max = Math.max(max, Math.abs(p.value - r.value), Math.abs(p.lower - r.lower), Math.abs(p.upper - r.upper));
        expect(p.lower).toBeLessThanOrEqual(p.value);
        expect(p.value).toBeLessThanOrEqual(p.upper);
      }
      expect(max).toBeLessThan(1e-9);
    });

    it("quantiles recalculés en TypeScript sur les scores de calibration, fenêtres et version source", () => {
      const { b } = load();
      checkParity(parityOf(loadDir!), (c) => b.conformal.quantiles[c.scope as WorkloadScope]?.[String(c.h)]);
      checkInfo(b.conformal, ["EQUIPE", "DEPARTEMENT"]);
      sourceUntouched(loadDir!, b.conformal.source_version);
    });
  });
});

type WfGolden = { bundles: { EFFECTIF: string; MASSE_SALARIALE: string }; state: WorkforceState; scenario: Scenario; output: Projection };
function diffs(a: unknown, b: unknown, at = "$", out: string[] = []): string[] {
  if (typeof b === "number" && typeof a === "number") {
    if (!near(a, b)) out.push(`${at}: ${a} ≠ ${b}`);
  } else if (Array.isArray(b)) {
    if (!Array.isArray(a) || a.length !== b.length) out.push(`${at}: longueur`);
    else b.forEach((v, i) => diffs(a[i], v, `${at}[${i}]`, out));
  } else if (b && typeof b === "object") {
    if (!a || typeof a !== "object") out.push(`${at}: objet attendu`);
    else for (const k of Object.keys(b)) diffs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`, out);
  } else if (a !== b) out.push(`${at}: ${String(a)} ≠ ${String(b)}`);
  return out;
}

const eDir = conformalDir("workforce", "effectif-");
const mDir = conformalDir("workforce", "masse-");
describe("versions calibrées EFFECTIF et MASSE_SALARIALE", () => {
  it("existent dans models/workforce (ml/workforce/conformal.py)", () => {
    expect(eDir).toBeTruthy();
    expect(mDir).toBeTruthy();
  });
  describe.skipIf(!eDir || !mDir)("contenu", () => {
    const load = () => ({
      be: readJson<EffectifBundle & { conformal: ConformalInfo & NonNullable<EffectifBundle["conformal"]> }>(path.join(eDir!, "model.json")),
      bm: readJson<MasseBundle & { conformal: ConformalInfo & NonNullable<MasseBundle["conformal"]> }>(path.join(mDir!, "model.json")),
    });

    it("appariées, golden reproduit à 1e-9 avec les bornes conformes", () => {
      const { be, bm } = load();
      expect(bm.effectif_version).toBe(be.version);
      for (const dir of [eDir!, mDir!]) {
        const golden = readJson<WfGolden[]>(path.join(dir, "golden.json"));
        expect(golden.length).toBeGreaterThanOrEqual(10);
        for (const [i, g] of golden.entries()) {
          expect(g.bundles).toEqual({ EFFECTIF: be.version, MASSE_SALARIALE: bm.version });
          expect(diffs(project(be, bm, g.state, g.scenario), g.output, `cas ${i}`)).toEqual([]);
        }
      }
    });

    it("quantiles par horizon : contiennent 0 et s'élargissent avec l'horizon", () => {
      const { be, bm } = load();
      for (const b of [be, bm])
        for (const byLevel of Object.values(b.conformal.quantiles))
          for (const q of [byLevel!.dept, byLevel!.total]) {
            expect(q).toHaveLength(be.horizon);
            q.forEach(([lo, hi], i) => {
              expect(lo).toBeLessThanOrEqual(0);
              expect(hi).toBeGreaterThanOrEqual(0);
              if (i > 0) expect(lo <= q[i - 1][0] && hi >= q[i - 1][1]).toBe(true);
            });
          }
    });

    it("quantiles recalculés en TypeScript, fenêtres et versions source", () => {
      const { be, bm } = load();
      checkParity(parityOf(eDir!));
      checkParity(parityOf(mDir!));
      for (const b of [be, bm]) {
        checkInfo(b.conformal, ["TAUX:total", "TAUX:dept"]);
        sourceUntouched(b === be ? eDir! : mDir!, b.conformal.source_version);
      }
    });
  });
});
