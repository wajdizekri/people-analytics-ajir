import "server-only";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { hashPassword, verifyPassword } from "./password";
import { clientIp, createSession } from "./session";
import { RATE_RULES, recordFailure, retryAfter, tooManyMessage, trustedClientIp } from "./rate-limit";
import { audit } from "@/lib/audit";

export const MAX_ATTEMPTS = 5;

export type LoginResult = { ok: true } | { ok: false; message: string };

// Message volontairement identique pour « login inconnu » et « mauvais mot de passe »
const GENERIC = "Identifiant ou mot de passe incorrect. Vérifiez votre saisie, majuscules comprises, puis réessayez.";
const LOCKED = "Compte temporairement verrouillé après plusieurs essais infructueux. Réessayez dans quelques minutes ou demandez à l'administrateur de le déverrouiller.";

// Verrouillage progressif : 1, 2, 4, 8... minutes (plafond 64) à partir de la 5e tentative.
function lockDelayMs(attempts: number): number | null {
  return attempts >= MAX_ATTEMPTS ? 60_000 * 2 ** Math.min(attempts - MAX_ATTEMPTS, 6) : null;
}

// Réserve la tentative avant la vérification (argon2 est asynchrone) : compteur incrémenté et, au seuil, verrou posé
// dans une même transaction, pour que des essais parallèles ne s'appuient jamais sur un compteur périmé.
// null = compte verrouillé.
function reserveAttempt(sqlite: Database.Database, userId: number): number | null {
  return sqlite
    .transaction(() => {
      const now = Date.now();
      const u = sqlite.prepare("SELECT failed_attempts AS n, locked_until AS lock FROM app_user WHERE id = ?").get(userId) as { n: number; lock: string | null };
      if (u.lock && u.lock > new Date(now).toISOString()) return null;
      const attempts = u.n + 1;
      const delay = lockDelayMs(attempts);
      sqlite.prepare("UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(attempts, delay === null ? null : new Date(now + delay).toISOString(), userId);
      return attempts;
    })
    .immediate();
}

// Identifiant inconnu, inactif ou sans mot de passe : même verrou progressif qu'un compte réel, tenu en mémoire,
// pour que le message « verrouillé » ne révèle pas l'existence d'un compte. false = verrouillé.
type Ghost = { attempts: number; lockedUntil: number; seenAt: number };
const GHOST_TTL_MS = 24 * 3600_000;
const MAX_GHOSTS = 10_000;
const g = globalThis as unknown as { __paLoginGhosts?: Map<string, Ghost> };

function reserveGhostAttempt(loginName: string, now = Date.now()): boolean {
  const ghosts = (g.__paLoginGhosts ??= new Map());
  let e = ghosts.get(loginName);
  if (e && now - e.seenAt > GHOST_TTL_MS) e = undefined;
  if (e && e.lockedUntil > now) return false;
  if (!e && ghosts.size >= MAX_GHOSTS) {
    for (const [k, v] of ghosts) if (ghosts.size >= MAX_GHOSTS || now - v.seenAt > GHOST_TTL_MS) ghosts.delete(k);
  }
  e ??= { attempts: 0, lockedUntil: 0, seenAt: now };
  e.attempts++;
  e.seenAt = now;
  e.lockedUntil = now + (lockDelayMs(e.attempts) ?? 0);
  ghosts.set(loginName, e);
  return true;
}

// Même coût argon2 qu'un compte réel : le délai de réponse ne distingue pas un identifiant inconnu.
let decoyHash: Promise<string> | undefined;
async function decoyVerify(password: string): Promise<void> {
  decoyHash ??= hashPassword(crypto.randomBytes(16).toString("base64url"));
  await verifyPassword(await decoyHash, password);
}

async function requestHeaders(): Promise<Headers | null> {
  try {
    return await headers();
  } catch {
    return null;
  }
}

export async function login(loginName: string, password: string): Promise<LoginResult> {
  const h = await requestHeaders();
  const ip = h ? clientIp(h) : undefined;
  const trusted = h ? trustedClientIp(h) : null;
  const ipKey = trusted ? `login:ip:${trusted}` : null;
  if (ipKey) {
    const wait = retryAfter(ipKey, RATE_RULES.loginIp);
    if (wait > 0) {
      audit(null, "auth.login", { type: "user", id: loginName }, "REFUSE", { reason: "limite_ip" }, ip);
      return { ok: false, message: tooManyMessage(wait) };
    }
  }
  const refuse = (userId: number | null, target: string, detail: Record<string, unknown>, message: string): LoginResult => {
    if (ipKey) recordFailure(ipKey, RATE_RULES.loginIp);
    audit(userId, "auth.login", { type: "user", id: target }, "REFUSE", detail, ip);
    return { ok: false, message };
  };

  const { sqlite } = getDb();
  const user = sqlite.prepare("SELECT id, password_hash, active FROM app_user WHERE login = ?").get(loginName) as
    | { id: number; password_hash: string | null; active: number }
    | undefined;

  if (!user || !user.active || !user.password_hash) {
    if (!reserveGhostAttempt(loginName)) return refuse(null, loginName, { reason: "verrouille" }, LOCKED);
    await decoyVerify(password);
    return refuse(null, loginName, { reason: "inconnu_ou_inactif" }, GENERIC);
  }
  const attempts = reserveAttempt(sqlite, user.id);
  if (attempts === null) return refuse(user.id, String(user.id), { reason: "verrouille" }, LOCKED);
  if (!(await verifyPassword(user.password_hash, password))) {
    return refuse(user.id, String(user.id), { reason: "mot_de_passe", attempts }, GENERIC);
  }
  sqlite.prepare("UPDATE app_user SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(user.id);
  await createSession(user.id);
  audit(user.id, "auth.login", { type: "user", id: String(user.id) }, "OK", undefined, ip);
  return { ok: true };
}
