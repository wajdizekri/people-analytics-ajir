import { test, expect, GENERIC_ERROR, LOCK_USER, USERS, login, loginAs, q1, storageState, type RoleKey } from "./helpers";
import type { Page } from "@playwright/test";

// Début du message de verrouillage (la suite indique quoi faire : patienter ou demander un déverrouillage)
const LOCKED_ERROR = "Compte temporairement verrouillé après plusieurs essais infructueux.";

test.describe("Authentification", () => {
  for (const role of Object.keys(USERS) as RoleKey[]) {
    test(`connexion ${USERS[role].login} → ${USERS[role].home}`, async ({ page }) => {
      await loginAs(page, role);
      await expect(page).toHaveURL(new RegExp(`${USERS[role].home}$`));
      const header = page.locator("header").first();
      await expect(header).toContainText(USERS[role].login);
      await expect(header).toContainText(USERS[role].roleLabel);
      const cookie = (await page.context().cookies()).find((c) => c.name === "pa_session");
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe("Lax");
    });
  }

  test("mauvais mot de passe et identifiant inconnu : même message générique", async ({ page }) => {
    await login(page, USERS.rh.login, "MauvaisMotDePasse1");
    await expect(page.getByText(GENERIC_ERROR)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    await login(page, "inconnu.e2e", "MauvaisMotDePasse1");
    await expect(page.getByText(GENERIC_ERROR)).toBeVisible();

    // une connexion réussie remet le compteur d'échecs à zéro
    await loginAs(page, "rh");
    expect(q1<{ n: number }>("SELECT failed_attempts AS n FROM app_user WHERE login = @l", { l: USERS.rh.login })?.n).toBe(0);
  });

  test("formulaire : afficher le mot de passe, erreur reliée au champ, constellation décorative", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("Mot de passe", { exact: true });
    const toggle = page.getByRole("button", { name: "Afficher le mot de passe" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await password.fill("MauvaisMdp7xx");
    // Le premier clic peut précéder l'hydratation : on réessaie jusqu'à ce que la bascule réponde
    await expect(async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
    }).toPass();
    await expect(password).toHaveAttribute("type", "text");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "password");

    // Scène 3D ou repli SVG : ignorée des lecteurs d'écran, jamais cliquable
    const scene = page.locator("[data-constellation]");
    await expect(scene).toHaveAttribute("aria-hidden", "true");
    await expect(scene).toHaveCSS("pointer-events", "none");

    await page.getByLabel("Identifiant").fill("e2e.inconnu.formulaire");
    await password.fill("MauvaisMdp7xx");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText(GENERIC_ERROR)).toBeVisible();
    await expect(password).toBeFocused();
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(password).toHaveAttribute("aria-describedby", /login-error/);
  });

  test("lien profond sans session : retour à la page demandée après connexion", async ({ page }) => {
    await page.goto("/employees?niveau=ELEVE");
    await expect(page).toHaveURL(/\/login\?next=%2Femployees%3Fniveau%3DELEVE$/);
    await page.getByLabel("Identifiant").fill(USERS.rh.login);
    await page.getByLabel("Mot de passe").fill(USERS.rh.password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(/\/employees\?niveau=ELEVE$/);
  });

  test("destination externe ignorée : accueil du rôle après connexion", async ({ page }) => {
    await page.goto("/login?next=%2F%5Cevil.example");
    await page.getByLabel("Identifiant").fill(USERS.rh.login);
    await page.getByLabel("Mot de passe").fill(USERS.rh.password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(new RegExp(`${USERS.rh.home}$`));
  });

  test("page protégée sans session → /login ; API sans session → 401", async ({ page, request }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    const res = await request.get("/api/dashboard");
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe("NON_AUTHENTIFIE");
  });

  test("déconnexion : retour à /login et session invalidée côté serveur", async ({ page, browser }) => {
    await loginAs(page, "rh");
    const token = (await page.context().cookies()).find((c) => c.name === "pa_session")!;
    await page.getByRole("button", { name: "Déconnexion" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);

    // rejouer l'ancien cookie ne doit plus donner accès
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    await ctx.addCookies([{ ...token }]);
    const res = await ctx.request.get("/api/me");
    expect(res.status()).toBe(401);
    await ctx.close();
  });

  test("verrouillage après 5 échecs, puis déverrouillage par l'admin", async ({ page, browser }) => {
    for (let i = 1; i <= 5; i++) {
      await login(page, LOCK_USER.login, `MauvaisMdp${i}xx`);
      await expect(page.getByText(GENERIC_ERROR)).toBeVisible();
    }
    const row = q1<{ n: number; lock: string | null }>("SELECT failed_attempts AS n, locked_until AS lock FROM app_user WHERE login = @l", { l: LOCK_USER.login });
    expect(row?.n).toBe(5);
    expect(row?.lock).toBeTruthy();

    // même avec le bon mot de passe, le compte reste verrouillé
    await login(page, LOCK_USER.login, LOCK_USER.password);
    await expect(page.getByText(LOCKED_ERROR)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    const adminCtx = await browser.newContext({ storageState: storageState("admin") });
    const admin = await adminCtx.newPage();
    await admin.goto("/admin/users");
    const userRow = admin.getByRole("row").filter({ hasText: LOCK_USER.login });
    await expect(userRow).toContainText("Verrouillé");
    await userRow.getByRole("button", { name: `Déverrouiller ${LOCK_USER.login}` }).click();
    await expect(userRow).not.toContainText("Verrouillé");
    await adminCtx.close();

    await login(page, LOCK_USER.login, LOCK_USER.password);
    await page.waitForURL(/\/dashboard$/);
  });

  test("identifiant inconnu : même verrouillage apparent (pas d'énumération des comptes)", async ({ page }) => {
    for (let i = 1; i <= 5; i++) {
      await login(page, "e2e.fantome", `MauvaisMdp${i}xx`);
      await expect(page.getByText(GENERIC_ERROR)).toBeVisible();
    }
    await login(page, "e2e.fantome", "MauvaisMdp6xx");
    await expect(page.getByText(LOCKED_ERROR)).toBeVisible();
  });
});

// Page de connexion 3D : formulaire utilisable sans attendre la scène, aucune erreur console ni violation CSP,
// repli SVG statique sur écran étroit et en mouvement réduit (émulation Playwright)
test.describe("Connexion 3D", () => {
  const watch = (page: Page) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    return errors;
  };

  test("1440 px : formulaire utilisable avant la scène, aucune erreur console ni CSP", async ({ page }) => {
    const errors = watch(page);
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const id = page.getByLabel("Identifiant");
    await expect(id).toBeEditable();
    await id.fill("rh.demo");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeEnabled();
    const scene = page.locator("[data-constellation]");
    // La scène se décide au repos de la page : 3D (WebGL matériel) ou repli SVG (WebGL logiciel des navigateurs sans tête)
    await expect(scene).toHaveAttribute("data-constellation", /^(static|3d)$/, { timeout: 15_000 });
    await expect(id).toHaveValue("rh.demo");
    await page.waitForTimeout(1000);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("390 px : repli statique (écran étroit), sans erreur", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR" });
    const page = await context.newPage();
    const errors = watch(page);
    await page.goto("/login");
    await expect(page.locator("[data-constellation]")).toHaveAttribute("data-reason", "ecran-etroit", { timeout: 15_000 });
    await expect(page.locator("[data-constellation]")).toHaveAttribute("data-constellation", "static");
    await expect(page.getByLabel("Identifiant")).toBeEditable();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });

  test("mouvement réduit : repli statique, sans erreur", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = watch(page);
    await page.goto("/login");
    await expect(page.locator("[data-constellation]")).toHaveAttribute("data-reason", "mouvement-reduit", { timeout: 15_000 });
    await expect(page.locator("[data-constellation]")).toHaveAttribute("data-constellation", "static");
    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });
});
