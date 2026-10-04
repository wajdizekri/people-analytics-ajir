import type Database from "better-sqlite3";
import { addDays, isWorkday, monthEnd, monthsBetween, monthStart } from "@/lib/calendar";
import { setSetting } from "@/lib/settings";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Effectif, entrées, sorties et turnover : contrats de travail seulement (CDI, CDD), hors stages et SIVP.
// Début du premier CDI/CDD (au plus tôt l'embauche) ; NULL si seulement stage ou SIVP ; embauche si aucun contrat connu.
export const workStartSql = (a: string) => `(CASE
  WHEN NOT EXISTS (SELECT 1 FROM contract c WHERE c.employee_id = ${a}.id) THEN ${a}.hire_date
  ELSE MAX(${a}.hire_date, (SELECT MIN(c.start_date) FROM contract c WHERE c.employee_id = ${a}.id AND c.type IN ('CDI','CDD'))) END)`;

// Mois couverts par les données : du premier pointage / paie au mois de data_end_date (à défaut, du dernier fait connu).
// data_end_date borne la fin : une ligne source datée par erreur dans le futur n'étend pas la période.
export function dataMonths(sqlite: Database.Database): string[] {
  const r = sqlite
    .prepare(
      `SELECT MIN(m) AS first, MAX(m) AS last,
         (SELECT substr(value, 1, 7) FROM app_setting WHERE key = 'data_end_date' AND value <> '') AS endMonth
       FROM (
         SELECT substr(MIN(date), 1, 7) AS m FROM attendance_daily UNION ALL SELECT substr(MAX(date), 1, 7) FROM attendance_daily
         UNION ALL SELECT MIN(month) FROM payroll_monthly UNION ALL SELECT MAX(month) FROM payroll_monthly
       ) WHERE m IS NOT NULL`,
    )
    .get() as { first: string | null; last: string | null; endMonth: string | null };
  const last = r.endMonth && MONTH_RE.test(r.endMonth) ? r.endMonth : r.last;
  const first = r.first ?? last;
  if (!first || !last || first > last) return [];
  return monthsBetween(first, last);
}

