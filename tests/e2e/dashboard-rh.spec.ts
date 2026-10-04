import { test, expect, kpi, kpiValue, q1, resultCount, storageState, toInt } from "./helpers";

test.use({ storageState: storageState("rh") });

test.describe("Tableau de bord RH", () => {
  test("KPI d'entreprise visibles, masse salariale en TND, graphiques rendus", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Lire la synthèse du mois" })).toHaveAttribute("href", "/synthese");
    for (const label of [/^Effectif fin/, /^Turnover sur 12 mois/, /^Absentéisme hors santé/, /^Masse salariale brute/, /^Entrées \/ sorties/, /^Formations obligatoires/, /^Collaborateurs en risque élevé/]) {
      await expect(page.getByText(label).first(), String(label)).toBeVisible();
    }
    const headcount = toInt(await kpiValue(page, /^Effectif fin/));
    expect(headcount).toBeGreaterThan(100);
    expect(await kpiValue(page, /^Masse salariale brute/)).toMatch(/\d.*\sTND$/);
    expect(await kpiValue(page, /^Turnover sur 12 mois/)).toMatch(/^\d+,\d\s?%$/);
    const charts = page.locator("main [role=img]");
    expect(await charts.count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator("main canvas").first()).toBeVisible();
    await expect(page.getByText(/Filtres actifs\s*:\s*aucun/)).toBeVisible();
  });

  test("filtres département et contrat : URL, filtres actifs et effectif réduit", async ({ page }) => {
    await page.goto("/dashboard");
    const total = toInt(await kpiValue(page, /^Effectif fin/));
    const dept = q1<{ id: number; name: string }>("SELECT id, name FROM department WHERE name = 'Direction qualité'") ?? q1<{ id: number; name: string }>("SELECT id, name FROM department ORDER BY id LIMIT 1")!;
    await page.getByLabel("Département", { exact: true }).selectOption(String(dept.id));
    await page.getByLabel("Contrat", { exact: true }).selectOption("CDI");
    await page.getByRole("button", { name: "Appliquer" }).click();
    await expect(page).toHaveURL(new RegExp(`departement=${dept.id}`));
    await expect(page).toHaveURL(/contrat=CDI/);
    await expect(page.getByText(new RegExp(`Filtres actifs\\s*:.*Département : ${dept.name}.*Contrat : CDI`))).toBeVisible();
    const filtered = toInt(await kpiValue(page, /^Effectif fin/));
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(total);
    await expect(page.getByLabel("Département", { exact: true })).toHaveValue(String(dept.id));

    await page.getByRole("link", { name: "Réinitialiser" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(/Filtres actifs\s*:\s*aucun/)).toBeVisible();
  });

  test("paramètre de filtre invalide signalé et ignoré", async ({ page }) => {
    await page.goto("/dashboard?contrat=XYZ&periode=99m");
    await expect(page.getByText(/Paramètre\(s\) invalide\(s\) ignoré\(s\)/)).toBeVisible();
    await expect(page.getByText(/^Effectif fin/).first()).toBeVisible();
  });

  test("drill-down : KPI risque élevé → liste filtrée cohérente", async ({ page }) => {
    await page.goto("/dashboard");
    const high = toInt(await kpiValue(page, /^Collaborateurs en risque élevé/));
    await kpi(page, /^Collaborateurs en risque élevé/).click();
    await expect(page).toHaveURL(/\/employees\?.*niveau=ELEVE/);
    await expect(page.getByText(/Filtres actifs\s*:.*Niveau de risque : Élevé/)).toBeVisible();
    const rows = page.locator("main table tbody tr");
    if (high === 0) {
      await expect(page.getByText("Aucun collaborateur ne correspond aux critères")).toBeVisible();
      return;
    }
    expect(await resultCount(page)).toBe(high);
    // Colonne « Niveau de risque » : badge compact (« Élevé », sans le préfixe « Risque »)
    const badges = await rows.locator("td").filter({ hasText: /^\s*(Élevé|Moyen|Faible|Non évalué)\s*$/ }).allInnerTexts();
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) expect(b.trim()).toBe("Élevé");
  });

  test("drill-down : tableau par département → liste du département et du niveau", async ({ page }) => {
    await page.goto("/dashboard");
    const table = page.getByRole("table", { name: /niveau de risque et par département/ });
    await expect(table.locator("tbody tr").first()).toBeVisible();
    const faibleLink = table.locator("tbody a[href*='niveau=FAIBLE'][href*='departement=']").first();
    test.skip((await faibleLink.count()) === 0, "aucun collaborateur Faible par département");
    const n = toInt((await faibleLink.innerText()).trim().split(/\s/)[0]);
    const deptId = Number(/departement=(\d+)/.exec((await faibleLink.getAttribute("href"))!)![1]);
    const deptName = q1<{ name: string }>("SELECT name FROM department WHERE id = @id", { id: deptId })!.name;
    await faibleLink.click();
    await expect(page).toHaveURL(new RegExp(`/employees\\?.*departement=${deptId}.*niveau=FAIBLE`));
    expect(await resultCount(page)).toBe(n);
    const rows = page.locator("main table tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(rows.filter({ hasNotText: deptName })).toHaveCount(0);
    await expect(rows.filter({ hasNot: page.locator("td").filter({ hasText: /^\s*Faible\s*$/ }) })).toHaveCount(0);
  });

  test("KPI absentéisme → page absentéisme", async ({ page }) => {
    await page.goto("/dashboard");
    await kpi(page, /^Absentéisme hors santé/).click();
    await expect(page).toHaveURL(/\/absenteeism/);
    await expect(page.getByRole("heading", { level: 1, name: "Absentéisme" })).toBeVisible();
  });
});
