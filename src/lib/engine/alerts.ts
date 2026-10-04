import type Database from "better-sqlite3";

export type AlertInput = {
  type: "TURNOVER" | "ABSENTEISME" | "DONNEES" | "SYSTEME";
  severity: "INFO" | "ATTENTION" | "CRITIQUE";
  audience: "RH" | "MANAGER" | "ADMIN";
  title: string;
  message: string;
  dedupKey: string;
  departmentId?: number | null;
  managerId?: number | null;
  employeeId?: number | null;
  link?: string | null;
};

// Dédupliquée par dedup_key : renvoie true si l'alerte est nouvelle.
export function createAlert(sqlite: Database.Database, a: AlertInput): boolean {
  const r = sqlite
    .prepare(
      `INSERT OR IGNORE INTO alert (type, severity, audience, department_id, manager_id, employee_id, title, message, link, dedup_key)
       VALUES (@type, @severity, @audience, @departmentId, @managerId, @employeeId, @title, @message, @link, @dedupKey)`,
    )
    .run({ departmentId: null, managerId: null, employeeId: null, link: null, ...a });
  return r.changes > 0;
}

export function systemAlert(
  sqlite: Database.Database,
  key: string,
  title: string,
  message: string,
  severity: AlertInput["severity"] = "CRITIQUE",
  link: string | null = null,
): boolean {
  try {
    return createAlert(sqlite, { type: "SYSTEME", severity, audience: "ADMIN", title, message, link, dedupKey: `systeme:${key}` });
  } catch {
    return false;
  }
}

export function auditSqlite(
  sqlite: Database.Database,
  userId: number | null,
  action: string,
  target?: { type: string; id?: string | number | null },
  outcome: "OK" | "REFUSE" | "ECHEC" = "OK",
  detail?: Record<string, unknown>,
): void {
  sqlite
    .prepare("INSERT INTO audit_log (user_id, action, target_type, target_id, outcome, detail_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, action, target?.type ?? null, target?.id != null ? String(target.id) : null, outcome, detail ? JSON.stringify(detail) : null);
}

export const today = () => new Date().toISOString().slice(0, 10);
