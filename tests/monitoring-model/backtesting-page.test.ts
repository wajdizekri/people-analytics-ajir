import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getBacktest } from "@/lib/dal/backtest";
import { promoteModel, registerBundle } from "@/lib/scoring";
import { buildWorld, openDalDb, publishRun } from "../fixtures/unit/dal-world";
import { ariaLabels, longSentences, text } from "./helpers";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<object>()), readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh() {}, push() {} }),
}));

const ORIGIN = "2024-11-30";
const TOY = path.resolve(__dirname, "../fixtures/engine/logreg-toy");

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;

// 10 collaborateurs évalués au 30/11/2024, 4 démissions dans les 6 mois : 2 classés Élevé (T4, V1), 2 classés Faible (Y1, W1)
beforeAll(() => {
  db = openDalDb("monitoring-model-backtest");
  w = buildWorld(db.sqlite);
  registerBundle(db.sqlite, TOY);
  promoteModel(db.sqlite, "logreg-toy-v1");
  db.sqlite
    .prepare("UPDATE model_version SET metrics_json = ?, promoted_at = '2026-09-30T19:17:00.000Z' WHERE version = 'logreg-toy-v1'")
    .run(JSON.stringify({ train_from: "2020-09-30", train_to: "2025-02-28" }));
  const add = (matricule: string) => w.fx.emp({ matricule, hire: "2018-01-01", dept: w.dept.prod, managerId: w.e.MGR });
  const [y, v, x] = [add("Y1"), add("V1"), add("W1")];
  w.fx.exit(y, "2024-12-20", "DEMISSION", { recordedAt: "2024-12-22" });
  w.fx.exit(x, "2025-02-10", "DEMISSION", { resignation: "2025-01-10", recordedAt: "2025-01-11" });
  w.fx.exit(v, "2025-05-15", "DEMISSION", { resignation: "2025-04-15", recordedAt: "2025-04-16" });
  const ranked = [w.e.T4, v, w.e.T1, y, w.e.T2, w.e.T3, x, w.e.S1, w.e.S2, w.e.SUB];
  const snapshot = db.sqlite.prepare("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json) VALUES (?, ?, 'v1', '[]')");
  for (const id of ranked) snapshot.run(id, ORIGIN);
  publishRun(
    db.sqlite,
    "LOGREG",
    ORIGIN,
    ranked.map((employeeId, i) => ({ employeeId, level: i < 2 ? "ELEVE" : i === 2 ? "MOYEN" : "FAIBLE", prob6: 0.3 - i * 0.02, lift: 1 })),
    { version: "logreg-toy-v1", current: false },
  );
});
afterAll(() => db.close());

const as = (role: "RH" | "ADMIN") => (session.current = { userId: role === "RH" ? w.users.rh : w.users.admin, login: role.toLowerCase(), role, employeeId: null } as SessionUser);
const page = async () => (await import("@/app/(app)/backtesting/page")).default;
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("DTO de la vérification a posteriori", () => {
  it("agrégats ajoutés : courbe de gain, démissions par mois, date de mise en service", () => {
    const b = getBacktest(w.ctx.rh, { mois: "2024-11" }, { source: "api" });
    expect(b.model).toMatchObject({ version: "logreg-toy-v1", kind: "LOGREG", promotedAt: "2026-09-30T19:17:00.000Z" });
    const r = b.result!;
    expect(r).toMatchObject({ n: 10, positives: 4, missedPositives: 2, seenInTraining: true, undated: 0 });
    // Un point par collaborateur (moins de 100) : 2 démissions sur 4 repérées avec les 2 premiers rangs
    expect(r.gain).toHaveLength(11);
    expect(r.gain.map((p) => p.captured)).toEqual([0, 0.25, 0.5, 0.5, 0.75, 0.75, 0.75, 1, 1, 1, 1]);
    expect(r.gain[2].share).toBeCloseTo(0.2, 12);
    expect(r.byMonth.map((m) => [m.month, m.levels.ELEVE, m.levels.MOYEN, m.levels.FAIBLE])).toEqual([
      ["2024-12", 0, 0, 1],
      ["2025-01", 0, 0, 1],
      ["2025-02", 0, 0, 0],
      ["2025-03", 1, 0, 0],
      ["2025-04", 1, 0, 0],
      ["2025-05", 0, 0, 0],
    ]);
    // Agrégats sans identité : ni nom ni matricule hors de la liste nominative
    expect(JSON.stringify({ gain: r.gain, byMonth: r.byMonth })).not.toMatch(/Nom|Prenom|matricule/i);
  });
});

