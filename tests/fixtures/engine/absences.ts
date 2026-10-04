import { fromDay, toDay } from "@/lib/features/dates";
import { eachDay, Fixture, isWeekday } from "./db";

export const RAMADAN_DAYS = [...eachDay("2024-03-11", "2024-04-09"), ...eachDay("2025-03-01", "2025-03-30")];
export const SPIKE_WEEKS = ["2025-05-05", "2025-05-12"];

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Deux équipes de 6 (managers M1, M2) dans un département ; absences non planifiées d'un jour tirées au hasard
// (1 % des jours, 10 % pendant le Ramadan), pic optionnel dans l'équipe 1 sur deux semaines de mai 2025.
export function buildAbsenceScenario(fx: Fixture, opts: { ramadanFlag: boolean; spike: boolean; seed?: number }) {
  const dept = fx.dept("PROD", "Production");
  const m1 = fx.emp({ matricule: "M1", hire: "2020-01-01", dept });
  const m2 = fx.emp({ matricule: "M2", hire: "2020-01-01", dept });
  const team1 = Array.from({ length: 6 }, (_, i) => fx.emp({ matricule: `T1-${i}`, hire: "2020-01-01", dept, managerId: m1 }));
  const team2 = Array.from({ length: 6 }, (_, i) => fx.emp({ matricule: `T2-${i}`, hire: "2020-01-01", dept, managerId: m2 }));
  const ramadan = new Set(RAMADAN_DAYS);
  if (opts.ramadanFlag) for (const d of RAMADAN_DAYS) fx.calendarDay(d, { ramadan: true });
  const spike = new Set(SPIKE_WEEKS.flatMap((w) => eachDay(w, fromDay(toDay(w) + 4))));
  const rnd = lcg(opts.seed ?? 7);
  const ins = fx.sqlite.prepare(
    "INSERT INTO absence_episode (employee_id, start_date, end_date, days, category, is_health, recorded_at) VALUES (?, ?, ?, 1, 'ABSENCE_INJUSTIFIEE', 0, ?)",
  );
  fx.sqlite.transaction(() => {
    for (const d of eachDay("2024-01-01", "2025-06-30")) {
      if (!isWeekday(d)) continue;
      for (const id of [m1, m2, ...team1, ...team2]) {
        const p = opts.spike && spike.has(d) && team1.includes(id) ? 0.5 : ramadan.has(d) ? 0.1 : 0.01;
        if (rnd() < p) ins.run(id, d, d, d);
      }
    }
  })();
  return { dept, m1, m2, team1, team2 };
}
