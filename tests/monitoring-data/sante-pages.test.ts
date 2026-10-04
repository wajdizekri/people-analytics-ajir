import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { clearDriftCache } from "@/lib/dal/drift";
import { setSetting } from "@/lib/settings";
import { setupDb, teardownDb } from "../ui-admin/helpers";
import { charts, html, inOrder, longSentences, text, type Any } from "./render";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<object>()), readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/charts/echart", async () => ({ EChart: (await import("./render")).EChartStub }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh() {} }),
}));

let fx: ReturnType<typeof setupDb>;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function addImport(days: number, status: "OK" | "BLOQUE", rowsOk: number, rowsRejected: number, quality: number, rejections: [file: string, rule: string, severity: string, message: string, n: number][]) {
  const { sqlite } = getDb();
  const id = Number(
    sqlite
      .prepare("INSERT INTO import_batch (source, status, started_at, finished_at, rows_ok, rows_rejected, quality_score) VALUES ('export-test', ?, ?, ?, ?, ?, ?)")
      .run(status, ago(days), ago(days), rowsOk, rowsRejected, quality).lastInsertRowid,
  );
  const rej = sqlite.prepare("INSERT INTO import_rejection (batch_id, file, line, rule, message, severity) VALUES (?, ?, ?, ?, ?, ?)");
  let line = 1;
  for (const [file, rule, severity, message, n] of rejections) for (let k = 0; k < n; k++) rej.run(id, file, line++, rule, message, severity);
  return id;
}

beforeAll(() => {
  fx = setupDb("monitoring-data-sante");
  clearDriftCache();
  setSetting(getDb().sqlite, "data_end_date", ago(10).slice(0, 10));
  addImport(65, "OK", 980, 20, 0.981, [
    ["attendance.csv", "POINTAGE_SANS_SORTIE", "AVERTISSEMENT", "Pointage du 2026-08-03 sans heure de sortie : importé sans sortie", 5],
    ["attendance.csv", "POINTAGE_DUPLIQUE", "REJET", "Pointage en double le 2026-08-03", 3],
    ["payroll.csv", "SALAIRE_SOUS_SMIG", "REJET", "Salaire de base 300 TND inférieur au SMIG (472 TND) en 2026-08", 2],
    ["employees.csv", "GRADE_INCONNU", "CORRECTION", "Grade G12 inconnu : grade ignoré", 1],
  ]);
});

afterAll(() => teardownDb(fx.file));

const as = (role: "RH" | "ADMIN" | "MANAGER") =>
  (session.current = {
    userId: role === "RH" ? fx.users.rh : role === "ADMIN" ? fx.users.admin : fx.users.mgr,
    login: role.toLowerCase(),
    role,
    employeeId: role === "MANAGER" ? fx.emp.MGR : null,
  } as SessionUser);

async function health(role: "RH" | "ADMIN", params: Record<string, string> = {}) {
  as(role);
  const page = (await import("@/app/(app)/data-health/page")).default;
  const markup = html(await page({ searchParams: Promise.resolve(params) }));
  return { markup, s: text(markup), charts: charts(markup) };
}

async function drift(role: "RH" | "ADMIN") {
  as(role);
  const page = (await import("@/app/(app)/derive/page")).default;
  const markup = html(await page());
  return { markup, s: text(markup), charts: charts(markup) };
}

const NAMES = /Nom (DG|MGR2?|SUB|E[1-4])/;

describe("Santé des données : un seul import", () => {
  it("RH : indicateurs, puis Pareto titré par son message, tableau compact des contrôles, historique, tendances", async () => {
    const { s, charts: figs } = await health("RH");
    expect(inOrder(s, ["Score qualité du dernier import", "des lignes signalées sont écartées", "Que faire", "Comprendre chaque contrôle", "Historique des imports et des traitements", "Tendances des imports et des traitements"])).toBe(true);
    expect(s).toContain("45 % des lignes signalées sont écartées, d'abord par « Pointage en double »");
    const pareto = figs.find((c) => c.label.startsWith("Barres horizontales triées : lignes signalées par contrôle"))!;
    expect(pareto.option.yAxis.data).toEqual(["Pointage sans heure de sortie", "Pointage en double", "Salaire de base inférieur au SMIG (salaire minimum légal)", "Grade inconnu (grade ignoré)"]);
    expect(pareto.option.series[0].data.map((d: Any) => d.value)).toEqual([5, 3, 2, 1]);
    // tableau compact : effet, part, action en une ligne ; l'action complète reste dans le bloc replié
    expect(inOrder(s, ["Effet sur la ligne", "Part du total", "POINTAGE_DUPLIQUE", "27,3 %", "Aucune correction nécessaire pour les analyses.", "Comprendre chaque contrôle"])).toBe(true);
    expect(s).toContain("Signaler à l'équipe AJIR si le volume augmente");
    // un seul import : barre de niveau face au seuil, pas de courbe
    expect(s).toContain("Un seul import : la tendance apparaîtra au 3e import");
    expect(figs.some((c) => c.label.startsWith("Courbe du score qualité"))).toBe(false);
    expect(figs.some((c) => c.label.startsWith("Import n° 1. Barre de niveau : Score qualité"))).toBe(true);
    expect(s).toContain("2,0 % des lignes lues écartées (20 sur 1 000)");
    expect(s).not.toContain("Voir les données");
    expect(s).toContain("Salaire de base 300 TND");
    expect(s).not.toContain("Lancer l'import");
  });

  it("ADMIN : même lecture, import guidé après les contrôles, aucun montant ni nom", async () => {
    const { s } = await health("ADMIN");
    expect(inOrder(s, ["des lignes signalées sont écartées", "Que faire", "Étape 1 : Choisir les fichiers", "Historique des imports et des traitements"])).toBe(true);
    expect(s).not.toContain("300 TND");
    expect(s).not.toMatch(NAMES);
  });

  it("phrases affichées d'emblée : 20 mots au plus", async () => {
    expect(longSentences((await health("RH")).markup)).toEqual([]);
    expect(longSentences((await health("ADMIN")).markup)).toEqual([]);
  });
});

