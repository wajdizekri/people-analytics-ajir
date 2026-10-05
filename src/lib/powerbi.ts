import type { Role } from "@/db/schema";

export const POWERBI_ROLES = ["RH", "MANAGER", "ADMIN"] as const satisfies readonly Role[];
export const POWERBI_SERVICE_ORIGIN = "https://app.powerbi.com";
export type PowerBiKind = "SERVICE" | "REPORT_SERVER";
export type PowerBiLink = { ok: true; url: string; kind: PowerBiKind } | { ok: false; error: string };

export const powerBiSettingKey = (role: Role) => `powerbi_url_${role.toLowerCase()}`;

const ORIGIN_RE = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

// Power BI Report Server sur site (installation hors ligne) : origine fixée au déploiement, reprise par la CSP (next.config.ts)
export function reportServerOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.POWERBI_REPORT_SERVER_ORIGIN?.trim().replace(/\/$/, "");
  return raw && ORIGIN_RE.test(raw) ? new URL(raw).origin : null;
}

// Accepte le lien « Incorporer le rapport → Site web ou portail » ou le code <iframe> complet ; refuse tout le reste
export function parsePowerBiLink(input: string, env: Record<string, string | undefined> = process.env): PowerBiLink {
  let raw = input.trim();
  const iframe = /<iframe\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(raw);
  if (iframe) raw = iframe[1].replace(/&amp;/g, "&");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "Lien invalide : collez l'adresse du rapport ou le code <iframe> fourni par Power BI." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Le lien doit commencer par https://." };
  if (u.username || u.password) return { ok: false, error: "Le lien ne doit pas contenir d'identifiant ni de mot de passe." };
  u.hash = "";

  if (u.origin === POWERBI_SERVICE_ORIGIN) {
    if (u.pathname === "/view")
      return { ok: false, error: "Lien « Publier sur le web » refusé : il rend le rapport public, sans filtrage par utilisateur. Utilisez Incorporer le rapport → Site web ou portail." };
    if (u.pathname !== "/reportEmbed")
      return { ok: false, error: "Lien non intégrable : utilisez Fichier → Incorporer le rapport → Site web ou portail (adresse en /reportEmbed)." };
    if (!u.searchParams.get("reportId")) return { ok: false, error: "Lien incomplet : l'identifiant du rapport (reportId) manque." };
    return { ok: true, url: u.toString(), kind: "SERVICE" };
  }

  const server = reportServerOrigin(env);
  if (server && u.origin === server) {
    if (!u.searchParams.has("rs:embed")) u.search += `${u.search ? "&" : "?"}rs:embed=true`;
    return { ok: true, url: u.toString(), kind: "REPORT_SERVER" };
  }
  return { ok: false, error: `Origine non autorisée : seuls ${[POWERBI_SERVICE_ORIGIN, server].filter(Boolean).join(" et ")} peuvent être intégrés.` };
}
