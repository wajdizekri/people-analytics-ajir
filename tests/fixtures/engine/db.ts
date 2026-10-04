import type Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openSqlite } from "@/db/client";
import { seedDefaultSettings } from "@/lib/settings";
import { dayOfWeek, fromDay, toDay } from "@/lib/features/dates";

export type TestDb = { sqlite: Database.Database; file: string; close: () => void };

export function createTestDb(): TestDb {
  const file = path.join(os.tmpdir(), `pa-engine-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = openSqlite(file);
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  seedDefaultSettings(sqlite);
  return {
    sqlite,
    file,
    close: () => {
      sqlite.close();
      for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    },
  };
}

export const isWeekday = (date: string) => {
  const d = dayOfWeek(toDay(date));
  return d >= 1 && d <= 5;
};

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = toDay(from); d <= toDay(to); d++) out.push(fromDay(d));
  return out;
}

export const weekdaysBetween = (from: string, to: string) => eachDay(from, to).filter(isWeekday).length;

export type EmpInput = {
  matricule: string;
  hire: string;
  birth?: string | null;
  dept?: number | null;
  family?: string | null;
  grade?: string | null;
  managerId?: number | null;
  contract?: { type: "CDI" | "CDD" | "SIVP" | "STAGE"; start?: string; end?: string | null } | null;
};

export class Fixture {
  constructor(readonly sqlite: Database.Database) {}

  dept(code: string, name = code): number {
    return Number(this.sqlite.prepare("INSERT INTO department (code, name) VALUES (?, ?)").run(code, name).lastInsertRowid);
  }

  emp(e: EmpInput): number {
    const id = Number(
      this.sqlite
        .prepare(
          `INSERT INTO employee (matricule, last_name, first_name, sex, birth_date, hire_date, department_id, job_family, job_title, grade, manager_id)
           VALUES (?, ?, ?, 'M', ?, ?, ?, ?, 'Poste', ?, ?)`,
        )
        .run(e.matricule, `Nom${e.matricule}`, `Prenom${e.matricule}`, e.birth ?? "1990-01-01", e.hire, e.dept ?? null, e.family ?? "TECH", e.grade ?? "G2", e.managerId ?? null)
        .lastInsertRowid,
    );
    if (e.contract !== null) {
      const c = e.contract ?? { type: "CDI" as const };
      this.sqlite
        .prepare("INSERT INTO contract (employee_id, type, start_date, end_date) VALUES (?, ?, ?, ?)")
        .run(id, c.type, c.start ?? e.hire, c.end ?? null);
    }
    return id;
  }

  attendance(
    empId: number,
    from: string,
    to: string,
    opts: {
      skip?: (date: string) => boolean;
      overtime?: (date: string) => number;
      late?: (date: string) => number;
      checkIn?: (date: string) => string | null;
    } = {},
  ): void {
    const ins = this.sqlite.prepare(
      `INSERT OR IGNORE INTO attendance_daily (employee_id, date, check_in, check_out, worked_minutes, overtime_minutes, late_minutes)
       VALUES (?, ?, ?, '17:00', 480, ?, ?)`,
    );
    this.sqlite.transaction(() => {
      for (const d of eachDay(from, to)) {
        if (!isWeekday(d) || opts.skip?.(d)) continue;
        ins.run(empId, d, opts.checkIn ? opts.checkIn(d) : "08:00", opts.overtime?.(d) ?? 0, opts.late?.(d) ?? 0);
      }
    })();
  }

  absence(empId: number, start: string, end: string, category: string, recordedAt?: string, days?: number): void {
    const health = category === "MALADIE" || category === "MATERNITE" ? 1 : 0;
    this.sqlite
      .prepare("INSERT INTO absence_episode (employee_id, start_date, end_date, days, category, is_health, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(empId, start, end, days ?? weekdaysBetween(start, end), category, health, recordedAt ?? end);
  }

  payroll(empId: number, fromMonth: string, toMonth: string, base: number | ((month: string) => number), lagDays = 5): void {
    const ins = this.sqlite.prepare(
      "INSERT OR IGNORE INTO payroll_monthly (employee_id, month, base_salary, gross_salary, overtime_hours, recorded_at) VALUES (?, ?, ?, ?, 0, ?)",
    );
    this.sqlite.transaction(() => {
      let [y, m] = fromMonth.split("-").map(Number);
      for (;;) {
        const month = `${y}-${String(m).padStart(2, "0")}`;
        if (month > toMonth) break;
        const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
        const rec = fromDay(toDay(`${next}-01`) + lagDays - 1);
        const b = typeof base === "function" ? base(month) : base;
        ins.run(empId, month, b, b * 1.2, rec);
        if (++m > 12) [y, m] = [y + 1, 1];
      }
    })();
  }

  career(empId: number, date: string, type: string, oldValue: string | null, newValue: string | null, recordedAt?: string): void {
    this.sqlite
      .prepare("INSERT INTO career_event (employee_id, date, type, old_value, new_value, recorded_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(empId, date, type, oldValue, newValue, recordedAt ?? date);
  }

  training(
    empId: number,
    t: { code?: string; mandatory?: boolean; start?: string | null; end?: string | null; due?: string | null; hours?: number; status: string },
  ): void {
    this.sqlite
      .prepare("INSERT INTO training (employee_id, code, title, mandatory, start_date, end_date, due_date, hours, status) VALUES (?, ?, 'Formation', ?, ?, ?, ?, ?, ?)")
      .run(empId, t.code ?? "F1", t.mandatory ? 1 : 0, t.start ?? null, t.end ?? null, t.due ?? null, t.hours ?? 0, t.status);
  }

  evaluation(empId: number, date: string, score: number, recordedAt?: string): void {
    this.sqlite.prepare("INSERT INTO evaluation (employee_id, eval_date, score, recorded_at) VALUES (?, ?, ?, ?)").run(empId, date, score, recordedAt ?? date);
  }

  exit(empId: number, date: string, reason: string, opts: { resignation?: string | null; recordedAt?: string } = {}): void {
    this.sqlite
      .prepare("INSERT INTO exit_event (employee_id, exit_date, reason, resignation_date, recorded_at) VALUES (?, ?, ?, ?, ?)")
      .run(empId, date, reason, opts.resignation ?? null, opts.recordedAt ?? date);
    this.sqlite.prepare("UPDATE employee SET status = 'SORTI', exit_date = ? WHERE id = ?").run(date, empId);
  }

  calendarDay(date: string, flags: { holiday?: boolean; bridge?: boolean; ramadan?: boolean; seanceUnique?: boolean }): void {
    const we = isWeekday(date) ? 0 : 1;
    this.sqlite
      .prepare(
        `INSERT INTO dim_date (date, is_weekend, is_holiday, is_ramadan, is_bridge, is_seance_unique) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET is_holiday = excluded.is_holiday, is_ramadan = excluded.is_ramadan,
           is_bridge = excluded.is_bridge, is_seance_unique = excluded.is_seance_unique`,
      )
      .run(date, we, flags.holiday ? 1 : 0, flags.ramadan ? 1 : 0, flags.bridge ? 1 : 0, flags.seanceUnique ? 1 : 0);
  }
}
