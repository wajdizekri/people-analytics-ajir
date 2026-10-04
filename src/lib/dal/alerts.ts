import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ALERT_STATUSES, ALERT_TYPES } from "@/db/schema";
import { audit } from "@/lib/audit";
import { SCOPE_SUBQUERY, type AccessContext } from "./context";
import { HttpError, forbidden, notFound } from "./errors";

export const ALERT_SEVERITIES = ["INFO", "ATTENTION", "CRITIQUE"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export type AlertDTO = {
  id: number;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  link: string | null;
  departmentName: string | null;
  employeeName: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string | null;
  updatedByLogin: string | null;
  canEdit: boolean;
};

export const alertFiltersSchema = z.object({
  type: z.enum(ALERT_TYPES).optional(),
  status: z.enum(ALERT_STATUSES).optional(),
  severity: z.enum(ALERT_SEVERITIES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export type AlertFilters = z.input<typeof alertFiltersSchema>;

export const alertUpdateSchema = z
  .object({
    status: z.enum(["EN_COURS", "TRAITEE", "REJETEE"], { error: "Choisissez le nouveau statut de l'alerte : En cours, Traitée ou Rejetée." }),
    comment: z
      .string()
      .trim()
      .max(1000, "Commentaire trop long : 1\u00a0000 caractères au plus.")
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((v) => v.status !== "REJETEE" || (v.comment?.length ?? 0) >= 3, {
    message: "Un commentaire est obligatoire pour rejeter une alerte. Expliquez la décision en quelques mots (3 caractères au moins).",
    path: ["comment"],
  });
export type AlertUpdate = z.input<typeof alertUpdateSchema>;

const STATUS_FR: Record<AlertStatus, string> = { NOUVELLE: "Nouvelle", EN_COURS: "En cours", TRAITEE: "Traitée", REJETEE: "Rejetée" };

export const ALERT_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  NOUVELLE: ["EN_COURS", "REJETEE"],
  EN_COURS: ["TRAITEE", "REJETEE"],
  TRAITEE: [],
  REJETEE: [],
};

// Visibilité : ADMIN l'audience ADMIN (système) et les alertes de données non nominatives (imports) ;
// RH tout sauf audience ADMIN ; MANAGER uniquement l'audience MANAGER de sa hiérarchie,
// jamais un signal individuel d'absentéisme (réservé RH), quelle que soit l'audience saisie.
function visibility(ctx: AccessContext): { clause: string; params: Record<string, unknown> } {
  if (ctx.role === "ADMIN") return { clause: "(a.audience = 'ADMIN' OR (a.type = 'DONNEES' AND a.employee_id IS NULL))", params: {} };
  if (ctx.role === "RH") return { clause: "a.audience <> 'ADMIN'", params: {} };
  if (ctx.role === "MANAGER" && ctx.employeeId != null) {
    return {
      clause: `a.audience = 'MANAGER'
        AND NOT (a.type = 'ABSENTEISME' AND a.employee_id IS NOT NULL)
        AND (
          (a.employee_id IS NOT NULL AND a.employee_id IN (${SCOPE_SUBQUERY}))
          OR (a.employee_id IS NULL AND (a.manager_id = @scopeRoot OR a.manager_id IN (${SCOPE_SUBQUERY})))
        )`,
      params: { scopeRoot: ctx.employeeId },
    };
  }
  return { clause: "1=0", params: {} };
}

type Row = {
  id: number;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  link: string | null;
  department_name: string | null;
  first_name: string | null;
  last_name: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string | null;
  updated_by_login: string | null;
};

const SELECT = `
  SELECT a.id, a.type, a.severity, a.status, a.title, a.message, a.link, a.comment, a.created_at, a.updated_at,
         d.name AS department_name, e.first_name, e.last_name, u.login AS updated_by_login
  FROM alert a
  LEFT JOIN department d ON d.id = a.department_id
  LEFT JOIN employee e ON e.id = a.employee_id
  LEFT JOIN app_user u ON u.id = a.updated_by`;

// Lien d'alerte : chemin interne uniquement. Un seul « / » initial suivi d'un caractère autre que « / » ou « \ »,
// sans espace, caractère de contrôle ni « \ » (les navigateurs retirent tabulations et retours à la ligne et lisent
// « \ » comme « / » : « /\hôte » ou « /<TAB>/hôte » deviennent « //hôte »), et qui reste sur l'origine une fois résolu.
const LINK_BASE = "http://app.invalid";
export function safeInternalLink(link: string | null): string | null {
  if (!link || link.length > 2000 || !/^\/[^/\\]/.test(link) || /[\s\\\u0000-\u001f\u007f]/.test(link)) return null;
  try {
    const u = new URL(link, LINK_BASE);
    return u.origin === LINK_BASE && !u.pathname.startsWith("//") ? link : null;
  } catch {
    return null;
  }
}

function toDTO(r: Row): AlertDTO {
  return {
    id: r.id,
    type: r.type,
    severity: r.severity,
    status: r.status,
    title: r.title,
    message: r.message,
    link: safeInternalLink(r.link),
    departmentName: r.department_name,
    employeeName: r.last_name ? `${r.first_name ?? ""} ${r.last_name}`.trim() : null,
    comment: r.comment,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updatedByLogin: r.updated_by_login,
    canEdit: ALERT_TRANSITIONS[r.status].length > 0,
  };
}

export function listAlerts(ctx: AccessContext, filters: AlertFilters = {}): AlertDTO[] {
  const f = alertFiltersSchema.parse(filters);
  const v = visibility(ctx);
  const rows = getDb()
    .sqlite.prepare(
      `${SELECT}
       WHERE ${v.clause}
         AND (@type IS NULL OR a.type = @type)
         AND (@status IS NULL OR a.status = @status)
         AND (@severity IS NULL OR a.severity = @severity)
       ORDER BY CASE a.status WHEN 'NOUVELLE' THEN 0 WHEN 'EN_COURS' THEN 1 ELSE 2 END,
                CASE a.severity WHEN 'CRITIQUE' THEN 0 WHEN 'ATTENTION' THEN 1 ELSE 2 END,
                a.created_at DESC, a.id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...v.params, type: f.type ?? null, status: f.status ?? null, severity: f.severity ?? null, limit: f.limit, offset: f.offset }) as Row[];
  return rows.map(toDTO);
}

// Comptage exact (sans limite) des alertes visibles, mêmes filtres que listAlerts : bandeau « À traiter », pagination
export function countAlerts(ctx: AccessContext, filters: Omit<AlertFilters, "limit" | "offset"> = {}): number {
  const f = alertFiltersSchema.omit({ limit: true, offset: true }).parse(filters);
  const v = visibility(ctx);
  const row = getDb()
    .sqlite.prepare(
      `SELECT COUNT(*) AS n FROM alert a
       WHERE ${v.clause}
         AND (@type IS NULL OR a.type = @type)
         AND (@status IS NULL OR a.status = @status)
         AND (@severity IS NULL OR a.severity = @severity)`,
    )
    .get({ ...v.params, type: f.type ?? null, status: f.status ?? null, severity: f.severity ?? null }) as { n: number };
  return row.n;
}

export function countOpenAlerts(ctx: AccessContext): number {
  const v = visibility(ctx);
  const row = getDb()
    .sqlite.prepare(`SELECT COUNT(*) AS n FROM alert a WHERE ${v.clause} AND a.status IN ('NOUVELLE','EN_COURS')`)
    .get(v.params) as { n: number };
  return row.n;
}

function loadVisible(ctx: AccessContext, id: number, action: string): Row {
  const { sqlite } = getDb();
  if (!sqlite.prepare("SELECT 1 FROM alert WHERE id = ?").get(id)) throw notFound("Alerte");
  const v = visibility(ctx);
  const row = sqlite.prepare(`${SELECT} WHERE a.id = @id AND ${v.clause}`).get({ ...v.params, id }) as Row | undefined;
  if (!row) {
    audit(ctx.userId, action, { type: "alert", id }, "REFUSE");
    throw forbidden();
  }
  return row;
}

export function getAlert(ctx: AccessContext, id: number): AlertDTO {
  return toDTO(loadVisible(ctx, id, "alert.view"));
}

export function updateAlert(ctx: AccessContext, id: number, input: AlertUpdate): AlertDTO {
  const data = alertUpdateSchema.parse(input);
  const current = loadVisible(ctx, id, "alert.update");
  if (!ALERT_TRANSITIONS[current.status].includes(data.status)) {
    throw new HttpError(
      409,
      "TRANSITION_INVALIDE",
      `Passage du statut « ${STATUS_FR[current.status]} » au statut « ${STATUS_FR[data.status]} » impossible. Rechargez la page : l'alerte a peut-être déjà été traitée.`,
    );
  }
  const { sqlite } = getDb();
  const res = sqlite
    .prepare(
      `UPDATE alert SET status = @to, comment = COALESCE(@comment, comment),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = @userId
       WHERE id = @id AND status = @from`,
    )
    .run({ id, to: data.status, from: current.status, comment: data.comment ?? null, userId: ctx.userId });
  if (res.changes !== 1) throw new HttpError(409, "CONFLIT", "L'alerte a été modifiée entre-temps. Rechargez la page.");
  audit(ctx.userId, "alert.update", { type: "alert", id }, "OK", { from: current.status, to: data.status, comment: !!data.comment });
  return getAlert(ctx, id);
}
