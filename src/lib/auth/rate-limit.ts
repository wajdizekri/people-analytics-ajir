import "server-only";
import net from "node:net";

// Limitation légère en mémoire (un seul processus Next.js), par fenêtre fixe, qui ne compte que les échecs.
// Elle complète le verrou progressif en base (login.ts) sans jamais pouvoir bloquer tous les utilisateurs :
// la clé IP n'est appliquée que si l'adresse est fiable (voir trustedClientIp), la clé compte ne vise qu'un compte.
export type Rule = { limit: number; windowMs: number };

const MINUTE = 60_000;
export const RATE_RULES = {
  loginIp: { limit: 30, windowMs: 15 * MINUTE },
  activationIp: { limit: 20, windowMs: 15 * MINUTE },
  activationAccount: { limit: 10, windowMs: 15 * MINUTE },
  passwordChange: { limit: 5, windowMs: 15 * MINUTE },
  assistant: { limit: 30, windowMs: 15 * MINUTE },
} satisfies Record<string, Rule>;

type Entry = { count: number; resetAt: number };
const MAX_KEYS = 10_000;
const g = globalThis as unknown as { __paRateLimit?: Map<string, Entry> };
const store = () => (g.__paRateLimit ??= new Map());

// Millisecondes à attendre avant un nouvel essai (0 = autorisé).
export function retryAfter(key: string, rule: Rule, now = Date.now()): number {
  const e = store().get(key);
  if (!e || e.resetAt <= now || e.count < rule.limit) return 0;
  return e.resetAt - now;
}

export function recordFailure(key: string, rule: Rule, now = Date.now()): void {
  const s = store();
  const e = s.get(key);
  if (e && e.resetAt > now) {
    e.count++;
    return;
  }
  if (s.size >= MAX_KEYS) prune(s, now);
  s.set(key, { count: 1, resetAt: now + rule.windowMs });
}

// Saturation (clés inventées en masse) : on oublie d'abord les fenêtres échues, puis les plus anciennes clés.
// Un attaquant peut ainsi affaiblir la limitation, jamais bloquer une clé qui n'est pas la sienne.
function prune(s: Map<string, Entry>, now: number): void {
  for (const [k, e] of s) if (e.resetAt <= now) s.delete(k);
  for (const k of s.keys()) {
    if (s.size < MAX_KEYS) break;
    s.delete(k);
  }
}

// Quota d'usage (assistant d'aide) : compte chaque appel, pas seulement les échecs.
// Renvoie l'attente en millisecondes ; 0 = appel autorisé et compté.
export function consume(key: string, rule: Rule, now = Date.now()): number {
  const wait = retryAfter(key, rule, now);
  if (wait) return wait;
  recordFailure(key, rule, now);
  return 0;
}

export function resetRateLimits(): void {
  store().clear();
}

export function tooManyMessage(waitMs: number): string {
  const min = Math.max(1, Math.ceil(waitMs / MINUTE));
  return `Trop de tentatives. Réessayez dans ${min} minute${min > 1 ? "s" : ""}.`;
}

// TRUST_PROXY = nombre de proxys de confiance devant Next.js : 0 (défaut) ou 1 derrière Caddy (deploy/caddy),
// qui remplace l'en-tête X-Forwarded-For reçu d'un client non fiable par l'adresse réelle du pair.
// L'adresse du client est alors le N-ième maillon de X-Forwarded-For en partant de la droite ; les maillons plus
// à gauche, fournis par le client, sont ignorés. Sans proxy de confiance, l'en-tête est falsifiable : null.
export function trustedProxyHops(): number {
  const v = (process.env.TRUST_PROXY ?? "").trim().toLowerCase();
  if (v === "true") return 1;
  const n = /^\d+$/.test(v) ? Number(v) : 0;
  return n > 0 && n <= 10 ? n : 0;
}

export function trustedClientIp(h: Headers): string | null {
  const hops = trustedProxyHops();
  if (!hops) return null;
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = chain[chain.length - hops];
  return ip && net.isIP(ip) ? ip : null;
}
