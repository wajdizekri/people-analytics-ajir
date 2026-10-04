import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { setupDb, teardownDb } from "../ui-admin/helpers";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<object>()), readSession: async () => session.current }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

let fx: ReturnType<typeof setupDb>;
beforeAll(() => {
  fx = setupDb("console");
});
afterAll(() => teardownDb(fx.file));

const DAY = 86_400_000;
const noon = (offset: number) => {
  const d = new Date();
  return `${new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - offset * DAY).toISOString().slice(0, 10)}T12:00:00.000Z`;
};

function event(offset: number, action: string, outcome: "OK" | "REFUSE", userId: number | null, times = 1) {
  const stmt = getDb().sqlite.prepare("INSERT INTO audit_log (at, user_id, action, outcome) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < times; i++) stmt.run(noon(offset), userId, action, outcome);
}

function job(offset: number, type: string, status: string, durationS: number | null) {
  const created = noon(offset);
  const finished = durationS == null ? null : new Date(Date.parse(created) + durationS * 1000).toISOString();
  getDb()
    .sqlite.prepare("INSERT INTO app_job (type, status, created_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?)")
    .run(type, status, created, durationS == null ? null : created, finished);
}

const as = (who: "admin" | "rh") => (session.current = { userId: fx.users[who], login: fx.ctx[who].login, role: fx.ctx[who].role, employeeId: null } as SessionUser);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");
const count = (s: string, part: string) => s.split(part).length - 1;
const headings = (html: string, level: number) => [...html.matchAll(new RegExp(`<h${level}[^>]*>(.*?)</h${level}>`, "g"))].map((m) => text(m[1]).trim());

async function render() {
  const Page = (await import("@/app/(app)/admin/page")).default;
  as("admin");
  const html = renderToStaticMarkup((await Page()) as ReactElement);
  return { html, t: text(html) };
}

const NOMINATIVE = /Nom (DG|MGR|SUB|E\d)|TND|[Ss]alaire|Risque (élevé|moyen|faible)/;

describe("console d'administration : rendu statique (ADMIN)", () => {
  it("base sans activité : chaque visuel affiche un état vide dans sa carte (quoi, pourquoi, action)", async () => {
    const { html, t } = await render();
    for (const s of [
      "Aucune tentative de connexion sur 30 jours Les connexions apparaissent ici dès qu'un utilisateur ouvre une session. Voir les comptes",
      "Aucun traitement lancé sur 30 jours Les traitements apparaissent après un import ou un calcul mensuel. Importer un export AJIR",
      "Aucun refus d'accès sur 30 jours Personne n'a tenté d'ouvrir une page ou une fiche hors de son rôle. Consulter le journal d'audit",
      "Aucun refus d'accès enregistré",
    ])
      expect(t).toContain(s);
    expect(headings(html, 3)).toEqual(["Connexions des 30 derniers jours", "Traitements des 30 derniers jours", "Refus d'accès des 30 derniers jours", "Derniers refus d'accès"]);
    for (const once of ["Aucune tentative de connexion", "Aucun traitement lancé", "Aucun refus d'accès sur"]) expect(count(t, once), once).toBe(1);
    expect(count(t, "Voir les données")).toBe(0);
    expect(count(html, 'role="img"')).toBe(3);
  });

  it("service arrêté : bandeau, tuile critique et lien « Voir la santé des données » disent la même chose", async () => {
    const { rh, mgr } = fx.users;
    event(1, "auth.login", "OK", rh, 5);
    event(1, "auth.login", "REFUSE", mgr, 2);
    event(1, "access.page", "REFUSE", mgr, 3);
    event(2, "employee.view", "REFUSE", mgr);
    job(1, "IMPORT", "TERMINE", 30);
    job(1, "SCORING", "ECHEC", 5);
    const { html, t } = await render();

    expect(t).toContain("2 points demandent votre attention.");
    expect(html).toContain("bg-danger-soft");
    const stopped = t.indexOf("Le service de calcul est arrêté (aucun signal reçu). Voir la santé des données");
    expect(stopped).toBeGreaterThan(-1);
    expect(stopped).toBeLessThan(t.indexOf("Aucun export AJIR n'a encore été importé. Importer un export AJIR"));

    expect(count(html, "ring-inset ring-danger")).toBe(1);
    expect(html).toMatch(/<a href="\/data-health" class="[^"]*ring-inset ring-danger[^"]*">[\s\S]*?Service de calcul[\s\S]*?Critique[\s\S]*?text-danger[^"]*"><span>Arrêté<\/span>[\s\S]*?Voir la santé des données/);
    expect(count(html, 'href="/data-health"')).toBe(2);
  });

  it("structure : sections, quatre tuiles d'état, trois tuiles de sécurité, trois visuels et le tableau des refus", async () => {
    const { html, t } = await render();
    expect(headings(html, 1)).toEqual(["Console d'administration"]);
    expect(headings(html, 2)).toEqual(["Tâches fréquentes", "État de l'outil", "Sécurité des accès", "Activité sur 30 jours"]);
    expect(headings(html, 3)).toEqual([
      "5 connexions réussies et 2 échecs en 30 jours",
      "2 traitements en 30 jours, dont 1 en échec",
      "Le plus refusé : « Ouvrir une page réservée »",
      "Derniers refus d'accès",
    ]);

    const tiles = ["Service de calcul", "Dernier import AJIR", "Alertes à traiter", "Comptes actifs"].map((label) => t.indexOf(label, t.indexOf("État de l'outil")));
    expect(tiles.every((i) => i > -1)).toBe(true);
    expect(tiles).toEqual([...tiles].sort((a, b) => a - b));
    for (const s of ["Critique", "Aucun import", "À jour", "Aucun verrouillé", "Voir la santé des données", "Importer un export AJIR", "Voir les alertes", "Voir les comptes"]) expect(t).toContain(s);
    expect(t).toContain("Comptes actifs par rôle : 2 managers · 1 responsable RH · 1 administrateur");

    for (const label of ["Connexions réussies", "Échecs de connexion", "Refus d'accès"]) expect(html).toContain(`aria-label="Tendance : ${label.replace("'", "&#x27;")}"`);
    expect(t).toMatch(/Connexions réussies 5 .*?\+5 par rapport aux 7 jours précédents favorable/);
    expect(t).toMatch(/Échecs de connexion 2 .*?\+2 par rapport aux 7 jours précédents à surveiller/);
    expect(t).toMatch(/Refus d'accès 4 .*?\+4 par rapport aux 7 jours précédents à surveiller/);

    expect(count(html, 'role="img"')).toBe(6);
    expect(count(t, "Voir les données")).toBe(3);
    expect(t).not.toContain("Anneau");
    expect(html).toContain('href="/admin/audit?outcome=REFUSE&amp;action=access.page"');
    expect(t).toContain("Voir dans le journal : Ouvrir une page réservée");
    expect(t).toMatch(/mgr a tenté d'ouvrir .* : accès refusé\./);
    expect(t).not.toMatch(NOMINATIVE);
  });

  it("tout va bien : bandeau de succès, aucune tuile critique", async () => {
    const { sqlite } = getDb();
    sqlite.prepare("INSERT INTO app_setting (key, value) VALUES ('worker_heartbeat', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(new Date().toISOString());
    sqlite.prepare("INSERT INTO import_batch (source, started_at, finished_at, status, rows_ok, rows_rejected, quality_score) VALUES ('test', ?, ?, 'OK', 1000, 12, 0.981)").run(noon(1), noon(1));
    const { html, t } = await render();
    expect(t).toContain("Tout fonctionne normalement.");
    expect(t).toMatch(/Dernier import conforme \(98,1 % de qualité, le \d{2}\/\d{2}\/\d{4}\), service de calcul actif, 4 comptes actifs\./);
    expect(html).not.toContain("ring-inset ring-danger");
    expect(html).not.toContain("bg-danger-soft text-fg");
    expect(t).toMatch(/Service de calcul Normal Actif Dernier signal il y a \d+ s : imports et calculs traités Voir la santé des données/);
    expect(t).toMatch(/Dernier import AJIR Conforme 98,1 % de qualité N° \d+ du \d{2}\/\d{2}\/\d{4} · 12 lignes rejetées Voir les contrôles de l'import/);
    expect(t).not.toMatch(NOMINATIVE);
  });

  it("squelette de chargement : mêmes grilles que la page, annoncé une seule fois", async () => {
    const Loading = (await import("@/app/(app)/admin/loading")).default;
    const skeleton = renderToStaticMarkup(createElement(Loading));
    const { html } = await render();
    expect(count(skeleton, 'role="status"')).toBe(1);
    expect(skeleton).toContain("Chargement de la console d&#x27;administration…");
    for (const grid of ["grid gap-3 sm:grid-cols-2 xl:grid-cols-4", "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4", "grid grid-cols-1 gap-3 sm:grid-cols-3", "grid gap-3 xl:grid-cols-2"]) {
      expect(html, grid).toContain(`class="${grid}"`);
      expect(skeleton, grid).toContain(`class="${grid}"`);
    }
    expect(count(skeleton, "xl:col-span-2")).toBe(count(html, "xl:col-span-2"));
  });

  it("RH redirigé", async () => {
    const Page = (await import("@/app/(app)/admin/page")).default;
    as("rh");
    await expect(Page()).rejects.toThrow("REDIRECT:/interdit");
  });
});
