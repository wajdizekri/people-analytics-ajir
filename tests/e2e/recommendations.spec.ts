import type { Page } from "@playwright/test";
import { test, expect, USERS, expectForbidden, managerTeamIds, q, q1, storageState, waitReady } from "./helpers";

const ACTION_LABELS: Record<string, string> = {
  ENTRETIEN: "Entretien de rétention",
  REVISION_SALARIALE: "Revue de la rémunération",
  CHARGE_TRAVAIL: "Revue de la charge de travail",
  PLAN_FORMATION: "Plan de formation et de développement",
};

// Recommandation proposée, seule de son action pour ce salarié, hors équipe du manager de démo et hors salarié 79 (parcours de démo)
function pickReco(exclude: number[] = []): { id: number; employeeId: number; action: string } {
  const skip = [79, ...managerTeamIds(), ...exclude].join(",");
  const row = q1<{ id: number; employeeId: number; action: string }>(
    `SELECT r.id, r.employee_id AS employeeId, r.action_code AS action FROM recommendation r
     WHERE r.status = 'PROPOSEE' AND r.employee_id NOT IN (${skip})
       AND (SELECT COUNT(*) FROM recommendation r2 WHERE r2.employee_id = r.employee_id AND r2.action_code = r.action_code) = 1
     ORDER BY r.id LIMIT 1`,
  );
  if (!row) throw new Error("aucune recommandation proposée disponible");
  return row;
}

const recoItem = (page: Page, action: string) => page.locator('section[aria-labelledby="zone-3"] li').filter({ hasText: ACTION_LABELS[action] ?? action });
const frDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

