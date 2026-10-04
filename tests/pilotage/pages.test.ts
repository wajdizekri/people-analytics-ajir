import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { SUPERSEDED_COMMENT } from "@/lib/engine/recommendations";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, db, setupSeededDb } from "./setup";

// Rendu serveur des pages (sans runtime Next) : liens, formulaires et graphiques remplacés par des éléments simples
const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

let file = "";
let seed: SeedResult;
beforeAll(async () => {
  ({ file, seed } = await setupSeededDb("pages"));
});
afterAll(() => cleanupDb(file));

const asRh = () => (session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null });
const asManager = () => (session.current = { userId: seed.managerUserId, login: "mgr.demo", role: "MANAGER", employeeId: seed.managerEmployeeId });
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);

async function pages() {
  return {
    dashboard: (await import("@/app/(app)/dashboard/page")).default,
    employees: (await import("@/app/(app)/employees/(liste)/page")).default,
    detail: (await import("@/app/(app)/employees/[id]/page")).default,
    absenteeism: (await import("@/app/(app)/absenteeism/page")).default,
    recommendations: (await import("@/app/(app)/recommendations/page")).default,
  };
}
const inScopeScored = () =>
  (
    db()
      .prepare(`SELECT p.employee_id AS id FROM prediction p JOIN employee e ON e.id = p.employee_id WHERE p.run_id = ? AND e.manager_id IN (SELECT id FROM employee WHERE manager_id = ?) ORDER BY p.rank LIMIT 1`)
      .get(seed.currentRunId, seed.managerEmployeeId) as { id: number }
  ).id;

