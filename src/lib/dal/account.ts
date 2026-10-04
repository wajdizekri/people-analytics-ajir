import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { Role } from "@/db/schema";
import { audit } from "@/lib/audit";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/auth/password";
import { RATE_RULES, recordFailure, retryAfter, tooManyMessage } from "@/lib/auth/rate-limit";
import { revokeOtherSessions } from "@/lib/auth/session";
import { visibleEmployeeIds, type AccessContext } from "./context";

// « Mon compte » : écran commun aux trois rôles, limité aux données de l'utilisateur connecté.

export type AccountDTO = {
  login: string;
  role: Role;
  email: string | null;
  employee: { matricule: string; name: string } | null;
  createdAt: string;
  lastLoginAt: string | null;
  openSessions: number;
  teamSize: number | null;
  activity: { id: number; at: string; action: string; outcome: "OK" | "REFUSE" | "ECHEC" }[];
};

export function getAccount(ctx: AccessContext): AccountDTO {
  const { sqlite } = getDb();
  const u = sqlite
    .prepare(
      `SELECT u.email, u.created_at, e.matricule, e.first_name, e.last_name
       FROM app_user u LEFT JOIN employee e ON e.id = u.employee_id WHERE u.id = ?`,
    )
    .get(ctx.userId) as { email: string | null; created_at: string; matricule: string | null; first_name: string | null; last_name: string | null };
  // Avant-dernière connexion réussie : la dernière est la session en cours
  const logins = sqlite
    .prepare("SELECT at FROM audit_log WHERE user_id = ? AND action = 'auth.login' AND outcome = 'OK' ORDER BY at DESC, id DESC LIMIT 2")
    .all(ctx.userId) as { at: string }[];
  const openSessions = (sqlite.prepare("SELECT COUNT(*) AS n FROM session WHERE user_id = ? AND expires_at > ?").get(ctx.userId, new Date().toISOString()) as { n: number }).n;
  const activity = sqlite
    .prepare("SELECT id, at, action, outcome FROM audit_log WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT 10")
    .all(ctx.userId) as AccountDTO["activity"];
  return {
    login: ctx.login,
    role: ctx.role,
    email: u.email,
    employee: u.matricule ? { matricule: u.matricule, name: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() } : null,
    createdAt: u.created_at,
    lastLoginAt: logins[1]?.at ?? null,
    openSessions,
    teamSize: ctx.role === "MANAGER" ? (visibleEmployeeIds(ctx) ?? []).length : null,
    activity,
  };
}

export const passwordChangeSchema = z
  .object({
    current: z.string().min(1, "Saisissez votre mot de passe actuel.").max(200, "Mot de passe actuel trop long : 200 caractères au plus."),
    password: z.string().min(1, "Saisissez un nouveau mot de passe.").max(200, "Mot de passe trop long : 200 caractères au plus."),
    confirm: z.string().max(200, "Confirmation trop longue : 200 caractères au plus."),
  })
  .refine((v) => v.password === v.confirm, { message: "Les deux mots de passe saisis sont différents : saisissez le même mot de passe dans les deux champs.", path: ["confirm"] })
  .refine((v) => v.password !== v.current, { message: "Le nouveau mot de passe doit être différent de l'actuel.", path: ["password"] });

export type PasswordChangeResult = { ok: true; revoked: number } | { ok: false; error: string };

// Les autres sessions de l'utilisateur sont fermées ; la session courante reste ouverte.
export async function changeOwnPassword(ctx: AccessContext, input: z.input<typeof passwordChangeSchema>): Promise<PasswordChangeResult> {
  const parsed = passwordChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const { current, password } = parsed.data;
  const policy = passwordPolicyError(password);
  if (policy) return { ok: false, error: policy };
  // Essais du mot de passe actuel limités par compte (session volée : pas de recherche du mot de passe par essais)
  const key = `pwd:${ctx.userId}`;
  const wait = retryAfter(key, RATE_RULES.passwordChange);
  if (wait > 0) {
    audit(ctx.userId, "user.password_change", { type: "user", id: ctx.userId }, "REFUSE", { reason: "limite" });
    return { ok: false, error: tooManyMessage(wait) };
  }
  const { sqlite } = getDb();
  const row = sqlite.prepare("SELECT password_hash FROM app_user WHERE id = ? AND active = 1").get(ctx.userId) as { password_hash: string | null } | undefined;
  if (!row?.password_hash || !(await verifyPassword(row.password_hash, current))) {
    recordFailure(key, RATE_RULES.passwordChange);
    audit(ctx.userId, "user.password_change", { type: "user", id: ctx.userId }, "ECHEC", { reason: "mot_de_passe_actuel" });
    return { ok: false, error: "Mot de passe actuel incorrect." };
  }
  sqlite.prepare("UPDATE app_user SET password_hash = ? WHERE id = ?").run(await hashPassword(password), ctx.userId);
  const revoked = await revokeOtherSessions(ctx.userId);
  audit(ctx.userId, "user.password_change", { type: "user", id: ctx.userId }, "OK", { revokedSessions: revoked });
  return { ok: true, revoked };
}
