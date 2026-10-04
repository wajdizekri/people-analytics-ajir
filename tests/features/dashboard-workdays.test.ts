import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCalendar } from "@/lib/calendar";
import { refreshAggregates } from "@/lib/aggregates";
import { _monthlyFromAggregates, _monthlyFromSources, clearDashboardCache, dashboardQuerySchema, getDashboard } from "@/lib/dal/dashboard";
import { absenceByEmployee, addDays, isoDate, monthBuckets, monthRange, toTime, type AbsenceEp, type Bucket } from "@/lib/dal/pilotage-metrics";
import { buildWorld, openDalDb, publishRun, REF } from "../fixtures/unit/dal-world";

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
beforeAll(() => {
  db = openDalDb("dashboard-workdays");
  w = buildWorld(db.sqlite);
  const { fx, dept } = w;
  // entrées et sorties en cours de mois, absences à cheval sur deux mois et sur un férié
  const mid = fx.emp({ matricule: "MID", hire: "2025-02-12", dept: dept.prod, managerId: w.e.MGR });
  const left = fx.emp({ matricule: "LEFT", hire: "2020-01-01", dept: dept.com, managerId: w.e.MGR2 });
  fx.exit(left, "2025-04-16", "DEMISSION", { resignation: "2025-03-16", recordedAt: "2025-03-17" });
  db.sqlite.prepare("UPDATE employee SET exit_date = '2025-04-16', status = 'SORTI' WHERE id = ?").run(left);
  fx.absence(mid, "2025-03-27", "2025-04-03", "ABSENCE_INJUSTIFIEE");
  fx.absence(left, "2025-03-18", "2025-03-21", "AUTRE");
  fx.absence(w.e.T2, "2025-01-30", "2025-02-04", "MALADIE");
  buildCalendar(db.sqlite, 2024, 2025);
  refreshAggregates(db.sqlite, monthRange("2024-01", "2025-06"));
  clearDashboardCache();
});
afterAll(() => db.close());

describe("jours ouvrés unifiés entre agrégats et calcul détaillé", () => {
  it("jours ouvrables proratisés par salarié (entrées et sorties en cours de mois) et absences : mêmes valeurs", () => {
    const months = monthRange("2024-07", "2025-06");
    const agg = _monthlyFromAggregates(months);
    const src = _monthlyFromSources(w.ctx.rh, {}, REF, months, true);
    for (let i = 0; i < months.length; i++)
      for (const k of ["headcount", "entries", "exits", "workableDays", "absenceDaysNonHealth", "absenceDaysHealth"] as const)
        expect(agg[i][k], `${months[i]} ${k}`).toBeCloseTo(src[i][k], 6);
    const feb = agg[months.indexOf("2025-02")];
    const apr = agg[months.indexOf("2025-04")];
    expect(feb.workableDays % 20).not.toBe(0);
    expect(apr.workableDays).toBeGreaterThan(0);
  });
});

