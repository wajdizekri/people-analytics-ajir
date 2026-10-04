"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { THEME_STORAGE_KEY } from "./theme-script";

// Thème clair / sombre / système (docs/qa/DESIGN_SYSTEM.md § 2). Source de vérité : attributs data-theme (résolu) et
// data-theme-pref (choix) de <html>, posés avant affichage par themeScript ; ce module les lit et les modifie.

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "light", label: "Clair", icon: "sun" },
  { value: "dark", label: "Sombre", icon: "moon" },
  { value: "system", label: "Système", icon: "monitor" },
];
const LABEL: Record<ThemePreference, string> = { light: "Clair", dark: "Sombre", system: "Système" };

const isPref = (v: unknown): v is ThemePreference => v === "light" || v === "dark" || v === "system";

function storedPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isPref(v) ? v : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;

/** Applique un choix sans l'enregistrer (data-theme, data-theme-pref). */
export function applyTheme(pref: ThemePreference) {
  const resolved: ResolvedTheme = pref === "system" ? (systemDark() ? "dark" : "light") : pref;
  const d = document.documentElement;
  d.setAttribute("data-theme", resolved);
  d.setAttribute("data-theme-pref", pref);
  return resolved;
}

/** Enregistre et applique un choix (localStorage « pa-theme »). */
export function setTheme(pref: ThemePreference) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // stockage indisponible (navigation privée stricte) : le choix vaut pour la page en cours
  }
  // Bascule nette : les transitions de couleur ne jouent pas toutes en même temps
  const d = document.documentElement;
  d.classList.add("pa-theme-switching");
  const resolved = applyTheme(pref);
  requestAnimationFrame(() => requestAnimationFrame(() => d.classList.remove("pa-theme-switching")));
  return resolved;
}

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-pref"] });
  return () => obs.disconnect();
}
const snapshot = () => {
  const d = document.documentElement;
  const pref = d.getAttribute("data-theme-pref");
  return `${isPref(pref) ? pref : "system"}|${d.getAttribute("data-theme") === "dark" ? "dark" : "light"}`;
};
const serverSnapshot = () => "system|light";

/** Thème courant pour les composants client : { theme (choix), resolvedTheme (clair/sombre), setTheme }. Se met à jour à chaque changement. */
export function useTheme() {
  const [theme, resolvedTheme] = useSyncExternalStore(subscribe, snapshot, serverSnapshot).split("|") as [ThemePreference, ResolvedTheme];
  return { theme, resolvedTheme, setTheme };
}

/**
 * À monter une fois (layout racine) : réapplique le choix si React a remis <html> à zéro (remontage du mode strict en développement),
 * et imprime toujours en clair (Ctrl+P sur n'importe quelle page) : les graphiques se redessinent en clair, le thème sombre revient ensuite.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme(storedPreference());
  }, []);
  useEffect(() => {
    const d = document.documentElement;
    let suspended = false;
    const before = () => {
      if (d.getAttribute("data-theme") !== "dark") return;
      suspended = true;
      d.classList.add("pa-theme-switching");
      d.setAttribute("data-theme", "light");
    };
    const after = () => {
      if (!suspended) return;
      suspended = false;
      if (d.getAttribute("data-theme") === "light") d.setAttribute("data-theme", "dark");
      d.classList.remove("pa-theme-switching");
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      after();
    };
  }, []);
  return null;
}

const announce = (pref: ThemePreference, resolved: ResolvedTheme) =>
  pref === "system" ? `Thème du système activé (${resolved === "dark" ? "sombre" : "clair"}).` : `Thème ${LABEL[pref].toLowerCase()} activé.`;

/**
 * Bascule de thème. variant="menu" (en-tête) : bouton + menu à cocher (flèches, Début/Fin, Échap) ;
 * variant="segmented" (Mon compte) : trois boutons radio « Clair / Sombre / Système ». Le changement est annoncé.
 */
export function ThemeToggle({ variant = "menu", className = "" }: { variant?: "menu" | "segmented"; className?: string }) {
  const { theme, resolvedTheme } = useTheme();
  const [message, setMessage] = useState("");
  const choose = (pref: ThemePreference) => {
    const resolved = setTheme(pref);
    setMessage(announce(pref, resolved));
  };
  const status = (
    <span role="status" className="sr-only">
      {message}
    </span>
  );
  if (variant === "segmented") return <Segmented theme={theme} onChoose={choose} status={status} className={className} />;
  return <ThemeMenu theme={theme} resolved={resolvedTheme} onChoose={choose} status={status} className={className} />;
}

function Segmented({ theme, onChoose, status, className }: { theme: ThemePreference; onChoose: (p: ThemePreference) => void; status: ReactNode; className: string }) {
  const name = useId();
  return (
    <fieldset className={className}>
      <legend className="mb-1.5 text-sm font-medium text-fg">Thème</legend>
      <div className="inline-flex rounded-control border border-line-strong bg-surface p-0.5">
        {THEME_OPTIONS.map((o) => (
          <label
            key={o.value}
            className="relative inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[6px] px-3 text-sm font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-3 hover:text-fg has-[:checked]:bg-primary has-[:checked]:text-primary-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--pa-focus)]"
          >
            <input type="radio" name={name} value={o.value} checked={theme === o.value} onChange={() => onChoose(o.value)} className="sr-only" />
            <Icon name={o.icon} />
            {o.label}
          </label>
        ))}
      </div>
      {status}
    </fieldset>
  );
}

function ThemeMenu({
  theme,
  resolved,
  onChoose,
  status,
  className,
}: {
  theme: ThemePreference;
  resolved: ResolvedTheme;
  onChoose: (p: ThemePreference) => void;
  status: ReactNode;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);

  useEffect(() => {
    if (!open) return;
    (items().find((el) => el.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") setOpen(false);
  };
  const current = THEME_OPTIONS.find((o) => o.value === theme) ?? THEME_OPTIONS[2];
  const icon: IconName = theme === "system" ? (resolved === "dark" ? "moon" : "sun") : current.icon;
  const title = `Thème : ${current.label}${theme === "system" ? ` (${resolved === "dark" ? "sombre" : "clair"})` : ""}`;

  return (
    <div ref={root} className={`relative inline-block ${className}`}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        title={title}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-control px-2.5 text-sm font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-3 hover:text-fg active:translate-y-px"
      >
        <Icon name={icon} className="h-5 w-5" />
        <span className="sr-only 2xl:not-sr-only">
          <span className="sr-only">Thème : </span>
          {current.label}
        </span>
      </button>
      <div
        ref={menu}
        id={id}
        role="menu"
        aria-label="Thème d'affichage"
        hidden={!open}
        onKeyDown={onMenuKey}
        className="absolute right-0 top-full z-40 mt-1 w-44 animate-pop-in rounded-control border border-line bg-surface p-1 shadow-pop"
      >
        {THEME_OPTIONS.map((o) => {
          const checked = theme === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={checked}
              onClick={() => {
                onChoose(o.value);
                close();
              }}
              className={`flex min-h-10 w-full items-center gap-2 rounded-[6px] px-3 text-left text-sm transition-colors duration-150 hover:bg-surface-3 focus-visible:bg-surface-3 ${checked ? "font-semibold text-fg" : "text-fg-muted"}`}
            >
              <Icon name={o.icon} className="h-4 w-4" />
              <span className="flex-1">{o.label}</span>
              {checked && <Icon name="check" className="h-4 w-4 text-link" />}
            </button>
          );
        })}
      </div>
      {status}
    </div>
  );
}