// Recalcule agg_kpi_monthly par mois x département (département à la date de référence du mois, reconstitué
// depuis les MUTATION). Calcul en SQL agrégé dans des tables temporaires, puis remplacement en une transaction.
export function refreshAggregates(sqlite: Database.Database, months?: string[]): number {
  const list = [...new Set(months ?? dataMonths(sqlite))].sort();
  if (!list.length) return 0;
  for (const m of list) if (!MONTH_RE.test(m)) throw new Error(`Mois invalide : ${m}`);
  const from = monthStart(list[0]);
  const to = monthEnd(list[list.length - 1]);

  sqlite.exec(`
    DROP TABLE IF EXISTS temp.agg_month; DROP TABLE IF EXISTS temp.agg_cal; DROP TABLE IF EXISTS temp.agg_dept_period; DROP TABLE IF EXISTS temp.agg_ws;
    DROP TABLE IF EXISTS temp.agg_em; DROP TABLE IF EXISTS temp.agg_att; DROP TABLE IF EXISTS temp.agg_abs; DROP TABLE IF EXISTS temp.agg_trn;
    DROP TABLE IF EXISTS temp.agg_out;
    CREATE TEMP TABLE agg_month (month TEXT PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL);
    CREATE TEMP TABLE agg_cal (date TEXT PRIMARY KEY, cum INTEGER NOT NULL);
  `);
  const insMonth = sqlite.prepare("INSERT INTO agg_month VALUES (?, ?, ?)");
  for (const m of list) insMonth.run(m, monthStart(m), monthEnd(m));

  // Jours ouvrés cumulés depuis le début de la période (lundi-vendredi hors fériés de dim_date, ponts ouvrés ; calendrier
  // tunisien calculé si dim_date ne couvre pas le jour) : mêmes jours que workingDays du tableau de bord détaillé.
  const dim = new Map(
    (sqlite.prepare("SELECT date, (is_weekend = 0 AND is_holiday = 0) AS w FROM dim_date WHERE date BETWEEN ? AND ?").all(from, to) as { date: string; w: number }[]).map(
      (r) => [r.date, r.w === 1],
    ),
  );
  const insCal = sqlite.prepare("INSERT INTO agg_cal VALUES (?, ?)");
  sqlite.transaction(() => {
    let cum = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (dim.get(d) ?? isWorkday(d)) cum++;
      insCal.run(d, cum);
    }
  })();

  sqlite.exec(`
    CREATE TEMP TABLE agg_dept_period AS
    WITH mut AS (
      SELECT ce.employee_id, ce.date, dold.id AS old_id, dnew.id AS new_id,
             ROW_NUMBER() OVER (PARTITION BY ce.employee_id ORDER BY ce.date, ce.id) AS rn,
             LEAD(ce.date) OVER (PARTITION BY ce.employee_id ORDER BY ce.date, ce.id) AS next_date
      FROM career_event ce
      LEFT JOIN department dold ON dold.code = ce.old_value
      LEFT JOIN department dnew ON dnew.code = ce.new_value
      WHERE ce.type = 'MUTATION'
    )
    SELECT e.id AS employee_id, '0000-00-00' AS from_date, COALESCE(m.date, '9999-12-31') AS to_date,
           COALESCE(m.old_id, e.department_id) AS department_id
    FROM employee e LEFT JOIN mut m ON m.employee_id = e.id AND m.rn = 1
    UNION ALL
    SELECT m.employee_id, m.date, COALESCE(m.next_date, '9999-12-31'), COALESCE(m.new_id, e.department_id)
    FROM mut m JOIN employee e ON e.id = m.employee_id;
    CREATE INDEX temp.agg_dept_period_idx ON agg_dept_period (employee_id, from_date);

    CREATE TEMP TABLE agg_ws AS
    SELECT e.id AS employee_id, ${workStartSql("e")} AS work_start FROM employee e;
    CREATE UNIQUE INDEX temp.agg_ws_idx ON agg_ws (employee_id);

    CREATE TEMP TABLE agg_em AS
    SELECT x.employee_id, x.month, x.start, x.end, x.hire_date, x.exit_date, x.voluntary,
           (SELECT cb.cum FROM agg_cal cb WHERE cb.date = MIN(x.end, COALESCE(x.exit_date, x.end)))
             - COALESCE((SELECT ca.cum FROM agg_cal ca WHERE ca.date = date(MAX(x.start, x.hire_date), '-1 day')), 0) AS workable,
           CASE WHEN x.work_start IS NOT NULL AND (x.exit_date IS NULL OR x.work_start <= x.exit_date) THEN x.work_start END AS work_start,
           (SELECT p.department_id FROM agg_dept_period p
             WHERE p.employee_id = x.employee_id AND p.from_date <= x.ref AND x.ref < p.to_date
             ORDER BY p.from_date DESC LIMIT 1) AS department_id
    FROM (
      SELECT e.id AS employee_id, m.month, m.start, m.end, e.hire_date, e.exit_date, ws.work_start,
             CASE WHEN e.exit_date IS NOT NULL AND e.exit_date < m.end THEN e.exit_date ELSE m.end END AS ref,
             EXISTS (SELECT 1 FROM exit_event x WHERE x.employee_id = e.id AND x.reason IN ('DEMISSION','ABANDON')) AS voluntary
      FROM employee e JOIN agg_month m ON e.hire_date <= m.end AND (e.exit_date IS NULL OR e.exit_date >= m.start)
      JOIN agg_ws ws ON ws.employee_id = e.id
    ) x;
    CREATE UNIQUE INDEX temp.agg_em_idx ON agg_em (employee_id, month);
  `);

  const range = { from, to, fromMonth: list[0], toMonth: list[list.length - 1] };
  sqlite
    .prepare(
      `CREATE TEMP TABLE agg_att AS
       SELECT employee_id, substr(date, 1, 7) AS month, SUM(late_minutes > 0) AS late_count, SUM(overtime_minutes) / 60.0 AS overtime_hours
       FROM attendance_daily WHERE date BETWEEN @from AND @to GROUP BY employee_id, substr(date, 1, 7)`,
    )
    .run(range);

  // Jours d'absence ventilés par mois au prorata des jours ouvrés de l'épisode (jours calendaires si aucun).
  sqlite
    .prepare(
      `CREATE TEMP TABLE agg_abs AS
       WITH ep AS (
         SELECT id, employee_id, start_date, end_date, days, is_health FROM absence_episode
         WHERE category <> 'CONGE_ANNUEL' AND end_date >= @from AND start_date <= @to
       ),
       per AS (
         SELECT ep.id, substr(d.date, 1, 7) AS month, SUM(d.is_weekend = 0 AND d.is_holiday = 0) AS wd, COUNT(*) AS cd
         FROM ep JOIN dim_date d ON d.date BETWEEN ep.start_date AND ep.end_date GROUP BY ep.id, substr(d.date, 1, 7)
       ),
       tot AS (SELECT id, SUM(wd) AS twd, SUM(cd) AS tcd FROM per GROUP BY id),
       share AS (
         SELECT ep.employee_id, per.month, ep.is_health,
                ep.days * CASE WHEN tot.twd > 0 THEN per.wd * 1.0 / tot.twd ELSE per.cd * 1.0 / tot.tcd END AS days
         FROM ep JOIN per ON per.id = ep.id JOIN tot ON tot.id = ep.id
       )
       SELECT employee_id, month, SUM(CASE WHEN is_health = 0 THEN days ELSE 0 END) AS non_health,
              SUM(CASE WHEN is_health = 1 THEN days ELSE 0 END) AS health
       FROM share WHERE month BETWEEN @fromMonth AND @toMonth GROUP BY employee_id, month`,
    )
    .run(range);

  // Heures : formations terminées, au mois de fin. Obligatoires : échéances du mois (due) et, parmi elles, les terminées
  // (done), comme computeMonthlyRows de la vue détaillée.
  sqlite
    .prepare(
      `CREATE TEMP TABLE agg_trn AS
       SELECT employee_id, month, SUM(hours) AS hours, SUM(done) AS done, SUM(due) AS due FROM (
         SELECT employee_id, substr(COALESCE(end_date, start_date), 1, 7) AS month, hours, 0 AS done, 0 AS due
         FROM training WHERE status = 'TERMINEE' AND COALESCE(end_date, start_date) BETWEEN @from AND @to
         UNION ALL
         SELECT employee_id, substr(due_date, 1, 7), 0, status = 'TERMINEE', 1
         FROM training WHERE mandatory = 1 AND due_date BETWEEN @from AND @to
       ) GROUP BY employee_id, month`,
    )
    .run(range);

  sqlite.exec(`
    CREATE TEMP TABLE agg_out AS
    SELECT em.month, em.department_id,
      COALESCE(SUM(em.work_start <= em.end AND (em.exit_date IS NULL OR em.exit_date > em.end)), 0) AS headcount,
      COALESCE(SUM(em.work_start BETWEEN em.start AND em.end), 0) AS entries,
      COALESCE(SUM(em.work_start IS NOT NULL AND em.exit_date IS NOT NULL AND em.exit_date <= em.end), 0) AS exits,
      COALESCE(SUM(em.work_start IS NOT NULL AND em.exit_date IS NOT NULL AND em.exit_date <= em.end AND em.voluntary), 0) AS voluntary_exits,
      COALESCE(SUM(ab.non_health), 0) AS absence_days_non_health,
      COALESCE(SUM(ab.health), 0) AS absence_days_health,
      SUM(em.workable) AS workable_days,
      COALESCE(SUM(a.late_count), 0) AS late_count,
      COALESCE(SUM(a.overtime_hours), 0) AS overtime_hours,
      COALESCE(SUM(p.gross_salary), 0) AS payroll_mass,
      COALESCE(SUM(t.hours), 0) AS training_hours,
      COALESCE(SUM(t.done), 0) AS trainings_done,
      COALESCE(SUM(t.due), 0) AS trainings_due
    FROM agg_em em
    LEFT JOIN agg_att a ON a.employee_id = em.employee_id AND a.month = em.month
    LEFT JOIN agg_abs ab ON ab.employee_id = em.employee_id AND ab.month = em.month
    LEFT JOIN payroll_monthly p ON p.employee_id = em.employee_id AND p.month = em.month
    LEFT JOIN agg_trn t ON t.employee_id = em.employee_id AND t.month = em.month
    WHERE em.department_id IS NOT NULL
    GROUP BY em.month, em.department_id;
  `);

  let written = 0;
  sqlite.transaction(() => {
    sqlite.exec("DELETE FROM agg_kpi_monthly WHERE month IN (SELECT month FROM agg_month)");
    written = sqlite
      .prepare(
        `INSERT INTO agg_kpi_monthly (month, department_id, headcount, entries, exits, voluntary_exits, absence_days_non_health,
           absence_days_health, workable_days, late_count, overtime_hours, payroll_mass, training_hours, trainings_done, trainings_due)
         SELECT month, department_id, headcount, entries, exits, voluntary_exits, ROUND(absence_days_non_health, 4),
           ROUND(absence_days_health, 4), workable_days, late_count, ROUND(overtime_hours, 4), ROUND(payroll_mass, 3),
           training_hours, trainings_done, trainings_due FROM agg_out`,
      )
      .run().changes;
    setSetting(sqlite, "aggregates_refreshed_at", new Date().toISOString());
  })();
  sqlite.exec(`
    DROP TABLE temp.agg_month; DROP TABLE temp.agg_cal; DROP TABLE temp.agg_dept_period; DROP TABLE temp.agg_ws; DROP TABLE temp.agg_em;
    DROP TABLE temp.agg_att; DROP TABLE temp.agg_abs; DROP TABLE temp.agg_trn; DROP TABLE temp.agg_out;
  `);
  return written;
}
