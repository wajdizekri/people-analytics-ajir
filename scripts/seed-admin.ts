import crypto from "node:crypto";
import { openSqlite } from "../src/db/client";
import { hashPassword } from "../src/lib/auth/password";

// Usage : npm run seed:admin -- [login] [motDePasse]
const login = process.argv[2] ?? "admin";
const password = process.argv[3] ?? crypto.randomBytes(9).toString("base64url") + "1a";

async function main() {
  const sqlite = openSqlite();
  const exists = sqlite.prepare("SELECT id FROM app_user WHERE login = ?").get(login);
  if (exists) {
    console.log(`L'utilisateur ${login} existe déjà.`);
  } else {
    sqlite.prepare("INSERT INTO app_user (login, password_hash, role) VALUES (?, ?, 'ADMIN')").run(login, await hashPassword(password));
    console.log(`Administrateur créé : ${login} / ${password}`);
  }
  sqlite.close();
}

main();