describe("Vérification a posteriori : rendu RH", () => {
  let markup: string;
  let s: string;
  beforeAll(async () => {
    as("RH");
    markup = renderToStaticMarkup((await (await page())({ searchParams: Promise.resolve({ mois: "2024-11" }) })) as ReactElement);
    s = text(markup);
  });

  it("résultat au format libellé : valeur, modèle nommé sans identifiant technique, badge « date d'apprentissage »", () => {
    expect(s).toContain("Vérification a posteriori (backtesting)");
    expect(s).toContain("Résultat au 30/11/2024 Date d'apprentissage (30/09/2020 – 28/02/2025) : résultat optimiste");
    expect(s).toContain("Classés Élevé 2 personnes · 2 démissions Classés Élevé ou Moyen 3 personnes · 2 démissions Démissions classées Faible 2");
    expect(s).toContain("Modèle Modèle mis en service le 30/09/2026 Niveaux Calcul enregistré du mois");
    expect(s).not.toContain("logreg-toy-v1");
    expect(s).toContain("Dates d'apprentissage (jusqu'à févr. 2025) : résultats optimistes");
    expect(s).toContain("Exposition au risque, hors effet des actions");
    expect(s).not.toContain("À quoi sert cette page");
    expect(s).not.toMatch(/départs? évités?/i);
    // La première date écrite après « au » est la date d'origine (repère lu par les tests de bout en bout)
    expect(/au (\d{2})\/(\d{2})\/(\d{4})/.exec(s)!.slice(1)).toEqual(["30", "11", "2024"]);
  });

  it("tuiles : collaborateurs évalués, démissions observées, précision, lift et rappel au niveau Élevé", () => {
    for (const [label, value, hint] of [
      ["Collaborateurs évalués (suivi complet)", "10", "Au 30/11/2024"],
      ["Démissions dans les 6 mois", "4", "Taux moyen : 40,0 %"],
      ["Précision au niveau Élevé", "100,0 %", "2 sur 2 classés Élevé"],
      ["Lift au niveau Élevé", "2,5 ×", "Taux moyen : 40,0 %"],
      ["Rappel au niveau Élevé", "50,0 %", "2 sur 4 démissions"],
    ]) {
      const at = s.indexOf(`${label} ${value}`);
      expect(at, label).toBeGreaterThan(-1);
      expect(s.indexOf(hint, at), label).toBeGreaterThan(at);
    }
  });

  it("visuels : taux par niveau, gain avec diagonale et capacité RH, démissions mois par mois", () => {
    expect(s).toContain("Taux de démission par niveau (%)");
    expect(s).toContain("Élevé (2 sur 2) 100,0 %");
    expect(s).toContain("Ensemble (4 sur 10) 40,0 %");
    expect(s).toContain("Démissions repérées par part contactée (%)");
    expect(s).toContain("20,0 % (capacité RH) 50,0 % 20,0 %");
    expect(s).toContain("Démissions par mois et niveau de risque");
    expect(s).toContain("3 premiers mois : 2 sur 4 démissions");
    expect(s).toContain("mars 2025 1 0 0 1");
    const labels = ariaLabels(markup);
    expect(labels.some((a) => a.startsWith("Courbe de gain") && a.includes("À la capacité RH : 20,0 % contactés : 50,0 % des démissions repérées"))).toBe(true);
    expect(labels.some((a) => a.startsWith("Barres empilées : démissions de chacun des 6 mois"))).toBe(true);
    expect(labels.some((a) => a.includes("Part ayant démissionné dans les 6 mois (%)"))).toBe(true);
  });

  it("tableau des groupes et liste nominative conservés, phrases courtes", () => {
    expect(markup).toContain("Exposition au risque et démissions observées");
    for (const header of ["Précision", "Rappel", "Lift", "Délai moyen avant démission"]) expect(s).toContain(header);
    expect(s).toContain("Classés Élevé 2 2 100,0 % 50,0 % 2,5 ×");
    expect(s).toContain("Élevé ou Moyen 3 2 66,7 % 50,0 % 1,7 ×");
    expect(s).toContain("Classés Faible 7 2 28,6 % 50,0 % 0,7 ×");
    expect(s).toContain("Collaborateurs signalés au 30/11/2024");
    expect(s).toContain("NomT4 PrenomT4");
    expect(s).toContain("Oui, le 15/04/2025");
    expect(count(markup, 'id="f-mois"')).toBe(1);
    expect(s).toContain("Date d'origine (fin de mois)");
    expect(s).toContain("Afficher la vérification");
    expect(longSentences(markup)).toEqual([]);
    // Le contrôle de longueur détecte bien une phrase de 21 mots
    expect(longSentences(`<p>${Array.from({ length: 21 }, (_, i) => `mot${i}`).join(" ")}.</p>`)).toHaveLength(1);
  });
});

describe("Vérification a posteriori : rôles", () => {
  it("administrateur redirigé : la liste nominative reste réservée à la RH", async () => {
    as("ADMIN");
    await expect((await page())({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/interdit");
  });
});
