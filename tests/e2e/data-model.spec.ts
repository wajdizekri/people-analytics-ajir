import { test, expect, q, q1, storageState, toInt, waitReady } from "./helpers";

const latestBatch = () => q1<{ id: number; source: string; quality: number }>("SELECT id, source, quality_score AS quality FROM import_batch ORDER BY id DESC LIMIT 1");
const champion = () => q1<{ version: string; kind: string }>("SELECT version, kind FROM model_version WHERE status = 'CHAMPION'");
const setting = (key: string) => q1<{ value: string }>("SELECT value FROM app_setting WHERE key = @key", { key })?.value;

test.describe("Santé des données", () => {
  test.describe("RH", () => {
    test.use({ storageState: storageState("rh") });

    test("lot importé, score qualité, seuil et détail des règles", async ({ page }) => {
      const batch = latestBatch();
      test.skip(!batch, "aucun import dans la base");
      await page.goto("/data-health");
      await expect(page.getByRole("heading", { level: 1, name: "Santé des données" })).toBeVisible();
      await expect(page.getByText("Qualité du dernier import").first()).toBeVisible();
      const pct = (batch!.quality * 100).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      await expect(page.getByText(new RegExp(`${pct}\\s?%`)).first()).toBeVisible();
      await expect(page.getByRole("region", { name: /État des données/ })).toContainText(/Import du \d{2}\/\d{2}\/\d{4}/);
      const threshold = Math.round(Number(setting("quality_threshold")) * 100);
      await expect(page.getByText(new RegExp(`seuil de blocage\\s?(:|à)\\s?${threshold}\\s?%`, "i")).first()).toBeAttached();
      const history = page.getByRole("table", { name: "Historique des imports" });
      await expect(history).toContainText(batch!.source.split(/[\\/]/).pop()!);
      await history.getByRole("link", { name: new RegExp(`Voir les contrôles.*n° ${batch!.id}`) }).click();
      await expect(page.getByRole("heading", { level: 2, name: `Contrôles de l'import n° ${batch!.id}` })).toBeVisible();
      const rules = q<{ rule: string }>("SELECT DISTINCT rule FROM import_rejection WHERE batch_id = @id", { id: batch!.id });
      if (rules.length) await expect(page.getByText(rules[0].rule).first()).toBeVisible();
    });

    test("la RH consulte sans pouvoir téléverser ni relancer (réservé à l'admin)", async ({ page }) => {
      await page.goto("/data-health");
      await expect(page.getByRole("button", { name: /Lancer l'import/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Relancer le calcul mensuel/ })).toHaveCount(0);
    });
  });

  test.describe("ADMIN", () => {
    test.use({ storageState: storageState("admin") });

    test("l'admin pilote les imports (téléversement, recalcul)", async ({ page }) => {
      await page.goto("/data-health");
      await expect(page.getByText("Choisir les fichiers CSV")).toBeVisible();
      await expect(page.getByRole("button", { name: /Lancer l'import/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Relancer le calcul mensuel/ })).toBeVisible();
    });

    test("l'admin prépare un import : sélection vérifiée, fichier non prévu retiré, sélection vidée (sans envoi)", async ({ page }) => {
      await page.goto("/data-health");
      await expect(page.getByText(/Glisser-déposer les fichiers CSV/)).toBeVisible();
      const csv = (name: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from("code;libelle\n") });
      await page.locator("#export-files").setInputFiles([csv("employees.csv"), csv("inconnu.csv")]);
      await expect(page.getByText("2 fichiers choisis").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Lancer l'import/ })).toBeDisabled();
      await page.getByRole("button", { name: "Retirer inconnu.csv" }).click();
      await expect(page.getByText("1 fichier choisi").first()).toBeVisible();
      await expect(page.getByText("Manquant · obligatoire")).toBeVisible();
      await page.getByRole("button", { name: "Vider la sélection" }).click();
      await expect(page.getByText("Aucun fichier choisi")).toBeVisible();
    });

    test("séparation des tâches : aucun montant de salaire dans les exemples de rejet montrés à l'admin", async ({ page }) => {
      await page.goto("/data-health");
      await expect(page.getByRole("heading", { level: 1, name: "Santé des données" })).toBeVisible();
      const open = page.getByText("Exemples de lignes (100 max)");
      if (await open.count()) await open.click();
      const samples = page.getByRole("table", { name: /Exemples de lignes en échec/ });
      test.skip((await samples.count()) === 0, "aucun exemple de rejet affiché");
      const text = await samples.innerText();
      const amounts = (text.match(/(?<!SMIG \()\b\d+(?:[.,]\d+)?\s*TND/g) ?? []).filter((a) => !/•/.test(a));
      expect(amounts, `montants visibles par l'ADMIN : ${amounts.slice(0, 5).join(", ")}`).toEqual([]);
      // Observation (non bloquante, voir BUGS_E2E.md) : matricules et dates d'absence restent visibles
      const known = new Set(q<{ m: string }>("SELECT matricule AS m FROM employee").map((r) => r.m));
      const shown = [...new Set(text.match(/\bM\d{4,}\b/g) ?? [])].filter((m) => known.has(m));
      test.info().annotations.push({ type: "observation", description: `${shown.length} matricule(s) de salariés visibles par l'ADMIN` });
    });
  });
});

test.describe("Transparence du modèle", () => {
  for (const role of ["rh", "admin"] as const) {
    test.describe(role, () => {
      test.use({ storageState: storageState(role) });

      test(`fiche du champion, règle de décision et historique (${role})`, async ({ page }) => {
        const champ = champion();
        test.skip(!champ, "aucun modèle champion");
        await page.goto("/transparency");
        await expect(page.getByRole("heading", { level: 1, name: /Transparence du modèle/ })).toBeVisible();
        await expect(page.getByText("Modèle en service").first()).toBeVisible();
        await expect(page.getByText(champ!.version).first()).toBeVisible();
        const cap = (Number(setting("capacity_rate")) * 100).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        await expect(page.getByText(new RegExp(`${cap}\\s?% des évalués`))).toBeVisible();
        if (champ!.kind === "B0") {
          const rules = page.getByRole("table", { name: /Règles du score B0/ });
          expect(await rules.locator("tbody tr").count()).toBeGreaterThan(0);
          await expect(page.getByText(/pas une probabilité/).first()).toBeVisible();
        }
        await expect(page.getByRole("table", { name: /Historique des versions/ })).toContainText(champ!.version);
      });
    });
  }
});

test.describe("Backtesting", () => {
  test.use({ storageState: storageState("rh") });

  test("résultats pour un mois d'origine, changement de mois", async ({ page }) => {
    await page.goto("/backtesting");
    await expect(page.getByRole("heading", { level: 1, name: /Vérification a posteriori/ })).toBeVisible();
    const select = page.getByRole("combobox", { name: /^Date d'origine/ });
    test.skip((await select.count()) === 0, "aucun mois avec un suivi complet de 6 mois");
    await expect(page.getByText("Collaborateurs évalués (suivi complet)")).toBeVisible();
    const groups = page.getByRole("table", { name: /Exposition au risque et démissions observées/ });
    await expect(groups).toContainText("Classés Élevé");
    await expect(groups).toContainText("Élevé ou Moyen");

    const options = await select.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(options.length).toBeGreaterThan(1);
    const other = options[Math.min(6, options.length - 1)];
    await select.selectOption(other);
    await page.getByRole("button", { name: "Afficher la vérification" }).click();
    await expect(page).toHaveURL(new RegExp(`mois=${other}`));
    await expect(select).toHaveValue(other);
    const [y, m] = other.split("-");
    await expect(page.getByText(new RegExp(`au \\d{2}/${m}/${y}`)).first()).toBeVisible();
  });

  test("cohérence : les démissions comptées sont postérieures à la date d'origine", async ({ page }) => {
    await page.goto("/backtesting");
    await waitReady(page);
    const text = await page.locator("main").last().innerText();
    const origin = /au (\d{2})\/(\d{2})\/(\d{4}), niveaux/.exec(text) ?? /au (\d{2})\/(\d{2})\/(\d{4})/.exec(text);
    test.skip(!origin, "pas de résultat de backtest");
    const originIso = `${origin![3]}-${origin![2]}-${origin![1]}`;
    const dates = [...text.matchAll(/Oui, le (\d{2})\/(\d{2})\/(\d{4})/g)].map((d) => `${d[3]}-${d[2]}-${d[1]}`);
    const before = dates.filter((d) => d <= originIso);
    expect(before, `démissions datées avant ou le jour de l'origine (${originIso}) : ${before.join(", ")}`).toEqual([]);
  });

  test("l'accès au backtest est audité", async ({ page }) => {
    const n = () => toInt(String(q1<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'backtest.view' AND outcome = 'OK'")!.n));
    const before = n();
    await page.goto("/backtesting");
    await expect(page.getByRole("heading", { level: 1, name: /Vérification a posteriori/ })).toBeVisible();
    expect(n()).toBeGreaterThan(before);
  });
});
