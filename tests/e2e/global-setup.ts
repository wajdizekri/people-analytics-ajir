import fs from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";
import { AUTH_DIR, USERS, loginAs, storageState, type RoleKey } from "./helpers";

// Sessions réutilisables des trois comptes de démonstration (le serveur est déjà démarré par webServer)
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const role of Object.keys(USERS) as RoleKey[]) {
      const context = await browser.newContext({ baseURL, locale: "fr-FR" });
      const page = await context.newPage();
      await loginAs(page, role);
      await context.storageState({ path: storageState(role) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
