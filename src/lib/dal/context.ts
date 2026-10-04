import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, readSession } from "@/lib/auth/session";
import type { Role } from "@/db/schema";
import { getDb } from "@/db/client";
import { audit, type AuditTarget } from "@/lib/audit";
import { HttpError, forbidden } from "./errors";

// Contexte d'accès transmis à TOUTES les fonctions de lib/dal.
// Le périmètre est toujours résolu côté serveur, jamais depuis un paramètre client.
export type AccessContext = {
  userId: number;
  login: string;
  role: Role;
  employeeId: number | null; // manager : racine de sa hiérarchie
};

export async function getContext(): Promise<AccessContext | null> {
  const s = await readSession();
  return s ? { userId: s.userId, login: s.login, role: s.role, employeeId: s.employeeId } : null;
}

// Refus de rôle au niveau page / route, audité une seule fois : le refus interrompt la requête avant la DAL,
// donc avant ensurePilotage / ensureRole. Route = en-tête interne posé par src/proxy.ts (null hors requête).
export const ROUTE_HEADER = "x-pa-pathname";

async function auditRoleRefusal(ctx: AccessContext, action: "access.page" | "access.api", roles: Role[]): Promise<void> {
  let route: string | null = null;
  let ip: string | undefined;
  try {
    const h = await headers();
    route = h.get(ROUTE_HEADER)?.slice(0, 200) ?? null;
    ip = clientIp(h);
  } catch {
    // hors contexte de requête (tests, scripts) : refus audité sans route
  }
  audit(ctx.userId, action, { type: "route", id: route }, "REFUSE", { role: ctx.role, required: roles }, ip);
}

// Pour les Route Handlers : 401 / 403 sous forme d'exception (convertie par withApi)
export async function requireContext(roles?: Role[]): Promise<AccessContext> {
  const ctx = await getContext();
  if (!ctx) throw new HttpError(401, "NON_AUTHENTIFIE", "Session expirée ou absente. Reconnectez-vous pour continuer.");
  if (roles && !roles.includes(ctx.role)) {
    await auditRoleRefusal(ctx, "access.api", roles);
    throw new HttpError(403, "INTERDIT", "Accès refusé : cette donnée ou cette action ne fait pas partie de votre périmètre.");
  }
  return ctx;
}

// Session expirée alors que le cookie est encore là (le proxy a laissé passer) : retour à la page demandée après
// connexion (?next=), chemin pris dans ROUTE_HEADER et validé comme chemin interne (safeNextPath).
// Import dynamique : next-path dépend de dal/alerts, qui dépend de ce module.
async function loginPath(): Promise<string> {
  let route: string | null = null;
  try {
    route = (await headers()).get(ROUTE_HEADER);
  } catch {
    // hors contexte de requête
  }
  if (!route) return "/login";
  const { safeNextPath } = await import("@/app/login/next-path");
  const next = safeNextPath(route);
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

// Pour les pages : redirection vers /login si pas de session, /interdit si rôle insuffisant
export async function pageContext(roles?: Role[]): Promise<AccessContext> {
  const ctx = await getContext();
  if (!ctx) redirect(await loginPath());
  if (roles && !roles.includes(ctx.role)) {
    await auditRoleRefusal(ctx, "access.page", roles);
    redirect("/interdit");
  }
  return ctx;
}

// Séparation des tâches : l'ADMIN administre l'outil (comptes, paramètres, audit, imports, modèle)
// mais ne voit aucune donnée nominative ni indicateur RH. Vue entreprise = RH seule ; MANAGER = sa hiérarchie.
export const PILOTAGE_ROLES: Role[] = ["RH", "MANAGER"];

export const isGlobal = (ctx: AccessContext) => ctx.role === "RH";

export const homePath = (role: Role) => (role === "ADMIN" ? "/admin" : "/dashboard");

export function ensurePilotage(ctx: AccessContext, action: string, target?: AuditTarget): void {
  if (PILOTAGE_ROLES.includes(ctx.role)) return;
  audit(ctx.userId, action, target, "REFUSE", { role: ctx.role });
  throw forbidden();
}

// Sous-requête SQL des salariés visibles par un manager (toute sa hiérarchie, lui exclu).
// Usage : `... WHERE e.id IN (${SCOPE_SUBQUERY})` avec le paramètre nommé @scopeRoot.
export const SCOPE_SUBQUERY = `
  WITH RECURSIVE team(id) AS (
    SELECT id FROM employee WHERE manager_id = @scopeRoot
    UNION
    SELECT e.id FROM employee e JOIN team t ON e.manager_id = t.id
  ) SELECT id FROM team`;

// Renvoie { clause, params } à insérer dans un WHERE. RH : pas de filtre ; ADMIN : aucune ligne.
export function scopeFilter(ctx: AccessContext, column = "e.id"): { clause: string; params: Record<string, unknown> } {
  if (isGlobal(ctx)) return { clause: "1=1", params: {} };
  if (ctx.role === "MANAGER" && ctx.employeeId != null)
    return { clause: `${column} IN (${SCOPE_SUBQUERY})`, params: { scopeRoot: ctx.employeeId } };
  return { clause: "1=0", params: {} };
}

export function visibleEmployeeIds(ctx: AccessContext): number[] | null {
  if (isGlobal(ctx)) return null;
  if (ctx.role !== "MANAGER" || ctx.employeeId == null) return [];
  const rows = getDb().sqlite.prepare(SCOPE_SUBQUERY).all({ scopeRoot: ctx.employeeId }) as { id: number }[];
  return rows.map((r) => r.id);
}

export function canSeeEmployee(ctx: AccessContext, employeeId: number): boolean {
  if (isGlobal(ctx)) return true;
  if (ctx.role !== "MANAGER" || ctx.employeeId == null) return false;
  const row = getDb()
    .sqlite.prepare(`SELECT 1 AS ok WHERE @id IN (${SCOPE_SUBQUERY})`)
    .get({ id: employeeId, scopeRoot: ctx.employeeId });
  return !!row;
}
