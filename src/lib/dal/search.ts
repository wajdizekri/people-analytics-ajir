import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { PILOTAGE_ROLES, scopeFilter, type AccessContext } from "./context";
import { listAlerts, type AlertSeverity, type AlertStatus } from "./alerts";

export const SEARCH_EMPLOYEE_LIMIT = 8;
export const SEARCH_ALERT_LIMIT = 5;

export const searchQuerySchema = z.object({
  q: z
    .string({ error: "Saisissez au moins 2 caractères à rechercher." })
    .trim()
    .min(2, "Saisissez au moins 2 caractères à rechercher.")
    .max(100, "Recherche trop longue : 100 caractères au plus."),
});

export type SearchEmployee = { id: number; lastName: string; firstName: string; matricule: string; department: string | null; jobTitle: string | null };
export type SearchAlert = { id: number; title: string; severity: AlertSeverity; status: AlertStatus };
export type SearchResults = { q: string; employees: SearchEmployee[]; moreEmployees: boolean; alerts: SearchAlert[] };

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Mêmes règles que la liste /employees (listEmployees) : salariés actifs du périmètre, nom, prénom ou matricule.
// Champs non sensibles seulement ; un résultat de plus est lu pour savoir si la liste est tronquée.
function searchEmployees(ctx: AccessContext, q: string): { rows: SearchEmployee[]; more: boolean } {
  if (!PILOTAGE_ROLES.includes(ctx.role)) return { rows: [], more: false };
  const scope = scopeFilter(ctx, "e.id");
  const escaped = q.replace(/[\\%_]/g, (c) => "\\" + c);
  const rows = getDb()
    .sqlite.prepare(
      `SELECT e.id, e.last_name AS lastName, e.first_name AS firstName, e.matricule, d.name AS department, e.job_title AS jobTitle
       FROM employee e LEFT JOIN department d ON d.id = e.department_id
       WHERE e.status = 'ACTIF' AND (${scope.clause})
         AND (e.last_name || ' ' || e.first_name LIKE @q ESCAPE '\\' OR e.first_name || ' ' || e.last_name LIKE @q ESCAPE '\\' OR e.matricule LIKE @q ESCAPE '\\')
       ORDER BY CASE
           WHEN e.matricule = @exact COLLATE NOCASE THEN 0
           WHEN e.last_name LIKE @prefix ESCAPE '\\' OR e.first_name LIKE @prefix ESCAPE '\\' OR e.matricule LIKE @prefix ESCAPE '\\' THEN 1
           ELSE 2 END,
         e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE, e.id
       LIMIT @limit`,
    )
    .all({ ...scope.params, q: `%${escaped}%`, prefix: `${escaped}%`, exact: q, limit: SEARCH_EMPLOYEE_LIMIT + 1 }) as SearchEmployee[];
  return { rows: rows.slice(0, SEARCH_EMPLOYEE_LIMIT), more: rows.length > SEARCH_EMPLOYEE_LIMIT };
}

// Alertes ouvertes, filtrage de /alerts (listAlerts : audience et périmètre du rôle), recherche sans accents
function searchAlerts(ctx: AccessContext, q: string): SearchAlert[] {
  const needle = fold(q);
  const open = [...listAlerts(ctx, { status: "NOUVELLE", limit: 500 }), ...listAlerts(ctx, { status: "EN_COURS", limit: 500 })];
  return open
    .filter((a) => [a.title, a.departmentName, a.employeeName].some((v) => v != null && fold(v).includes(needle)))
    .slice(0, SEARCH_ALERT_LIMIT)
    .map((a) => ({ id: a.id, title: a.title, severity: a.severity, status: a.status }));
}

export function searchAll(ctx: AccessContext, rawQuery: unknown): SearchResults {
  const { q } = searchQuerySchema.parse({ q: rawQuery });
  const employees = searchEmployees(ctx, q);
  return { q, employees: employees.rows, moreEmployees: employees.more, alerts: searchAlerts(ctx, q) };
}
