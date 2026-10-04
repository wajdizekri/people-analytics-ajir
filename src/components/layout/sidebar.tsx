"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Role } from "@/db/schema";
import { Icon } from "@/components/ui/icons";
import { setNavRail, syncNavRail, useNavRail } from "./nav-rail";

type Item = { href: string; label: string; roles: Role[]; exact?: boolean; labels?: Partial<Record<Role, string>> };

const ALL: Role[] = ["ADMIN", "RH", "MANAGER"];
const PILOTAGE: Role[] = ["RH", "MANAGER"];

// L'ADMIN administre l'outil sans voir de données RH ; RH et MANAGER partagent le pilotage (DTO par rôle côté serveur).
// Sections courtes et dans l'ordre des usages : vue d'ensemble, collaborateurs, analyses par thème, données, aide.
export const NAV: { section: string; items: Item[] }[] = [
  {
    section: "Vue d'ensemble",
    items: [
      { href: "/dashboard", label: "Tableau de bord", roles: PILOTAGE },
      { href: "/synthese", label: "Synthèse du mois", roles: PILOTAGE },
      { href: "/alerts", label: "Alertes", roles: PILOTAGE },
    ],
  },
  {
    section: "Collaborateurs",
    items: [
      { href: "/employees", label: "Collaborateurs", roles: PILOTAGE, labels: { MANAGER: "Mon équipe" } },
      { href: "/equipes", label: "Mes équipes", roles: PILOTAGE, labels: { RH: "Équipes" } },
      { href: "/organigramme", label: "Organigramme", roles: PILOTAGE },
      { href: "/recommendations", label: "Recommandations", roles: ["RH"] },
      { href: "/interventions", label: "Interventions", roles: ["RH"] },
    ],
  },
  {
    section: "Analyses",
    items: [
      { href: "/absenteeism", label: "Absentéisme", roles: PILOTAGE },
      { href: "/formations", label: "Formations", roles: PILOTAGE },
      { href: "/charge", label: "Charge de travail", roles: PILOTAGE },
      { href: "/retention", label: "Rétention", roles: PILOTAGE },
      { href: "/previsions", label: "Prévisions effectifs", roles: ["RH"] },
    ],
  },
  {
    section: "Administration",
    items: [
      { href: "/admin", label: "Console", roles: ["ADMIN"], exact: true },
      { href: "/alerts", label: "Alertes", roles: ["ADMIN"] },
      { href: "/admin/users", label: "Utilisateurs et accès", roles: ["ADMIN"] },
      { href: "/admin/settings", label: "Paramètres", roles: ["ADMIN"] },
      { href: "/admin/audit", label: "Journal d'audit", roles: ["ADMIN"] },
    ],
  },
  {
    section: "Données et modèle",
    items: [
      { href: "/data-health", label: "Santé des données", roles: ["ADMIN", "RH"] },
      { href: "/transparency", label: "Transparence du modèle", roles: ["ADMIN", "RH"] },
      { href: "/derive", label: "Dérive des données", roles: ["ADMIN", "RH"] },
      { href: "/backtesting", label: "Vérification a posteriori", roles: ["RH"] },
      { href: "/confidentialite", label: "Droit d'accès", roles: ["RH"] },
    ],
  },
  {
    section: "Aide et compte",
    items: [
      { href: "/aide", label: "Aide", roles: ALL },
      { href: "/compte", label: "Mon compte", roles: ALL },
    ],
  },
];

