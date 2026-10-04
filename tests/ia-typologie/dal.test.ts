import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { HttpError } from "@/lib/dal/errors";
import { getDepartureProfiles } from "@/lib/dal/typology";
import type { AccessContext } from "@/lib/dal/context";
import { seedDefaultSettings, setSetting } from "@/lib/settings";
import { snapshot } from "./helpers";

// Base de test : 40 démissions avec variables à la veille du départ (Production 25, IT 12, Finance 3), 3 sans variables,
// 2 fins de CDD et 1 démission saisie après la référence (ignorées). Profils calculés avec le bundle de production.
const DATA_END = "2026-08-31";
let file = "";
const ids: Record<string, number> = {};
const rh: AccessContext = { userId: 1, login: "rh.test", role: "RH", employeeId: null };
const admin: AccessContext = { userId: 2, login: "admin.test", role: "ADMIN", employeeId: null };

beforeAll(() => {
  file = path.join(os.tmpdir(), `pa-typologie-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  (globalThis as { __paDb?: unknown }).__paDb = undefined;
  const s = getDb().sqlite;
  migrate(drizzle(s), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  seedDefaultSettings(s);
  setSetting(s, "data_end_date", DATA_END);
  const dept: Record<string, number> = {};
  for (const [code, name] of [
    ["PROD", "Production"],
    ["IT", "IT"],
    ["FIN", "Finance"],
  ])
    dept[name] = Number(s.prepare("INSERT INTO department (code, name) VALUES (?, ?)").run(code, name).lastInsertRowid);
  const insEmp = s.prepare("INSERT INTO employee (matricule, last_name, first_name, hire_date, department_id, manager_id, job_family, status) VALUES (?, ?, 'Prénom', ?, ?, ?, ?, 'SORTI')");
  const insExit = s.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, resignation_date, recorded_at) VALUES (?, ?, ?, ?, ?)");
  const insSnap = s.prepare("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json) VALUES (?, ?, 'v1', ?)");
  ids.M = Number(insEmp.run("T-M", "Manager", "2010-01-04", dept.Production, null, "Production").lastInsertRowid);
  s.prepare("UPDATE employee SET status = 'ACTIF' WHERE id = ?").run(ids.M);
  const add = (key: string, deptName: string, reason: string, withSnapshot: boolean, i: number, recordedAt = "2025-06-16") => {
    ids[key] = Number(insEmp.run(`T-${key}`, `Nom${key}`, "2020-01-06", dept[deptName], ids.M, deptName === "IT" ? "IT" : "Production").lastInsertRowid);
    insExit.run(ids[key], "2025-07-31", reason, reason === "DEMISSION" ? "2025-06-15" : null, recordedAt);
    if (withSnapshot)
      insSnap.run(
        ids[key],
        "2025-05-31",
        JSON.stringify(
          snapshot({
            tenure_months: i % 3 === 0 ? 6 + i : i % 3 === 1 ? 120 + i : 40 + i,
            months_since_promotion: i % 3 === 1 ? 90 : 12,
            overtime_h_avg_3m: i % 3 === 2 ? 25 : 3,
            raise_pct_12m: i % 3 === 0 ? 0 : 0.05,
            compa_ratio: i % 3 === 0 ? 0.88 : 1.02,
            training_hours_12m: i % 4 === 0 ? 0 : 12,
            contract_cdd: i % 3 === 0 ? 1 : 0,
          }),
        ),
      );
  };
  for (let i = 0; i < 40; i++) add(`D${i}`, i < 25 ? "Production" : i < 37 ? "IT" : "Finance", "DEMISSION", true, i);
  for (let i = 0; i < 3; i++) add(`U${i}`, "Production", "DEMISSION", false, i);
  for (let i = 0; i < 2; i++) add(`C${i}`, "Production", "FIN_CDD", true, i);
  add("LATE", "Production", "DEMISSION", true, 1, "2026-09-03");
});

afterAll(() => {
  const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  delete g.__paDb;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
});

describe("DAL profils de départs : rôles", () => {
  it("ADMIN refusé (403), refus audité", () => {
    expect(() => getDepartureProfiles(admin)).toThrow(HttpError);
    const row = getDb().sqlite.prepare("SELECT outcome FROM audit_log WHERE action = 'retention.view' AND user_id = ? ORDER BY id DESC LIMIT 1").get(admin.userId) as
      | { outcome: string }
      | undefined;
    expect(row?.outcome).toBe("REFUSE");
  });

  it("manager : aucune donnée (vue RH seule)", () => {
    expect(getDepartureProfiles({ userId: 3, login: "mgr.test", role: "MANAGER", employeeId: ids.M })).toBeNull();
  });
});

describe("DAL profils de départs : agrégats RH", () => {
  it("démissions visibles seulement ; non classés = sans variables à la veille du départ", () => {
    const r = getDepartureProfiles(rh)!;
    expect(r.status).toBe("OK");
    expect(r.total).toBe(43);
    expect(r.classified).toBe(40);
    expect(r.unclassified).toBe(3);
    expect(r.firstExit).toBe("2025-07-31");
    expect(r.model?.k).toBe(r.profiles.length);
    const shown = r.profiles.filter((p) => !p.masked);
    const counted = shown.reduce((s, p) => s + (p.departures ?? 0), 0);
    expect(counted).toBeLessThanOrEqual(40);
    expect(40 - counted === 0 || 40 - counted >= r.minGroupSize).toBe(true);
    for (const p of shown) if ((p.departures ?? 0) > 0) expect(p.departures!).toBeGreaterThanOrEqual(r.minGroupSize);
    expect(r.departments.map((d) => d.department)).toEqual(["Production", "IT"]);
    expect(r.otherDepartments).toBe(3);
  });

  it("cache mémoire : réutilisé tant que les données ne changent pas, invalidé par une nouvelle sortie", () => {
    const a = getDepartureProfiles(rh)!;
    expect(getDepartureProfiles(rh)!.profiles).toBe(a.profiles);
    const s = getDb().sqlite;
    const id = Number(s.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, resignation_date, recorded_at) VALUES (?, '2025-07-31', 'DEMISSION', '2025-06-15', '2025-06-16')").run(ids.M).lastInsertRowid);
    try {
      const b = getDepartureProfiles(rh)!;
      expect(b.profiles).not.toBe(a.profiles);
      expect(b.total).toBe(44);
    } finally {
      s.prepare("DELETE FROM exit_event WHERE id = ?").run(id);
    }
    expect(getDepartureProfiles(rh)!.total).toBe(43);
  });

  it("rien de nominatif dans la réponse", () => {
    const json = JSON.stringify(getDepartureProfiles(rh));
    for (const s of ["T-D1", "NomD1", "Prénom", "employeeId", "exitId", "valuesJson"]) expect(json).not.toContain(s);
  });

  it("opposition au traitement : départ compté mais non classé", () => {
    const s = getDb().sqlite;
    s.prepare("INSERT INTO employee_opposition (employee_id, since) VALUES (?, '2025-01-01')").run(ids.D0);
    try {
      const r = getDepartureProfiles(rh)!;
      expect(r.total).toBe(43);
      expect(r.classified).toBe(39);
      expect(r.unclassified).toBe(4);
    } finally {
      s.prepare("DELETE FROM employee_opposition WHERE employee_id = ?").run(ids.D0);
    }
  });

  it("moins de 30 départs classés : aucun profil affiché", () => {
    const s = getDb().sqlite;
    const kept = Object.entries(ids)
      .filter(([k]) => /^D([0-9]|1[0-9]|2[0-8])$/.test(k))
      .map(([, id]) => id);
    s.exec("BEGIN");
    try {
      s.prepare(`DELETE FROM feature_snapshot WHERE employee_id NOT IN (${kept.join(",")})`).run();
      const r = getDepartureProfiles(rh)!;
      expect(r.status).toBe("TROP_PEU");
      expect(r.classified).toBe(29);
      expect(r.profiles).toEqual([]);
      expect(r.departments).toEqual([]);
    } finally {
      s.exec("ROLLBACK");
    }
  });
});
