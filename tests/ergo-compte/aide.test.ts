import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { SessionUser } from "@/lib/auth/session";
import type { Role } from "@/db/schema";
import { getDb } from "@/db/client";
import { seedDefaultSettings } from "@/lib/settings";
import { SECTIONS, forRole } from "@/lib/help/content";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const { searchHelp, HelpSearch } = await import("@/app/(app)/aide/search");
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const ids = (role: Role) => forRole(SECTIONS, role).map((s) => s.id);
const count = (r: ReturnType<typeof searchHelp>) => (r ? r.faq.length + r.glossaire.length + r.indicateurs.length + r.ecrans.length : 0);

describe("recherche dans l'aide", () => {
  it("accents et majuscules ignorés, tous les mots requis ; vide sous 2 lettres", () => {
    const r = searchHelp("RH", "ABSENTEISME", ids("RH"));
    expect(r?.glossaire.some((g) => g.title === "Absentéisme hors santé non planifié")).toBe(true);
    expect(count(searchHelp("RH", "absentéisme zzzinconnu", ids("RH")))).toBe(0);
    expect(searchHelp("RH", "a", ids("RH"))).toBeNull();
  });

  it("chaque rôle ne trouve que ses contenus : rien sur le lift pour le manager, pas d'indicateurs RH pour l'administrateur", () => {
    expect(count(searchHelp("RH", "lift", ids("RH")))).toBeGreaterThan(0);
    const mgr = searchHelp("MANAGER", "lift", ids("MANAGER"));
    expect(count(mgr)).toBe(0);
    const adm = searchHelp("ADMIN", "effectif", ids("ADMIN"));
    expect(adm?.indicateurs).toEqual([]);
    const pwd = searchHelp("ADMIN", "mot de passe oublié", ids("ADMIN"));
    expect(pwd?.faq.map((f) => f.title)).toContain("Un utilisateur a oublié son mot de passe : que faire ?");
  });

  it("résultats : réponse affichée directement, lien vers la rubrique ; sans résultat : quoi faire", () => {
    const q = "verrouillé";
    const t = text(html(createElement(HelpSearch, { query: q, results: searchHelp("ADMIN", q, ids("ADMIN")) })));
    expect(t).toMatch(/\d+ résultats? pour « verrouillé »/);
    expect(t).toContain("Un compte est verrouillé : que faire ?");
    expect(t).toContain("Débloquez-le tout de suite");
    expect(t).toContain("Voir toutes les questions");
    const none = text(html(createElement(HelpSearch, { query: "zzz", results: searchHelp("RH", "zzz", ids("RH")) })));
    expect(none).toContain("Aucun résultat pour « zzz »");
    expect(none).toContain("Effacer la recherche");
    const idle = html(createElement(HelpSearch, { query: "", results: null }));
    expect(idle).toContain('role="search"');
    expect(text(idle)).not.toContain("résultat");
  });
});

describe("page /aide avec recherche", () => {
  let file = "";
  beforeAll(() => {
    file = path.join(os.tmpdir(), `pa-ergo-aide-${process.pid}-${Date.now()}.db`);
    process.env.DATABASE_PATH = file;
    (globalThis as { __paDb?: unknown }).__paDb = undefined;
    const { sqlite } = getDb();
    migrate(drizzle(sqlite), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
    seedDefaultSettings(sqlite);
  });
  afterAll(() => {
    const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } } };
    g.__paDb?.sqlite.close();
    delete g.__paDb;
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  });

  const render = async (role: Role, q?: string) => {
    session.current = { userId: 1, login: "x", role, employeeId: role === "MANAGER" ? 10 : null } as SessionUser;
    const Page = (await import("@/app/(app)/aide/page")).default;
    return html(await Page(q === undefined ? undefined : { searchParams: Promise.resolve({ q }) }));
  };

  it("RH : résultats en tête, rubriques et ordre inchangés", async () => {
    const out = await render("RH", "lift");
    const t = text(out);
    expect(t).toMatch(/\d+ résultats? pour « lift »/);
    const order = [...out.matchAll(/<section[^>]* id="([a-z-]+)"/g)].map((m) => m[1]);
    expect(order.slice(0, 2)).toEqual(["commencer", "faq"]);
    expect(out).toContain('value="lift"');
  });

  it("manager : la recherche d'un terme réservé ne révèle rien", async () => {
    const t = text(await render("MANAGER", "lift"));
    expect(t).toContain("Aucun résultat pour « lift »");
    expect(t).not.toMatch(/\d+ résultats? pour/);
  });

  it("sans paramètre : formulaire de recherche, aucun résultat affiché", async () => {
    const t = text(await render("ADMIN"));
    expect(t).toContain("Rechercher dans l'aide");
    expect(t).not.toMatch(/résultats? pour/);
  });
});
