import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { setupDb, teardownDb } from "./helpers";

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

let fx: ReturnType<typeof setupDb>;
const bundleDir = path.join("data", `test-ui-pages-${process.pid}`, "logreg-pages");

beforeAll(() => {
  fx = setupDb("data-model-pages");
  const { sqlite } = getDb();
  const batch = Number(
    sqlite
      .prepare("INSERT INTO import_batch (source, status, started_at, finished_at, rows_ok, rows_rejected, quality_score) VALUES ('export-aout', 'OK', '2026-09-29T20:31:00.000Z', '2026-09-29T20:32:00.000Z', 980, 20, 0.981)")
      .run().lastInsertRowid,
  );
  const rej = sqlite.prepare("INSERT INTO import_rejection (batch_id, file, line, rule, message, severity) VALUES (?, ?, ?, ?, ?, ?)");
  rej.run(batch, "payroll.csv", 12, "SALAIRE_SOUS_SMIG", "Salaire de base 300 TND inférieur au SMIG (472 TND) en 2026-08", "REJET");
  rej.run(batch, "attendance.csv", 40, "POINTAGE_SANS_SORTIE", "Pointage du 2026-08-03 sans heure de sortie : importé sans sortie", "AVERTISSEMENT");
  sqlite.prepare("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('data_end_date', '2026-08-31')").run();

  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, "model.json"),
    JSON.stringify({
      version: "logreg-pages",
      kind: "LOGREG",
      fsv: "v1",
      features: ["compa_ratio", "overtime_h_avg_3m", "tenure_months"],
      standardization: { mean: [1, 10, 60], std: [0.1, 8, 50] },
      coef: [-0.4, 0.2, -0.3],
      intercept: -3.4,
      calibration: { method: "platt", a: 1, b: 0 },
    }),
  );
  sqlite
    .prepare("INSERT INTO model_version (version, kind, status, fsv, bundle_path, metrics_json, promoted_at) VALUES ('logreg-pages', 'LOGREG', 'CHAMPION', 'v1', ?, ?, '2026-09-30T19:17:00.000Z')")
    .run(
      bundleDir,
      JSON.stringify({
        auc: 0.63,
        eval: { n: 35621, n_pos: 1461, base_rate: 0.041, period: "2023-03 → 2026-02 (6 origines)" },
        calibration: { oe_ratio: 1.0, slope: 0.84, bins: [{ p_mean: 0.02, observed: 0.021, n: 100 }, { p_mean: 0.099, observed: 0.093, n: 100 }] },
        lift: { k_rate: 0.02, lift_at_k: 3.33, precision_at_k: 0.137, recall_at_k: 0.067 },
        fairness: { min_group_size: 50, sex: [{ group: "Femmes", n: 900, base_rate: 0.04, mean_pred: 0.041, oe_ratio: 0.98, selection_rate: 0.02 }] },
      }),
    );
});

afterAll(() => {
  fs.rmSync(path.dirname(bundleDir), { recursive: true, force: true });
  teardownDb(fx.file);
});

const as = (role: "RH" | "ADMIN" | "MANAGER") =>
  (session.current = {
    userId: role === "RH" ? fx.users.rh : role === "ADMIN" ? fx.users.admin : fx.users.mgr,
    login: role.toLowerCase(),
    role,
    employeeId: role === "MANAGER" ? fx.emp.MGR : null,
  } as SessionUser);
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const sp = { searchParams: Promise.resolve({}) };

