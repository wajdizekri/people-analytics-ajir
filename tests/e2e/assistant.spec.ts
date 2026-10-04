import type { Page } from "@playwright/test";
import { test, expect, q1, storageState, waitReady, type RoleKey } from "./helpers";

// Assistant d'aide (RAG sur la documentation, filtré par rôle) : replié sur une ligne sous le titre de l'écran d'accueil,
// réponse avec sources internes, aucun appel d'IA générative sans clé, audit sans le texte de la question.

const CASES: { role: RoleKey; home: string; question: string }[] = [
  { role: "rh", home: "/dashboard", question: "Comment est calculé le niveau de risque ?" },
  { role: "manager", home: "/dashboard", question: "Que veut dire le niveau de risque de mon équipe ?" },
  { role: "admin", home: "/admin", question: "Comment importer un export AJIR ?" },
];

const form = (page: Page) => page.getByRole("search", { name: "Poser une question à l'assistant d'aide" });
const lastAudit = () =>
  q1<{ outcome: string; detail: string | null }>("SELECT outcome, detail_json AS detail FROM audit_log WHERE action = 'assistant.ask' ORDER BY id DESC LIMIT 1");

for (const c of CASES) {
  test.describe(`Assistant d'aide — ${c.role}`, () => {
    test.use({ storageState: storageState(c.role) });

    test("replié sur une ligne, réponse avec sources internes, fermeture au clavier, audit sans texte", async ({ page }) => {
      await page.goto(c.home);
      await waitReady(page);
      const search = form(page);
      await expect(search).toBeVisible();
      await expect(page.getByRole("list", { name: "Sources" })).toHaveCount(0);

      const input = search.getByRole("textbox");
      await input.fill(c.question);
      await search.getByRole("button", { name: "Demander" }).click();

      const sources = page.getByRole("list", { name: "Sources" });
      await expect(sources).toBeVisible();
      const links = sources.getByRole("link");
      expect(await links.count()).toBeGreaterThan(0);
      for (const href of await links.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) expect(href).toMatch(/^\/aide/);

      await page.keyboard.press("Escape");
      await expect(sources).toHaveCount(0);
      await expect(input).toBeFocused();

      const audit = lastAudit();
      expect(audit?.outcome).toBe("OK");
      expect(audit?.detail ?? "").not.toContain(c.question);
    });

    test("API : réponse sans IA générative (aucune clé en E2E), rôle tiré de la session", async ({ page }) => {
      const res = await page.request.post("/api/assistant", { data: { question: c.question, role: "RH" } });
      expect(res.status()).toBe(200);
      expect(res.headers()["cache-control"]).toContain("no-store");
      const body = (await res.json()) as { mode: string; answer: string; sources: { href: string }[] };
      expect(["EXTRAIT", "AUCUN"]).toContain(body.mode);
      for (const s of body.sources) expect(s.href).toMatch(/^\/aide/);
      if (c.role === "manager") expect(`${body.answer}`).not.toMatch(/\blift\b/i);
    });
  });
}

test.describe("Assistant d'aide — question invalide", () => {
  test.use({ storageState: storageState("rh") });

  test("question trop courte : 400 avec message en français", async ({ page }) => {
    const res = await page.request.post("/api/assistant", { data: { question: "a" } });
    expect(res.status()).toBe(400);
  });
});
