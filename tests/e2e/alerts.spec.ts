import type { Page } from "@playwright/test";
import { test, expect, USERS, expectForbidden, q, q1, storageState, waitReady } from "./helpers";

type AlertRow = { id: number; title: string };

const pickAlert = (where: string, exclude: number[] = []): AlertRow => {
  const row = q1<AlertRow>(
    `SELECT id, title FROM alert WHERE status = 'NOUVELLE' AND dedup_key NOT LIKE 'e2e-%' AND ${where}
     ${exclude.length ? `AND id NOT IN (${exclude.join(",")})` : ""} ORDER BY id LIMIT 1`,
  );
  if (!row) throw new Error(`aucune alerte ${where}`);
  return row;
};
const seeded = (key: string) => q1<AlertRow>("SELECT id, title FROM alert WHERE dedup_key = @k", { k: key })!;
const statusOf = (id: number) => q1<{ status: string; comment: string | null }>("SELECT status, comment FROM alert WHERE id = @id", { id })!;

const statusForm = (page: Page) => page.getByRole("form", { name: "Suivi de l'alerte" });
const CONFIRM: Record<string, string> = { "Marquer comme traitée": "Confirmer le traitement", "Rejeter l'alerte": "Confirmer le rejet" };

// Étape du suivi : bouton verbe + objet ; les étapes qui clôturent l'alerte passent par une confirmation
async function applyStep(page: Page, step: "Prendre en charge l'alerte" | "Marquer comme traitée" | "Rejeter l'alerte", comment?: string) {
  const form = statusForm(page);
  if (comment !== undefined) await form.getByLabel(/Commentaire de suivi/).fill(comment);
  await form.getByRole("button", { name: step }).click();
  if (CONFIRM[step]) await page.getByRole("dialog").getByRole("button", { name: CONFIRM[step] }).click();
}
const statusBadge = (page: Page) => page.locator("dt", { hasText: "Statut" }).locator("xpath=following-sibling::dd[1]");