// Une icône par entrée, même famille : tracé sur une grille de 24, trait de 1,75, bouts arrondis, affichée à 20 px
const ICONS: Record<string, string> = {
  "/dashboard":
    "M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z M15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z M15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z M4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z",
  "/synthese": "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M8 12l2 2 4-4 M8 17h8",
  "/alerts": "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
  "/employees": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  "/equipes": "M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M5 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M12 8v4 M12 12l-6 4 M12 12l6 4",
  "/organigramme":
    "M10 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z M3 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z M17 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3 M12 12V8",
  "/recommendations": "M9 18h6 M10 22h4 M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z",
  "/interventions": "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  "/absenteeism": "M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M10 14l4 4 M14 14l-4 4",
  "/formations": "M22 10 12 5 2 10l10 5 10-5z M6 12v5c3 2 9 2 12 0v-5",
  "/charge": "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
  "/retention": "M3 3v16a2 2 0 0 0 2 2h16 M7 7h4v4h4v4h4",
  "/previsions": "M22 7l-8.5 8.5-5-5L2 17 M16 7h6v6",
  "/admin": "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M7 9l3 3-3 3 M13 15h4",
  "/admin/users": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M8 16a4 4 0 0 1 8 0",
  "/admin/settings": "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M2 14h4 M10 8h4 M18 16h4",
  "/admin/audit": "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5",
  "/data-health": "M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3z M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5 M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3",
  "/transparency": "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "/derive": "M2 20h20 M3 20c2.5 0 3-15 5.5-15S11.5 20 14 20 M10 20c2 0 3-9 5.5-9s3.5 9 5.5 9",
  "/backtesting": "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l3 2",
  "/confidentialite": "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4",
  "/aide": "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01",
  "/compte": "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6.2 18.8a7 7 0 0 1 11.6 0",
};

function NavIcon({ href, className }: { href: string; className: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[href] ?? "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"} />
    </svg>
  );
}

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

// navy : menu latéral, marine dans les deux thèmes (blanc sur bg-nav ≥ 4,5:1, même à 65 %) ; surface : menu mobile, jetons du thème
const TONE = {
  navy: {
    heading: "text-white/65",
    idle: "text-white/85 hover:bg-white/10 hover:text-white active:bg-white/15",
    active: "bg-white font-semibold text-heading shadow-sm dark:bg-white/[0.14] dark:shadow-none",
    icon: "text-white/65 group-hover:text-white",
    iconActive: "text-link dark:text-accent",
    count: "bg-accent text-accent-fg",
    countActive: "bg-nav text-white dark:bg-accent dark:text-accent-fg",
  },
  surface: {
    heading: "text-fg-subtle",
    idle: "text-fg hover:bg-surface-3 active:bg-surface-3",
    active: "bg-primary-soft font-semibold text-heading",
    icon: "text-fg-subtle group-hover:text-fg-muted",
    iconActive: "text-link",
    count: "bg-accent text-accent-fg",
    countActive: "bg-accent text-accent-fg",
  },
} as const;

// Menu réduit (rail de 64 px) : mis en forme par CSS d'après data-nav="rail" sur <html> (nav-script.ts), sur le menu latéral
// seulement. Les libellés restent dans le DOM (sr-only) : le nom accessible des liens ne change pas.
const RAIL = {
  nav: "in-data-[nav=rail]:gap-0 in-data-[nav=rail]:divide-y in-data-[nav=rail]:divide-white/10 in-data-[nav=rail]:pt-1 in-data-[nav=rail]:[scrollbar-width:none]",
  section: "shrink-0 in-data-[nav=rail]:py-2",
  hidden: "in-data-[nav=rail]:sr-only",
  link: "in-data-[nav=rail]:px-2.5",
  count: "in-data-[nav=rail]:absolute in-data-[nav=rail]:-right-1.5 in-data-[nav=rail]:-top-1 in-data-[nav=rail]:h-4 in-data-[nav=rail]:min-w-4 in-data-[nav=rail]:px-1 in-data-[nav=rail]:text-[10px]",
} as const;

type TipHandlers = { show: (target: HTMLElement, text: string) => void; hide: () => void };

type NavProps = {
  role: Role;
  idPrefix: string;
  variant: keyof typeof TONE;
  alertCount?: number;
  onNavigate?: () => void;
  tip?: TipHandlers;
  id?: string;
  className?: string;
};

