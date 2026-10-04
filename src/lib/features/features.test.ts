import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { createTestDb, Fixture, weekdaysBetween, type TestDb } from "../../../tests/fixtures/engine/db";
import { buildTeamScenario, T } from "../../../tests/fixtures/engine/scenario";
import { backfillFeatures, computeFeatures, computeFeaturesForMonth, FEATURE_INDEX as F, FEATURE_NAMES, readSnapshots } from "./index";
import { addMonths, fromDay, toDay } from "./dates";

let db: TestDb;
let fx: Fixture;
let ids: ReturnType<typeof buildTeamScenario>;

beforeAll(() => {
  db = createTestDb();
  fx = new Fixture(db.sqlite);
  ids = buildTeamScenario(fx);
});
afterAll(() => db.close());

const byName = (values: number[]) => Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, values[i]]));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

function withRollback<T>(fn: () => T): T {
  db.sqlite.exec("SAVEPOINT perturbation");
  try {
    return fn();
  } finally {
    db.sqlite.exec("ROLLBACK TO perturbation; RELEASE perturbation");
  }
}

describe("variables : exemples calculés à la main", () => {
  it("salarié A au 30/06/2025", () => {
    const r = computeFeatures(db.sqlite, ids.a, T);
    expect(r).not.toBeNull();
    const v = byName(r!.values);
    const W3 = weekdaysBetween("2025-04-01", T);
    const W12 = weekdaysBetween("2024-07-01", T);
    const n = W3 - 9;
    const p = 4 / n;
    const month = (from: string, to: string, absent: number, health: number) =>
      ((weekdaysBetween(from, to) - absent) / (weekdaysBetween(from, to) - health)) * 21.67;
    const ys = [
      month("2025-01-01", "2025-01-31", 0, 0),
      month("2025-02-01", "2025-02-28", 0, 0),
      month("2025-03-01", "2025-03-31", 0, 0),
      month("2025-04-01", "2025-04-30", 2, 0),
      month("2025-05-01", "2025-05-31", 5, 3),
      month("2025-06-01", "2025-06-30", 2, 0),
    ];
    const xs = [-5, -4, -3, -2, -1, 0];
    const my = ys.reduce((s, y) => s + y, 0) / 6;
    const slope = xs.reduce((s, x, i) => s + (x + 2.5) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x + 2.5) ** 2, 0);

    expect(r!.partial).toBe(false);
    expect(v).toEqual({
      tenure_months: 16,
      contract_cdd: 0,
      grade_level: 2,
      months_since_promotion: 16,
      job_change_12m: 1,
      compa_ratio: 0.9,
      raise_pct_12m: r6(1800 / 1700 - 1),
      months_since_raise: 6,
      overtime_h_avg_3m: r6(((W3 - 9) / (W3 - 3)) * 21.67),
      overtime_trend_6m: r6(slope),
      late_count_3m: 4,
      arrival_std_min_3m: r6(15 * Math.sqrt(p * (1 - p))),
      no_badge_days_3m: 3,
      absence_rate_3m: r6(3 / (W3 - 3)),
      absence_rate_12m: r6(8 / (W12 - 3)),
      short_episodes_12m: 2,
      bradford_12m: 72,
      training_hours_12m: 14,
      mandatory_training_overdue: 1,
      last_eval_score: 3.5,
      eval_delta: 0,
      eval_missing: 0,
      team_exit_rate_6m: 0.2,
      manager_change_12m: 0,
      team_size: 4,
    });
  });

  it("imputation et plafonds : manager sans manager, sans évaluation", () => {
    const v = byName(computeFeatures(db.sqlite, ids.m, T)!.values);
    expect(v.team_size).toBe(8);
    expect(v.team_exit_rate_6m).toBe(0);
    expect(v.last_eval_score).toBe(3);
    expect(v.eval_missing).toBe(1);
    expect(v.months_since_promotion).toBe(120);
    expect(v.months_since_raise).toBe(60);
    expect(v.compa_ratio).toBe(1);
  });

  it("éligibilité : sorti, démission posée, SIVP, CDD court, âge, arrivée récente", () => {
    expect(computeFeatures(db.sqlite, ids.d, T)).toBeNull();
    withRollback(() => {
      const sivp = fx.emp({ matricule: "S1", hire: "2024-01-01", contract: { type: "SIVP" } });
      const cddShort = fx.emp({ matricule: "S2", hire: "2024-01-01", contract: { type: "CDD", end: "2025-12-31" } });
      const cddLong = fx.emp({ matricule: "S3", hire: "2024-01-01", contract: { type: "CDD", end: "2026-01-31" } });
      const old = fx.emp({ matricule: "S4", hire: "2000-01-01", birth: "1965-11-15" });
      const young = fx.emp({ matricule: "S5", hire: "2000-01-01", birth: "1966-01-15" });
      const recent = fx.emp({ matricule: "S6", hire: "2025-06-01" });
      const resigned = fx.emp({ matricule: "S7", hire: "2020-01-01" });
      fx.exit(resigned, "2025-07-31", "DEMISSION", { resignation: "2025-06-15", recordedAt: "2025-06-16" });
      const lateResign = fx.emp({ matricule: "S8", hire: "2020-01-01" });
      fx.exit(lateResign, "2025-07-31", "DEMISSION", { resignation: "2025-06-15", recordedAt: "2025-07-02" });
      expect(computeFeatures(db.sqlite, sivp, T)).toBeNull();
      expect(computeFeatures(db.sqlite, cddShort, T)).toBeNull();
      expect(computeFeatures(db.sqlite, cddLong, T)?.values[F.contract_cdd]).toBe(1);
      expect(computeFeatures(db.sqlite, old, T)).toBeNull();
      expect(computeFeatures(db.sqlite, young, T)).not.toBeNull();
      expect(computeFeatures(db.sqlite, recent, T)).toBeNull();
      expect(computeFeatures(db.sqlite, resigned, T)).toBeNull();
      expect(computeFeatures(db.sqlite, lateResign, T)).not.toBeNull();
    });
  });

  it("étiquette y6 cohérente avec l'éligibilité as-of : démission posée mais saisie après t = 1", () => {
    withRollback(() => {
      const unknown = fx.emp({ matricule: "L1", hire: "2020-01-01" });
      fx.exit(unknown, "2025-07-20", "DEMISSION", { recordedAt: "2025-07-25" });
      const unknownWithDate = fx.emp({ matricule: "L2", hire: "2020-01-01" });
      fx.exit(unknownWithDate, "2025-08-10", "ABANDON", { resignation: "2025-06-10", recordedAt: "2025-07-01" });
      const future = fx.emp({ matricule: "L3", hire: "2020-01-01" });
      fx.exit(future, "2025-09-15", "DEMISSION", { recordedAt: "2025-09-15" });
      const cdd = fx.emp({ matricule: "L4", hire: "2020-01-01" });
      fx.exit(cdd, "2025-07-20", "FIN_CDD", { recordedAt: "2025-07-25" });
      const late = fx.emp({ matricule: "L5", hire: "2020-01-01" });
      fx.exit(late, "2026-02-15", "DEMISSION", { resignation: "2025-06-01", recordedAt: "2025-07-02" });
      for (const id of [unknown, unknownWithDate, future, cdd, late]) expect(computeFeatures(db.sqlite, id, T)).not.toBeNull();
      backfillFeatures(db.sqlite, "2025-06", "2025-06");
      const y6 = (id: number) => (db.sqlite.prepare("SELECT y6 FROM v_label_panel WHERE employee_id = ? AND as_of = ?").get(id, T) as { y6: number }).y6;
      expect([unknown, unknownWithDate, future, cdd, late].map(y6)).toEqual([1, 1, 1, 0, 0]);
    });
  });
});