test.describe("Alertes — RH", () => {
  test.use({ storageState: storageState("rh") });

  test("workflow : Nouvelle → En cours → Traitée, tracé et audité", async ({ page }) => {
    const alert = pickAlert("type = 'TURNOVER' AND audience <> 'ADMIN'");
    await page.goto("/alerts");
    await page.getByRole("link", { name: `Traiter l'alerte « ${alert.title} »` }).click();
    await expect(page).toHaveURL(new RegExp(`/alerts/${alert.id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(alert.title);
    await expect(statusBadge(page)).toHaveText("Nouvelle");

    await applyStep(page, "Prendre en charge l'alerte", "Entretien planifié (E2E)");
    await expect(statusBadge(page)).toHaveText("En cours");
    await expect(page.getByText("Alerte prise en charge.")).toBeVisible();
    await expect(page.getByText(`par ${USERS.rh.login}`)).toBeVisible();
    await expect(page.getByText("Entretien planifié (E2E)")).toBeVisible();

    await applyStep(page, "Marquer comme traitée");
    await expect(statusBadge(page)).toHaveText("Traitée");
    // Le formulaire disparaît à la clôture : le résultat reste annoncé par un toast
    await expect(page.getByText("Alerte marquée comme traitée.")).toBeVisible();
    await expect(page.getByText("Alerte clôturée (traitée)")).toBeVisible();
    expect(statusOf(alert.id).status).toBe("TRAITEE");
    const audits = q<{ detail: string }>(
      "SELECT a.detail_json AS detail FROM audit_log a JOIN app_user u ON u.id = a.user_id WHERE u.login = @l AND a.action = 'alert.update' AND a.target_id = @id ORDER BY a.id",
      { l: USERS.rh.login, id: String(alert.id) },
    );
    expect(audits.map((a) => JSON.parse(a.detail).to)).toEqual(["EN_COURS", "TRAITEE"]);
  });

  test("rejet : commentaire obligatoire, puis rejet motivé enregistré", async ({ page }) => {
    const alert = pickAlert("audience <> 'ADMIN' AND type IN ('ABSENTEISME','DONNEES')");
    await page.goto(`/alerts/${alert.id}`);
    const form = statusForm(page);
    await expect(page.getByText("(obligatoire pour un rejet)")).toBeVisible();
    await expect(form.getByRole("button", { name: "Rejeter l'alerte" })).toBeDisabled();
    await expect(form.getByText("Rejet : commentaire de 3 caractères minimum")).toBeVisible();
    expect(statusOf(alert.id).status).toBe("NOUVELLE");

    await applyStep(page, "Rejeter l'alerte", "Faux positif vérifié avec le manager (E2E)");
    await expect(statusBadge(page)).toHaveText("Rejetée");
    await expect(page.getByText("Faux positif vérifié avec le manager (E2E)")).toBeVisible();
    await expect(page.getByText("Alerte clôturée (rejetée)")).toBeVisible();
    expect(statusOf(alert.id)).toMatchObject({ status: "REJETEE", comment: "Faux positif vérifié avec le manager (E2E)" });
  });

  test("rejet : un commentaire fait d'espaces ne permet pas de rejeter ; annuler la confirmation ne change rien", async ({ page }) => {
    const alert = pickAlert("audience <> 'ADMIN' AND type IN ('ABSENTEISME','DONNEES')");
    await page.goto(`/alerts/${alert.id}`);
    const form = statusForm(page);
    const comment = form.getByLabel(/Commentaire de suivi/);
    await comment.fill("   ");
    await expect(form.getByRole("button", { name: "Rejeter l'alerte" })).toBeDisabled();

    await comment.fill("Rejet motivé après correction (E2E)");
    await form.getByRole("button", { name: "Rejeter l'alerte" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
    expect(statusOf(alert.id).status).toBe("NOUVELLE");
    await expect(comment).toHaveValue("Rejet motivé après correction (E2E)");

    await applyStep(page, "Rejeter l'alerte");
    await expect(statusBadge(page)).not.toHaveText("Nouvelle");
    expect(statusOf(alert.id).status).toBe("REJETEE");
  });

  test("filtre par type et visibilité RH des signaux individuels d'absentéisme", async ({ page }) => {
    await page.goto("/alerts");
    await page.getByLabel("Type", { exact: true }).selectOption("ABSENTEISME");
    await page.getByRole("button", { name: "Appliquer" }).click();
    await expect(page).toHaveURL(/type=ABSENTEISME/);
    await waitReady(page);
    const types = await page.locator('main [data-field="type"]').allInnerTexts();
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) expect(t.trim()).toBe("Absentéisme");
    await expect(page.getByText(seeded("e2e-absence-indiv-mgr").title, { exact: true })).toBeVisible();
  });
});

test.describe("Alertes — manager", () => {
  test.use({ storageState: storageState("manager") });

  test("voit les alertes de son équipe, jamais les signaux individuels d'absentéisme", async ({ page }) => {
    const turnover = seeded("e2e-turnover-mgr");
    const absence = seeded("e2e-absence-indiv-mgr");
    await page.goto("/alerts");
    await expect(page.getByText("Sans signal individuel d'absence")).toBeVisible();
    await expect(page.getByText(turnover.title, { exact: true })).toBeVisible();
    await expect(page.getByText(absence.title)).toHaveCount(0);
    await expect(page.getByText(/Absences répétées à vérifier/)).toHaveCount(0);

    await page.goto("/alerts?type=ABSENTEISME");
    await expect(page.locator("main li[data-alert-id]").filter({ hasText: /Absences|absences/ })).toHaveCount(0);

    await page.goto(`/alerts/${absence.id}`);
    await expectForbidden(page);
    const rhSignal = q1<{ id: number }>("SELECT id FROM alert WHERE type = 'ABSENTEISME' AND employee_id IS NOT NULL AND audience = 'RH' LIMIT 1");
    if (rhSignal) {
      await page.goto(`/alerts/${rhSignal.id}`);
      await expectForbidden(page);
    }

    const api = await page.request.get("/api/alerts");
    expect(api.status()).toBe(200);
    const body = await api.json();
    const items: { type: string; employeeName: string | null; title: string }[] = body.alerts;
    expect(items.some((a) => a.title === turnover.title)).toBe(true);
    expect(items.filter((a) => a.type === "ABSENTEISME" && a.employeeName)).toEqual([]);
    const patch = await page.request.patch(`/api/alerts/${absence.id}`, { data: { status: "EN_COURS" } });
    expect(patch.status()).toBe(403);
    expect(statusOf(absence.id).status).toBe("NOUVELLE");
  });

  test("le manager prend en charge une alerte de son équipe", async ({ page }) => {
    const turnover = seeded("e2e-turnover-mgr");
    await page.goto(`/alerts/${turnover.id}`);
    await applyStep(page, "Prendre en charge l'alerte");
    await expect(statusBadge(page)).toHaveText("En cours");
    await expect(page.getByText(`par ${USERS.manager.login}`)).toBeVisible();
  });
});

test.describe("Alertes — admin", () => {
  test.use({ storageState: storageState("admin") });

  test("l'admin ne voit que les alertes système et données non nominatives", async ({ page }) => {
    await page.goto("/alerts");
    await waitReady(page);
    const types = await page.locator('main [data-field="type"]').allInnerTexts();
    for (const t of types) expect(["Qualité des données", "Système"]).toContain(t.trim());
    const concerned = await page.locator('main [data-field="concerne"]').allInnerTexts();
    for (const c of concerned) expect(c.trim()).toBe("L'outil (alerte technique)");
  });
});
