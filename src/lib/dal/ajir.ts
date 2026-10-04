import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { PILOTAGE_ROLES, canSeeEmployee, type AccessContext } from "./context";
import { forbidden, notFound } from "./errors";

// ---------- Lien profond depuis le menu AJIR ----------

export const matriculeSchema = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/);

// Fiche d'un salarié par matricule : 404 si inconnu (vérifié en premier), 403 audité si hors périmètre ou rôle sans
// données RH (ADMIN) ; sinon identifiant de la fiche, dont l'ouverture est auditée par la page elle-même.
export function resolveEmployeeLink(ctx: AccessContext, matricule: string, ip?: string): number {
  const m = matriculeSchema.safeParse(matricule);
  if (!m.success) throw notFound("Collaborateur");
  const row = getDb().sqlite.prepare("SELECT id FROM employee WHERE matricule = ?").get(m.data) as { id: number } | undefined;
  if (!row) throw notFound("Collaborateur");
  if (!PILOTAGE_ROLES.includes(ctx.role) || !canSeeEmployee(ctx, row.id)) {
    audit(ctx.userId, "employee.deeplink", { type: "employee", id: row.id }, "REFUSE", { role: ctx.role, source: "ajir" }, ip);
    throw forbidden();
  }
  return row.id;
}

// ---------- Ouverture depuis AJIR par jeton signé (docs/INTEGRATION_AJIR.md) ----------

export const LAUNCH_MAX_AGE_S = 60;
export const LAUNCH_DEFAULT_TARGET = "/go/tableau-de-bord";
const MIN_SECRET_LENGTH = 32;
const LOGIN_RE = /^[A-Za-z0-9._@-]{1,100}$/;
const TARGET_RE = /^\/go\/(tableau-de-bord|collaborateur\/[A-Za-z0-9._-]{1,32})$/;

// Secret partagé avec AJIR ; absent ou trop court = fonctionnalité désactivée.
export function launchSecret(): string | null {
  const s = process.env.AJIR_LAUNCH_SECRET ?? "";
  return s.length >= MIN_SECRET_LENGTH ? s : null;
}

export const launchMessage = (login: string, ts: string | number, target: string) => `${login}|${ts}|${target}`;

export function signLaunch(secret: string, login: string, ts: string | number, target: string): string {
  return crypto.createHmac("sha256", secret).update(launchMessage(login, ts, target), "utf8").digest("hex");
}

export type LaunchParams = { login?: string | null; ts?: string | null; sig?: string | null; cible?: string | null };
export type LaunchResult = { ok: true; userId: number; target: string } | { ok: false; status: 401 | 404; reason: string };

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// Vérifie le jeton (format, signature HMAC-SHA256 en temps constant, fraîcheur ±60 s, compte actif) puis le consomme :
// l'empreinte de la signature est mémorisée dans le journal d'audit (auth.ajir_launch), et une signature déjà vue dans la
// fenêtre de validité est refusée (anti-rejeu, vérification et mémorisation dans une même transaction).
export function verifyLaunch(p: LaunchParams, nowMs = Date.now(), ip?: string): LaunchResult {
  const secret = launchSecret();
  if (!secret) return { ok: false, status: 404, reason: "desactive" };
  const login = p.login ?? "";
  const ts = p.ts ?? "";
  const sig = (p.sig ?? "").toLowerCase();
  const target = p.cible || LAUNCH_DEFAULT_TARGET;
  const refuse = (reason: string, userId: number | null = null): LaunchResult => {
    audit(userId, "auth.ajir_launch", { type: "ajir_launch", id: /^[0-9a-f]{64}$/.test(sig) ? sha256(sig) : null }, "REFUSE", { reason, login: login.slice(0, 100) }, ip);
    return { ok: false, status: 401, reason };
  };
  if (!LOGIN_RE.test(login) || !/^\d{1,12}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig) || !TARGET_RE.test(target)) return refuse("format");
  const expected = Buffer.from(signLaunch(secret, login, ts, target), "hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), expected)) return refuse("signature");
  if (Math.abs(nowMs / 1000 - Number(ts)) > LAUNCH_MAX_AGE_S) return refuse("expire");

  const { sqlite } = getDb();
  const user = sqlite.prepare("SELECT id, active FROM app_user WHERE login = ?").get(login) as { id: number; active: number } | undefined;
  if (!user || !user.active) return refuse("compte_inactif", user?.id ?? null);

  const sigHash = sha256(sig);
  const since = new Date(nowMs - 3 * LAUNCH_MAX_AGE_S * 1000).toISOString();
  const fresh = sqlite
    .transaction(() => {
      const seen = sqlite
        .prepare("SELECT 1 FROM audit_log WHERE at >= ? AND action = 'auth.ajir_launch' AND outcome = 'OK' AND target_id = ?")
        .get(since, sigHash);
      if (seen) return false;
      audit(user.id, "auth.ajir_launch", { type: "ajir_launch", id: sigHash }, "OK", { login, target }, ip);
      return true;
    })
    .immediate();
  if (!fresh) return refuse("rejeu", user.id);
  return { ok: true, userId: user.id, target };
}