function NavLinks({ role, idPrefix, variant, alertCount = 0, onNavigate, tip, id, className = "" }: NavProps) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  const navy = variant === "navy";
  const tone = TONE[variant];

  // Menu plus haut que l'écran : la page ouverte reste visible dans la zone défilante
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  return (
    <nav ref={ref} id={id} aria-label="Navigation principale" onScroll={tip?.hide} className={`flex flex-col gap-4 px-3 pb-6 pt-3 ${navy ? RAIL.nav : ""} ${className}`}>
      {NAV.map((s, n) => {
        const items = s.items.filter((i) => i.roles.includes(role));
        if (!items.length) return null;
        const headingId = `${idPrefix}-nav-${n}`;
        return (
          <div key={s.section} className={navy ? RAIL.section : undefined}>
            <p id={headingId} className={`px-3 pb-2 text-xs font-semibold uppercase leading-4 tracking-wider ${tone.heading} ${navy ? RAIL.hidden : ""}`}>
              {s.section}
            </p>
            <ul aria-labelledby={headingId}>
              {items.map((i) => {
                const active = pathname === i.href || (!i.exact && pathname.startsWith(i.href + "/"));
                const label = i.labels?.[role] ?? i.label;
                const showCount = i.href === "/alerts" && alertCount > 0;
                return (
                  <li key={`${i.href}-${s.section}`}>
                    <Link
                      href={i.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      onMouseEnter={tip && ((e) => tip.show(e.currentTarget, label))}
                      onMouseLeave={tip?.hide}
                      onFocus={tip && ((e) => tip.show(e.currentTarget, label))}
                      onBlur={tip?.hide}
                      className={`group relative flex items-center gap-3 rounded-control px-3 text-sm leading-5 transition-colors duration-150 ${navy ? `min-h-10 ${RAIL.link}` : "min-h-11"} ${
                        active ? `${tone.active} before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-accent` : tone.idle
                      }`}
                    >
                      <NavIcon href={i.href} className={active ? tone.iconActive : tone.icon} />
                      <span className={`min-w-0 flex-1 truncate ${navy ? RAIL.hidden : ""}`}>{label}</span>
                      {showCount && (
                        <span
                          className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums ${active ? tone.countActive : tone.count} ${navy ? RAIL.count : ""}`}
                        >
                          {alertCount > 99 ? "99+" : alertCount}
                          <span className="sr-only"> {plural(alertCount, "alerte ouverte", "alertes ouvertes")}</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

// compact : en-tête mobile, nom affiché à partir de 640 px seulement ; collapsible : nom masqué quand le menu latéral est réduit
export function BrandMark({ light = false, compact = false, collapsible = false }: { light?: boolean; compact?: boolean; collapsible?: boolean }) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-[13px] font-bold text-accent-fg">
        PA
      </span>
      <span className={`leading-tight ${compact ? "hidden sm:block" : ""} ${collapsible ? RAIL.hidden : ""}`}>
        <span className={`block text-[15px] font-semibold ${light ? "text-heading" : "text-white"}`}>People Analytics</span>
        <span className={`block text-xs ${light ? "text-fg-muted" : "text-white/70"}`}>AJIR · ArabSoft</span>
      </span>
    </span>
  );
}

const SIDE_NAV_ID = "menu-lateral";

// avatar : pastille d'initiales rendue par le gabarit serveur (évite de charger tout @/components/ui avec le menu)
type SidebarProps = { role: Role; alertCount: number; dataDate?: string; login?: string; roleLabel?: string; avatar?: ReactNode };

// Pas de balise <header> ici : les tests E2E prennent le premier <header> de la page pour l'en-tête de l'application
export function Sidebar({ role, alertCount, dataDate, login, roleLabel, avatar }: SidebarProps) {
  const rail = useNavRail();
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  useLayoutEffect(syncNavRail, []);

  // Bulle des entrées du rail : position fixe (hors de la zone défilante), au survol comme au focus clavier
  const handlers: TipHandlers = {
    show: (target, text) => {
      const r = target.getBoundingClientRect();
      setTip({ text, top: r.top + r.height / 2, left: r.right + 12 });
    },
    hide: () => setTip(null),
  };
  const account = [login, roleLabel].filter(Boolean).join(" · ");

  return (
    <div className="on-navy hidden w-64 shrink-0 bg-nav transition-[width] duration-200 motion-reduce:transition-none md:block in-data-[nav=rail]:w-16">
      <div className="sticky top-0 flex h-dvh flex-col overflow-hidden">
        <div className="flex h-16 shrink-0 items-center border-b border-white/10 px-4">
          <BrandMark collapsible />
        </div>
        <NavLinks
          id={SIDE_NAV_ID}
          role={role}
          idPrefix="side"
          alertCount={alertCount}
          variant="navy"
          tip={rail ? handlers : undefined}
          className="min-h-0 flex-1 scroll-pb-6 overflow-y-auto overflow-x-hidden scheme-dark [scrollbar-color:rgb(255_255_255/0.3)_transparent] [scrollbar-width:thin]"
        />
        {(dataDate || login) && (
          <div className="relative shrink-0 border-t border-white/10 px-3 py-3 before:pointer-events-none before:absolute before:-top-px before:left-0 before:right-3 before:h-6 before:-translate-y-full before:bg-linear-to-t before:from-nav before:to-transparent">
            {dataDate && (
              <p className={`flex items-center gap-4 pl-3 text-xs leading-5 text-white/70 in-data-[nav=rail]:hidden ${login ? "mb-2" : ""}`}>
                <Icon name="calendar" className="h-4 w-4 text-white/65" />
                <span>
                  Données AJIR au <span className="font-semibold tabular-nums text-white">{dataDate}</span>
                </span>
              </p>
            )}
            {login && (
              <div className="flex min-h-10 items-center gap-2 px-1" onMouseEnter={rail ? (e) => handlers.show(e.currentTarget, account) : undefined} onMouseLeave={rail ? handlers.hide : undefined}>
                {avatar}
                <p className={`min-w-0 leading-tight ${RAIL.hidden}`}>
                  <span className="sr-only">Compte connecté : </span>
                  <span className="block truncate text-sm font-medium text-white">{login}</span>
                  {roleLabel && <span className="block truncate text-xs text-white/70">{roleLabel}</span>}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      {rail && tip && (
        <span
          aria-hidden="true"
          style={{ top: tip.top, left: tip.left }}
          className="pointer-events-none fixed z-40 -translate-y-1/2 animate-fade-in whitespace-nowrap rounded-control bg-surface px-2.5 py-1.5 text-sm font-medium text-fg shadow-pop ring-1 ring-line"
        >
          {tip.text}
        </span>
      )}
    </div>
  );
}

/** Bouton de l'en-tête (à partir de md) : réduit le menu latéral en rail d'icônes ou le déploie ; choix mémorisé (« pa-nav »). */
export function NavToggle({ className = "" }: { className?: string }) {
  const rail = useNavRail();
  const label = rail ? "Déployer le menu" : "Réduire le menu";
  return (
    <button
      type="button"
      aria-expanded={!rail}
      aria-controls={SIDE_NAV_ID}
      title={label}
      onClick={() => setNavRail(!rail)}
      className={`hidden min-h-10 min-w-10 items-center justify-center rounded-control text-fg-muted transition-colors duration-150 hover:bg-surface-3 hover:text-fg active:translate-y-px md:inline-flex ${className}`}
    >
      <Icon name="menu" className="h-5 w-5" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

type MobileNavProps = { role: Role; alertCount: number; dataDate?: string; login?: string; roleLabel?: string };

// Menu des petits écrans (< md) : bouton de divulgation, fermeture par Échap ou au choix d'un lien
export function MobileNav({ role, alertCount, dataDate, login, roleLabel }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="menu-mobile"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-10 items-center gap-2 rounded-control border border-line-strong px-3 text-sm font-medium text-fg transition-colors duration-150 hover:bg-surface-3 active:translate-y-px"
      >
        <Icon name={open ? "x" : "menu"} className="h-4 w-4" />
        {open ? "Fermer" : "Menu"}
        <span className="sr-only"> de navigation</span>
      </button>
      <div
        id="menu-mobile"
        ref={panelRef}
        hidden={!open}
        className="absolute inset-x-0 top-full z-30 max-h-[calc(100dvh-4rem)] animate-pop-in overflow-y-auto overscroll-contain border-b border-line bg-surface shadow-pop"
      >
        {(dataDate || login) && (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line bg-surface-2 px-6 py-3 text-sm text-fg-muted">
            {dataDate && (
              <p className="flex items-center gap-2">
                <Icon name="calendar" className="h-4 w-4 text-fg-subtle" />
                <span>
                  Données AJIR au <span className="font-semibold tabular-nums text-fg">{dataDate}</span>
                </span>
              </p>
            )}
            {login && (
              <p>
                <span className="sr-only">Compte connecté : </span>
                <span className="font-medium text-fg">{login}</span>
                {roleLabel && ` · ${roleLabel}`}
              </p>
            )}
          </div>
        )}
        <NavLinks role={role} idPrefix="mobile" onNavigate={() => setOpen(false)} alertCount={alertCount} variant="surface" />
      </div>
    </div>
  );
}
