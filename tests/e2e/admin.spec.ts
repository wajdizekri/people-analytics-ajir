import type { Locator, Page } from "@playwright/test";
import { test, expect, USERS, alertMsg, login, outOfScopeEmployeeId, q, q1, storageState, waitReady } from "./helpers";

test.use({ storageState: storageState("admin") });

const createForm = (page: Page) => page.getByRole("form", { name: "Créer un compte" });
const settingValue = (key: string) => q1<{ value: string }>("SELECT value FROM app_setting WHERE key = @key", { key })!.value;

// Valeurs saisies telles qu'affichées (capacity_rate en %, medium_lift en « fois »)
async function saveSettings(page: Page, values: Record<string, string>) {
  await page.goto("/admin/settings");
  for (const [k, v] of Object.entries(values)) await page.locator(`#s-${k}`).fill(v);
  await page.getByRole("button", { name: "Enregistrer les paramètres" }).click();
}
const asPercent = (raw: string) => String(Number((Number(raw) * 100).toFixed(6)));

test.describe("Administration", () => {
  test("création d'un compte RH, lien d'activation, activation puis connexion", async ({ page, browser }) => {
    const loginName = `e2e.rh.${Date.now().toString(36)}`;
    await page.goto("/admin/users");
    const form = createForm(page);
    await form.getByLabel("Identifiant").fill(loginName);
    await form.getByLabel("Rôle").selectOption("RH");
    await form.getByLabel(/E-mail/).fill(`${loginName}@example.test`);
    await form.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.getByText(`Compte ${loginName} créé.`)).toBeVisible();
    const link = page.getByLabel(`Lien d'activation pour ${loginName}`, { exact: true });
    await expect(link).toHaveValue(/\/activation\?token=[\w-]{20,}/);
    const url = new URL(await link.inputValue());

    const row = page.getByRole("row").filter({ hasText: loginName });
    await expect(row).toContainText("Responsable RH");
    await expect(row).toContainText("Lien en attente");
    expect(q1<{ role: string; pw: number }>("SELECT role, password_hash IS NOT NULL AS pw FROM app_user WHERE login = @l", { l: loginName })).toEqual({ role: "RH", pw: 0 });

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await ctx.newPage();
    await p.goto(url.pathname + url.search);
    await expect(p.getByText(`Compte ${loginName}`)).toBeVisible();
    await p.getByLabel("Nouveau mot de passe").fill("NouveauMdp2026e2e");
    await p.getByLabel(/^Confirmation/).fill("NouveauMdp2026e2e");
    await p.getByRole("button", { name: "Définir le mot de passe" }).click();
    await expect(p.getByText(/Mot de passe enregistré/)).toBeVisible();
    await p.goto(url.pathname + url.search);
    await expect(p.getByText(/invalide, expiré ou déjà utilisé/)).toBeVisible();
    await login(p, loginName, "NouveauMdp2026e2e");
    await p.waitForURL(/\/dashboard$/);
    await ctx.close();
  });

  test("création refusée : identifiant existant, manager sans matricule, matricule inconnu", async ({ page }) => {
    await page.goto("/admin/users");
    const form = createForm(page);
    await form.getByLabel("Identifiant").fill(USERS.rh.login);
    await form.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.getByText("Cet identifiant est déjà utilisé.")).toBeVisible();

    await form.getByLabel("Identifiant").fill("e2e.mgr.sans.matricule");
    await form.getByLabel("Rôle").selectOption("MANAGER");
    const matricule = form.getByLabel(/Matricule du collaborateur/);
    await expect(matricule).toHaveAttribute("required", "");
    await matricule.evaluate((el) => el.removeAttribute("required"));
    await form.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.getByText("Un compte manager doit être lié à un collaborateur : renseignez son matricule.")).toBeVisible();

    await form.getByLabel("Identifiant").fill("e2e.mgr.inconnu");
    await form.getByLabel("Rôle").selectOption("MANAGER");
    await form.getByLabel(/Matricule du collaborateur/).fill("M99999999");
    await form.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.getByText(/^Aucun collaborateur ne porte ce matricule/)).toBeVisible();
    expect(q1("SELECT 1 FROM app_user WHERE login IN ('e2e.mgr.sans.matricule','e2e.mgr.inconnu')")).toBeUndefined();
  });

  test("paramètres : valeurs hors bornes refusées, valeur valide enregistrée", async ({ page }) => {
    const original = settingValue("capacity_rate");
    await saveSettings(page, { capacity_rate: "50", medium_lift: "0.2" });
    await expect(alertMsg(page)).toHaveText(/certaines valeurs sont hors des bornes autorisées/);
    await expect(page.locator("#s-capacity_rate")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#s-capacity_rate-err")).toHaveText(/Maximum 20 %/);
    await expect(page.locator("#s-medium_lift-err")).toHaveText(/Minimum 1/);
    expect(settingValue("capacity_rate")).toBe(original);

    await page.goto("/admin/settings");
    await page.locator("#s-capacity_rate").fill("3");
    await expect(page.getByText(/1 modification à enregistrer/)).toBeVisible();
    await expect(page.getByText(/Capacité mensuelle .* → 3\s%/)).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer les paramètres" }).click();
    await expect(page.getByText(/Paramètres enregistrés : Capacité mensuelle/)).toBeVisible();
    expect(Number(settingValue("capacity_rate"))).toBeCloseTo(0.03, 6);
    await page.reload();
    await expect(page.getByText(/Modifié le .* par admin/).first()).toBeVisible();
    await expect(page.getByText(/Valeur par défaut : 2\s%/)).toBeVisible();

    await saveSettings(page, { capacity_rate: asPercent(original) });
    await expect(page.getByText(/Paramètres enregistrés/)).toBeVisible();
    expect(Number(settingValue("capacity_rate"))).toBeCloseTo(Number(original), 6);
  });

  test("journal d'audit : les actions précédentes sont tracées et filtrables", async ({ page, browser }) => {
    // actions à retrouver : paramètre modifié par l'admin, fiche refusée au manager
    const original = settingValue("medium_lift");
    await saveSettings(page, { medium_lift: "2.5" });
    await expect(page.getByText(/Paramètres enregistrés/)).toBeVisible();
    await saveSettings(page, { medium_lift: original });
    await expect(page.getByText(/Paramètres enregistrés/)).toBeVisible();
    const mgr = await browser.newContext({ storageState: storageState("manager") });
    const id = outOfScopeEmployeeId();
    expect((await mgr.request.get(`/api/employees/${id}`)).status()).toBe(403);
    await mgr.close();

    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { level: 1, name: "Journal d'audit" })).toBeVisible();
    const table = page.getByRole("table", { name: /Journal d'audit/ });
    await expect(table.locator("tbody tr").first()).toBeVisible();

    await page.getByLabel("Utilisateur").selectOption(USERS.admin.login);
    await page.getByLabel("Type d'action").selectOption("settings.");
    await page.getByRole("button", { name: "Appliquer les filtres" }).click();
    await expect(page).toHaveURL(/user=admin/);
    const settingsRow = table.locator("tbody tr").first();
    await expect(settingsRow).toContainText(`${USERS.admin.login} a modifié les paramètres`);
    await expect(settingsRow).toContainText("Seuil du niveau « Moyen »");
    await expect(settingsRow).toContainText("Réussi");

    await page.goto(`/admin/audit?user=${encodeURIComponent(USERS.manager.login)}&outcome=REFUSE&action=employee.view`);
    const refused = table.locator("tbody tr").filter({ hasText: `fiche du collaborateur n° ${id}` }).first();
    await expect(refused).toContainText(`${USERS.manager.login} a tenté d'ouvrir`);
    await expect(refused).toContainText("Refusé");

    await page.goto("/admin/audit?action=user.create");
    await expect(table.locator("tbody tr").first()).toContainText("a créé le compte");

    await page.goto("/admin/audit?from=2026-13-45");
    await expect(page.getByText(/Filtres invalides ignorés/)).toBeVisible();
  });

  test("un non-admin ne peut pas créer de compte par l'API", async ({ browser }) => {
    const rh = await browser.newContext({ storageState: storageState("rh") });
    const res = await rh.request.post("/api/admin/users", { data: { login: "e2e.pirate", role: "ADMIN" } });
    expect([401, 403]).toContain(res.status());
    await rh.close();
    expect(q1("SELECT 1 FROM app_user WHERE login = 'e2e.pirate'")).toBeUndefined();
  });
});

