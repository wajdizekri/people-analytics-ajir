import { test, expect, kpi, kpiValue, mainText, managerTeamIds, q, resultCount, storageState, toInt, waitReady } from "./helpers";

test.use({ storageState: storageState("manager") });

test.describe("Tableau de bord manager", () => {
  test("périmètre : sous-titre, effectif limité à l'équipe, départements de l'équipe seulement", async ({ page }) => {
    await page.goto("/dashboard");
    await waitReady(page);
    await expect(page.getByText("Indicateurs de votre équipe (périmètre hiérarchique), hors rémunération")).toBeVisible();
    const team = managerTeamIds();
    const headcount = toInt(await kpiValue(page, /^Effectif fin/));
    expect(headcount).toBeGreaterThan(0);
    expect(headcount).toBeLessThanOrEqual(team.length);

    const allowed = q<{ name: string }>(
      `SELECT DISTINCT d.name FROM employee e JOIN department d ON d.id = e.department_id WHERE e.id IN (${team.join(",")})`,
    ).map((r) => r.name);
    const options = (await page.getByLabel("Département", { exact: true }).locator("option").allInnerTexts()).map((o) => o.trim()).filter((o) => o !== "Tous");
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(allowed, `département hors périmètre proposé : ${o}`).toContain(o);
  });

  test("aucun montant en TND, aucune probabilité, aucun lift", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/^Effectif fin/).first()).toBeVisible();
    const text = await mainText(page);
    expect(text).not.toMatch(/TND/);
    expect(text).not.toMatch(/Masse salariale/i);
    expect(text).not.toMatch(/Probabilit/i);
    expect(text).not.toMatch(/\bLift\b/i);
    expect(text).not.toMatch(/modèle b0|modèle logreg/i);

    const html = await page.content();
    expect(html).not.toMatch(/TND|prob6|payroll|masse salariale/i);

    const api = await page.request.get("/api/dashboard");
    expect(api.status()).toBe(200);
    const body = await api.text();
    expect(body).not.toMatch(/"payroll"|"prob6"|"avgLift"|"lift"|TND|"modelVersion"/);
  });

  test("filtres contrat, âge et ancienneté absents ; forcés dans l'URL ils sont ignorés", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByLabel("Période", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Département", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Niveau de risque", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Contrat", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Tranche d'âge", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Ancienneté", { exact: true })).toHaveCount(0);

    const base = await kpiValue(page, /^Effectif fin/);
    await page.goto("/dashboard?contrat=CDD&age=moins-30&anciennete=10-plus");
    await expect(page.getByText(/Filtres actifs\s*:\s*aucun/)).toBeVisible();
    await expect(page.getByText(/contrat.*non disponibles dans la vue manager/)).toBeVisible();
    expect(await kpiValue(page, /^Effectif fin/)).toBe(base);
  });

  test("drill-down : effectif → liste de l'équipe uniquement", async ({ page }) => {
    await page.goto("/dashboard");
    await kpi(page, /^Effectif fin/).click();
    await expect(page).toHaveURL(/\/employees/);
    const team = new Set(managerTeamIds());
    const activeTeam = q<{ n: number }>(`SELECT COUNT(*) AS n FROM employee WHERE status = 'ACTIF' AND id IN (${[...team].join(",")})`)[0].n;
    expect(await resultCount(page)).toBe(activeTeam);
    const hrefs = await page.locator("main table tbody a[href^='/employees/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    for (const h of hrefs) expect(team.has(Number(h.split("?")[0].split("/").pop()))).toBe(true);
  });
});