describe("cache du tableau de bord", () => {
  const q = dashboardQuerySchema.parse({ periode: "6m" });
  const setHeadcount = (n: number) => db.sqlite.prepare("UPDATE agg_kpi_monthly SET headcount = ? WHERE month = '2025-06' AND department_id = ?").run(n, w.dept.com);
  const aggHeadcount = () => (db.sqlite.prepare("SELECT SUM(headcount) AS n FROM agg_kpi_monthly WHERE month = '2025-06'").get() as { n: number }).n;

  it("résultat servi depuis le cache tant que la version des données ne change pas ; DTO indépendants", () => {
    const first = getDashboard(w.ctx.rh, q);
    setHeadcount(999);
    const second = getDashboard(w.ctx.rh, q);
    expect(second.kpis.headcount).toBe(first.kpis.headcount);
    second.kpis.headcount = -1;
    second.series.length = 0;
    const third = getDashboard(w.ctx.rh, q);
    expect(third.kpis.headcount).toBe(first.kpis.headcount);
    expect(third.series.length).toBe(first.series.length);
  });

  it("invalidé par un import, une publication de run et un recalcul des agrégats", () => {
    setHeadcount(999);
    db.sqlite.prepare("INSERT INTO import_batch (source, status) VALUES ('export', 'OK')").run();
    expect(getDashboard(w.ctx.rh, q).kpis.headcount).toBe(aggHeadcount());

    expect(getDashboard(w.ctx.rh, q).view === "RH" && getDashboard(w.ctx.rh, q).risk).toBeNull();
    publishRun(db.sqlite, "LOGREG", REF, [{ employeeId: w.e.T1, level: "ELEVE", prob6: 0.4, lift: 5 }]);
    const withRun = getDashboard(w.ctx.rh, q);
    expect(withRun.view === "RH" && withRun.risk?.totals.ELEVE).toBe(1);

    const stale = aggHeadcount();
    refreshAggregates(db.sqlite, ["2025-06"]);
    expect(aggHeadcount()).not.toBe(stale);
    expect(getDashboard(w.ctx.rh, q).kpis.headcount).toBe(aggHeadcount());
  });

  it("clé par périmètre : un manager ne reçoit jamais l'entrée d'un autre ni celle de la RH", () => {
    const rh = getDashboard(w.ctx.rh, q);
    const mgr = getDashboard(w.ctx.mgr, q);
    const mgr2 = getDashboard(w.ctx.mgr2, q);
    expect(mgr.view).toBe("MANAGER");
    expect(mgr.kpis.headcount).not.toBe(rh.kpis.headcount);
    expect(mgr2.kpis.headcount).not.toBe(mgr.kpis.headcount);
    expect(getDashboard(w.ctx.mgr, q)).toEqual(mgr);
  });
});

// Implémentation de référence (avant optimisation) : jour par jour, isWorking interrogé pour chaque date.
function referenceAbsences(buckets: Bucket[], episodes: AbsenceEp[], isWorking: (d: string) => boolean): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const first = buckets[0].from;
  const last = buckets[buckets.length - 1].to;
  const bucketOf = (d: string) => buckets.findIndex((b) => b.from <= d && d <= b.to);
  const add = (emp: number, d: string, v: number) => {
    const k = bucketOf(d);
    if (k < 0) return;
    let arr = out.get(emp);
    if (!arr) out.set(emp, (arr = buckets.map(() => 0)));
    arr[k] += v;
  };
  for (const ep of episodes) {
    if (ep.endDate < first || ep.startDate > last) continue;
    const days: string[] = [];
    for (let t = toTime(ep.startDate); t <= toTime(ep.endDate); t += 86_400_000) if (isWorking(isoDate(t))) days.push(isoDate(t));
    if (!days.length) {
      add(ep.employeeId, ep.startDate, ep.days);
      continue;
    }
    for (const d of days) add(ep.employeeId, d, ep.days / days.length);
  }
  return out;
}

describe("ventilation des absences par seau (version optimisée)", () => {
  it("identique à l'implémentation jour par jour, épisodes à cheval sur la fenêtre compris", () => {
    const dayArb = fc.integer({ min: 0, max: 500 }).map((n) => addDays("2024-01-01", n));
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.array(fc.tuple(fc.integer({ min: 1, max: 4 }), dayArb, fc.integer({ min: 0, max: 40 }), fc.double({ min: 0.5, max: 30, noNaN: true })), { maxLength: 40 }),
        fc.integer({ min: 1, max: 1000 }),
        (nMonths, raw, seed) => {
          const buckets = monthBuckets(monthRange("2024-04", addDays("2024-04-01", 31 * (nMonths - 1)).slice(0, 7)));
          const isWorking = (d: string) => (toTime(d) / 86_400_000 + seed) % 7 < 5 && (toTime(d) / 86_400_000) % 23 !== seed % 23;
          const episodes: AbsenceEp[] = raw.map(([emp, start, len, days]) => ({
            employeeId: emp,
            startDate: start,
            endDate: addDays(start, len),
            days,
            isHealth: false,
            category: "AUTRE",
          }));
          expect(absenceByEmployee(buckets, episodes, isWorking)).toEqual(referenceAbsences(buckets, episodes, isWorking));
        },
      ),
      { numRuns: 200 },
    );
  });
});
