import type { Role } from "@/db/schema";
import type { IconName } from "@/components/ui/icons";
import type { ThemePreference } from "@/components/ui/theme";
import { NAV } from "@/components/layout/sidebar";

// Éléments statiques de la palette (pages du menu, actions) : filtrés côté client, sans appel réseau.
export type StaticItem = {
  id: string;
  kind: "page" | "action";
  label: string;
  detail: string;
  icon: IconName;
  href?: string;
  theme?: ThemePreference;
  keywords?: string;
};

export const ACTION_ITEMS: StaticItem[] = [
  { id: "action:theme-light", kind: "action", label: "Passer au thème clair", detail: "Apparence", icon: "sun", theme: "light", keywords: "mode jour" },
  { id: "action:theme-dark", kind: "action", label: "Passer au thème sombre", detail: "Apparence", icon: "moon", theme: "dark", keywords: "mode nuit" },
  { id: "action:theme-system", kind: "action", label: "Utiliser le thème du système", detail: "Apparence", icon: "monitor", theme: "system", keywords: "mode automatique" },
  { id: "action:compte", kind: "action", label: "Mon compte", detail: "Vos informations, vos droits, votre mot de passe", icon: "user", href: "/compte", keywords: "profil mot de passe" },
  { id: "action:aide", kind: "action", label: "Aide", detail: "Guide et définitions", icon: "help", href: "/aide", keywords: "glossaire documentation" },
];

const ACTION_HREFS = new Set(ACTION_ITEMS.flatMap((a) => (a.href ? [a.href] : [])));

export function pageItems(role: Role): StaticItem[] {
  const seen = new Set<string>();
  const out: StaticItem[] = [];
  for (const s of NAV) {
    for (const i of s.items) {
      if (!i.roles.includes(role) || ACTION_HREFS.has(i.href) || seen.has(i.href)) continue;
      seen.add(i.href);
      out.push({ id: `page:${i.href}`, kind: "page", label: i.labels?.[role] ?? i.label, detail: s.section, icon: "arrow-right", href: i.href });
    }
  }
  return out;
}

export const foldText = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Tous les mots saisis doivent figurer dans le libellé (ou ses mots-clés), sans tenir compte de la casse ni des accents.
// Ordre : libellé qui commence par la saisie, puis un mot du libellé qui commence par le premier mot saisi, puis le reste.
export function filterItems<T extends { label: string; keywords?: string }>(items: T[], query: string): T[] {
  const q = foldText(query).trim();
  if (!q) return items;
  const tokens = q.split(/\s+/);
  const rank = (label: string) => (label.startsWith(q) ? 0 : label.split(/[\s'’-]+/).some((w) => w.startsWith(tokens[0])) ? 1 : 2);
  return items
    .map((item, index) => ({ item, index, label: foldText(item.label), hay: foldText(`${item.label} ${item.keywords ?? ""}`) }))
    .filter((x) => tokens.every((t) => x.hay.includes(t)))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.index - b.index)
    .map((x) => x.item);
}

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean };

// Ctrl/⌘+K partout (y compris dans un champ) ; « / » seulement hors champ de saisie
export function isPaletteShortcut(e: KeyLike, typingInField: boolean): boolean {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") return true;
  return e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !typingInField;
}

export function isEditableTarget(target: unknown): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  return !!el && (el.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ""));
}

export const isMacPlatform = (nav: { platform?: string; userAgent?: string } | undefined) => /Mac|iPhone|iPad|iPod/i.test(nav?.platform || nav?.userAgent || "");

// Récents : identifiants de pages et d'actions seulement (jamais de collaborateur ni d'alerte côté navigateur)
export const RECENTS_KEY = "pa-palette-recents";
export const RECENTS_MAX = 5;
const isStorableId = (id: unknown): id is string => typeof id === "string" && /^(page|action):/.test(id);

export function parseRecents(raw: string | null, allowed: ReadonlySet<string>): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter((id): id is string => isStorableId(id) && allowed.has(id)))].slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

export function addRecent(list: string[], id: string): string[] {
  if (!isStorableId(id)) return list;
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENTS_MAX);
}
