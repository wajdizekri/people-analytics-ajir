import { getDb } from "@/db/client";

export type AuditTarget = { type: string; id?: string | number | null };

// Journal append-only (triggers SQL). Toute écriture et toute lecture sensible passe par ici.
export function audit(
  userId: number | null,
  action: string,
  target?: AuditTarget,
  outcome: "OK" | "REFUSE" | "ECHEC" = "OK",
  detail?: Record<string, unknown>,
  ip?: string,
): void {
  getDb()
    .sqlite.prepare(
      "INSERT INTO audit_log (user_id, action, target_type, target_id, outcome, detail_json, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      userId,
      action,
      target?.type ?? null,
      target?.id != null ? String(target.id) : null,
      outcome,
      detail ? JSON.stringify(detail) : null,
      ip ?? null,
    );
}
