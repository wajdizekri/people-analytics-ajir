import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import type { WhatIfDto } from "@/lib/dal/whatif";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, db, rhCtx, setupSeededDb } from "../pilotage/setup";

// Chantier ergonomie (COLLAB) : retours contextuels, ordre de lecture de la fiche, simulation périmée, organigramme au clavier
const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("echarts-for-react", () => ({ default: () => createElement("div", { "data-echarts": "" }) }));
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
  ({ file, seed } = await setupSeededDb("ergo-collab"));
});
afterAll(() => cleanupDb(file));

const asRh = () => (session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null });
const asManager = () => (session.current = { userId: seed.managerUserId, login: "mgr.demo", role: "MANAGER", employeeId: seed.managerEmployeeId });
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const scored = () =>
  (
    db()
      .prepare(`SELECT p.employee_id AS id FROM prediction p JOIN employee e ON e.id = p.employee_id WHERE p.run_id = ? AND e.manager_id IN (SELECT id FROM employee WHERE manager_id = ?) ORDER BY p.rank LIMIT 1`)
      .get(seed.currentRunId, seed.managerEmployeeId) as { id: number }
  ).id;
const detail = async (retour?: string) => {
  const page = (await import("@/app/(app)/employees/[id]/page")).default;
  return html(await page({ params: Promise.resolve({ id: String(scored()) }), searchParams: Promise.resolve(retour ? { retour } : {}) }));
};

