import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";

// Les confirmations (window.confirm) des actions qui clôturent ou désactivent sont acceptées
export const test = base.extend({
  page: async ({ page }, provide) => {
    page.on("dialog", (d) => void d.accept());
    await provide(page);
  },
});
export { expect };

export const ROOT = path.resolve(__dirname, "..", "..");
export const E2E_DB = process.env.E2E_DB ?? path.join(ROOT, "data", "e2e.db");
export const AUTH_DIR = path.join(ROOT, "test-results", "e2e-auth");

export type RoleKey = "admin" | "rh" | "manager";

export const USERS: Record<RoleKey, { login: string; password: string; home: string; roleLabel: string }> = {
  admin: { login: "admin", password: "Admin2026pfe", home: "/admin", roleLabel: "Administrateur" },
  rh: { login: "rh.demo", password: "RhDemo2026pfe", home: "/dashboard", roleLabel: "Responsable RH" },
  manager: { login: "mgr.M10451", password: "MgrDemo2026pfe", home: "/dashboard", roleLabel: "Manager" },
};
export const LOCK_USER = { login: "e2e.verrou", password: "E2eVerrou2026x" };
export const GENERIC_ERROR = "Identifiant ou mot de passe incorrect.";
export const LOCKED_ERROR = "Compte temporairement verrouillé. Réessayez plus tard.";

export const storageState = (role: RoleKey) => path.join(AUTH_DIR, `${role}.json`);

export async function login(page: Page, loginName: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Identifiant").fill(loginName);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

export async function loginAs(page: Page, role: RoleKey): Promise<void> {
  const u = USERS[role];
  await login(page, u.login, u.password);
  await page.waitForURL((url) => url.pathname === u.home || url.pathname.startsWith(`${u.home}/`), { timeout: 30_000 });
}

// Lecture seule de data/e2e.db pour retrouver des identifiants et vérifier les effets persistés
export function q<T = Record<string, unknown>>(sql: string, params: Record<string, unknown> | unknown[] = {}): T[] {
  const db = new Database(E2E_DB, { readonly: true, fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    return db.prepare(sql).all(params) as T[];
  } finally {
    db.close();
  }
}
export const q1 = <T = Record<string, unknown>>(sql: string, params: Record<string, unknown> | unknown[] = {}): T | undefined => q<T>(sql, params)[0];

export const SCOPE_SQL = `WITH RECURSIVE team(id) AS (
  SELECT id FROM employee WHERE manager_id = @root
  UNION SELECT e.id FROM employee e JOIN team t ON e.manager_id = t.id
) SELECT id FROM team`;

export function managerRoot(): number {
  return q1<{ id: number }>("SELECT employee_id AS id FROM app_user WHERE login = @l", { l: USERS.manager.login })!.id;
}
export function managerTeamIds(): number[] {
  return q<{ id: number }>(SCOPE_SQL, { root: managerRoot() }).map((r) => r.id);
}
export function activeTeamIds(): number[] {
  const team = managerTeamIds();
  return q<{ id: number }>(`SELECT id FROM employee WHERE status = 'ACTIF' AND id IN (${team.join(",")}) ORDER BY id`).map((r) => r.id);
}
export function outOfScopeEmployeeId(): number {
  const team = new Set(managerTeamIds());
  const rows = q<{ id: number }>("SELECT e.id FROM employee e JOIN prediction p ON p.employee_id = e.id AND p.run_id = (SELECT CAST(value AS INTEGER) FROM app_setting WHERE key = 'current_run_id') WHERE e.status = 'ACTIF' ORDER BY p.rank LIMIT 50");
  const found = rows.find((r) => !team.has(r.id) && r.id !== managerRoot());
  if (!found) throw new Error("Aucun salarié hors périmètre trouvé");
  return found.id;
}

// Contrôle axe-core (WCAG 2.0 / 2.1, niveaux A et AA) : les violations sont jointes au rapport et agrégées dans un fichier
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export type AxeSummary = { page: string; role: string; url: string; violations: { id: string; impact: string | null; help: string; nodes: number; targets: string[] }[] };

export async function axeScan(page: Page, testInfo: TestInfo, label: string, role: string): Promise<AxeSummary> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const summary: AxeSummary = {
    page: label,
    role,
    url: new URL(page.url()).pathname + new URL(page.url()).search,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? null,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => {
        const why = (n.failureSummary ?? "").split("\n").map((l) => l.trim()).find((l) => /contrast|focus|label|name|role/i.test(l) && !/^Fix/.test(l));
        return `${n.target.join(" ")}${why ? ` — ${why}` : ""}`;
      }),
    })),
  };
  await testInfo.attach(`axe-${label}`, { body: JSON.stringify(results.violations, null, 2), contentType: "application/json" });
  const dir = path.join(ROOT, "test-results", "e2e-axe");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${role}-${label.replace(/[^a-z0-9-]+/gi, "_")}.json`), JSON.stringify(summary, null, 2));
  return summary;
}

export const describeViolations = (s: AxeSummary) =>
  s.violations.map((v) => `[${v.impact}] ${v.id} (${v.nodes} nœud(s)) : ${v.help} → ${v.targets.join(" | ")}`).join("\n");

// Texte visible de la zone principale (hors menu et en-tête)
export async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").last().innerText()).replace(/\s+/g, " ");
}

export const toInt = (s: string) => Number(s.replace(/[^\d]/g, ""));

// Carte KPI = plus proche ancêtre (lien ou bloc arrondi) du libellé ; 2e ligne non vide = valeur
export const kpi = (page: Page, label: RegExp) =>
  page.locator("main").last().getByText(label).first().locator("xpath=ancestor::*[self::a or contains(@class,'rounded')][1]");
export async function kpiValue(page: Page, label: RegExp): Promise<string> {
  const lines = (await kpi(page, label).innerText()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines[1];
}

// « 12 résultats » ou « 120 résultats · page 1 sur 3 »
export async function resultCount(page: Page): Promise<number> {
  const t = await page.getByText(/^\d[\d\s  ]* résultats?/).first().innerText();
  return toInt(t.split("résultat")[0]);
}

// Fin du rendu en flux : squelette loading.tsx (aria-busy) disparu et titre de page affiché
export async function waitReady(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator("main h1").first()).toBeVisible();
}

// Message d'erreur applicatif (exclut l'annonceur de route de Next.js, lui aussi role=alert)
export const alertMsg = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

export async function expectForbidden(page: Page) {
  await expect(page).toHaveURL(/\/interdit$/);
  await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
}
