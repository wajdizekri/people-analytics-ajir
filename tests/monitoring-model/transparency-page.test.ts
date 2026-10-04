import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { setupDb, teardownDb } from "../ui-admin/helpers";
import { ariaLabels, longSentences, text } from "./helpers";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<object>()), readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh() {} }),
}));

// Modèle réel du dépôt (models/turnover) : la page est rendue avec ses facteurs et ses mesures d'évaluation
const VERSION = "logreg-v1-20260930";
const BUNDLE = `models/turnover/${VERSION}`;

let fx: ReturnType<typeof setupDb>;

beforeAll(() => {
  fx = setupDb("monitoring-model");
  const { sqlite } = getDb();
  sqlite.prepare("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('data_end_date', '2026-08-31')").run();
  const metrics = JSON.parse(fs.readFileSync(`${BUNDLE}/model.json`, "utf8")).metrics;
  const model = Number(
    sqlite
      .prepare("INSERT INTO model_version (version, kind, status, fsv, bundle_path, metrics_json, promoted_at) VALUES (?, 'LOGREG', 'CHAMPION', 'v1', ?, ?, '2026-09-30T19:17:00.000Z')")
      .run(VERSION, BUNDLE, JSON.stringify(metrics)).lastInsertRowid,
  );
  sqlite.prepare("INSERT INTO model_version (version, kind, status, fsv, promoted_at) VALUES ('b0-v1', 'B0', 'RETIRE', 'v1', '2026-09-29T10:00:00.000Z')").run();
  sqlite.prepare("INSERT INTO topic_model (topic, version, kind, status, promoted_at) VALUES ('ABSENTEISME', 'abs-ridge-v1-20260930', 'RIDGE_DIRECT', 'CHAMPION', '2026-09-30T19:20:00.000Z')").run();

  // Deux calculs publiés : 8 collaborateurs, 1 Élevé, 1 Moyen, 6 Faible
  const employees = Object.values(fx.emp);
  const probabilities = [0.12, 0.08, 0.05, 0.04, 0.035, 0.03, 0.02, 0.01];
  let run = 0;
  for (const asOf of ["2026-07-31", "2026-08-31"]) {
    run = Number(
      sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, n_scored, finished_at) VALUES (?, ?, 'PUBLIE', ?, '2026-09-30T20:00:00.000Z')").run(asOf, model, employees.length)
        .lastInsertRowid,
    );
    const insert = sqlite.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    employees.forEach((id, i) => insert.run(run, id, asOf, probabilities[i], i === 0 ? "ELEVE" : i === 1 ? "MOYEN" : "FAIBLE", i + 1, probabilities[i] / 0.048, model));
  }
  sqlite.prepare("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('current_run_id', ?)").run(String(run));
});

afterAll(() => teardownDb(fx.file));

const as = (role: "RH" | "ADMIN") =>
  (session.current = { userId: role === "RH" ? fx.users.rh : fx.users.admin, login: role.toLowerCase(), role, employeeId: null } as SessionUser);