describe("Dérive des données : sans variable calculée", () => {
  it("états vides explicites, indicateurs sans valeur, aucune donnée nominative", async () => {
    for (const role of ["RH", "ADMIN"] as const) {
      const { s, charts: figs, markup } = await drift(role);
      expect(s).toContain("En attente de données Dérive non calculable pour l'instant.");
      expect(s).toContain("Il faut deux mois de variables calculées");
      expect(s).toContain("Pas encore de cohorte suivie 6 mois");
      expect(s).not.toContain("Feu vert");
      expect(s.match(/— Non calculé/g)).toHaveLength(3);
      expect(s).toContain("— En attente");
      expect(figs).toEqual([]);
      expect(s).not.toMatch(NAMES);
      expect(longSentences(markup)).toEqual([]);
    }
  });
});

describe("Santé des données : trois imports", () => {
  beforeAll(() => {
    addImport(35, "BLOQUE", 900, 100, 0.93, [["attendance.csv", "POINTAGE_DUPLIQUE", "REJET", "Pointage en double le 2026-08-03", 4]]);
    addImport(5, "OK", 985, 15, 0.985, [["attendance.csv", "POINTAGE_DUPLIQUE", "REJET", "Pointage en double le 2026-09-03", 2]]);
    const job = getDb().sqlite.prepare("INSERT INTO app_job (type, target, status, created_at, started_at, finished_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
    job.run("IMPORT", "a", "TERMINE", ago(5), ago(5), new Date(Date.now() - 5 * DAY + 120_000).toISOString(), fx.users.admin);
    job.run("BATCH_MENSUEL", null, "ECHEC", ago(4), ago(4), ago(4), fx.users.admin);
  });

  it("courbe bornée avec seuil annoté, cumul des contrôles sur 90 jours, traitements, un tableau par visuel", async () => {
    const { s, charts: figs } = await health("RH");
    expect(s).toContain("Qualité de 98,5 % au dernier import, au-dessus du seuil de blocage");
    expect(s).not.toContain("la tendance apparaîtra");
    const line = figs.find((c) => c.label.startsWith("Courbe du score qualité sur les 3 derniers imports"))!;
    expect([line.option.yAxis.min, line.option.yAxis.max]).toEqual([90, 100]);
    expect(text(line.option.series[0].markLine.label.formatter)).toBe("Seuil de blocage : 95 %");
    expect(s).toContain("« Pointage en double » : contrôle le plus signalé sur 90 jours");
    expect(s).toContain("cumul des 3 imports des 90 derniers jours");
    expect(s).toContain("2 traitements en 30 jours, dont 1 en échec");
    expect(s.match(/Voir les données par (import|contrôle|traitement)/g)).toEqual(["Voir les données par import", "Voir les données par contrôle", "Voir les données par traitement"]);
    // dernier import avec un seul contrôle : le tableau suffit, pas de graphique à une barre
    expect(figs.some((c) => c.label.startsWith("Barres horizontales triées : lignes signalées par contrôle. En tête"))).toBe(false);
    expect(s).toContain("Contrôles de l'import n° 3");
  });

  it("un import plus ancien reste consultable avec son Pareto", async () => {
    const { s, charts: figs } = await health("ADMIN", { batch: "1" });
    expect(s).toContain("Contrôles de l'import n° 1");
    expect(figs.some((c) => c.label.startsWith("Barres horizontales triées : lignes signalées par contrôle. En tête"))).toBe(true);
    expect(s).toContain("Contrôles affichés ci-dessus");
    expect(s).not.toContain("300 TND");
  });
});
