import type { Role } from "@/db/schema";
import { safeInternalLink } from "@/lib/dal/alerts";

// Destination après connexion (?next=) : chemin interne uniquement (même règle que les liens d'alerte),
// jamais la connexion, l'activation ni une API.
const EXCLUDED = ["/login", "/activation", "/api", "/_next", "/interdit"];
const ADMIN_ALLOWED = ["/admin", "/data-health", "/transparency", "/alerts", "/compte", "/aide"];
const RH_ONLY = ["/recommendations", "/backtesting", "/data-health", "/transparency", "/previsions", "/confidentialite"];

const under = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

export function safeNextPath(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length > 500 || value === "/") return null;
  const link = safeInternalLink(value);
  if (!link) return null;
  return under(link.split(/[?#]/)[0], EXCLUDED) ? null : link;
}

// Page accessible au rôle ? Sinon retour à l'accueil du rôle plutôt qu'un refus (/interdit).
export function nextAllowedFor(role: Role, next: string): boolean {
  const path = next.split(/[?#]/)[0];
  if (role === "ADMIN") return under(path, ADMIN_ALLOWED);
  if (under(path, ["/admin"])) return false;
  return !(role === "MANAGER" && under(path, RH_ONLY));
}
