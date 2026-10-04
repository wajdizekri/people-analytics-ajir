import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { SessionUser } from "@/lib/auth/session";
import type { Role } from "@/db/schema";
import { getDb } from "@/db/client";
import { seedDefaultSettings, setSetting } from "@/lib/settings";
import { FEATURES, GROUPS } from "@/lib/features/spec";
import { FAQ, FAQ_TOPICS, GLOSSARY, KPIS, SCREENS, SECTIONS, START, VARIABLE_HELP, factorGroups, forRole } from "@/lib/help/content";
import { TERMS, termFor, type TermId } from "@/lib/help/terms";
import { CornerTip, Definition, DefinitionList, DetailTip, InfoTip, LevelExplainer, PageIntro, TermTip } from "@/components/help";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
// createElement sans contrôle de type des props : les enfants passent en arguments (règle react/no-children-prop)
const h = (type: unknown, props: Record<string, unknown> | null, ...children: ReactNode[]) => createElement(type as string, props, ...children);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/ /g, " ").replace(/\s+/g, " ");

let file = "";
beforeAll(() => {
  file = path.join(os.tmpdir(), `pa-help-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  (globalThis as { __paDb?: unknown }).__paDb = undefined;
  const { sqlite } = getDb();
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  seedDefaultSettings(sqlite);
  setSetting(sqlite, "capacity_rate", "0.03");
  setSetting(sqlite, "medium_lift", "2.5");
});
afterAll(() => {
  const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  delete g.__paDb;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
});

describe("composants d'aide", () => {
  it("InfoTip : bouton nommé, fermé par défaut, texte masqué présent dans le DOM, pas de description vers un contenu non rendu", () => {
    const out = html(h(InfoTip, { label: "Turnover" }, "Sorties sur 12 mois."));
    expect(out).toMatch(/<button[^>]*type="button"/);
    expect(out).toContain('aria-expanded="false"');
    const controls = out.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
    expect(out).not.toContain("aria-describedby");
    expect(out).toMatch(new RegExp(`id="${controls!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*hidden`));
    expect(out).toContain("Définition : Turnover");
    expect(out).toContain("Sorties sur 12 mois.");
    expect(text(html(h(InfoTip, { label: "Effectif fin de mois", prefix: "Détails" }, "x")))).toContain("Détails : Effectif fin de mois");
  });

  it("DetailTip : une seule bulle ; détails ajoutés à la bulle fournie (TermTip), bulle propre sinon, rien si tout est vide", () => {
    const merged = html(h(DetailTip, { label: "Turnover glissant", tip: createElement(TermTip, { term: "turnover" }), details: ["12 derniers mois", null, ""] }));
    expect(merged.match(/<button/g)).toHaveLength(1);
    expect(merged).toContain(TERMS.turnover.text.slice(0, 40));
    expect(merged).toMatch(/border-t border-line pt-1\.5"><span class="block">12 derniers mois<\/span><\/span>/);
    const own = html(h(DetailTip, { label: "Effectif par département", details: "Toute l'entreprise · août 2026" }));
    expect(text(own)).toContain("Détails : Effectif par département");
    expect(own).toContain("Toute l&#x27;entreprise · août 2026");
    expect(html(h(DetailTip, { label: "x", details: [undefined, false] }))).toBe("");
    expect(html(h(DetailTip, { label: "x", tip: createElement(TermTip, { term: "turnover" }) }))).not.toContain("border-t");
  });

  it("TermTip : texte du vocabulaire commun, rien pour un rôle non destinataire", () => {
    expect(html(createElement(TermTip, { term: "turnover" }))).toContain(TERMS.turnover.text.slice(0, 40));
    expect(html(createElement(TermTip, { term: "masseSalariale", role: "MANAGER" }))).toBe("");
    expect(html(createElement(TermTip, { term: "lift", role: "MANAGER" }))).toBe("");
    expect(html(createElement(TermTip, { term: "lift", role: "RH" }))).toContain("Lift");
  });

  it("CornerTip : la bulle est à côté du lien de la carte, jamais dedans", () => {
    const out = html(h(CornerTip, { tip: createElement(TermTip, { term: "effectif" }) }, createElement("a", { href: "/employees" }, "Effectif")));
    expect(out).not.toMatch(/<a[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
    expect(out).toContain("<button");
  });

  it("PageIntro : plus d'encart, simple lien « Aide » vers la rubrique ; rien sans rubrique", () => {
    const out = html(h(PageIntro, { helpHref: "/aide#risque", points: ["Un", "Deux"] }, "Sert à suivre."));
    expect(out).toMatch(/^<p class="mb-4"><a href="\/aide#risque"/);
    expect(text(out).trim()).toBe("Aide sur cette page");
    expect(out).not.toMatch(/À quoi sert cette page|Sert à suivre|<li|<section/);
    expect(html(h(PageIntro, null, "Sert à suivre."))).toBe("");
  });

  it("Definition : calcul, périmètre, exclusions, unité et période dans une liste de définitions", () => {
    const out = html(
      h(DefinitionList, null, h(Definition, { term: "Effectif", formula: "F", scope: "S", exclusions: "Stages et SIVP.", unit: "collaborateurs", period: "P" }, "Déf.")),
    );
    expect(out).toMatch(/^<dl/);
    expect(out).toContain("<dt");
    for (const s of ["Calcul :", "Périmètre :", "Exclusions :", "Stages et SIVP.", "Unité :", "Période :"]) expect(out).toContain(s);
  });

  it("LevelExplainer : paramètres en vigueur ; le mot lift est réservé à la RH et à l'administrateur", () => {
    const rh = text(html(createElement(LevelExplainer, { capacityRate: 0.03, mediumLift: 2.5, role: "RH" })));
    expect(rh).toContain("3 %");
    expect(rh).toContain("2,5 fois");
    expect(rh).toContain("lift ≥ 2,5");
    for (const s of ["Risque Élevé", "Risque Moyen", "Risque Faible", "Non évalué"]) expect(rh).toContain(s);
    const mgr = html(createElement(LevelExplainer, { capacityRate: 0.02, mediumLift: 2, role: "MANAGER" }));
    expect(mgr.toLowerCase()).not.toContain("lift");
  });
});

describe("contenus d'aide", () => {
  it("chaque variable de features.json a une définition simple ; le manager n'a ni la famille Absences ni les variables", () => {
    for (const f of FEATURES) expect(VARIABLE_HELP[f.name], f.name).toBeTruthy();
    expect(factorGroups("RH").map((g) => g.code)).toEqual(Object.keys(GROUPS));
    const mgr = factorGroups("MANAGER");
    expect(mgr.map((g) => g.code)).not.toContain("ABSENCES");
    expect(mgr.every((g) => g.variables.length === 0)).toBe(true);
    expect(mgr.map((g) => g.label)).toContain(GROUPS.TEMPS_TRAVAIL.label_manager);
  });

  it("aucun texte destiné au manager ne cite le lift, la masse salariale ou un montant", () => {
    const managerTexts = [
      ...forRole(KPIS, "MANAGER").flatMap((k) => [k.label, k.definition, k.formula, k.scope, k.exclusions ?? "", k.unit, k.period]),
      ...forRole(FAQ, "MANAGER").flatMap((f) => [f.q, f.a]),
      ...START.MANAGER.flatMap((st) => [st.title, st.text, st.cta]),
      ...forRole(GLOSSARY, "MANAGER").flatMap((g) => [g.term, g.definition]),
      ...(Object.keys(TERMS) as TermId[]).map((id) => termFor(id, "MANAGER")).flatMap((t) => (t ? [t.label, t.text] : [])),
    ].join(" ");
    expect(managerTexts).not.toMatch(/\blift\b|masse salariale|TND|compa-ratio|Bradford/i);
  });

  it("trois étapes « Par où commencer ? » par rôle ; chaque question fréquente est rangée dans un thème", () => {
    for (const role of ["ADMIN", "RH", "MANAGER"] as Role[]) {
      expect(START[role], role).toHaveLength(3);
      for (const step of START[role]) expect(step.href.startsWith("/"), step.href).toBe(true);
      expect(forRole(FAQ, role).length, role).toBeGreaterThanOrEqual(5);
    }
    for (const f of FAQ) expect(Object.keys(FAQ_TOPICS), f.q).toContain(f.topic);
  });

  it("chaque écran du plan correspond à une rubrique existante", () => {
    const ids = new Set(SECTIONS.map((s) => s.id));
    for (const s of SCREENS) if (s.help) expect(ids.has(s.help), s.href).toBe(true);
  });
});

describe("page /aide par rôle", () => {
  const ctx: Record<Role, SessionUser> = {
    ADMIN: { userId: 1, login: "admin", role: "ADMIN", employeeId: null } as SessionUser,
    RH: { userId: 2, login: "rh", role: "RH", employeeId: null } as SessionUser,
    MANAGER: { userId: 3, login: "mgr", role: "MANAGER", employeeId: 10 } as SessionUser,
  };
  const render = async (role: Role) => {
    session.current = ctx[role];
    const Page = (await import("@/app/(app)/aide/page")).default;
    return html(await Page());
  };

  it("sans session : redirection vers la connexion", async () => {
    session.current = null;
    const Page = (await import("@/app/(app)/aide/page")).default;
    await expect(Page()).rejects.toThrow("REDIRECT:/login");
  });

  it("RH : toutes les rubriques de pilotage et de données, paramètres en vigueur, lift et Bradford expliqués", async () => {
    const out = await render("RH");
    for (const id of ["commencer", "risque", "tableau-de-bord", "absenteisme", "recommandations", "alertes", "qualite-donnees", "modele", "confidentialite", "faq", "glossaire"])
      expect(out, id).toContain(`id="${id}"`);
    // « Par où commencer ? » d'abord, puis les questions fréquentes, le glossaire en dernier
    const order = [...out.matchAll(/<section[^>]* id="([a-z-]+)"/g)].map((m) => m[1]);
    expect(order.slice(0, 2)).toEqual(["commencer", "faq"]);
    expect(order.at(-1)).toBe("glossaire");
    const t = text(out);
    for (const s of ["Par où commencer ?", "Ouvrir la synthèse du mois", "Voir les collaborateurs au niveau Élevé", "Ouvrir les recommandations", "Qui dois-je rencontrer en priorité ce mois-ci ?"]) expect(t, s).toContain(s);
    expect(out).toContain('href="/employees?niveau=ELEVE"');
    for (const s of ["Masse salariale brute", "Le lift", "Bradford", "Seuil actuel : 250", "Vérification a posteriori", "Droit d'accès", "3 %", "Revue de la rémunération", "95 %"]) expect(t, s).toContain(s);
    expect(t).toContain("Facteurs associés, pas causes");
    expect(t).toContain("Variables utilisées");
  });

  it("manager : ni données, ni modèle, ni lift, ni masse salariale ; petits groupes expliqués", async () => {
    const out = await render("MANAGER");
    for (const id of ["commencer", "risque", "tableau-de-bord", "absenteisme", "recommandations", "confidentialite", "faq", "glossaire"]) expect(out, id).toContain(`id="${id}"`);
    for (const id of ["qualite-donnees", "modele"]) expect(out, id).not.toContain(`id="${id}"`);
    const t = text(out);
    expect(t).not.toMatch(/\blift\b|Masse salariale|TND|Bradford|Revue de la rémunération|Backtesting|Vérification a posteriori|Santé des données|Transparence du modèle|Journal d'audit|Variables utilisées/i);
    expect(t).toContain("moins de 5 personnes");
    expect(t).toContain("Mon équipe");
    expect(t).toContain("2,5 fois");
    for (const s of ["Ouvrir Mon équipe", "Voir mes alertes", "Quels collaborateurs de mon équipe dois-je voir en priorité ?"]) expect(t, s).toContain(s);
  });

  it("administrateur : outil et qualité des données, aucune rubrique de pilotage", async () => {
    const out = await render("ADMIN");
    for (const id of ["commencer", "risque", "alertes", "qualite-donnees", "modele", "confidentialite", "faq", "glossaire"]) expect(out, id).toContain(`id="${id}"`);
    for (const id of ["tableau-de-bord", "absenteisme", "recommandations"]) expect(out, id).not.toContain(`id="${id}"`);
    const t = text(out);
    expect(t).toContain("Paramètres");
    expect(t).toContain("Journal d'audit");
    for (const s of ["Ouvrir Santé des données", "Ouvrir Utilisateurs et accès", "Un utilisateur a oublié son mot de passe : que faire ?"]) expect(t, s).toContain(s);
    expect(t).not.toMatch(/Masse salariale|Backtesting|Vérification a posteriori|Tableau de bord|Revue de la rémunération/);
  });
});

describe("page d'accès refusé", () => {
  const forbidden = async (role: Role | null) => {
    session.current = role ? ({ userId: 9, login: "x", role, employeeId: role === "MANAGER" ? 10 : null } as SessionUser) : null;
    const Page = (await import("@/app/interdit/page")).default;
    return text(html(await Page()));
  };

  it("dit le rôle, la raison et l'action suivante, sans renvoyer l'administrateur vers lui-même", async () => {
    const mgr = await forbidden("MANAGER");
    for (const s of ["Accès refusé", "rôle : Manager", "Revenir au tableau de bord", "Voir ce que mon rôle permet", "Demande d'accès : administrateur de l'outil"]) expect(mgr, s).toContain(s);
    const adm = await forbidden("ADMIN");
    expect(adm).toContain("Revenir à la console");
    expect(adm).toContain("Séparation des tâches");
    expect(adm).not.toContain("Demande d'accès");
    const anon = await forbidden(null);
    expect(anon).toContain("Se connecter");
  });
});

describe("page 404", () => {
  it("en français, avec retour à l'accueil et lien vers l'aide", async () => {
    const mod = await import("@/app/not-found");
    expect(mod.metadata.title).toBe("Page introuvable — People Analytics AJIR");
    const t = text(html(mod.default()));
    expect(t).toContain("Page introuvable");
    expect(t).toContain("Revenir à l'accueil");
    expect(t).toContain("Consulter l'aide");
  });

  it("élément introuvable dans l'application : explication et deux actions", async () => {
    const mod = await import("@/app/(app)/not-found");
    const t = text(html(mod.default()));
    for (const s of ["Élément introuvable", "n'existe pas ou n'est plus disponible", "Revenir à l'accueil", "Consulter l'aide"]) expect(t, s).toContain(s);
  });
});
