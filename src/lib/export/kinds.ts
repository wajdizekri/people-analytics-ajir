import type { Role } from "@/db/schema";

export const EXPORT_KINDS = ["employees", "alerts", "recommendations"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_MAX_ROWS = 10_000;

// Mêmes rôles que la page de la liste
export const EXPORT_ROLES: Record<ExportKind, Role[]> = {
  employees: ["RH", "MANAGER"],
  alerts: ["ADMIN", "RH", "MANAGER"],
  recommendations: ["RH"],
};

// Paramètres d'URL des filtres et du tri de chaque page (ni « page » ni « retour »)
export const EXPORT_PARAMS: Record<ExportKind, readonly string[]> = {
  employees: ["q", "departement", "contrat", "niveau", "manager", "age", "anciennete", "tri", "ordre"],
  alerts: ["type", "status", "severity"],
  recommendations: ["statut", "action", "departement"],
};

export const EXPORT_FILE_PREFIX: Record<ExportKind, string> = { employees: "collaborateurs", alerts: "alertes", recommendations: "recommandations" };
export const EXPORT_LABEL: Record<ExportKind, string> = {
  employees: "la liste des collaborateurs",
  alerts: "la liste des alertes",
  recommendations: "la liste des recommandations",
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function pickExportParams(kind: ExportKind, raw: RawSearchParams): RawSearchParams {
  const out: RawSearchParams = {};
  for (const k of EXPORT_PARAMS[kind]) if (raw[k] !== undefined) out[k] = raw[k];
  return out;
}

export function exportHref(kind: ExportKind, raw: RawSearchParams = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(pickExportParams(kind, raw))) for (const x of Array.isArray(v) ? v : [v ?? ""]) if (x !== "") sp.append(k, x);
  const s = sp.toString();
  return `/api/export/${kind}${s ? `?${s}` : ""}`;
}

// Même forme que les searchParams d'une page Next : une valeur répétée devient un tableau
export function searchParamsRecord(sp: URLSearchParams): RawSearchParams {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of sp) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}