describe("Santé des données", () => {
  it("RH : état en une phrase, contrôles expliqués règle par règle, aucune commande d'administration", async () => {
    as("RH");
    const page = (await import("@/app/(app)/data-health/page")).default;
    const s = text(html(await page(sp)));
    expect(s).toMatch(/Dernier import du \d{2}\/\d{2}\/2026 \(données jusqu'au 31\/08\/2026\) : qualité 98,1 %, calcul autorisé\./);
    expect(s).toContain("Salaire de base inférieur au SMIG");
    expect(s).toContain("Ce que cela veut dire :");
    expect(s).toContain("Que faire : Vérifier le bulletin dans AJIR");
    expect(s).toContain("Lignes importées, à vérifier");
    expect(s).toContain("Salaire de base 300 TND");
    expect(s).not.toContain("Lancer l'import");
    expect(s).not.toContain("Relancer le calcul mensuel");
    expect(s).not.toMatch(/\bjob\b|Scoring/);
  });

  it("ADMIN : import guidé en trois étapes, boutons verbe + objet, montants masqués dans les exemples", async () => {
    as("ADMIN");
    const page = (await import("@/app/(app)/data-health/page")).default;
    const s = text(html(await page(sp)));
    for (const step of ["Étape 1 : Choisir les fichiers", "Étape 2 : Vérifier la sélection", "Étape 3 : Lancer l'import"]) expect(s).toContain(step);
    expect(s).toContain("Importer un export AJIR");
    expect(s).toContain("Relancer le calcul mensuel");
    expect(s).toContain("Manquant · obligatoire");
    expect(s).toContain("Redémarrez le service « worker » sur le serveur.");
    expect(s).not.toContain("300 TND");
  });
});

describe("Transparence du modèle", () => {
  it("langage simple : verdict, facteurs avec sens et poids, analogies « sur 100 », équité vulgarisée", async () => {
    as("RH");
    const page = (await import("@/app/(app)/transparency/page")).default;
    const s = text(html(await page()));
    expect(s).toContain("Modèle dans ses cibles");
    expect(s).toContain("Comment le modèle décide");
    expect(s).toContain("Salaire plus haut que la médiane du poste");
    expect(s).toContain("14 ont démissionné dans les 6 mois suivants");
    expect(s).toContain("7 étaient classés Élevé 6 mois avant leur départ");
    expect(s).toContain("63 cas sur 100");
    expect(s).toMatch(/Pour 100 démissions prévues ?, 100 ont été observées/);
    expect(s).toContain("aucun groupe n'est surestimé ni sous-estimé");
    expect(s).toContain("2,0 % des collaborateurs évalués");
    expect(s).toContain("Historique des versions");
  });

  it("manager redirigé", async () => {
    as("MANAGER");
    const page = (await import("@/app/(app)/transparency/page")).default;
    await expect(page()).rejects.toThrow("REDIRECT:/interdit");
  });
});

describe("Design system : écrans « Données et modèle »", () => {
  const files = [
    "src/app/(app)/data-health/page.tsx",
    "src/app/(app)/data-health/import-controls.tsx",
    "src/app/(app)/data-health/trends.tsx",
    "src/app/(app)/data-health/admin-controls.tsx",
    "src/app/(app)/data-health/loading.tsx",
    "src/app/(app)/transparency/page.tsx",
    "src/app/(app)/transparency/loading.tsx",
    "src/app/(app)/derive/page.tsx",
    "src/app/(app)/derive/loading.tsx",
    "src/app/(app)/backtesting/page.tsx",
    "src/app/(app)/backtesting/loading.tsx",
    "src/components/monitoring/disclosure.tsx",
    "src/components/monitoring/loading-shapes.tsx",
  ];

  it("aucune couleur fixe dans les classes : uniquement des jetons (thème clair et sombre)", () => {
    const fixed = /\b(?:text|bg|border|ring|divide|from|via|to|outline)-(?:white|black|slate|gray|sky|red|amber|emerald|green|blue|brand)(?:-\d+)?\b/g;
    for (const f of files) {
      const found = fs.readFileSync(f, "utf8").match(fixed) ?? [];
      expect(found, f).toEqual([]);
    }
  });

  it("ADMIN : zone de dépôt des fichiers et bouton de sélection", async () => {
    as("ADMIN");
    const page = (await import("@/app/(app)/data-health/page")).default;
    const s = text(html(await page(sp)));
    expect(s).toContain("Glissez-déposez les fichiers CSV de l'export ici");
    expect(s).toContain("Choisir les fichiers CSV");
    expect(s).toContain("Aucun fichier choisi");
  });
});
