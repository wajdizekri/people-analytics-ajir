import "server-only";
import type Database from "better-sqlite3";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { Role } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { POWERBI_ROLES, parsePowerBiLink, powerBiSettingKey, type PowerBiKind } from "@/lib/powerbi";
import { ensureRole } from "./admin";
import type { AccessContext } from "./context";

export type PowerBiReportDTO = { role: Role; url: string | null; kind: PowerBiKind | null; invalid: boolean };
export type PowerBiConfigRow = { role: Role; value: string; status: "ABSENT" | "OK" | "INVALIDE"; error: string | null; updatedAt: string | null; updatedBy: string | null };

// Le lien stocké est revalidé à chaque lecture : un lien devenu non autorisé (origine retirée) n'est jamais intégré
function readLink(sqlite: Database.Database, role: Role) {
  const value = getSetting(sqlite, powerBiSettingKey(role));
  if (!value) return { value, link: null };
  return { value, link: parsePowerBiLink(value) };
}

// Chaque rôle reçoit uniquement le rapport configuré pour lui ; le filtrage par utilisateur relève de la RLS de Power BI
export function getPowerBiReport(ctx: AccessContext): PowerBiReportDTO {
  const { link } = readLink(getDb().sqlite, ctx.role);
  const ok = link?.ok ? link : null;
  audit(ctx.userId, "powerbi.view", { type: "powerbi", id: ctx.role }, "OK", { configured: !!ok });
  return { role: ctx.role, url: ok?.url ?? null, kind: ok?.kind ?? null, invalid: !!link && !link.ok };
}

export function getPowerBiConfig(ctx: AccessContext): PowerBiConfigRow[] {
  ensureRole(ctx, ["ADMIN"], "powerbi.config.view");
  const { sqlite } = getDb();
  const meta = sqlite.prepare("SELECT s.updated_at, u.login FROM app_setting s LEFT JOIN app_user u ON u.id = s.updated_by WHERE s.key = ?");
  return POWERBI_ROLES.map((role) => {
    const { value, link } = readLink(sqlite, role);
    const m = meta.get(powerBiSettingKey(role)) as { updated_at: string | null; login: string | null } | undefined;
    return {
      role,
      value,
      status: !link ? "ABSENT" : link.ok ? "OK" : "INVALIDE",
      error: link && !link.ok ? link.error : null,
      updatedAt: m?.updated_at ?? null,
      updatedBy: m?.login ?? null,
    };
  });
}

export const powerBiConfigSchema = z.object(
  Object.fromEntries(POWERBI_ROLES.map((r) => [r, z.string().trim().max(4000, "Lien trop long (4 000 caractères au plus).")])) as Record<
    (typeof POWERBI_ROLES)[number],
    z.ZodString
  >,
);

export type PowerBiConfigResult = { ok: true; changed: Role[] } | { ok: false; fieldErrors: Partial<Record<Role, string>> };

export function updatePowerBiConfig(ctx: AccessContext, input: Record<string, string>): PowerBiConfigResult {
  ensureRole(ctx, ["ADMIN"], "powerbi.config.update");
  const parsed = powerBiConfigSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<Role, string>> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path[0] as Role] ??= i.message;
    return { ok: false, fieldErrors };
  }
  const next = new Map<Role, string>();
  const fieldErrors: Partial<Record<Role, string>> = {};
  for (const role of POWERBI_ROLES) {
    const raw = parsed.data[role];
    if (!raw) next.set(role, "");
    else {
      const link = parsePowerBiLink(raw);
      if (link.ok) next.set(role, link.url);
      else fieldErrors[role] = link.error;
    }
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const { sqlite } = getDb();
  const changes: Record<string, string> = {};
  sqlite.transaction(() => {
    for (const [role, to] of next) {
      const key = powerBiSettingKey(role);
      const from = getSetting(sqlite, key);
      if (from === to) continue;
      if (to) setSetting(sqlite, key, to, ctx.userId);
      else sqlite.prepare("DELETE FROM app_setting WHERE key = ?").run(key);
      changes[role] = !from ? "AJOUT" : !to ? "RETRAIT" : "MODIFICATION";
    }
  })();
  if (Object.keys(changes).length) audit(ctx.userId, "powerbi.config.update", { type: "settings" }, "OK", { changes });
  return { ok: true, changed: Object.keys(changes) as Role[] };
}