test.describe("Recommandations", () => {
  test.use({ storageState: storageState("rh") });

  test("RH passe une recommandation en réalisée → intervention datée, audit, suivi", async ({ page }) => {
    const reco = pickReco();
    const interventionsBefore = q1<{ n: number }>("SELECT COUNT(*) AS n FROM intervention")!.n;
    await page.goto(`/employees/${reco.employeeId}`);
    const item = recoItem(page, reco.action);
    await expect(item).toContainText("Proposée");
    // Fiche : deux actions explicites, « Marquer comme réalisée » ouvre le formulaire de réalisation (pas celui du rejet)
    await item.getByRole("button", { name: "Marquer comme réalisée" }).click();
    await expect(item.getByLabel(/Motif du rejet/)).toHaveCount(0);
    const date = await item.getByLabel("Date de réalisation").inputValue();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await item.getByLabel(/Recommandation pertinente/).selectOption("PERTINENTE");
    await item.getByLabel(/Commentaire/).fill("Réalisé lors du test E2E");
    await item.getByRole("button", { name: "Enregistrer la réalisation" }).click();
    await expect(item.locator("span", { hasText: /^Réalisée$/ })).toBeVisible();

    await page.reload();
    const done = recoItem(page, reco.action);
    await expect(done).toContainText("Réalisée");
    await expect(done).toContainText(`Intervention : ${frDate(date)}`);
    await expect(done.getByRole("button", { name: /Marquer comme réalisée|Rejeter avec motif/ })).toHaveCount(0);

    const db = q1<{ status: string; n: number; feedback: string }>(
      "SELECT r.status, r.feedback, (SELECT COUNT(*) FROM intervention i WHERE i.recommendation_id = r.id) AS n FROM recommendation r WHERE r.id = @id",
      { id: reco.id },
    )!;
    expect(db).toMatchObject({ status: "REALISEE", n: 1, feedback: "PERTINENTE" });
    expect(q1<{ n: number }>("SELECT COUNT(*) AS n FROM intervention")!.n).toBe(interventionsBefore + 1);
    const audit = q<{ outcome: string }>(
      "SELECT a.outcome FROM audit_log a JOIN app_user u ON u.id = a.user_id WHERE u.login = @l AND a.action = 'recommendation.decide' AND a.target_id = @id",
      { l: USERS.rh.login, id: String(reco.id) },
    );
    expect(audit.map((a) => a.outcome)).toEqual(["OK"]);

    await page.goto("/recommendations?statut=REALISEE");
    const row = page.locator("main li[data-reco]").filter({ has: page.locator(`a[href="/employees/${reco.employeeId}"], a[href^="/employees/${reco.employeeId}?"]`) });
    await expect(row.first()).toContainText("Réalisée");
    await expect(row.first()).toContainText(`Intervention le ${frDate(date)}`);
  });

  test("rejet : commentaire obligatoire, puis statut Rejetée sans intervention", async ({ page }) => {
    const reco = pickReco();
    await page.goto(`/employees/${reco.employeeId}`);
    const item = recoItem(page, reco.action);
    // Rejet : motif obligatoire, puis confirmation explicite (boîte de dialogue qui rappelle la conséquence)
    const reject = async () => {
      await item.getByRole("button", { name: "Rejeter la recommandation" }).click();
      await item.getByRole("dialog", { name: "Rejeter cette recommandation ?" }).getByRole("button", { name: "Confirmer le rejet" }).click();
    };
    await item.getByRole("button", { name: "Rejeter avec motif" }).click();
    await expect(item.getByLabel("Date de réalisation")).toHaveCount(0);
    const comment = item.getByLabel(/Motif du rejet \(obligatoire\)/);
    await expect(comment).toHaveAttribute("required", "");
    await reject();
    expect(await comment.evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
    expect(q1<{ status: string }>("SELECT status FROM recommendation WHERE id = @id", { id: reco.id })!.status).toBe("PROPOSEE");

    await comment.fill("Non pertinent pour ce collaborateur (test E2E)");
    await reject();
    await expect(item.locator("span", { hasText: /^Rejetée$/ })).toBeVisible();
    await expect(item).toContainText("Motif du rejet : Non pertinent pour ce collaborateur (test E2E)");
    const db = q1<{ status: string; comment: string; n: number }>(
      "SELECT status, comment, (SELECT COUNT(*) FROM intervention i WHERE i.recommendation_id = r.id) AS n FROM recommendation r WHERE id = @id",
      { id: reco.id },
    )!;
    expect(db).toMatchObject({ status: "REJETEE", comment: "Non pertinent pour ce collaborateur (test E2E)", n: 0 });
  });

  test("rejet : refus serveur d'un commentaire vide (espaces) sans perdre le choix « Rejetée »", async ({ page }) => {
    const reco = pickReco();
    await page.goto(`/employees/${reco.employeeId}`);
    const item = recoItem(page, reco.action);
    const reject = async () => {
      await item.getByRole("button", { name: "Rejeter la recommandation" }).click();
      await item.getByRole("dialog", { name: "Rejeter cette recommandation ?" }).getByRole("button", { name: "Confirmer le rejet" }).click();
    };
    await item.getByRole("button", { name: "Rejeter avec motif" }).click();
    await item.getByLabel(/Motif du rejet/).fill("   ");
    await reject();
    // Refus : message sous le formulaire (relié au champ) et notification d'erreur annoncée
    await expect(item.getByText(/Un commentaire est obligatoire/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Notifications urgentes" }).getByText(/Un commentaire est obligatoire/)).toBeVisible();
    expect(q1<{ status: string }>("SELECT status FROM recommendation WHERE id = @id", { id: reco.id })!.status).toBe("PROPOSEE");

    // attendu : le formulaire de rejet reste ouvert et la correction aboutit
    await expect(item.getByLabel(/Motif du rejet/)).toHaveValue("   ");
    await item.getByLabel(/Motif du rejet/).fill("Rejet motivé après correction (E2E)");
    await reject();
    await expect(item.locator("span", { hasText: /^Rejetée$/ })).toBeVisible();
  });

  test("un message de confirmation reste affiché après la décision", async ({ page }) => {
    const reco = pickReco();
    await page.goto(`/employees/${reco.employeeId}`);
    const item = recoItem(page, reco.action);
    await item.getByRole("button", { name: "Marquer comme réalisée" }).click();
    await item.getByRole("button", { name: "Enregistrer la réalisation" }).click();
    await expect(item.locator("span", { hasText: /^Réalisée$/ })).toBeVisible();
    // Confirmation par notification (toast), qui survit au remplacement du formulaire après revalidation
    await expect(page.getByRole("list", { name: "Notifications", exact: true }).getByText("Recommandation réalisée : intervention enregistrée.")).toBeVisible();
  });

  test("page de suivi : indicateurs d'adoption et filtre par statut", async ({ page }) => {
    await page.goto("/recommendations");
    await expect(page.getByRole("heading", { level: 1, name: "Recommandations" })).toBeVisible();
    for (const k of ["Taux d'adoption", "Interventions enregistrées", "Jugées pertinentes"]) await expect(page.getByText(k).first()).toBeVisible();
    await page.getByLabel("Statut").selectOption("PROPOSEE");
    await page.getByRole("button", { name: "Appliquer" }).click();
    await expect(page).toHaveURL(/statut=PROPOSEE/);
    await waitReady(page);
    const statuses = await page.locator("main li[data-reco]").locator("span", { hasText: /^(Proposée|Réalisée|Rejetée)$/ }).allInnerTexts();
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) expect(s.trim()).toBe("Proposée");
  });

  test("page de suivi : rejet depuis la liste, notification qui survit à la disparition de la ligne", async ({ page }) => {
    await page.goto("/recommendations?statut=PROPOSEE");
    await waitReady(page);
    const skip = new Set([79, ...managerTeamIds()]);
    const items = page.locator("main li[data-reco]");
    let target: { id: number } | null = null;
    for (let i = 0, n = await items.count(); i < n && !target; i++) {
      const href = (await items.nth(i).locator('a[href^="/employees/"]').first().getAttribute("href")) ?? "";
      const emp = Number(/\/employees\/(\d+)/.exec(href)?.[1]);
      if (!skip.has(emp)) target = { id: Number(await items.nth(i).getAttribute("data-reco")) };
    }
    expect(target).not.toBeNull();
    const item = page.locator(`main li[data-reco="${target!.id}"]`);
    await item.getByRole("button", { name: "Rejeter la recommandation" }).click();
    const dialog = item.getByRole("dialog", { name: "Rejeter cette recommandation ?" });
    await dialog.getByLabel(/Motif du rejet/).fill("Rejet depuis la liste de suivi (E2E)");
    await dialog.getByRole("button", { name: "Confirmer le rejet" }).click();
    // Filtre « Proposée » : la ligne disparaît après revalidation, la notification reste
    await expect(page.getByRole("list", { name: "Notifications", exact: true }).getByText("Recommandation rejetée.")).toBeVisible();
    await expect(item).toHaveCount(0);
    expect(q1<{ status: string }>("SELECT status FROM recommendation WHERE id = @id", { id: target!.id })!.status).toBe("REJETEE");
  });
});

test.describe("Recommandations — accès manager", () => {
  test.use({ storageState: storageState("manager") });

  test("page de suivi refusée au manager", async ({ page }) => {
    await page.goto("/recommendations");
    await expectForbidden(page);
  });
});
