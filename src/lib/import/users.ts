import crypto from "node:crypto";
import type { Role } from "@/db/schema";
import { processFile, type ImportCtx } from "./process";
import { reject } from "./rules";
import { COLUMNS, userRow } from "./schemas";

export const ACTIVATION_DAYS = 7;

export type ActivationLink = { login: string; link: string; expiresAt: string };

export type UserSyncReport = {
  created: string[];
  reactivated: string[];
  deactivated: string[];
  updated: number;
  protectedAdmins: string[];
  ignoredInactive: number;
};

type Existing = {
  id: number;
  role: Role;
  password_hash: string | null;
  active: number;
  activation_token_hash: string | null;
  activation_expires_at: string | null;
};

type UserLine = { login: string; role: Role; email: string | null; active: boolean; employeeId: number | null };

// Seul le SHA-256 du jeton est stocké ; le lien en clair n'est renvoyé qu'à l'appelant.
function newActivation() {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    hash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + ACTIVATION_DAYS * 86_400_000).toISOString(),
  };
}

// Synchronise app_user avec users.csv. Un compte ADMIN qui a déjà un mot de passe n'est jamais modifié.
export async function syncUsers(ctx: ImportCtx): Promise<{ report: UserSyncReport; links: ActivationLink[] } | null> {
  const { sqlite } = ctx;
  const report: UserSyncReport = { created: [], reactivated: [], deactivated: [], updated: 0, protectedAdmins: [], ignoredInactive: 0 };
  const links: ActivationLink[] = [];
  const seen = new Set<string>();
  const nowIso = new Date().toISOString();

  const find = sqlite.prepare(
    "SELECT id, role, password_hash, active, activation_token_hash, activation_expires_at FROM app_user WHERE login = ?",
  );
  const insert = sqlite.prepare(
    `INSERT INTO app_user (login, role, employee_id, email, active, activation_token_hash, activation_expires_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  const update = sqlite.prepare("UPDATE app_user SET role = ?, employee_id = ?, email = COALESCE(?, email), active = ? WHERE id = ?");
  const setToken = sqlite.prepare("UPDATE app_user SET activation_token_hash = ?, activation_expires_at = ? WHERE id = ?");
  const dropSessions = sqlite.prepare("DELETE FROM session WHERE user_id = ?");

  const apply = (u: UserLine) => {
    const ex = find.get(u.login) as Existing | undefined;
    if (ex && ex.role === "ADMIN" && ex.password_hash) {
      report.protectedAdmins.push(u.login);
      return;
    }
    if (!ex) {
      if (!u.active) {
        report.ignoredInactive++;
        return;
      }
      const a = newActivation();
      insert.run(u.login, u.role, u.employeeId, u.email, a.hash, a.expiresAt);
      report.created.push(u.login);
      links.push({ login: u.login, link: `/activation?token=${a.token}`, expiresAt: a.expiresAt });
      return;
    }
    update.run(u.role, u.employeeId, u.email, u.active ? 1 : 0, ex.id);
    if (ex.active && !u.active) {
      dropSessions.run(ex.id);
      report.deactivated.push(u.login);
    } else if (!ex.active && u.active) report.reactivated.push(u.login);
    else report.updated++;
    const tokenValid = ex.activation_token_hash && ex.activation_expires_at && ex.activation_expires_at > nowIso;
    if (u.active && !ex.password_hash && !tokenValid) {
      const a = newActivation();
      setToken.run(a.hash, a.expiresAt, ex.id);
      links.push({ login: u.login, link: `/activation?token=${a.token}`, expiresAt: a.expiresAt });
    }
  };

  const ok = await processFile(
    ctx,
    "users.csv",
    COLUMNS.users,
    userRow,
    (r): UserLine | ReturnType<typeof reject> => {
      if (seen.has(r.login)) return reject("DOUBLON", `Identifiant ${r.login} en double`);
      seen.add(r.login);
      let employeeId: number | null = null;
      if (r.matricule) {
        const id = ctx.empIds.get(r.matricule);
        if (id === undefined) return reject("MATRICULE_INCONNU", `Matricule ${r.matricule} du compte ${r.login} absent des collaborateurs importés (employees.csv)`);
        employeeId = id;
      } else if (r.role === "MANAGER") {
        return reject("CHAMP_OBLIGATOIRE", `Champ obligatoire manquant : matricule (compte manager ${r.login})`);
      }
      return { login: r.login, role: r.role, email: r.email ?? null, active: r.active ?? true, employeeId };
    },
    (rows) => rows.forEach(apply),
  );
  if (!ctx.files["users.csv"].present || !ok) return null;
  return { report, links };
}