describe("variables : troncature", () => {
  it("fenêtres tronquées à l'embauche et partial_history", () => {
    const r = computeFeatures(db.sqlite, ids.e, T)!;
    const v = byName(r.values);
    expect(r.partial).toBe(true);
    expect(v.tenure_months).toBe(3);
    expect(v.no_badge_days_3m).toBe(1);
    expect(v.absence_rate_12m).toBe(r6(1 / weekdaysBetween("2025-03-10", T)));
    expect(v.absence_rate_3m).toBe(r6(1 / weekdaysBetween("2025-04-01", T)));
    expect(v.compa_ratio).toBe(1);
  });

  it("fenêtres tronquées au début des données de pointage", () => {
    const r = computeFeatures(db.sqlite, ids.b, "2024-03-31")!;
    expect(r.partial).toBe(true);
    expect(r.values[F.no_badge_days_3m]).toBe(0);
  });
});

describe("variables : santé exclue", () => {
  it("un arrêt maladie équivaut à retirer ces jours de la fenêtre", () => {
    const days = ["2025-05-19", "2025-05-20", "2025-05-21"];
    const sick = computeFeatures(db.sqlite, ids.a, T)!.values;
    const asHoliday = withRollback(() => {
      db.sqlite.prepare("DELETE FROM absence_episode WHERE employee_id = ? AND category = 'MALADIE'").run(ids.a);
      for (const d of days) fx.calendarDay(d, { holiday: true });
      return computeFeatures(db.sqlite, ids.a, T)!.values;
    });
    expect(sick).toEqual(asHoliday);
  });

  it("propriété : épisodes maladie/maternité aléatoires (fast-check)", () => {
    const winStart = toDay("2024-07-01");
    const winEnd = toDay(T);
    const busy = new Set(
      (db.sqlite.prepare("SELECT start_date AS s, end_date AS e FROM absence_episode WHERE employee_id = ?").all(ids.a) as { s: string; e: string }[]).flatMap(
        (r) => Array.from({ length: toDay(r.e) - toDay(r.s) + 1 }, (_, i) => toDay(r.s) + i),
      ),
    );
    fc.assert(
      fc.property(
        fc.array(fc.record({ start: fc.integer({ min: winStart, max: winEnd }), len: fc.integer({ min: 1, max: 12 }), mat: fc.boolean() }), {
          minLength: 1,
          maxLength: 3,
        }),
        (eps) => {
          const spans = eps
            .map((e) => ({ ...e, end: Math.min(e.start + e.len - 1, winEnd) }))
            .filter((e) => Array.from({ length: e.end - e.start + 1 }, (_, i) => e.start + i).every((d) => !busy.has(d)));
          if (!spans.length) return;
          const clear = () => {
            for (const s of spans)
              db.sqlite.prepare("DELETE FROM attendance_daily WHERE employee_id = ? AND date BETWEEN ? AND ?").run(ids.a, fromDay(s.start), fromDay(s.end));
          };
          const withHealth = withRollback(() => {
            clear();
            for (const s of spans) fx.absence(ids.a, fromDay(s.start), fromDay(s.end), s.mat ? "MATERNITE" : "MALADIE", fromDay(s.start));
            return computeFeatures(db.sqlite, ids.a, T)!.values;
          });
          const withHolidays = withRollback(() => {
            clear();
            for (const s of spans) for (let d = s.start; d <= s.end; d++) fx.calendarDay(fromDay(d), { holiday: true });
            return computeFeatures(db.sqlite, ids.a, T)!.values;
          });
          const h = byName(withHealth);
          const k = byName(withHolidays);
          for (const name of ["absence_rate_3m", "absence_rate_12m", "short_episodes_12m", "bradford_12m", "no_badge_days_3m", "late_count_3m"])
            expect(h[name]).toBe(k[name]);
          expect(h.overtime_h_avg_3m).toBeCloseTo(k.overtime_h_avg_3m, 6);
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("variables : anti-fuite par perturbation (fast-check)", () => {
  const after = (base: string, days: number) => fromDay(toDay(base) + days);

  it("ajouter des lignes datées ou saisies après t ne change aucune variable", () => {
    const baseline = computeFeaturesForMonth(db.sqlite, T);
    expect(baseline.length).toBeGreaterThanOrEqual(5);
    const empIds = [ids.m, ids.a, ids.b, ids.c, ids.d, ids.e];
    const gradeAtT: Record<number, string> = { [ids.m]: "G5", [ids.a]: "G2", [ids.b]: "G2", [ids.c]: "G2", [ids.d]: "G2", [ids.e]: "G1" };
    const mgrAtT: Record<number, string | null> = { [ids.m]: null, [ids.a]: "M1", [ids.b]: "M1", [ids.c]: "M1", [ids.d]: "M1", [ids.e]: "M1" };
    const emp = fc.integer({ min: 0, max: empIds.length - 1 }).map((i) => empIds[i]);
    const future = fc.integer({ min: 1, max: 400 });
    const past = fc.integer({ min: 0, max: 500 });
    const lag = fc.integer({ min: 1, max: 90 });
    const categories = fc.constantFrom("CONGE_ANNUEL", "MALADIE", "MATERNITE", "ABSENCE_INJUSTIFIEE", "CONGE_SANS_SOLDE", "AUTRE");

    const op = fc.oneof(
      fc.record({ k: fc.constant("att"), e: emp, d: future, ot: fc.integer({ min: 0, max: 300 }) }),
      fc.record({ k: fc.constant("absFuture"), e: emp, d: future, len: fc.integer({ min: 0, max: 20 }), c: categories }),
      fc.record({ k: fc.constant("absLate"), e: emp, d: past, len: fc.integer({ min: 0, max: 20 }), c: categories, lag }),
      fc.record({ k: fc.constant("pay"), e: emp, m: fc.integer({ min: 1, max: 12 }), base: fc.integer({ min: 500, max: 9000 }) }),
      fc.record({ k: fc.constant("payLate"), e: emp, m: fc.integer({ min: 0, max: 30 }), base: fc.integer({ min: 500, max: 9000 }), lag }),
      fc.record({ k: fc.constant("eval"), e: emp, d: future, s: fc.integer({ min: 1, max: 5 }) }),
      fc.record({ k: fc.constant("evalLate"), e: emp, d: past, s: fc.integer({ min: 1, max: 5 }), lag }),
      fc.record({ k: fc.constant("career"), e: emp, d: future, late: fc.boolean(), lag, t: fc.constantFrom("AUGMENTATION", "CHANGEMENT_POSTE", "PROMOTION", "CHANGEMENT_MANAGER", "MUTATION") }),
      fc.record({ k: fc.constant("careerLate"), e: emp, d: past, lag, t: fc.constantFrom("AUGMENTATION", "CHANGEMENT_POSTE", "PROMOTION", "CHANGEMENT_MANAGER", "MUTATION") }),
      fc.record({ k: fc.constant("exit"), e: emp, d: future, r: fc.constantFrom("DEMISSION", "ABANDON", "LICENCIEMENT", "RETRAITE") }),
      fc.record({ k: fc.constant("exitLate"), e: emp, d: past, lag, r: fc.constantFrom("DEMISSION", "ABANDON", "LICENCIEMENT") }),
      fc.record({ k: fc.constant("training"), e: emp, d: future, mandatory: fc.boolean(), s: fc.constantFrom("PLANIFIEE", "EN_COURS", "TERMINEE", "ABANDONNEE") }),
      fc.record({ k: fc.constant("contract"), e: emp, d: future, t: fc.constantFrom("CDI", "CDD", "SIVP") }),
      fc.record({ k: fc.constant("hire"), d: future, mgr: fc.boolean() }),
    );

    let seq = 0;
    const apply = (o: Record<string, unknown> & { k: string }) => {
      const e = o.e as number;
      switch (o.k) {
        case "att":
          db.sqlite.prepare("INSERT OR IGNORE INTO attendance_daily (employee_id, date, check_in, overtime_minutes, late_minutes) VALUES (?, ?, '07:00', ?, 30)").run(e, after(T, o.d as number), o.ot);
          break;
        case "absFuture": {
          const s = after(T, o.d as number);
          fx.absence(e, s, after(s, o.len as number), o.c as string, after(s, 1), 1 + (o.len as number));
          break;
        }
        case "absLate": {
          const s = after(T, -(o.d as number));
          fx.absence(e, s, after(s, o.len as number), o.c as string, after(T, o.lag as number), 1 + (o.len as number));
          break;
        }
        case "pay":
          db.sqlite.prepare("INSERT OR IGNORE INTO payroll_monthly (employee_id, month, base_salary, gross_salary, recorded_at) VALUES (?, ?, ?, ?, ?)").run(e, addMonths(T, o.m as number).slice(0, 7), o.base, o.base, after(T, 40 * (o.m as number)));
          break;
        case "payLate":
          db.sqlite.prepare("INSERT OR IGNORE INTO payroll_monthly (employee_id, month, base_salary, gross_salary, recorded_at) VALUES (?, ?, ?, ?, ?)").run(e, addMonths(T, -(o.m as number)).slice(0, 7), o.base, o.base, after(T, o.lag as number));
          break;
        case "eval":
          fx.evaluation(e, after(T, o.d as number), o.s as number, after(T, (o.d as number) + 3));
          break;
        case "evalLate":
          fx.evaluation(e, after(T, -(o.d as number)), o.s as number, after(T, o.lag as number));
          break;
        case "career":
        case "careerLate": {
          const date = o.k === "career" ? after(T, o.d as number) : after(T, -(o.d as number));
          const rec = o.k === "career" ? after(date, o.late ? (o.lag as number) : 0) : after(T, o.lag as number);
          const t = o.t as string;
          const [oldV, newV] =
            t === "PROMOTION" ? [gradeAtT[e], "G7"] : t === "CHANGEMENT_MANAGER" ? [mgrAtT[e], "C1"] : t === "AUGMENTATION" ? ["1000", "5000"] : ["X", "Y"];
          fx.career(e, date, t, oldV, newV, rec);
          break;
        }
        case "exit":
          db.sqlite.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, resignation_date, recorded_at) VALUES (?, ?, ?, ?, ?)").run(e, after(T, o.d as number), o.r, after(T, Math.max(1, (o.d as number) - 20)), after(T, o.d as number));
          break;
        case "exitLate":
          db.sqlite.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, recorded_at) VALUES (?, ?, ?, ?)").run(e, after(T, -(o.d as number)), o.r, after(T, o.lag as number));
          break;
        case "training": {
          const s = after(T, o.d as number);
          fx.training(e, { status: o.s as string, mandatory: o.mandatory as boolean, start: s, end: after(s, 3), due: after(s, 30), hours: 20 });
          break;
        }
        case "contract":
          db.sqlite.prepare("INSERT INTO contract (employee_id, type, start_date, end_date) VALUES (?, ?, ?, ?)").run(e, o.t, after(T, o.d as number), after(T, 30));
          break;
        case "hire":
          fx.emp({ matricule: `N${++seq}`, hire: after(T, o.d as number), managerId: o.mgr ? ids.m : null });
          break;
      }
    };

    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 8 }), (ops) => {
        const perturbed = withRollback(() => {
          for (const o of ops) apply(o as Record<string, unknown> & { k: string });
          return computeFeaturesForMonth(db.sqlite, T);
        });
        expect(perturbed).toEqual(baseline);
      }),
      { numRuns: 60 },
    );
  });

  it("calcul individuel = calcul par lot = backfill", () => {
    const batch = computeFeaturesForMonth(db.sqlite, T);
    for (const r of batch) expect(computeFeatures(db.sqlite, r.employeeId, T)).toEqual({ values: r.values, partial: r.partial });
    withRollback(() => {
      const n = backfillFeatures(db.sqlite, "2025-01", "2025-06");
      expect(n).toBeGreaterThan(0);
      expect(readSnapshots(db.sqlite, T)).toEqual(batch);
    });
  });
});