const render = async (role: "RH" | "ADMIN") => {
  as(role);
  const page = (await import("@/app/(app)/transparency/page")).default;
  return renderToStaticMarkup((await page()) as ReactElement);
};
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("Transparence du modèle : rendu RH", () => {
  let markup: string;
  let s: string;
  beforeAll(async () => {
    markup = await render("RH");
    s = text(markup);
  });

  it("identifiant technique remplacé par un libellé lisible, sauf fiche technique et historique", () => {
    expect(s).toContain("Transparence du modèle Aide à la décision humaine Facteurs associés, non causaux Données agrégées");
    expect(s).toContain(
      "Dans la cible Régression logistique régularisée · en service depuis le 30/09/2026 Pouvoir de tri (AUC) : 0,63 · modéré Lift à la capacité : 3,3 × (cible ≥ 3 ×) Observé / prévu : 1,00 (cible 0,8 à 1,25) Pente de calibration : 0,84 (cible 0,8 à 1,2) Action : Aucune",
    );
    expect(s).not.toContain("À quoi sert cette page");
    // Le code du modèle n'apparaît qu'avec son libellé : fiche technique puis historique des versions (cartes sous 640 px et tableau)
    expect(count(s, VERSION)).toBe(3);
    expect(s.indexOf(VERSION)).toBeGreaterThan(s.indexOf("Fiche technique du modèle en service"));
    expect(s).toMatch(new RegExp(`Version Modèle mis en service le 30/09/2026 ${VERSION}`));
    expect(s).toContain("Modèle mis en service le 29/09/2026 b0-v1 variables v1");
    // Suivi mensuel : le modèle de chaque calcul est nommé par sa date, pas par son code
    expect(s).toContain("août 2026 (publié) Modèle du 30/09/2026 8");
    // Modèles par sujet (repliés) : libellé lisible à côté du code
    expect(s).toContain("Modèles par sujet : 1 (absentéisme)");
    expect(s).toContain("Modèle mis en service le 30/09/2026 abs-ridge-v1-20260930 RIDGE_DIRECT");
  });

  it("facteurs : titre-message, sens écrit et poids signés ; familles avec le signal en badge", () => {
    expect(s).toContain("Fonctionnement du modèle");
    expect(s).toContain("Poids des principaux facteurs (%)");
    expect(s).toMatch(/10 facteurs sur 25 · \d+ % du poids total/);
    expect(s).toContain("Salaire plus haut que la médiane du poste Risque plus faible −11 %");
    expect(s).toContain("Plus d'absences courtes Risque plus élevé +11 %");
    expect(s).toContain("Risque plus élevé Risque plus faible Voir les données");
    const factors = ariaLabels(markup).find((a) => a.startsWith("Barres divergentes"))!;
    expect(factors).toContain("poids relatif de 10 facteurs, du plus influent au moins influent");
    expect(factors).toContain("Salaire plus haut que la médiane du poste : −11 %, risque plus faible");

    expect(s).toContain("Poids par famille de facteurs (%) Hors absences de santé");
    expect(s).toMatch(/Levier RH (\S+ )*Rémunération/);
    expect(s).toMatch(/Signal à observer (\S+ )*Absences \(hors santé\)/);
    expect(s).toMatch(/Rémunération Levier RH \d+ %/);
    expect(ariaLabels(markup).some((a) => a.includes("Poids de la famille (%)") && a.includes("Absences (hors santé)"))).toBe(true);
  });

  it("fiabilité : analogies « sur 100 », marges d'incertitude, calibration avec intervalles", () => {
    expect(s).toContain("Évaluation hors apprentissage : mars 2023 – févr. 2026 · 35 621 situations mensuelles");
    expect(s).toContain("14 sur 100 Démissions à 6 mois");
    expect(s).toContain("Lift : 3,3 × Dans la cible (≥ 3 ×) IC 95 % : 2,4 à 4,3");
    expect(s).toContain("7 sur 100 Démissionnaires classés Élevé 6 mois avant Capacité (niveau Élevé) : 2 %");
    expect(s).toContain("0,63 Modéré IC 95 % : 0,60 à 0,66");
    expect(s).toContain("50 : hasard");
    expect(s).toContain("Calibration du modèle");
    expect(s).toContain("Observé / prévu 1,00 (cible 0,8 à 1,25) Dans la cible IC 95 % observé / prévu 0,88 à 1,12");
    expect(s).toContain("Groupe le plus exposé 9,9 % annoncé · 9,3 % observé");
    expect(s).toContain("Pente de calibration 0,84 (cible 0,8 à 1,2) Dans la cible");
    expect(s).toContain("Risque annoncé et observé (%)");
    expect(s).toContain("Dans la cible Modèle (IC 95 %) Accord parfait Écart acceptable (0,8 à 1,25)");
    expect(s).toContain("Risque annoncé (moyenne) Démissions observées Marge d'incertitude à 95 % Observations");
    expect(s).toContain("9,9 % 9,3 % 8,4 à 10,3 % 3 563");
    expect(ariaLabels(markup).some((a) => a.startsWith("Nuage de points") && a.includes("marge d'incertitude à 95 %"))).toBe(true);
  });

  it("équité : un visuel et un tableau par axe, jugement en mots", () => {
    expect(s).toContain("Équité entre groupes Sexe et âge non utilisés par le modèle Groupes de moins de 30 masqués Aucun blocage automatique");
    expect(s).toContain("Sexe Juste pour chaque groupe");
    expect(s).toContain("Tranche d'âge Juste pour chaque groupe");
    const dots = ariaLabels(markup).filter((a) => a.startsWith("Points par groupe sur une même échelle"));
    expect(dots).toHaveLength(2);
    expect(dots[0]).toContain("Femmes : réel 4,0 %, estimé 4,0 %, juste ; Hommes : réel 4,1 %, estimé 4,1 %, juste");
    expect(dots[1]).toContain("45 ans et plus : réel 3,6 %, estimé 4,1 %, juste");
    expect(s).toContain("Femmes 14 226 observations 4,0 % 4,0 % Juste 1,8 %");
    // Rapport complet (replié) : marge du rapport observé / prévu
    expect(s).toContain("0,82 à 1,21");
  });

  it("suivi mensuel : trois visuels aux titres courts, chiffres clés en bulle", () => {
    expect(s).toContain("Collaborateurs évalués par calcul");
    expect(s).toContain("Niveaux de risque par calcul (%)");
    expect(s).toContain("août 2026 : 12,5 % Élevé · 12,5 % Moyen");
    expect(s).toMatch(/Risques estimés à 6 mois : Calcul du 31\/08\/2026 · 80 % sous \d+ %/);
    const labels = ariaLabels(markup);
    expect(labels.some((a) => a.includes("Collaborateurs évalués") && a.includes("août 2026"))).toBe(true);
    expect(labels.some((a) => a.startsWith("Barres empilées à 100 %") && a.includes("août 2026 : Élevé 12,5 %, Moyen 12,5 %, Faible 75,0 %"))).toBe(true);
    expect(labels.some((a) => a.startsWith("Histogramme") && a.includes("Moyenne : 4,8 %"))).toBe(true);
  });

  it("structure : sommaire, sections techniques repliées, règle de décision, phrases courtes", () => {
    for (const anchor of ["modele", "performances", "equite", "suivi", "technique"]) {
      expect(markup).toContain(`href="#${anchor}"`);
      expect(markup).toContain(`<section id="${anchor}"`);
    }
    expect(count(s, "2,0 % des évalués")).toBe(1);
    expect(s).toContain("Modèle en service");
    expect(s).toContain("Historique des versions Mise en service tracée, hors interface");
    expect(s).not.toContain("Modifier la capacité");
    // Six blocs repliés : mesures détaillées, lift, courbe de décision, équité, coefficients, modèles par sujet
    const technical = markup.slice(markup.indexOf('<section id="technique"'));
    expect(count(technical, "<details class=\"group/disc")).toBe(6);
    expect(longSentences(markup)).toEqual([]);
  });

  it("historique des versions : cartes sous 640 px, tableau au-delà", () => {
    const history = markup.slice(markup.indexOf("Historique des versions</h3>"));
    expect(history).toMatch(/<ul aria-label="Historique des versions de modèle" class="[^"]*\bsm:hidden\b/);
    expect(history).toMatch(/<div class="[^"]*\bhidden\b[^"]*\bsm:block\b[^"]*" tabindex="0" role="region" aria-label="Historique des versions de modèle \(zone défilante\)"/);
    const cards = text(history.slice(history.indexOf("<ul"), history.indexOf("</ul>")));
    expect(cards).toContain("Modèle mis en service le 29/09/2026 b0-v1 variables v1 Retiré Méthode B0");
    expect(cards).toMatch(new RegExp(`${VERSION} variables v1 En service Méthode LOGREG Enregistrée \\d{2}/\\d{2}/\\d{4} Mise en service 30/09/2026`));
    expect(cards).toMatch(/AUC \d,\d{2} Lift à la capacité \d,\d ×/);
  });
});

describe("Transparence du modèle : rendu ADMIN", () => {
  it("mêmes mesures agrégées, lien vers les paramètres, aucune donnée nominative", async () => {
    const markup = await render("ADMIN");
    const s = text(markup);
    expect(s).toContain("Régression logistique régularisée · en service depuis le 30/09/2026");
    expect(s).toContain("Poids des principaux facteurs (%)");
    expect(s).toContain("14 sur 100 Démissions à 6 mois");
    expect(s).toContain("Sexe Juste pour chaque groupe");
    expect(s).toContain("Modifier la capacité");
    expect(count(s, VERSION)).toBe(3);
    // Aucun nom, matricule, lien vers une fiche ni montant
    const { sqlite } = getDb();
    const people = sqlite.prepare("SELECT matricule, last_name AS lastName FROM employee").all() as { matricule: string; lastName: string }[];
    expect(people.length).toBeGreaterThan(0);
    for (const p of people) {
      expect(s).not.toContain(p.lastName);
      expect(s).not.toMatch(new RegExp(`\\b${p.matricule}\\b`));
    }
    expect(markup).not.toContain("/employees");
    expect(s).not.toContain("TND");
    expect(longSentences(markup)).toEqual([]);
  });
});
