import type { Page } from "@playwright/test";
import { test, expect, USERS, expectForbidden, managerTeamIds, outOfScopeEmployeeId, q, q1, resultCount, storageState, waitReady } from "./helpers";

const CURRENT_RUN = "(SELECT CAST(value AS INTEGER) FROM app_setting WHERE key = 'current_run_id')";
const championKind = () => q1<{ kind: string }>("SELECT kind FROM model_version WHERE status = 'CHAMPION'")?.kind ?? "B0";

// Salarié scoré avec au moins un facteur : ÉLEVÉ ou MOYEN pour la vue RH ; dans l'équipe du manager, le plus exposé
// (l'équipe de démonstration peut n'avoir que des niveaux Faible)
function scoredEmployee(ids?: number[]): number {
  const scope = ids ? `AND p.employee_id IN (${ids.join(",")})` : "AND p.level IN ('ELEVE','MOYEN')";
  const row = q1<{ id: number }>(
    `SELECT p.employee_id AS id FROM prediction p JOIN prediction_factor f ON f.prediction_id = p.id
     WHERE p.run_id = ${CURRENT_RUN} ${scope} GROUP BY p.employee_id ORDER BY p.rank LIMIT 1`,
  );
  if (!row) throw new Error("aucun salarié scoré avec facteurs");
  return row.id;
}

const zone = (page: Page, n: number) => page.locator(`section[aria-labelledby="zone-${n}"]`);

async function expectThreeZones(page: Page) {
  await expect(page.getByRole("heading", { level: 2, name: "En bref" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /1\.\s*Faits/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /2\.\s*Estimation/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /3\.\s*Suggestions/ })).toBeVisible();
  await expect(zone(page, 2)).toContainText("Estimation, pas une certitude. Facteurs associés, pas des causes.");
}

test.describe("Liste et fiche collaborateur — RH", () => {
  test.use({ storageState: storageState("rh") });

  test("liste : colonnes score/probabilité et lift, recherche par matricule", async ({ page }) => {
    await page.goto("/employees");
    await expect(page.locator("main table thead th").first()).toBeVisible();
    const headers = (await page.locator("main table thead th").allInnerTexts()).map((h) => h.trim().toUpperCase());
    expect(headers.join("|")).toMatch(championKind() === "B0" ? /SCORE À RÈGLES/ : /PROBABILITÉ (À )?6 MOIS/);
    // Lift affiché sous la probabilité (« 4,5 × la moyenne »), colonne fusionnée pour rester à 6 colonnes
    if (championKind() !== "B0") await expect(page.locator("main table tbody tr").first()).toContainText(/\d,\d\s×\sla moyenne/);
    expect(await resultCount(page)).toBeGreaterThan(100);

    const e = q1<{ matricule: string; last_name: string }>("SELECT matricule, last_name FROM employee WHERE id = 79")!;
    await page.getByLabel("Nom ou matricule").fill(e.matricule);
    await page.getByRole("button", { name: "Appliquer" }).click();
    await expect(page).toHaveURL(new RegExp(`q=${e.matricule}`));
    await expect(page.locator("main table tbody tr")).toHaveCount(1);
    await expect(page.locator("main table tbody tr")).toContainText(e.last_name);
  });

  test("tri par risque décroissant par défaut, tri par nom en un clic", async ({ page }) => {
    await page.goto("/employees?niveau=ELEVE");
    await expect(page.locator("main table thead th[aria-sort='descending']")).toContainText(/Risque/i);
    await page.locator("main table thead").getByRole("link", { name: /^(Trier par )?Nom/ }).click();
    await expect(page).toHaveURL(/tri=nom/);
    await expect(page.locator("main table thead th[aria-sort='ascending']")).toContainText(/Nom/i);
  });

  test("fiche : 3 zones, rémunération, estimation chiffrée et phrases chiffrées", async ({ page }) => {
    const id = scoredEmployee();
    await page.goto(`/employees/${id}`);
    await expectThreeZones(page);
    await expect(zone(page, 1)).toContainText("Rémunération");
    await expect(zone(page, 1)).toContainText(/Salaire de base\s*[\d\s]+TND/);
    const estimation = zone(page, 2);
    if (championKind() === "B0") await expect(estimation).toContainText(/Score à règles \(\d+ points?\)/);
    else await expect(estimation).toContainText(/Probabilité à 6 mois\s*:?\s*\d+,\d\s?%/);
    await expect(estimation).toContainText(/[Cc]alcul au \d{2}\/\d{2}\/\d{4}/);
    await expect(estimation.getByRole("heading", { name: "Principaux facteurs associés" })).toBeVisible();
    await expect(estimation.getByText(/Fait (monter|baisser) le risque/).first()).toBeVisible();
    await expect(page.locator('section[aria-labelledby="fiche-resume"]')).toContainText(/Risque (Élevé|Moyen|Faible) —/);
    await expect(estimation.locator("ol > li").first()).toBeVisible();
    const phrases = await estimation.locator("ol > li").allInnerTexts();
    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases.some((p) => /\d/.test(p)), `phrases sans chiffre : ${phrases.join(" | ")}`).toBe(true);
  });

  test("fiche : libellés de déclencheur lisibles (pas de code technique)", async ({ page }) => {
    const row = q1<{ id: number }>("SELECT employee_id AS id FROM recommendation WHERE trigger_group = 'NIVEAU_ELEVE' ORDER BY id LIMIT 1");
    test.skip(!row, "aucune recommandation déclenchée par le niveau élevé");
    await page.goto(`/employees/${row!.id}`);
    await waitReady(page);
    const triggers = await zone(page, 3).getByText(/Déclenchée par/).allInnerTexts();
    expect(triggers.length).toBeGreaterThan(0);
    for (const t of triggers) expect(t, t).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
  });

  test("fiche inexistante → « Collaborateur introuvable »", async ({ page }) => {
    await page.goto("/employees/99999999");
    await expect(page.getByText("Collaborateur introuvable")).toBeVisible();
  });
});

