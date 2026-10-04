import path from "node:path";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openSqlite, dbPath } from "../src/db/client";
import { seedDefaultSettings, setSetting } from "../src/lib/settings";
import { hashPassword } from "../src/lib/auth/password";
import {
  addDays,
  computeMonthlyRows,
  isWeekend,
  monthEnd,
  monthRange,
  workingDayFn,
  type AbsenceEp,
} from "../src/lib/dal/pilotage-metrics";
import features from "../shared/features.json";

// Jeu de démonstration des écrans de pilotage.
// Usage : DATABASE_PATH=data/dev-ui-pilotage.db npx tsx scripts/seed-dev-ui.ts [--echelle N]

export const DATA_END = "2026-08-31";
const FIRST_MONTH = "2025-03";
const LAST_MONTH = "2026-08";
const HISTORY_START = "2024-09-01";
export const DEMO_PASSWORDS = { rh: "DemoRh2026", manager: "DemoMgr2026" };

type Group = keyof typeof features.groups;
const GROUPS = Object.keys(features.groups) as Group[];
const ACTIONABLE: Partial<Record<Group, string>> = {
  REMUNERATION: "REVISION_SALARIALE",
  TEMPS_TRAVAIL: "CHARGE_TRAVAIL",
  FORMATION_EVAL: "PLAN_FORMATION",
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MALE = ["Ahmed", "Mohamed", "Amine", "Youssef", "Karim", "Sami", "Hichem", "Walid", "Nabil", "Mehdi", "Oussema", "Skander", "Firas", "Bilel", "Rami", "Anis", "Hamza", "Slim"];
const FEMALE = ["Amira", "Fatma", "Ines", "Salma", "Nour", "Rim", "Sonia", "Olfa", "Leila", "Mariem", "Ons", "Asma", "Hela", "Khaoula", "Sirine", "Yasmine", "Emna", "Wafa"];
const LAST = ["Ben Ali", "Trabelsi", "Jebali", "Gharbi", "Mansouri", "Hammami", "Chaabane", "Ayari", "Ferchichi", "Dridi", "Sassi", "Mejri", "Ben Salah", "Khelifi", "Zouari", "Baccouche", "Kammoun", "Masmoudi", "Ellouze", "Chebbi", "Haddad", "Belhaj", "Jlassi", "Riahi"];

const DEPTS = [
  { code: "PROD", name: "Production", family: "Production", head: "Responsable de production", lead: "Chef d'équipe production", staff: ["Opérateur de production", "Technicien de maintenance", "Contrôleur qualité"], direct: "Assistante de production", teams: [6, 6], directN: 1 },
  { code: "COM", name: "Commercial", family: "Commercial", head: "Directeur commercial", lead: "Chef des ventes", staff: ["Commercial terrain", "Chargée de clientèle"], direct: "Assistante commerciale", teams: [6], directN: 4 },
  { code: "SI", name: "Systèmes d'information", family: "Informatique", head: "Responsable des systèmes d'information", lead: "Chef de projet", staff: ["Développeur", "Administrateur systèmes"], direct: "Analyste support", teams: [5], directN: 5 },
];

const BASE_BY_GRADE: Record<string, number> = { G2: 1050, G3: 1350, G4: 1750, G5: 2300, G6: 2900, G7: 3900 };
const HOLIDAYS = ["01-01", "01-14", "03-20", "04-09", "05-01", "07-25", "08-13", "10-15", "12-17"];

type Emp = {
  key: string;
  id: number;
  matricule: string;
  sex: "F" | "M";
  firstName: string;
  lastName: string;
  birthDate: string;
  hireDate: string;
  dept: number;
  deptCode: string;
  jobFamily: string;
  jobTitle: string;
  grade: string;
  managerKey: string | null;
  managerId: number | null;
  contract: "CDI" | "CDD" | "SIVP";
  cddEnd: string | null;
  exitDate: string | null;
  exitReason: string | null;
  risk: number;
  base: number;
  raise: number;
};

export type SeedResult = {
  employees: number;
  managerEmployeeId: number;
  rhUserId: number;
  managerUserId: number;
  currentRunId: number;
  runs: number;
  predictions: number;
};

const TABLES_TO_RESET = [
  "prediction_factor",
  "recommendation",
  "intervention",
  "prediction",
  "scoring_run",
  "model_version",
  "anomaly",
  "alert",
  "feature_snapshot",
  "agg_kpi_monthly",
  "training",
  "evaluation",
  "career_event",
  "absence_episode",
  "payroll_monthly",
  "attendance_daily",
  "exit_event",
  "contract",
  "employee",
  "department",
  "dim_date",
];

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const fmtNum = (v: number, digits = 0) => v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function phraseRh(group: Group, feature: string, value: number): string {
  const def = features.features.find((f) => f.name === feature)!;
  const txt = def.label.replace("{pct}", `${fmtNum(value * 100)} %`).replace("{v}", fmtNum(value, Number.isInteger(value) ? 0 : 1));
  return `${features.groups[group].label_rh} : ${txt}`;
}

export async function seedDevUi(sqlite: Database.Database, opts: { scale?: number; seed?: number } = {}): Promise<SeedResult> {
  const scale = Math.max(1, Math.floor(opts.scale ?? 1));
  const rand = rng(opts.seed ?? 20260831);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const between = (a: number, b: number) => a + rand() * (b - a);
  const randDate = (from: string, to: string) => addDays(from, Math.floor(rand() * ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1)));
  const nextWorkday = (d: string) => {
    let x = d;
    while (isWeekend(x)) x = addDays(x, 1);
    return x;
  };
  const spanWorkdays = (start: string, days: number) => {
    let end = start;
    for (let n = 1; n < days; n++) end = nextWorkday(addDays(end, 1));
    return end;
  };

  const passwords = { rh: await hashPassword(DEMO_PASSWORDS.rh), manager: await hashPassword(DEMO_PASSWORDS.manager) };

  const run = sqlite.transaction(() => {
    const demoUsers = sqlite.prepare("SELECT id FROM app_user WHERE login IN ('rh.demo','mgr.demo')").all() as { id: number }[];
    for (const u of demoUsers) sqlite.prepare("DELETE FROM session WHERE user_id = ?").run(u.id);
    for (const t of TABLES_TO_RESET) sqlite.prepare(`DELETE FROM ${t}`).run();

    const insDimDate = sqlite.prepare("INSERT INTO dim_date (date, is_weekend, is_holiday, holiday_name) VALUES (?, ?, ?, ?)");
    const dim = new Map<string, boolean>();
    for (let d = "2024-01-01"; d <= "2026-12-31"; d = addDays(d, 1)) {
      const we = isWeekend(d);
      const hol = HOLIDAYS.includes(d.slice(5));
      insDimDate.run(d, we ? 1 : 0, hol ? 1 : 0, hol ? "Jour férié" : null);
      dim.set(d, !we && !hol);
    }
    const isWorking = workingDayFn(dim);

    const insDept = sqlite.prepare("INSERT INTO department (code, name) VALUES (?, ?)");
    const deptIds = DEPTS.map((d) => Number(insDept.run(d.code, d.name).lastInsertRowid));

    const emps: Emp[] = [];
    let seq = 0;
    const make = (deptIdx: number, role: "head" | "lead" | "staff" | "direct", managerKey: string | null, exited = false): Emp => {
      const d = DEPTS[deptIdx];
      const sex: "F" | "M" = role === "direct" && rand() < 0.7 ? "F" : rand() < 0.4 ? "F" : "M";
      const senior = role === "head" || role === "lead";
      const age = senior ? between(36, 56) : between(22, 55);
      const hire = senior ? randDate("2010-01-01", "2019-12-31") : rand() < 0.2 ? randDate("2025-03-01", "2026-06-30") : randDate("2012-01-01", "2025-02-28");
      const grade = role === "head" ? "G7" : role === "lead" ? "G5" : pick(["G2", "G3", "G3", "G4"]);
      const contract = senior ? "CDI" : rand() < 0.7 ? "CDI" : rand() < 0.85 ? "CDD" : "SIVP";
      seq++;
      const e: Emp = {
        key: `E${seq}`,
        id: 0,
        matricule: `A${String(seq).padStart(5, "0")}`,
        sex,
        firstName: pick(sex === "F" ? FEMALE : MALE),
        lastName: pick(LAST),
        birthDate: addDays(DATA_END, -Math.round(age * 365.25)),
        hireDate: hire,
        dept: deptIds[deptIdx],
        deptCode: d.code,
        jobFamily: d.family,
        jobTitle: role === "head" ? d.head : role === "lead" ? d.lead : role === "direct" ? d.direct : pick(d.staff),
        grade,
        managerKey,
        managerId: null,
        contract,
        cddEnd: contract === "CDD" ? addDays(randDate("2026-09-15", "2027-08-31"), 0) : null,
        exitDate: null,
        exitReason: null,
        risk: senior ? between(0, 0.3) : Math.pow(rand(), 1.6),
        base: BASE_BY_GRADE[grade] * between(0.88, 1.15),
        raise: rand() < 0.6 ? between(0.04, 0.08) : 0,
      };
      if (exited) {
        e.hireDate = e.hireDate > "2025-01-01" ? randDate("2016-01-01", "2024-12-31") : e.hireDate;
        e.exitDate = randDate("2025-03-01", "2026-08-15");
        const r = rand();
        e.exitReason = e.contract === "CDD" ? "FIN_CDD" : r < 0.55 ? "DEMISSION" : r < 0.7 ? "ABANDON" : r < 0.8 ? "LICENCIEMENT" : r < 0.9 ? "MUTATION" : "RETRAITE";
        if (e.contract === "CDD") e.cddEnd = e.exitDate;
      }
      emps.push(e);
      return e;
    };

    DEPTS.forEach((d, i) => {
      const head = make(i, "head", null);
      for (let k = 0; k < scale; k++)
        for (const size of d.teams) {
          const lead = make(i, "lead", head.key);
          for (let j = 0; j < size; j++) make(i, "staff", lead.key);
          make(i, "staff", lead.key, true);
        }
      for (let k = 0; k < d.directN * scale; k++) make(i, "direct", head.key);
      make(i, "direct", head.key, true);
    });

    // Quelques profils à risque marqué pour la démonstration
    for (const e of emps.filter((x) => !x.exitDate && x.grade !== "G7" && x.grade !== "G5").filter((_, i) => i % 7 === 3)) e.risk = between(0.75, 1);

    const insEmp = sqlite.prepare(
      `INSERT INTO employee (matricule, last_name, first_name, sex, birth_date, hire_date, department_id, job_family, job_title, grade, manager_id, governorate, marital_status, status, exit_date)
       VALUES (@matricule, @lastName, @firstName, @sex, @birthDate, @hireDate, @dept, @jobFamily, @jobTitle, @grade, NULL, @gov, @marital, @status, @exitDate)`,
    );
    for (const e of emps)
      e.id = Number(
        insEmp.run({ ...e, gov: pick(["Tunis", "Ariana", "Ben Arous", "Sfax", "Sousse", "Nabeul"]), marital: pick(["Célibataire", "Marié(e)"]), status: e.exitDate ? "SORTI" : "ACTIF" })
          .lastInsertRowid,
      );
    const byKey = new Map(emps.map((e) => [e.key, e]));
    const setMgr = sqlite.prepare("UPDATE employee SET manager_id = ? WHERE id = ?");
    for (const e of emps) {
      e.managerId = e.managerKey ? byKey.get(e.managerKey)!.id : null;
      setMgr.run(e.managerId, e.id);
    }
    const active = (e: Emp, day: string) => e.hireDate <= day && (!e.exitDate || e.exitDate >= day);

    const insContract = sqlite.prepare("INSERT INTO contract (employee_id, type, start_date, end_date) VALUES (?, ?, ?, ?)");
    const insExit = sqlite.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, resignation_date, recorded_at) VALUES (?, ?, ?, ?, ?)");
    for (const e of emps) {
      if (e.contract === "CDI" && e.hireDate < "2023-01-01" && rand() < 0.4) {
        const switchDate = addDays(e.hireDate, 365);
        insContract.run(e.id, "CDD", e.hireDate, addDays(switchDate, -1));
        insContract.run(e.id, "CDI", switchDate, e.exitDate);
      } else if (e.contract === "CDD") {
        const start = e.hireDate > addDays(e.cddEnd!, -365) ? e.hireDate : addDays(e.cddEnd!, -364);
        if (start > e.hireDate) insContract.run(e.id, "CDD", e.hireDate, addDays(start, -1));
        insContract.run(e.id, "CDD", start, e.cddEnd);
      } else if (e.contract === "SIVP") {
        insContract.run(e.id, "SIVP", e.hireDate, addDays(e.hireDate, 364 * 2));
      } else insContract.run(e.id, "CDI", e.hireDate, e.exitDate);
      if (e.exitDate) {
        const resign = ["DEMISSION"].includes(e.exitReason!) ? addDays(e.exitDate, -30) : null;
        insExit.run(e.id, e.exitDate, e.exitReason, resign, addDays(e.exitDate, 3));
      }
    }

    const insPay = sqlite.prepare("INSERT INTO payroll_monthly (employee_id, month, base_salary, gross_salary, overtime_hours, recorded_at) VALUES (?, ?, ?, ?, ?, ?)");
    const insCareer = sqlite.prepare("INSERT INTO career_event (employee_id, date, type, old_value, new_value, recorded_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const e of emps) {
      for (const m of monthRange("2024-09", LAST_MONTH)) {
        if (!active(e, m + "-01") && !active(e, monthEnd(m))) continue;
        const base = Math.round(e.base * (m >= "2026-01" ? 1 + e.raise : 1) * 1000) / 1000;
        const ot = e.deptCode === "PROD" ? Math.round(between(0, 12) + 18 * e.risk) : Math.round(between(0, 6));
        const gross = Math.round((base * 1.15 + (ot * base * 1.25) / 173) * 1000) / 1000;
        insPay.run(e.id, m, base, gross, ot, addDays(monthEnd(m), 5));
      }
      if (e.raise && e.hireDate < "2026-01-01" && active(e, "2026-01-01"))
        insCareer.run(e.id, "2026-01-01", "AUGMENTATION", e.base.toFixed(3), (e.base * (1 + e.raise)).toFixed(3), "2026-01-06");
      if (rand() < 0.2 && e.hireDate < "2023-01-01") {
        const lvl = Number(e.grade.slice(1));
        const date = randDate("2023-06-01", "2026-05-31");
        insCareer.run(e.id, date, "PROMOTION", `G${lvl - 1}`, e.grade, addDays(date, 7));
      }
      if (rand() < 0.05) {
        const date = randDate("2025-06-01", "2026-06-30");
        if (active(e, date)) insCareer.run(e.id, date, "CHANGEMENT_POSTE", "Poste précédent", e.jobTitle, addDays(date, 5));
      }
    }

    // Changement de manager pour la seconde équipe de production
    const prodHead = emps.find((e) => e.deptCode === "PROD" && e.grade === "G7")!;
    const prodLeads = emps.filter((e) => e.managerKey === prodHead.key && e.grade === "G5");
    const secondTeam = emps.filter((e) => e.managerKey === prodLeads[1].key);
    for (const e of secondTeam)
      if (e.hireDate < "2026-02-01" && active(e, "2026-02-01")) insCareer.run(e.id, "2026-02-01", "CHANGEMENT_MANAGER", prodLeads[0].matricule, prodLeads[1].matricule, "2026-02-03");

    const insAbs = sqlite.prepare("INSERT INTO absence_episode (employee_id, start_date, end_date, days, category, is_health, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const absences: AbsenceEp[] = [];
    const addAbs = (e: Emp, start: string, days: number, category: string) => {
      const s = nextWorkday(start);
      const end = spanWorkdays(s, days);
      if (!active(e, s) || !active(e, end)) return;
      const isHealth = category === "MALADIE" || category === "MATERNITE";
      insAbs.run(e.id, s, end, days, category, isHealth ? 1 : 0, addDays(end, 2 + Math.floor(rand() * 8)));
      absences.push({ employeeId: e.id, startDate: s, endDate: end, days, isHealth, category });
    };
    for (const e of emps) {
      for (const m of monthRange(HISTORY_START.slice(0, 7), LAST_MONTH)) {
        const day = () => randDate(m + "-01", addDays(monthEnd(m), -7));
        if (rand() < 0.18) addAbs(e, day(), 2 + Math.floor(rand() * 7), "CONGE_ANNUEL");
        if (rand() < 0.06) addAbs(e, day(), 1 + Math.floor(rand() * 4), "MALADIE");
        if (rand() < 0.04 + 0.12 * e.risk) addAbs(e, day(), 1 + Math.floor(rand() * 2), "ABSENCE_INJUSTIFIEE");
        if (rand() < 0.05) addAbs(e, day(), 1, "AUTRE");
        if (rand() < 0.004) addAbs(e, day(), 3 + Math.floor(rand() * 6), "CONGE_SANS_SOLDE");
      }
    }
    const mother = emps.find((e) => e.sex === "F" && !e.exitDate && e.hireDate < "2024-01-01");
    if (mother) addAbs(mother, "2026-02-02", 64, "MATERNITE");
    // Anomalie collective injectée : pic d'absences injustifiées dans la seconde équipe de production
    for (const e of secondTeam.filter((x) => !x.exitDate).slice(0, 4)) addAbs(e, randDate("2026-07-06", "2026-07-14"), 2 + Math.floor(rand() * 2), "ABSENCE_INJUSTIFIEE");

    const insTraining = sqlite.prepare(
      "INSERT INTO training (employee_id, code, title, mandatory, start_date, end_date, due_date, hours, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const mandatory: { employeeId: number; dueDate: string | null; status: string }[] = [];
    const addTraining = (e: Emp, code: string, title: string, mand: boolean, due: string | null, pDone: number, hours: number) => {
      const start = randDate(addDays(due ?? "2026-06-30", -200), addDays(due ?? "2026-06-30", -40));
      if (!active(e, start)) return;
      const done = rand() < pDone;
      const status = done ? "TERMINEE" : start > DATA_END ? "PLANIFIEE" : rand() < 0.5 ? "EN_COURS" : "PLANIFIEE";
      const end = done ? addDays(start, Math.ceil(hours / 7)) : null;
      insTraining.run(e.id, code, title, mand ? 1 : 0, start, end, due, hours, status);
      if (mand) mandatory.push({ employeeId: e.id, dueDate: due, status });
    };
    for (const e of emps) {
      if (e.deptCode === "PROD") {
        addTraining(e, "SST-2025", "Santé et sécurité au travail", true, "2025-06-30", 0.92, 14);
        addTraining(e, "SST-2026", "Santé et sécurité au travail (recyclage)", true, "2026-06-30", 0.85 - 0.5 * e.risk, 7);
      } else addTraining(e, "RGPD-2025", "Protection des données personnelles", true, "2025-12-31", 0.9 - 0.4 * e.risk, 7);
      if (rand() < 0.45) {
        const opt = e.deptCode === "PROD" ? ["LEAN", "Lean manufacturing"] : e.deptCode === "COM" ? ["NEGO", "Techniques de négociation"] : ["CLOUD", "Fondamentaux du cloud"];
        addTraining(e, opt[0], opt[1], false, null, 0.8, 7 * (1 + Math.floor(rand() * 3)));
      }
    }

    const insEval = sqlite.prepare("INSERT INTO evaluation (employee_id, eval_date, score, recorded_at) VALUES (?, ?, ?, ?)");
    for (const e of emps)
      for (const d of ["2025-01-20", "2026-01-20"])
        if (active(e, d) && e.hireDate < addDays(d, -90)) {
          const score = Math.min(5, Math.max(1, Math.round((between(2.8, 4.8) - 1.4 * e.risk) * 2) / 2));
          insEval.run(e.id, d, score, addDays(d, 15));
        }

    const insAgg = sqlite.prepare(
      `INSERT INTO agg_kpi_monthly (month, department_id, headcount, entries, exits, voluntary_exits, absence_days_non_health, absence_days_health, workable_days, late_count, overtime_hours, payroll_mass, training_hours, trainings_done, trainings_due)
       VALUES (@month, @dept, @headcount, @entries, @exits, @voluntaryExits, @absenceDaysNonHealth, @absenceDaysHealth, @workableDays, @lateCount, @overtimeHours, @payrollMass, 0, @trainingsDone, @trainingsDue)`,
    );
    const payrollRows = sqlite.prepare("SELECT employee_id AS employeeId, month, gross_salary AS gross, overtime_hours AS ot FROM payroll_monthly").all() as {
      employeeId: number;
      month: string;
      gross: number;
      ot: number;
    }[];
    const months = monthRange(FIRST_MONTH, LAST_MONTH);
    deptIds.forEach((deptId) => {
      const members = emps.filter((e) => e.dept === deptId);
      const ids = new Set(members.map((e) => e.id));
      const rows = computeMonthlyRows({
        months,
        employees: members.map((e) => ({ id: e.id, hireDate: e.hireDate, exitDate: e.exitDate, workStart: e.contract === "SIVP" ? null : e.hireDate })),
        exits: members.filter((e) => e.exitDate).map((e) => ({ employeeId: e.id, exitDate: e.exitDate!, reason: e.exitReason! })),
        absences: absences.filter((a) => ids.has(a.employeeId)),
        payroll: payrollRows.filter((p) => ids.has(p.employeeId)),
        mandatoryTrainings: mandatory.filter((t) => ids.has(t.employeeId)),
        isWorking,
      });
      for (const r of rows) {
        const ot = payrollRows.filter((p) => ids.has(p.employeeId) && p.month === r.month).reduce((s, p) => s + p.ot, 0);
        insAgg.run({ ...r, dept: deptId, lateCount: Math.round(r.headcount * between(0.5, 2)), overtimeHours: ot });
      }
    });

    // Modèles, runs publiés, prédictions et facteurs
    const insModel = sqlite.prepare("INSERT INTO model_version (version, kind, status, fsv, bundle_path, metrics_json, created_at, promoted_at) VALUES (?, ?, ?, 'v1', ?, ?, ?, ?)");
    insModel.run("b0-v1", "B0", "RETIRE", "models/turnover/b0-v1", null, "2025-06-01T00:00:00Z", "2025-06-01T00:00:00Z");
    const modelId = Number(
      insModel.run("logreg-v1-20250915", "LOGREG", "CHAMPION", "models/turnover/logreg-v1-20250915", JSON.stringify({ auc: 0.74, lift_at_capacity: 3.4 }), "2025-09-15T00:00:00Z", "2025-09-20T00:00:00Z")
        .lastInsertRowid,
    );
    const insRun = sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, started_at, finished_at, n_scored) VALUES (?, ?, 'PUBLIE', ?, ?, ?)");
    const insPred = sqlite.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const insFactor = sqlite.prepare(
      "INSERT INTO prediction_factor (prediction_id, group_code, contribution, rank, direction, top_feature, top_feature_value, phrase_rh, phrase_manager) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const capacity = 0.08;
    const topFeature: Record<Group, (e: Emp) => [string, number]> = {
      CARRIERE: (e) => ["months_since_promotion", Math.round(12 + 50 * e.risk + between(0, 10))],
      REMUNERATION: (e) => ["compa_ratio", Math.round((1.08 - 0.3 * e.risk + between(-0.04, 0.04)) * 100) / 100],
      TEMPS_TRAVAIL: (e) => ["overtime_h_avg_3m", Math.round(4 + 22 * e.risk + between(0, 4))],
      ABSENCES: (e) => ["absence_rate_3m", Math.round((0.005 + 0.06 * e.risk + between(0, 0.01)) * 1000) / 1000],
      FORMATION_EVAL: (e) => ["last_eval_score", Math.round((4.3 - 1.8 * e.risk) * 2) / 2],
      EQUIPE: (e) => ["team_exit_rate_6m", Math.round((0.05 + 0.2 * e.risk) * 100) / 100],
    };
    const weights: Record<Group, number> = { CARRIERE: 0.9, REMUNERATION: 1.3, TEMPS_TRAVAIL: 1.0, ABSENCES: 0.7, FORMATION_EVAL: 0.8, EQUIPE: 0.4 };
    const drift = new Map(emps.map((e) => [e.id, between(-0.3, 0.3)]));

    let currentRunId = 0;
    let nPred = 0;
    const runMonths = monthRange("2025-09", LAST_MONTH);
    const predsByEmp = new Map<number, { id: number; level: string; factors: { group: Group; contribution: number; rank: number }[] }>();
    runMonths.forEach((m, idx) => {
      const asOf = monthEnd(m);
      const horizon = addDays(asOf, 183);
      const eligible = emps.filter((e) => {
        if (!active(e, asOf) || (e.exitDate && e.exitDate <= asOf)) return false;
        if (e.hireDate > addDays(asOf, -30)) return false;
        if (e.contract === "SIVP") return false;
        if (e.contract === "CDD" && (!e.cddEnd || e.cddEnd <= horizon)) return false;
        if (e.birthDate <= addDays(horizon, -Math.round(60 * 365.25))) return false;
        if (e.exitReason === "DEMISSION" && addDays(e.exitDate!, -30) <= asOf) return false;
        return true;
      });
      const probs = eligible.map((e) => {
        const trend = drift.get(e.id)! * (idx / runMonths.length);
        return sigmoid(-4.6 + 3.6 * e.risk + trend + between(-0.15, 0.15));
      });
      const mean = probs.reduce((s, p) => s + p, 0) / probs.length;
      const order = eligible.map((_, i) => i).sort((a, b) => probs[b] - probs[a]);
      const nHigh = Math.max(1, Math.ceil(capacity * eligible.length));
      const runId = Number(insRun.run(asOf, modelId, `${addDays(asOf, 10)}T02:00:00Z`, `${addDays(asOf, 10)}T02:03:00Z`, eligible.length).lastInsertRowid);
      currentRunId = runId;
      order.forEach((i, rank) => {
        const e = eligible[i];
        const p = probs[i];
        const lift = p / mean;
        const level = rank < nHigh ? "ELEVE" : lift >= 2 ? "MOYEN" : "FAIBLE";
        const predId = Number(insPred.run(runId, e.id, asOf, p, level, rank + 1, lift, modelId).lastInsertRowid);
        nPred++;
        const contribs = GROUPS.map((g) => ({ group: g, contribution: (e.risk - 0.35) * weights[g] + between(-0.25, 0.25) })).sort(
          (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
        );
        const factors = contribs.map((c, r) => {
          const [feat, val] = topFeature[c.group](e);
          insFactor.run(
            predId,
            c.group,
            Math.round(c.contribution * 1000) / 1000,
            r + 1,
            c.contribution >= 0 ? "HAUSSE" : "BAISSE",
            feat,
            val,
            phraseRh(c.group, feat, val),
            features.groups[c.group].label_manager,
          );
          return { group: c.group, contribution: c.contribution, rank: r + 1 };
        });
        if (idx === runMonths.length - 1 || idx === runMonths.length - 3) predsByEmp.set(e.id * 100 + idx, { id: predId, level, factors });
      });
    });
    setSetting(sqlite, "current_run_id", String(currentRunId));
    setSetting(sqlite, "data_end_date", DATA_END);
    setSetting(sqlite, "capacity_rate", String(capacity));

    const insReco = sqlite.prepare(
      "INSERT INTO recommendation (employee_id, prediction_id, action_code, trigger_group, status, feedback, comment, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insInterv = sqlite.prepare("INSERT INTO intervention (employee_id, recommendation_id, date, action_code, created_by) VALUES (?, ?, ?, ?, NULL)");
    for (const [key, pred] of predsByEmp) {
      if (pred.level === "FAIBLE") continue;
      const empId = Math.floor(key / 100);
      const old = key % 100 !== runMonths.length - 1;
      const created = old ? "2026-06-10T08:00:00Z" : "2026-09-10T08:00:00Z";
      for (const f of pred.factors.filter((x) => x.rank <= 3 && x.contribution > 0)) {
        const action = ACTIONABLE[f.group];
        if (!action) continue;
        if (!old) {
          insReco.run(empId, pred.id, action, f.group, "PROPOSEE", null, null, created, null, null);
          continue;
        }
        const r = rand();
        const status = r < 0.55 ? "REALISEE" : r < 0.8 ? "REJETEE" : "PROPOSEE";
        const feedback = status === "PROPOSEE" ? null : rand() < 0.7 ? "PERTINENTE" : "NON_PERTINENTE";
        const comment = status === "REJETEE" ? "Situation déjà traitée lors de l'entretien annuel." : null;
        const recoId = Number(insReco.run(empId, pred.id, action, f.group, status, feedback, comment, created, status === "PROPOSEE" ? null : "2026-07-02T09:00:00Z", null).lastInsertRowid);
        if (status === "REALISEE") insInterv.run(empId, recoId, "2026-07-01", action);
      }
    }

    const prodDept = deptIds[0];
    const comDept = deptIds[1];
    const siDept = deptIds[2];
    const siLead = emps.find((e) => e.deptCode === "SI" && e.grade === "G5")!;
    const comStaff = emps.find((e) => e.deptCode === "COM" && !e.exitDate && e.grade !== "G7" && e.grade !== "G5")!;
    const prodStaff = secondTeam.find((e) => !e.exitDate)!;
    const insAnom = sqlite.prepare(
      "INSERT INTO anomaly (scope, department_id, manager_id, employee_id, period_start, period_end, metric, observed, expected, score, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const at = "2026-09-10T02:05:00Z";
    insAnom.run("EQUIPE", prodDept, prodLeads[1].id, null, "2026-07-06", "2026-07-19", "taux_absence_hors_sante", 0.085, 0.021, 3.4, "Taux d'absence hors santé de 8,5 % sur 2 semaines consécutives, contre 2,1 % attendu (hors Ramadan).", at);
    insAnom.run("DEPARTEMENT", comDept, null, null, "2026-05-04", "2026-05-17", "taux_absence_hors_sante", 0.052, 0.024, 2.6, "Taux d'absence hors santé de 5,2 % sur 2 semaines, contre 2,4 % attendu.", at);
    insAnom.run("EQUIPE", siDept, siLead.id, null, "2026-03-02", "2026-03-15", "taux_absence_hors_sante", 0.061, 0.02, 2.9, "Taux d'absence hors santé de 6,1 % sur 2 semaines consécutives, contre 2,0 % attendu.", at);
    insAnom.run("SALARIE", comDept, comStaff.managerId, comStaff.id, "2025-09-01", "2026-08-31", "bradford_12m", 245, 60, 4.1, "Facteur de Bradford hors santé de 245 sur 12 mois (seuil 200).", at);
    insAnom.run("SALARIE", prodDept, prodStaff.managerId, prodStaff.id, "2026-07-01", "2026-07-31", "episodes_mois", 3, 0.4, 3.2, "3 absences courtes en juillet 2026, contre 0,4 attendue d'après son historique.", at);

    const upsertUser = sqlite.prepare(
      `INSERT INTO app_user (login, password_hash, role, employee_id, email, active) VALUES (@login, @hash, @role, @employeeId, @email, 1)
       ON CONFLICT(login) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role, employee_id = excluded.employee_id, active = 1, failed_attempts = 0, locked_until = NULL`,
    );
    upsertUser.run({ login: "rh.demo", hash: passwords.rh, role: "RH", employeeId: null, email: "rh.demo@example.tn" });
    upsertUser.run({ login: "mgr.demo", hash: passwords.manager, role: "MANAGER", employeeId: prodHead.id, email: "mgr.demo@example.tn" });
    const uid = (login: string) => (sqlite.prepare("SELECT id FROM app_user WHERE login = ?").get(login) as { id: number }).id;

    return {
      employees: emps.length,
      managerEmployeeId: prodHead.id,
      rhUserId: uid("rh.demo"),
      managerUserId: uid("mgr.demo"),
      currentRunId,
      runs: runMonths.length,
      predictions: nPred,
    };
  });
  return run();
}

async function main() {
  const file = dbPath();
  const i = process.argv.indexOf("--echelle");
  const scale = i > 0 ? Number(process.argv[i + 1]) : 1;
  if (!path.basename(file).startsWith("dev-") && !process.argv.includes("--force")) {
    console.error(`Refus : ${file} n'est pas une base de développement (dev-*.db). Ajoutez --force pour passer outre.`);
    process.exit(1);
  }
  const sqlite = openSqlite(file);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  seedDefaultSettings(sqlite);
  const t0 = Date.now();
  const res = await seedDevUi(sqlite, { scale });
  sqlite.close();
  console.log(`Base ${file} remplie en ${Date.now() - t0} ms :`, res);
  console.log(`Comptes : rh.demo / ${DEMO_PASSWORDS.rh} (RH), mgr.demo / ${DEMO_PASSWORDS.manager} (MANAGER)`);
}

// Exécuté seulement en CLI : le module est aussi importé par les tests
if (/seed-dev-ui\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