describe("fiche collaborateur", () => {
  it("fil d'Ariane : retour vers l'organigramme (couleur conservée), la charge, les formations", async () => {
    asRh();
    expect(await detail("/organigramme?couleur=risque")).toMatch(/href="\/organigramme\?couleur=risque"[^>]*>Organigramme</);
    expect(await detail("/charge#surcharges")).toMatch(/href="\/charge#surcharges"[^>]*>Charge de travail</);
    expect(await detail("/formations#a-risque")).toMatch(/href="\/formations#a-risque"[^>]*>Formations obligatoires</);
    expect(await detail("/interventions?type=ENTRETIEN")).toMatch(/href="\/interventions\?type=ENTRETIEN"[^>]*>Interventions</);
    expect(await detail("/alerts/42")).toMatch(/href="\/alerts\/42"[^>]*>Alerte</);
    expect(await detail("/alerts/42/../../admin")).toMatch(/href="\/employees"[^>]*>Collaborateurs</);
    asManager();
    expect(await detail("/organigramme")).toMatch(/href="\/organigramme"[^>]*>Organigramme</);
    expect(await detail()).toMatch(/href="\/employees"[^>]*>Mon équipe</);
  });

  it("ordre de décision sous lg : Faits → Estimation → Parcours → Suggestions ; Estimation sur deux rangées à partir de lg", async () => {
    asRh();
    const h = await detail();
    const at = (s: string) => h.indexOf(s);
    expect(at('id="zone-1"')).toBeGreaterThan(-1);
    expect(at('id="zone-1"')).toBeLessThan(at('id="zone-2"'));
    expect(at('id="zone-2"')).toBeLessThan(at('id="parcours"'));
    expect(at('id="parcours"')).toBeLessThan(at('id="zone-3"'));
    expect(h).toContain("lg:row-span-2");
    expect(h).toContain("lg:grid-rows-[auto_1fr]");
  });

  it("manager du collaborateur : lien vers son équipe", async () => {
    asRh();
    expect(await detail()).toMatch(/href="\/employees\?manager=\d+"[^>]*>Voir l&#x27;équipe<span class="sr-only"> de /);
  });
});

describe("liste des collaborateurs", () => {
  it("fil d'Ariane depuis Équipes (RH) et Mes équipes (manager), la synthèse, filtres d'origine conservés", async () => {
    const page = (await import("@/app/(app)/employees/(liste)/page")).default;
    asRh();
    const rh = html(await page(sp({ retour: "/equipes?tension=oui" })));
    expect(rh).toMatch(/href="\/equipes\?tension=oui"[^>]*>Équipes</);
    expect(rh).toContain("retour=%2Fequipes%3Ftension%3Doui");
    expect(html(await page(sp({ niveau: "ELEVE", retour: "/synthese" })))).toMatch(/href="\/synthese"[^>]*>Synthèse du mois</);
    asManager();
    expect(html(await page(sp({ retour: "/equipes" })))).toMatch(/href="\/equipes"[^>]*>Mes équipes</);
    expect(html(await page(sp({ retour: "//evil.example/equipes" })))).not.toContain("evil.example");
  });

  it("état vide filtré : quoi, pourquoi, quoi faire", async () => {
    asRh();
    const page = (await import("@/app/(app)/employees/(liste)/page")).default;
    const h = html(await page(sp({ q: "zzzz-personne" })));
    expect(h).toContain("Aucun collaborateur ne correspond aux critères");
    expect(h).toContain("Retirez un filtre ou réinitialisez-les.");
    expect(h).toContain("Réinitialiser les filtres");
  });
});

describe("équipes", () => {
  it("liste d'une équipe avec retour vers l'écran filtré, ligne entière cliquable", async () => {
    asRh();
    const page = (await import("@/app/(app)/equipes/page")).default;
    const h = html(await page(sp({ tension: "oui" })));
    expect(h).toContain("retour=%2Fequipes%3Ftension%3Doui");
    expect(h).toMatch(/data-href="\/employees\?manager=\d+&amp;retour=%2Fequipes/);
    const all = html(await page(sp()));
    if (/[1-9]\d* à regarder/.test(all)) expect(all).toContain("Voir les équipes à regarder");
  });
});

describe("organigramme", () => {
  it("action vers les équipes ; fiches et listes ouvertes avec retour vers la couleur choisie", async () => {
    asRh();
    const page = (await import("@/app/(app)/organigramme/page")).default;
    const h = html(await page(sp({ couleur: "risque" })));
    expect(h).toMatch(/href="\/equipes"[^>]*>.*Voir les équipes/);
    expect(h).toContain("retour=%2Forganigramme%3Fcouleur%3Drisque");
    expect(h).toContain("Voir son détail");
    asManager();
    expect(html(await page(sp()))).toContain("Voir mes équipes");
  });

  it("vue liste : lignes repérables au clavier et aide affichée", async () => {
    const { getOrgChart } = await import("@/lib/dal/org-chart");
    const { indexTree } = await import("@/components/org-chart/tree-index");
    const { OrgTreeList } = await import("@/components/org-chart/org-tree-list");
    const dto = getOrgChart(rhCtx(seed), { source: "page", ip: "test" });
    const h = html(
      createElement(OrgTreeList, {
        root: dto.root,
        index: indexTree(dto.root),
        colorBy: "effectif",
        reference: dto.reference,
        selected: dto.root.key,
        onSelect: () => {},
        back: "/organigramme?couleur=absenteisme",
      }),
    );
    expect(h).toContain(`data-tree="${dto.root.key}"`);
    expect(h).toContain("Au clavier : flèches haut et bas");
    expect(h).toMatch(/<ul aria-label="Organigramme en liste" aria-describedby="[^"]+"/);
  });

  it("navigation au clavier : haut / bas, droite (déplier puis enfant), gauche (replier puis parent), début / fin", async () => {
    const { treeKeyTarget } = await import("@/components/org-chart/org-tree-list");
    type Fake = { dataset: { tree: string }; parentElement: unknown };
    const details = (open: boolean, parent: unknown = null) => {
      const d = { open, parentElement: parent, children: [] as Fake[], contains: (x: unknown) => d.children.includes(x as Fake), closest: () => d, querySelector: () => null as unknown };
      return d;
    };
    const rootDetails = details(true);
    const root: Fake = { dataset: { tree: "root" }, parentElement: rootDetails };
    rootDetails.querySelector = () => root;
    const childDetails = details(false, { closest: () => rootDetails });
    const child: Fake = { dataset: { tree: "a" }, parentElement: childDetails };
    const sibling: Fake = { dataset: { tree: "b" }, parentElement: details(false, { closest: () => rootDetails }) };
    rootDetails.children.push(child, sibling);
    const rows = [root, child, sibling] as unknown as HTMLElement[];
    const [r, c, s] = rows;
    expect(treeKeyTarget("ArrowDown", r, rows)).toEqual({ focus: c });
    expect(treeKeyTarget("ArrowUp", c, rows)).toEqual({ focus: r });
    expect(treeKeyTarget("End", r, rows)).toEqual({ focus: s });
    expect(treeKeyTarget("Home", s, rows)).toEqual({ focus: r });
    expect(treeKeyTarget("ArrowRight", c, rows)).toEqual({ toggle: { key: "a", open: true } });
    expect(treeKeyTarget("ArrowRight", r, rows)).toEqual({ focus: c });
    expect(treeKeyTarget("ArrowLeft", r, rows)).toEqual({ toggle: { key: "root", open: false } });
    expect(treeKeyTarget("ArrowLeft", c, rows)).toEqual({ focus: r });
    expect(treeKeyTarget("a", c, rows)).toBeNull();
  });
});

describe("simulation « et si ? »", () => {
  const dto = {
    employeeId: 1,
    asOf: "2026-08-31",
    model: { version: "b0-v1-20260930", kind: "B0" },
    notice: "",
    levers: { salaryPct: 10, overtimeCutH: 0, trainingHours: 0, promotion: false, chargeRatePct: 16.57 },
    stored: { score: 6, level: "ELEVE" },
    before: { score: 6, level: "ELEVE", rank: 3, lift: 2, population: 900 },
    after: { score: 4, level: "MOYEN", rank: 40, lift: 1.2, population: 900 },
    groups: [],
    changes: [],
    applied: { salary: { before: 1000, after: 1100 }, grade: null, overtimeRemovedH: 0, trainingHours: 0 },
    cost: { monthlySalaryDelta: 100, annual: 1398.84, chargeRate: 0.1657 },
    notes: [],
  } as unknown as WhatIfDto;

  it("résultat signalé à mettre à jour quand les leviers ont changé depuis le calcul", async () => {
    const { WhatIfResult } = await import("@/components/pilotage/what-if-panel");
    expect(html(createElement(WhatIfResult, { r: dto, outdated: true }))).toContain("Résultat à mettre à jour");
    const fresh = html(createElement(WhatIfResult, { r: dto }));
    expect(fresh).not.toContain("Résultat à mettre à jour");
    expect(fresh).toContain("Avant (calcul publié)");
    expect(fresh).toContain("Après les actions simulées");
  });
});

describe("jetons sémantiques", () => {
  it("aucune couleur Tailwind brute ni hexadécimale dans les écrans retouchés", () => {
    const files = [
      "src/app/(app)/equipes/page.tsx",
      "src/app/(app)/equipes/loading.tsx",
      "src/app/(app)/organigramme/page.tsx",
      "src/app/(app)/organigramme/loading.tsx",
      "src/components/org-chart/org-chart-view.tsx",
      "src/components/org-chart/org-detail-panel.tsx",
      "src/components/org-chart/org-tree-list.tsx",
    ];
    const raw = /\b(?:bg|text|border(?:-[lrtbxy])?|ring|divide|from|via|to|accent)-(?:slate|gray|sky|red|amber|emerald|brand|white|black)\b|#[0-9a-f]{6}\b/i;
    for (const f of files) expect(fs.readFileSync(path.resolve(process.cwd(), f), "utf8"), f).not.toMatch(raw);
  });
});