// Page Paramètres côté navigateur : repères de modification et contrôles immédiats, sans jamais enregistrer
test.describe("Paramètres côté navigateur (sans enregistrement)", () => {
  const themes = (page: Page) => page.getByRole("navigation", { name: "Thèmes des paramètres" });
  // Lien de la navigation des thèmes ; son nom inclut le compteur éventuel (« Niveaux de risque1 modifié »)
  const theme = (page: Page, label: string) => themes(page).getByRole("link", { name: new RegExp(`^${label}`) });
  const changedThemes = (page: Page) => themes(page).getByRole("link").filter({ hasText: /\d+ modifiés?/ });
  const card = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });
  const modifiedBadge = (scope: Locator) => scope.getByText("Modifié", { exact: true });
  const recap = (page: Page) => page.getByRole("list", { name: "Récapitulatif des modifications" });
  const noChange = (page: Page) => page.getByText("Aucune modification à enregistrer.");
  const saveButton = (page: Page) => page.getByRole("button", { name: "Enregistrer les paramètres" });
  const cancelButton = (page: Page) => page.getByRole("button", { name: "Annuler les modifications" });
  const settingsRows = () => JSON.stringify(q("SELECT key, value, updated_at FROM app_setting ORDER BY key"));

  let posts: string[] = [];
  let before = "";
  test.beforeEach(async ({ page }) => {
    posts = [];
    before = settingsRows();
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/admin/settings")) posts.push(r.url());
    });
    await page.goto("/admin/settings");
    await waitReady(page);
  });
  // Aucun envoi de l'action serveur, aucune écriture dans app_setting
  test.afterEach(() => {
    expect(posts, `envois inattendus : ${posts.join(", ")}`).toEqual([]);
    expect(settingsRows()).toBe(before);
  });

  test("badge « Modifié », compteur du thème et récapitulatif après saisie ; « Rétablir la valeur par défaut »", async ({ page }) => {
    const capacity = page.locator("#s-capacity_rate");
    const risque = card(page, "Classement des niveaux de risque");
    const original = asPercent(settingValue("capacity_rate"));
    const typed = original === "5" ? "6" : "5";
    await expect(capacity).toHaveValue(original);
    await expect(noChange(page)).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
    await expect(modifiedBadge(risque)).toHaveCount(0);
    await expect(changedThemes(page)).toHaveCount(0);

    await capacity.fill(typed);
    await expect(modifiedBadge(risque)).toBeVisible();
    await expect(theme(page, "Niveaux de risque")).toContainText("1 modifié");
    await expect(changedThemes(page)).toHaveCount(1);
    await expect(page.getByText(/1 modification à enregistrer/)).toBeVisible();
    await expect(recap(page)).toContainText(new RegExp(`Capacité mensuelle .* → ${typed}\\s%`));
    await expect(saveButton(page)).toBeEnabled();

    // Valeur par défaut : 2 % (DEFAULT_SETTINGS.capacity_rate)
    const restore = page.getByRole("button", { name: /^Rétablir la valeur par défaut : Capacité mensuelle/ });
    await restore.click();
    await expect(capacity).toHaveValue("2");
    await expect(restore).toHaveCount(0);
    if (original === "2") {
      await expect(modifiedBadge(risque)).toHaveCount(0);
      await expect(changedThemes(page)).toHaveCount(0);
      await expect(noChange(page)).toBeVisible();
    } else {
      await expect(recap(page)).toContainText(/Capacité mensuelle .* → 2\s%/);
    }
  });

  test("« Annuler les modifications » rétablit les valeurs en vigueur", async ({ page }) => {
    const capacity = page.locator("#s-capacity_rate");
    const lift = page.locator("#s-medium_lift");
    const capacityNow = asPercent(settingValue("capacity_rate"));
    const liftNow = String(Number(settingValue("medium_lift")));
    await capacity.fill(capacityNow === "5" ? "6" : "5");
    await lift.fill(liftNow === "3" ? "4" : "3");
    await expect(theme(page, "Niveaux de risque")).toContainText("2 modifiés");
    await expect(page.getByText(/2 modifications à enregistrer/)).toBeVisible();

    await cancelButton(page).click();
    await expect(capacity).toHaveValue(capacityNow);
    await expect(lift).toHaveValue(liftNow);
    await expect(noChange(page)).toBeVisible();
    await expect(cancelButton(page)).toHaveCount(0);
    await expect(saveButton(page)).toBeDisabled();
    await expect(modifiedBadge(card(page, "Classement des niveaux de risque"))).toHaveCount(0);
    await expect(changedThemes(page)).toHaveCount(0);
  });

  test("erreur immédiate « Maximum 20 % » avant tout envoi, levée dès la correction", async ({ page }) => {
    const capacity = page.locator("#s-capacity_rate");
    await capacity.fill("50");
    await expect(page.locator("#s-capacity_rate-err")).toHaveText(/Maximum 20\s%/);
    await expect(capacity).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(/1 valeur à corriger/)).toBeVisible();
    await expect(theme(page, "Niveaux de risque")).toContainText("1 modifié");

    await page.locator("#s-medium_lift").fill("0.2");
    await expect(page.locator("#s-medium_lift-err")).toHaveText(/Minimum 1/);
    await expect(page.getByText(/2 valeurs à corriger/)).toBeVisible();

    await capacity.fill("20");
    await expect(page.locator("#s-capacity_rate-err")).toHaveCount(0);
    await expect(capacity).toHaveAttribute("aria-invalid", "false");
    await cancelButton(page).click();
    await expect(noChange(page)).toBeVisible();
    await expect(page.locator("#s-medium_lift-err")).toHaveCount(0);
  });

  test("barème SMIG : ajout puis retrait d'une période", async ({ page }) => {
    const periods = JSON.parse(settingValue("smig_schedule")) as { from: string | null }[];
    const n = periods.length;
    const smig = page.getByRole("group", { name: "Barème SMIG daté" });
    const removeButtons = smig.getByRole("button", { name: /^Retirer la période/ });
    await expect(removeButtons).toHaveCount(n);

    await smig.getByRole("button", { name: "Ajouter une période" }).click();
    await expect(removeButtons).toHaveCount(n + 1);
    const date = smig.getByLabel(`Date d'effet de la période ${n + 1}`, { exact: true });
    const amount = smig.getByLabel(`SMIG mensuel de la période ${n + 1} (TND)`, { exact: true });
    await expect(date).toHaveValue("");
    await expect(modifiedBadge(smig)).toBeVisible();
    await expect(theme(page, "Paie et SMIG")).toContainText("1 modifié");
    // Une seule période peut rester sans date : si le barème en a déjà une, la nouvelle ligne est signalée tout de suite
    if (periods.some((p) => p.from === null)) {
      await expect(date).toHaveAttribute("aria-invalid", "true");
      await expect(smig.getByText("Saisissez la date d'effet.")).toBeVisible();
      await expect(page.getByText(/Barème SMIG daté : 1 ligne à corriger/)).toBeVisible();
    }

    await date.fill("2099-01-01");
    await amount.fill("600");
    await expect(date).toHaveAttribute("aria-invalid", "false");
    await expect(recap(page)).toContainText(/Barème SMIG daté : .*600\sTND à partir du 01\/01\/2099/);
    await expect(smig.locator("p").filter({ hasText: /^En clair/ })).toContainText(/600\sTND à partir du 01\/01\/2099/);

    await smig.getByRole("button", { name: `Retirer la période ${n + 1}`, exact: true }).click();
    await expect(removeButtons).toHaveCount(n);
    await expect(modifiedBadge(smig)).toHaveCount(0);
    await expect(changedThemes(page)).toHaveCount(0);
    await expect(noChange(page)).toBeVisible();
  });

  test("le thème en cours est surligné au défilement", async ({ page }) => {
    const current = (label: string) => expect(theme(page, label)).toHaveAttribute("aria-current", "location");
    await current("Niveaux de risque");

    await card(page, "Absentéisme").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await current("Absentéisme");
    await expect(theme(page, "Niveaux de risque")).not.toHaveAttribute("aria-current", "location");

    // Fin de page : la ligne de lecture descend, la dernière carte (trop courte pour atteindre le haut) est surlignée
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await current("Conservation");

    await page.evaluate(() => window.scrollTo(0, 0));
    await current("Niveaux de risque");
    await expect(themes(page).locator('a[aria-current="location"]').filter({ visible: true })).toHaveCount(1);
  });
});
