import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Role } from "@/db/schema";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => {} }) }));

const items = await import("@/components/ux/command-palette-items");
const { CommandPalette, CommandPaletteDialog, CommandPaletteTrigger } = await import("@/components/ux/command-palette");
const { NAV } = await import("@/components/layout/sidebar");

const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const labels = (role: Role) => items.pageItems(role).map((p) => p.label);
const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("pages de la palette", () => {
  it("reprennent le menu visible pour le rôle, libellés propres au rôle", () => {
    const mgr = labels("MANAGER");
    expect(mgr).toContain("Mon équipe");
    expect(mgr).toContain("Tableau de bord");
    expect(mgr).not.toContain("Recommandations");
    expect(mgr).not.toContain("Console");
    expect(labels("RH")).toContain("Équipes");
    expect(labels("RH")).toContain("Recommandations");
    const admin = labels("ADMIN");
    expect(admin).toEqual(expect.arrayContaining(["Console", "Alertes", "Utilisateurs et accès", "Journal d'audit"]));
    for (const l of ["Tableau de bord", "Collaborateurs", "Mon équipe", "Absentéisme", "Synthèse du mois"]) expect(admin).not.toContain(l);
  });

  it("aucune page hors du menu du rôle, sans doublon ; Mon compte et Aide passent dans les actions", () => {
    for (const role of ["ADMIN", "RH", "MANAGER"] as Role[]) {
      const allowed = new Set(NAV.flatMap((s) => s.items.filter((i) => i.roles.includes(role)).map((i) => i.href)));
      const hrefs = items.pageItems(role).map((p) => p.href);
      expect(hrefs.every((h) => allowed.has(h!))).toBe(true);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      expect(hrefs).not.toContain("/compte");
      expect(hrefs).not.toContain("/aide");
    }
    expect(items.ACTION_ITEMS.map((a) => a.href ?? a.theme)).toEqual(["light", "dark", "system", "/compte", "/aide"]);
  });

  it("recherche insensible à la casse et aux accents, tous les mots saisis", () => {
    const rh = items.pageItems("RH");
    expect(items.filterItems(rh, "absenteisme").map((p) => p.label)).toEqual(["Absentéisme"]);
    expect(items.filterItems(rh, "SYNTHESE").map((p) => p.label)).toEqual(["Synthèse du mois"]);
    expect(items.filterItems(rh, "equipe").map((p) => p.label)).toContain("Équipes");
    expect(items.filterItems(rh, "  ").length).toBe(rh.length);
    expect(items.filterItems(rh, "zzz")).toEqual([]);
    expect(items.filterItems(items.ACTION_ITEMS, "theme sombre").map((a) => a.id)).toEqual(["action:theme-dark"]);
    expect(items.filterItems(items.ACTION_ITEMS, "thème").length).toBe(3);
  });

  it("classe d'abord les libellés qui commencent par la saisie", () => {
    const list = [{ label: "Vérification a posteriori" }, { label: "Dérive des données" }, { label: "Données et modèle" }];
    expect(items.filterItems(list, "donn").map((i) => i.label)).toEqual(["Données et modèle", "Dérive des données"]);
    expect(items.filterItems(list, "ification").map((i) => i.label)).toEqual(["Vérification a posteriori"]);
    expect(items.filterItems([{ label: "Santé des données" }, { label: "Dérive des données" }], "donnees").map((i) => i.label)).toEqual(["Santé des données", "Dérive des données"]);
  });
});

describe("raccourci et récents", () => {
  it("Ctrl/⌘+K partout, « / » seulement hors champ de saisie", () => {
    expect(items.isPaletteShortcut(key("k", { ctrlKey: true }), false)).toBe(true);
    expect(items.isPaletteShortcut(key("K", { metaKey: true }), true)).toBe(true);
    expect(items.isPaletteShortcut(key("k", { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(items.isPaletteShortcut(key("k"), false)).toBe(false);
    expect(items.isPaletteShortcut(key("/"), false)).toBe(true);
    expect(items.isPaletteShortcut(key("/"), true)).toBe(false);
    expect(items.isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(items.isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(items.isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(items.isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(items.isEditableTarget(null)).toBe(false);
    expect(items.isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(items.isMacPlatform({ platform: "Win32" })).toBe(false);
  });

  it("récents : pages et actions autorisées seulement, jamais un collaborateur ni une alerte", () => {
    const allowed = new Set(["page:/dashboard", "page:/alerts", "action:theme-dark"]);
    expect(items.parseRecents(JSON.stringify(["page:/dashboard", "employee:12", "alert:3", "page:/admin", 42, "action:theme-dark", "page:/dashboard"]), allowed)).toEqual([
      "page:/dashboard",
      "action:theme-dark",
    ]);
    expect(items.parseRecents("{pas du json", allowed)).toEqual([]);
    expect(items.parseRecents(null, allowed)).toEqual([]);
    expect(items.addRecent(["page:/alerts"], "employees|12")).toEqual(["page:/alerts"]);
    expect(items.addRecent(["page:/alerts", "page:/dashboard"], "page:/dashboard")).toEqual(["page:/dashboard", "page:/alerts"]);
    const many = ["a", "b", "c", "d", "e", "f"].reduce<string[]>((l, x) => items.addRecent(l, `page:/${x}`), []);
    expect(many).toHaveLength(items.RECENTS_MAX);
    expect(many[0]).toBe("page:/f");
  });
});

describe("rendu", () => {
  it("palette fermée : rien n'est rendu ; déclencheur avec indice clavier", () => {
    expect(html(createElement(CommandPalette, { role: "RH" }))).toBe("");
    const t = html(createElement(CommandPaletteTrigger));
    expect(t).toContain('aria-haspopup="dialog"');
    expect(t).toContain('aria-keyshortcuts="Control+K Meta+K"');
    expect(t).toContain("Ctrl K");
    expect(t).toContain("Recherche rapide");
    expect(t).not.toMatch(/bg-white|text-slate-|bg-sky-/);
  });

  it("dialogue modal titré, combobox reliée à la listbox, option active", () => {
    const m = html(createElement(CommandPaletteDialog, { role: "MANAGER", onClose: () => {} }));
    expect(m).toMatch(/<dialog[^>]*aria-modal="true"[^>]*aria-labelledby="([^"]+)"/);
    const titleId = /aria-labelledby="([^"]+)"/.exec(m)![1];
    expect(m).toContain(`id="${titleId}"`);
    const listId = /aria-controls="([^"]+)"/.exec(m)![1];
    expect(m).toMatch(new RegExp(`id="${listId}"[^>]*role="listbox"`));
    expect(m).toContain('role="combobox"');
    const activeId = /aria-activedescendant="([^"]+)"/.exec(m)![1];
    expect(m).toMatch(new RegExp(`id="${activeId}"[^>]*role="option"[^>]*aria-selected="true"`));
    expect(m.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(m).toContain('aria-live="polite"');
    expect(m).toContain("Mon équipe");
    expect(m).toContain("Passer au thème sombre");
    expect(m).toContain("collaborateur");
    expect(m).not.toMatch(/bg-white|text-slate-|bg-sky-/);
  });

  it("ADMIN : pages d'administration et actions, aucune invite à chercher un collaborateur", () => {
    const m = html(createElement(CommandPaletteDialog, { role: "ADMIN", onClose: () => {} }));
    expect(m).toContain("Console");
    expect(m).toContain("Mon compte");
    expect(m).not.toContain("Tableau de bord");
    expect(m).not.toMatch(/collaborateur/i);
  });
});
