import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "@/db/client";
import { seedDefaultSettings } from "@/lib/settings";
import type { AccessContext } from "@/lib/dal/context";

type Fixture = {
  file: string;
  emp: Record<string, number>;
  users: Record<"admin" | "rh" | "mgr" | "mgr2", number>;
  ctx: Record<"admin" | "rh" | "mgr" | "mgr2", AccessContext>;
};

// Base temporaire migrée. Hiérarchie : DG > MGR (> E1, SUB > E2, E3) ; DG > MGR2 > E4.
export function setupDb(name: string): Fixture {
  const file = path.join(os.tmpdir(), `pa-ui-admin-${name}-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  (globalThis as { __paDb?: unknown }).__paDb = undefined;
  const { sqlite } = getDb();
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  seedDefaultSettings(sqlite);

  const deptId = Number(sqlite.prepare("INSERT INTO department (code, name) VALUES ('PROD', 'Production')").run().lastInsertRowid);
  const emp: Record<string, number> = {};
  const add = (m: string, manager: string | null) => {
    emp[m] = Number(
      sqlite
        .prepare("INSERT INTO employee (matricule, last_name, first_name, hire_date, department_id, manager_id) VALUES (?, ?, 'Test', '2020-01-01', ?, ?)")
        .run(m, `Nom ${m}`, deptId, manager ? emp[manager] : null).lastInsertRowid,
    );
  };
  add("DG", null);
  add("MGR", "DG");
  add("E1", "MGR");
  add("SUB", "MGR");
  add("E2", "SUB");
  add("E3", "SUB");
  add("MGR2", "DG");
  add("E4", "MGR2");

  const user = (login: string, role: string, employeeId: number | null) =>
    Number(
      sqlite
        .prepare("INSERT INTO app_user (login, password_hash, role, employee_id) VALUES (?, 'x', ?, ?)")
        .run(login, role, employeeId).lastInsertRowid,
    );
  const users = { admin: user("admin", "ADMIN", null), rh: user("rh", "RH", null), mgr: user("mgr", "MANAGER", emp.MGR), mgr2: user("mgr2", "MANAGER", emp.MGR2) };
  const ctx = {
    admin: { userId: users.admin, login: "admin", role: "ADMIN", employeeId: null },
    rh: { userId: users.rh, login: "rh", role: "RH", employeeId: null },
    mgr: { userId: users.mgr, login: "mgr", role: "MANAGER", employeeId: emp.MGR },
    mgr2: { userId: users.mgr2, login: "mgr2", role: "MANAGER", employeeId: emp.MGR2 },
  } satisfies Record<string, AccessContext>;
  return { file, emp, users, ctx };
}

export function teardownDb(file: string) {
  const g = globalThis as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  g.__paDb = undefined;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}

export function auditRows(action: string): { user_id: number | null; outcome: string; detail_json: string | null }[] {
  return getDb().sqlite.prepare("SELECT user_id, outcome, detail_json FROM audit_log WHERE action = ? ORDER BY id").all(action) as {
    user_id: number | null;
    outcome: string;
    detail_json: string | null;
  }[];
}