describe("pages de pilotage", () => {
  it("RH : toutes les pages se rendent, avec rémunération et probabilité", async () => {
    asRh();
    const p = await pages();
    const dash = html(await p.dashboard(sp({ periode: "18m", age: "xx" })));
    expect(dash).toContain("Masse salariale");
    expect(dash).toContain("Période :");
    expect(dash).toContain("ignoré(s) : tranche d&#x27;âge");
    expect(dash).toContain("hors stages et SIVP");
    for (const f of ["contrat", "age", "anciennete"]) expect(dash).toContain(`name="${f}"`);
    const list = html(await p.employees(sp({ niveau: "ELEVE" })));
    expect(list).toContain("Probabilité à 6 mois");
    const id = inScopeScored();
    const detail = html(await p.detail({ params: Promise.resolve({ id: String(id) }) }));
    for (const s of ["Faits</h2>", "Estimation</h2>", "Suggestions</h2>", "Estimation, pas une certitude. Facteurs associés, pas des causes.", "Absences pour raison de santé", "TND", "Probabilité à 6 mois"])
      expect(detail).toContain(s);
    // Repère sur la probabilité (horizon = calcul + 6 mois) et bulle de définition
    expect(detail).toMatch(/Sur 100 collaborateurs avec cette estimation, environ \d+ part(ent)? d&#x27;ici fin [a-zéû]+ \d{4} et \d+ restent\./);
    expect(detail).toContain("Définition : Probabilité à 6 mois");
    // Suggestions : « Pourquoi » chiffré (facteur déclencheur à la hausse) et « Que faire »
    const trigger = db()
      .prepare(
        `SELECT f.phrase_rh AS phrase FROM recommendation r JOIN prediction p ON p.run_id = ? AND p.employee_id = r.employee_id
         JOIN prediction_factor f ON f.prediction_id = p.id AND f.group_code = r.trigger_group AND f.direction = 'HAUSSE' AND f.rank <= 5
         WHERE r.employee_id = ? AND r.status = 'PROPOSEE' LIMIT 1`,
      )
      .get(seed.currentRunId, id) as { phrase: string } | undefined;
    expect(trigger).toBeDefined();
    expect(detail).toContain(`Pourquoi :</span> ${trigger!.phrase.replace(/'/g, "&#x27;")} (calcul du `);
    expect(detail).toContain("Que faire :</span>");
    // Résumé en tête (niveau + facteurs principaux), sens des facteurs en mots, courbe des niveaux avec tableau de données
    expect(detail).toContain("En bref");
    expect(detail).toMatch(/Risque (Élevé|Moyen|Faible) —/);
    expect(detail).toMatch(/Fait (monter|baisser) le risque/);
    expect(detail).toContain("Niveau de risque par mois");
    const absRh = html(await p.absenteeism(sp({ axe: "equipe", granularite: "mois" })));
    expect(absRh).toContain("Signaux individuels à vérifier");
    expect(absRh).toContain("est-il sous contrôle ?");
    expect(absRh).toMatch(/Sous contrôle|À surveiller|Hausse à traiter|Pas de données/);
    expect(html(await p.recommendations(sp({ statut: "PROPOSEE" })))).toContain("Taux d&#x27;adoption");
  });

  it("manager : ni rémunération ni probabilité ; hors périmètre redirigé ; inexistant 404 ; recommandations interdites", async () => {
    asManager();
    const p = await pages();
    const dash = html(await p.dashboard(sp({ contrat: "CDD", anciennete: "1-3" })));
    expect(dash).toContain("Filtres contrat et ancienneté non disponibles dans la vue manager");
    expect(dash).not.toContain("Paramètre(s) invalide(s)");
    expect(dash).toContain("hors stages et SIVP");
    for (const f of ["contrat", "age", "anciennete"]) expect(dash).not.toContain(`name="${f}"`);
    expect(dash).toContain(`name="departement"`);
    expect(dash).not.toContain("Masse salariale");
    expect(dash).not.toContain("TND");
    expect(dash).not.toContain("Lift");
    const list = html(await p.employees(sp()));
    expect(list).not.toContain("Probabilité");
    const detail = html(await p.detail({ params: Promise.resolve({ id: String(inScopeScored()) }) }));
    expect(detail).toContain("Catégories de facteurs associés");
    expect(detail).toMatch(/Risque (Élevé|Moyen|Faible) — (domaines? qui f(on|ai)t monter|aucun domaine)/);
    expect(detail).toMatch(/Domaines qui font monter l&#x27;estimation|Aucun domaine ne fait nettement monter l&#x27;estimation\./);
    expect(detail).toContain("Le niveau sert à choisir avec qui échanger en premier, jamais à juger une personne. Parlez-en avec la RH.");
    for (const s of [
      "TND",
      "Probabilité",
      "risque moyen",
      "Absences pour raison de santé",
      "Congé annuel",
      "Fait monter le risque",
      "Marquer comme réalisée",
      "Rejeter avec motif",
      "Pourquoi :",
      "Sur 100 collaborateurs",
      "Actions proposées pour ce collaborateur",
    ])
      expect(detail).not.toContain(s);
    const abs = html(await p.absenteeism(sp()));
    expect(abs).not.toContain("Signaux individuels");
    expect(abs).not.toContain("Bradford");
    expect(abs).toContain("est-il sous contrôle ?");

    const out = db().prepare("SELECT id FROM employee WHERE department_id <> (SELECT department_id FROM employee WHERE id = ?) LIMIT 1").get(seed.managerEmployeeId) as { id: number };
    await expect(p.detail({ params: Promise.resolve({ id: String(out.id) }) })).rejects.toThrow("REDIRECT:/interdit");
    await expect(p.detail({ params: Promise.resolve({ id: "999999" }) })).rejects.toThrow("NOT_FOUND");
    await expect(p.detail({ params: Promise.resolve({ id: "abc" }) })).rejects.toThrow("NOT_FOUND");
    await expect(p.recommendations(sp())).rejects.toThrow("REDIRECT:/interdit");
  });

  it("fiche : aucun loading.tsx au-dessus, la vérification de périmètre précède le streaming (vraie redirection 307, vrai 404)", () => {
    const app = path.resolve(process.cwd(), "src/app");
    for (const dir of ["", "(app)", "(app)/employees", "(app)/employees/[id]"]) expect(fs.existsSync(path.join(app, dir, "loading.tsx")), dir).toBe(false);
    expect(fs.existsSync(path.join(app, "(app)/employees/(liste)/loading.tsx"))).toBe(true);
  });

  it("collaborateurs : jetons sémantiques seulement (thème sombre), tri accessible sous 640 px, lignes cliquables", async () => {
    const files = [
      "src/app/(app)/employees/(liste)/page.tsx",
      "src/app/(app)/employees/(liste)/loading.tsx",
      "src/app/(app)/employees/[id]/page.tsx",
      "src/components/pilotage/employee-detail.tsx",
      "src/components/pilotage/what-if-panel.tsx",
      "src/components/pilotage/filters.tsx",
      "src/components/pilotage/filter-fields.tsx",
      "src/components/pilotage/recommendation-forms.tsx",
      "src/components/pilotage/route-states.tsx",
      "src/components/insights/whats-new.tsx",
      "src/components/insights/journey.tsx",
      "src/components/insights/intervention-effects.tsx",
    ];
    const raw = /\b(?:bg|text|border(?:-[lrtbxy])?|ring|divide|from|via|to|accent)-(?:slate|gray|sky|red|amber|emerald|brand|white|black)\b|#[0-9a-f]{6}\b/i;
    for (const f of files) expect(fs.readFileSync(path.resolve(process.cwd(), f), "utf8"), f).not.toMatch(raw);

    asManager();
    const list = html(await (await pages()).employees(sp()));
    expect(list).toContain('aria-label="Trier la liste"');
    expect(list).toMatch(/aria-current="true"[^>]*>(<span[^>]*>Trier par <\/span>)?Risque/);
    expect(list).toContain("after:inset-0");
  });

  it("sans run publié : message explicite", async () => {
    asRh();
    const p = await pages();
    db().prepare("UPDATE app_setting SET value = '' WHERE key = 'current_run_id'").run();
    try {
      expect(html(await p.dashboard(sp()))).toContain("Aucun calcul de risque publié");
      expect(html(await p.detail({ params: Promise.resolve({ id: String(inScopeScored()) }) }))).toContain("Aucun calcul de risque publié");
    } finally {
      db().prepare("UPDATE app_setting SET value = ? WHERE key = 'current_run_id'").run(String(seed.currentRunId));
    }
  });

  it("ergonomie : retour contextuel vers la liste filtrée, décision depuis la liste, filtre retirable", async () => {
    asRh();
    const p = await pages();
    const list = html(await p.employees(sp({ niveau: "ELEVE", retour: "/dashboard?periode=18m" })));
    expect(list).toContain("?retour=%2Femployees%3Fniveau%3DELEVE");
    expect(list).toContain('aria-label="Fil d&#x27;Ariane"');
    expect(list).toContain('href="/dashboard?periode=18m"');
    expect(list).toContain("Retirer le filtre Niveau de risque");
    const id = String(inScopeScored());
    const back = html(await p.detail({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ retour: "/recommendations?statut=PROPOSEE" }) }));
    expect(back).toContain('href="/recommendations?statut=PROPOSEE"');
    expect(back).toMatch(/Fil d&#x27;Ariane.*Recommandations/);
    const evil = html(await p.detail({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ retour: "//evil.example/employees" }) }));
    expect(evil).not.toContain("evil.example");
    expect(evil).toMatch(/href="\/employees"[^>]*>Collaborateurs</);
    const recos = html(await p.recommendations(sp({ statut: "PROPOSEE" })));
    expect(recos).toContain("Marquer comme réalisée");
    expect(recos).toContain("Rejeter");
    expect(recos).toMatch(/Pour qui[\s\S]*Pourquoi[\s\S]*Que faire/);
    expect(recos).toContain('href="/recommendations?statut=PROPOSEE"');
    expect(recos).toContain("Niveau de risque actuel");
  });

  it("recommandation remplacée par un nouveau calcul : « Remplacée », hors du taux d'adoption, sur la liste et la fiche", async () => {
    const id = inScopeScored();
    const reco = Number(
      db()
        .prepare(
          "INSERT INTO recommendation (employee_id, action_code, trigger_group, status, comment, created_at, updated_at) VALUES (?, 'PLAN_FORMATION', 'FORMATION_EVAL', 'REJETEE', ?, '2026-08-01T08:00:00Z', '2026-09-30T08:00:00Z')",
        )
        .run(id, SUPERSEDED_COMMENT).lastInsertRowid,
    );
    try {
      asRh();
      const p = await pages();
      const dept = (db().prepare("SELECT department_id AS d FROM employee WHERE id = ?").get(id) as { d: number }).d;
      const recos = html(await p.recommendations(sp({ statut: "REJETEE", action: "PLAN_FORMATION", departement: String(dept) })));
      expect(recos).toContain("1 remplacée par un nouveau calcul, hors du taux.");
      expect(recos).toContain("Remplacée par un nouveau calcul le 30/09/2026, sans décision de la RH");
      expect(recos).not.toContain(SUPERSEDED_COMMENT);
      const detail = html(await p.detail({ params: Promise.resolve({ id: String(id) }) }));
      expect(detail).toContain("Remplacée par un nouveau calcul du risque, sans décision de la RH.");
      expect(detail).not.toContain(SUPERSEDED_COMMENT);
    } finally {
      db().prepare("DELETE FROM recommendation WHERE id = ?").run(reco);
    }
  });

  it("fiche : opposition au traitement prédictif affichée à la RH seule, sans simulation", async () => {
    const id = inScopeScored();
    db().prepare("INSERT INTO employee_opposition (employee_id, since) VALUES (?, '2026-09-01T10:00:00.000Z')").run(id);
    try {
      asRh();
      let p = await pages();
      const rh = html(await p.detail({ params: Promise.resolve({ id: String(id) }) }));
      expect(rh).toContain("Opposition au traitement prédictif");
      expect(rh).toContain("01/09/2026");
      expect(rh).not.toContain("Simulation « et si ? »");
      asManager();
      p = await pages();
      const mgr = html(await p.detail({ params: Promise.resolve({ id: String(id) }) }));
      expect(mgr).not.toContain("Opposition");
      expect(mgr).toContain("Catégories de facteurs associés");
    } finally {
      db().prepare("DELETE FROM employee_opposition WHERE employee_id = ?").run(id);
    }
  });
});