test.describe("Liste et fiche collaborateur — manager", () => {
  test.use({ storageState: storageState("manager") });

  test("« Mon équipe » : uniquement la hiérarchie, sans colonne score ni lift", async ({ page }) => {
    await page.goto("/employees");
    await expect(page.locator("main table thead th").first()).toBeVisible();
    const team = new Set(managerTeamIds());
    const headers = (await page.locator("main table thead th").allInnerTexts()).join("|").toUpperCase();
    expect(headers).not.toMatch(/SCORE|PROBABILIT|LIFT/);
    const hrefs = await page.locator("main table tbody a[href^='/employees/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(team.has(Number(h.split("?")[0].split("/").pop())), h).toBe(true);
    const text = await page.locator("main").last().innerText();
    expect(text).not.toMatch(/points?\)|TND|%/);
  });

  test("fiche d'un collaborateur de l'équipe : niveau et catégories, sans aucun chiffre sensible", async ({ page }) => {
    const id = scoredEmployee(managerTeamIds());
    await page.goto(`/employees/${id}`);
    await expectThreeZones(page);
    const estimation = zone(page, 2);
    await expect(estimation.getByText(/^Risque (Élevé|Moyen|Faible)$/).first()).toBeVisible();
    await expect(estimation.getByRole("heading", { name: "Catégories de facteurs associés" })).toBeVisible();
    const cats = await estimation.locator("ul > li").allInnerTexts();
    expect(cats.length).toBeGreaterThan(0);
    for (const c of cats) expect(c, `catégorie chiffrée : ${c}`).not.toMatch(/\d/);
    expect(cats.join("|")).not.toMatch(/Assiduité|Absence/i);
    if (championKind() === "B0") expect(cats.join("|")).not.toMatch(/Rémunération/i);

    const text = (await page.locator("main").last().innerText()).replace(/\s+/g, " ");
    expect(text).not.toMatch(/TND|Probabilit|Score à règles|points?\b|\blift\b|×|Salaire|Absences sur 12 mois|Augmentation/i);
    expect(text).not.toMatch(/\d+(,\d+)? ?%/);
    await expect(page.getByText("Simulation « et si ? »")).toHaveCount(0);

    const res = await page.request.get(`/api/employees/${id}`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(/"prob6"|"lift"|"phraseRh"|phrase_rh|"payroll"|"compensation"|baseSalary|"absences"|"points"/);
  });

  test("recommandation réservée à la RH (revue de rémunération) masquée au manager", async ({ page }) => {
    const row = q1<{ id: number }>("SELECT employee_id AS id FROM recommendation WHERE action_code = 'REVISION_SALARIALE' AND employee_id IN (" + managerTeamIds().join(",") + ") LIMIT 1");
    test.skip(!row, "aucune revue de rémunération dans l'équipe");
    await page.goto(`/employees/${row!.id}`);
    await expect(zone(page, 3)).toContainText("Entretien de rétention");
    await expect(zone(page, 3)).not.toContainText("Revue de la rémunération");
    await expect(zone(page, 3).getByText("Traiter cette recommandation")).toHaveCount(0);
    await expect(zone(page, 3).getByRole("button", { name: /Marquer comme réalisée|Rejeter/ })).toHaveCount(0);
  });

  test("fiche hors périmètre → /interdit, API 403 et refus audité", async ({ page }) => {
    const id = outOfScopeEmployeeId();
    const before = q<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log a JOIN app_user u ON u.id = a.user_id WHERE u.login = @l AND a.action = 'employee.view' AND a.outcome = 'REFUSE' AND a.target_id = @id", { l: USERS.manager.login, id: String(id) })[0].n;
    await page.goto(`/employees/${id}`);
    await expectForbidden(page);
    const res = await page.request.get(`/api/employees/${id}`);
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("INTERDIT");
    expect(JSON.stringify(body)).not.toMatch(/lastName|matricule/);
    const after = q<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log a JOIN app_user u ON u.id = a.user_id WHERE u.login = @l AND a.action = 'employee.view' AND a.outcome = 'REFUSE' AND a.target_id = @id", { l: USERS.manager.login, id: String(id) })[0].n;
    expect(after).toBeGreaterThanOrEqual(before + 2);
  });

  test("filtre manager forcé hors périmètre dans l'URL : aucune fuite", async ({ page }) => {
    const outsider = q1<{ id: number }>("SELECT manager_id AS id FROM employee WHERE id = @id", { id: outOfScopeEmployeeId() })!.id;
    await page.goto(`/employees?manager=${outsider}`);
    await waitReady(page);
    const team = new Set(managerTeamIds());
    const hrefs = await page.locator("main table tbody a[href^='/employees/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    for (const h of hrefs) expect(team.has(Number(h.split("?")[0].split("/").pop())), h).toBe(true);
  });
});
