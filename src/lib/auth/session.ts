import "server-only";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { cookies, headers } from "next/headers";
import { getDb } from "@/db/client";
import type { Role } from "@/db/schema";
import { trustedClientIp } from "./rate-limit";

export const SESSION_COOKIE = "pa_session";
// Plafond absolu : 10 h après la connexion (échéance du cookie). Expiration glissante : la session tombe après
// SESSION_IDLE_MINUTES sans requête ; chaque usage repousse expires_at, jamais au-delà du plafond.
const SESSION_HOURS = 10;
export const SESSION_IDLE_MINUTES = 120;
const SESSION_MS = SESSION_HOURS * 3600_000;
const IDLE_MS = SESSION_IDLE_MINUTES * 60_000;
const TOUCH_MS = 60_000; // au plus une écriture par minute et par session
const PURGE_EVERY_MS = 15 * 60_000;
let lastPurge = 0;

export type SessionUser = { userId: number; login: string; role: Role; employeeId: number | null };

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1";
}

// Sessions expirées (inactivité) ou au-delà du plafond : supprimées à la connexion et au plus tous les 1/4 h.
export function purgeExpiredSessions(sqlite: Database.Database = getDb().sqlite, now = Date.now()): number {
  lastPurge = now;
  return sqlite
    .prepare("DELETE FROM session WHERE expires_at <= @now OR created_at <= @cap")
    .run({ now: new Date(now).toISOString(), cap: new Date(now - SESSION_MS).toISOString() }).changes;
}

export async function createSession(userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const h = await headers();
  const { sqlite } = getDb();
  purgeExpiredSessions(sqlite);
  const expiresAt = isoIn(SESSION_HOURS);
  sqlite
    .prepare("INSERT INTO session (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)")
    .run(hashToken(token), userId, expiresAt, clientIp(h), (h.get("user-agent") ?? "").slice(0, 200));
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function readSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { sqlite } = getDb();
  const now = Date.now();
  if (now - lastPurge >= PURGE_EVERY_MS) purgeExpiredSessions(sqlite, now);
  const row = sqlite
    .prepare(
      `SELECT s.id, s.created_at, s.expires_at, u.id AS user_id, u.login, u.role, u.employee_id, u.active
       FROM session s JOIN app_user u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(hashToken(token)) as
    | { id: string; created_at: string; expires_at: string; user_id: number; login: string; role: Role; employee_id: number | null; active: number }
    | undefined;
  if (!row) return null;
  const created = Date.parse(row.created_at);
  const deadline = Number.isFinite(created) ? Math.min(now + IDLE_MS, created + SESSION_MS) : 0;
  if (row.expires_at <= new Date(now).toISOString() || deadline <= now) {
    sqlite.prepare("DELETE FROM session WHERE id = ?").run(row.id);
    return null;
  }
  if (!row.active) return null;
  if (!(Math.abs(deadline - Date.parse(row.expires_at)) < TOUCH_MS)) {
    sqlite.prepare("UPDATE session SET expires_at = ? WHERE id = ?").run(new Date(deadline).toISOString(), row.id);
  }
  return { userId: row.user_id, login: row.login, role: row.role, employeeId: row.employee_id };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) getDb().sqlite.prepare("DELETE FROM session WHERE id = ?").run(hashToken(token));
  store.delete(SESSION_COOKIE);
}

export function revokeUserSessions(userId: number): void {
  getDb().sqlite.prepare("DELETE FROM session WHERE user_id = ?").run(userId);
}

export async function revokeOtherSessions(userId: number): Promise<number> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const current = token ? hashToken(token) : "";
  return getDb().sqlite.prepare("DELETE FROM session WHERE user_id = ? AND id <> ?").run(userId, current).changes;
}

// Adresse journalisée (audit, sessions). Avec TRUST_PROXY, adresse fiable vue par le proxy ; sinon, indicative
// seulement (premier maillon de X-Forwarded-For, falsifiable) : ne jamais l'utiliser pour une décision.
export function clientIp(h: Headers): string {
  return trustedClientIp(h) ?? ((h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local");
}
