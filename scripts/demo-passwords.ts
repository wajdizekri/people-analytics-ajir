import { dbPath, openSqlite } from "../src/db/client";
import { hashPassword, passwordPolicyError } from "../src/lib/auth/password";

// Usage : npx tsx scripts/demo-passwords.ts [--manager <login>]
const RH = { login: "rh.demo", password: "RhDemo2026pfe" };
const MANAGER_PASSWORD = "MgrDemo2026pfe";

type UserRow = { id: number; login: string; role: string; employee_id: number | null };

async function main() {
  const argv = process.argv.slice(2);
  const mIdx = argv.indexOf("--manager");
  const managerLogin = mIdx >= 0 ? argv[mIdx + 1] : undefined;
  if (mIdx >= 0 && !managerLogin) throw new Error("--manager attend un identifiant.");

  const sqlite = openSqlite();
  try {
    const rh = sqlite.prepare("SELECT id, login, role, employee_id FROM app_user WHERE login = ?").get(RH.login) as UserRow | undefined;
    if (!rh) throw new Error(`Compte ${RH.login} absent : importez d'abord un export contenant users.csv.`);
    const manager = (
      managerLogin
        ? sqlite.prepare("SELECT id, login, role, employee_id FROM app_user WHERE login = ? AND role = 'MANAGER'").get(managerLogin)
        : sqlite
            .prepare(
              `SELECT u.id, u.login, u.role, u.employee_id FROM app_user u JOIN employee e ON e.id = u.employee_id
               WHERE u.role = 'MANAGER' AND u.active = 1 AND e.status = 'ACTIF' ORDER BY u.id LIMIT 1`,
            )
            .get()
    ) as UserRow | undefined;
    if (!manager) throw new Error(managerLogin ? `Manager ${managerLogin} introuvable.` : "Aucun compte MANAGER actif rattaché à un salarié en poste.");

    const targets = [
      { user: rh, password: RH.password },
      { user: manager, password: MANAGER_PASSWORD },
    ];
    const hashes = await Promise.all(targets.map((t) => hashPassword(t.password)));
    const upd = sqlite.prepare(
      `UPDATE app_user SET password_hash = ?, active = 1, failed_attempts = 0, locked_until = NULL,
         activation_token_hash = NULL, activation_expires_at = NULL WHERE id = ?`,
    );
    const log = sqlite.prepare(
      "INSERT INTO audit_log (user_id, action, target_type, target_id, outcome, detail_json) VALUES (NULL, 'user.password.demo', 'app_user', ?, 'OK', ?)",
    );
    sqlite.transaction(() => {
      targets.forEach((t, i) => {
        const err = passwordPolicyError(t.password);
        if (err) throw new Error(err);
        upd.run(hashes[i], t.user.id);
        log.run(String(t.user.id), JSON.stringify({ login: t.user.login, source: "scripts/demo-passwords.ts" }));
      });
    })();

    const scope = sqlite
      .prepare(
        `WITH RECURSIVE team(id) AS (SELECT id FROM employee WHERE manager_id = @r UNION SELECT e.id FROM employee e JOIN team t ON e.manager_id = t.id)
         SELECT count(*) AS n FROM employee WHERE status = 'ACTIF' AND id IN (SELECT id FROM team)`,
      )
      .get({ r: manager.employee_id }) as { n: number };
    console.log(`Base ${dbPath()}`);
    console.log(`  ${RH.login.padEnd(16)} ${RH.password}  (RH)`);
    console.log(`  ${manager.login.padEnd(16)} ${MANAGER_PASSWORD}  (MANAGER, ${scope.n} collaborateurs actifs dans son périmètre)`);
  } finally {
    sqlite.close();
  }
}

main().catch((e) => {
  console.error(`Erreur : ${(e as Error).message}`);
  process.exit(1);
});
