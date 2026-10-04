import type { Page } from "@playwright/test";
import { test, expect, USERS, activeTeamIds, q1, storageState } from "./helpers";

const CURRENT_RUN = "(SELECT CAST(value AS INTEGER) FROM app_setting WHERE key = 'current_run_id')";
const championKind = () => q1<{ kind: string }>("SELECT kind FROM model_version WHERE status = 'CHAMPION'")?.kind ?? "B0";

// Salarié scoré avec un salaire sous la médiane : le levier salaire a un effet observable
function target(): number {
  const row =
    q1<{ id: number }>(
      `SELECT p.employee_id AS id FROM prediction p JOIN prediction_factor f ON f.prediction_id = p.id
       WHERE p.run_id = ${CURRENT_RUN} AND f.group_code = 'REMUNERATION' ORDER BY p.rank LIMIT 1`,
    ) ?? q1<{ id: number }>(`SELECT employee_id AS id FROM prediction WHERE run_id = ${CURRENT_RUN} ORDER BY rank LIMIT 1`);
  if (!row) throw new Error("aucun salarié scoré");
  return row.id;
}
const whatIfSection = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: /Simulation « et si \? »/ }) });
const points = (s: string) => Number(/\((\d+) points?\)/.exec(s)?.[1] ?? NaN);

test.describe("Simulation « et si ? » — RH", () => {
  test.use({ storageState: storageState("rh") });

  test("levier salaire : avant/après, coût annuel, rien n'est enregistré, audit", async ({ page }) => {
    const id = target();
    const snapshot = () =>
      q1<{ n: number; level: string; prob6: number }>(
        `SELECT (SELECT COUNT(*) FROM prediction WHERE employee_id = @id) AS n, level, prob6 FROM prediction WHERE employee_id = @id AND run_id = ${CURRENT_RUN}`,
        { id },
      );
    const before = snapshot();
    const audits = () => q1<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log a JOIN app_user u ON u.id = a.user_id WHERE u.login = @l AND a.action = 'whatif.run' AND a.target_id = @id", { l: USERS.rh.login, id: String(id) })!.n;
    const auditBefore = audits();

    await page.goto(`/employees/${id}`);
    const section = whatIfSection(page);
    await expect(section).toBeVisible();
    await expect(section).toContainText("Estimation non causale");
    await section.getByLabel("Augmentation du salaire de base (%)").fill("10");
    await section.getByRole("button", { name: "Simuler" }).click();

    const avant = section.locator("p", { hasText: "Avant (calcul publié)" }).locator("..");
    const apres = section.locator("p", { hasText: "Après les actions simulées" }).locator("..");
    await expect(avant).toBeVisible();
    await expect(apres).toBeVisible();
    await expect(section.getByText(/Salaire de base : [\d\s]+TND → [\d\s]+TND par mois/)).toBeVisible();
    await expect(section.getByText(/Coût annuel estimé : [1-9][\d\s]*TND/)).toBeVisible();
    await expect(section.getByText(/Niveau de risque( inchangé)? :/)).toBeVisible();
    await section.getByText("Voir le détail du calcul par groupe de facteurs").click();
    await expect(section.getByRole("table", { name: /Contributions par groupe/ })).toBeVisible();
    if (championKind() === "B0") {
      const b = points(await avant.innerText());
      const a = points(await apres.innerText());
      expect(a).toBeLessThanOrEqual(b);
    }

    expect(snapshot()).toEqual(before);
    expect(audits()).toBe(auditBefore + 1);

    await section.getByRole("button", { name: "Réinitialiser" }).click();
    await expect(apres).toHaveCount(0);
    await expect(section.getByLabel("Augmentation du salaire de base (%)")).toHaveValue("0");
  });

  test("levier promotion : changement de grade affiché", async ({ page }) => {
    const id = target();
    const grade = q1<{ g: string }>("SELECT grade AS g FROM employee WHERE id = @id", { id })!.g;
    test.skip(!grade || /G8$/.test(grade), "grade maximal ou absent");
    await page.goto(`/employees/${id}`);
    const section = whatIfSection(page);
    await section.getByLabel(/Promotion au grade supérieur/).check();
    await section.getByRole("button", { name: "Simuler" }).click();
    await expect(section.getByText(new RegExp(`Grade : ${grade} → G${Number(grade.replace(/\D/g, "")) + 1}`))).toBeVisible();
  });

  test("bornes des leviers validées côté serveur", async ({ page }) => {
    const id = target();
    await page.goto(`/employees/${id}`);
    const res = await page.request.post(`/api/employees/${id}/what-if`, { data: { salaryPct: 50, overtimeCutH: 0, trainingHours: 0, promotion: false, chargeRatePct: 16.57 } });
    expect(res.status()).toBe(400);
    const bad = await page.request.post(`/api/employees/${id}/what-if`, { headers: { "Content-Type": "application/json" }, data: "{pas du json" });
    expect(bad.status()).toBe(400);
  });
});

test.describe("Simulation « et si ? » — manager", () => {
  test.use({ storageState: storageState("manager") });

  test("absente de la fiche et refusée par l'API", async ({ page }) => {
    const id = activeTeamIds()[0];
    await page.goto(`/employees/${id}`);
    await expect(page.getByRole("heading", { level: 2, name: /Estimation/ })).toBeVisible();
    await expect(whatIfSection(page)).toHaveCount(0);
    const res = await page.request.post(`/api/employees/${id}/what-if`, { data: { salaryPct: 5 } });
    expect(res.status()).toBe(403);
  });
});
