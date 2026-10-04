import type { ReactNode } from "react";
import type { Role } from "@/db/schema";

export const ROLE_LABEL: Record<Role, string> = { ADMIN: "Administrateur", RH: "Responsable RH", MANAGER: "Manager" };

const ROLE_TONE: Record<Role, string> = {
  ADMIN: "bg-fuchsia-50 text-brand-magenta ring-fuchsia-200 dark:bg-fuchsia-950/50 dark:text-fuchsia-200 dark:ring-fuchsia-800",
  RH: "bg-primary-soft text-link ring-primary/25",
  MANAGER: "bg-success-soft text-success ring-success/30",
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ROLE_TONE[role]}`}>
      {ROLE_LABEL[role]}
    </span>
  );
}

export type Tone = "emerald" | "amber" | "red" | "slate" | "sky";

const PILL_TONE: Record<Tone, { pill: string; dot: string }> = {
  emerald: { pill: "bg-success-soft text-success ring-success/30", dot: "bg-success" },
  amber: { pill: "bg-warning-soft text-warning ring-warning/30", dot: "bg-warning" },
  red: { pill: "bg-danger-soft text-danger ring-danger/30", dot: "bg-danger" },
  slate: { pill: "bg-surface-3 text-fg-muted ring-line", dot: "bg-fg-subtle" },
  sky: { pill: "bg-primary-soft text-link ring-primary/25", dot: "bg-primary" },
};

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${PILL_TONE[tone].pill}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${PILL_TONE[tone].dot}`} />
      {children}
    </span>
  );
}

export const OUTCOME = {
  OK: { label: "Réussi", tone: "emerald" },
  REFUSE: { label: "Refusé", tone: "red" },
  ECHEC: { label: "Échec", tone: "amber" },
} as const;

export function OutcomeBadge({ outcome }: { outcome: keyof typeof OUTCOME }) {
  return <StatusPill tone={OUTCOME[outcome].tone}>{OUTCOME[outcome].label}</StatusPill>;
}

export function ActionChip({ action }: { action: string }) {
  return (
    <code className="inline-block max-w-full truncate whitespace-nowrap rounded bg-surface-3 px-1.5 py-0.5 align-middle font-mono text-xs text-fg ring-1 ring-inset ring-line">
      {action}
    </code>
  );
}

type IconName =
  | "check"
  | "ban"
  | "link"
  | "unlock"
  | "power"
  | "search"
  | "user-plus"
  | "clock"
  | "gauge"
  | "database"
  | "wallet"
  | "calendar"
  | "lock"
  | "chevron"
  | "filter"
  | "mail"
  | "id"
  | "upload"
  | "bell"
  | "sliders"
  | "arrow"
  | "list"
  | "alert"
  | "undo"
  | "shield";

const PATHS: Record<IconName, ReactNode> = {
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  ban: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M5.5 14.5l9-9" />
    </>
  ),
  link: <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" />,
  unlock: (
    <>
      <rect x="4" y="9" width="12" height="8" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 0 1 5.8-1" />
    </>
  ),
  power: <path d="M10 3v6.5M6.2 5.6a6 6 0 1 0 7.6 0" />,
  search: (
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="M13 13l3.5 3.5" />
    </>
  ),
  "user-plus": (
    <>
      <circle cx="8" cy="7" r="3" />
      <path d="M2.5 16.5a5.5 5.5 0 0 1 11 0M15.5 6v5M13 8.5h5" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.5 1.5" />
    </>
  ),
  gauge: <path d="M3.5 14a6.5 6.5 0 1 1 13 0M10 14l3-4.5" />,
  database: (
    <>
      <ellipse cx="10" cy="5" rx="6" ry="2.5" />
      <path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="5.5" width="14" height="10" rx="1.5" />
      <path d="M3 8.5h14M13 12h1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" />
      <path d="M3.5 8.5h13M7 3v3M13 3v3" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="9" width="12" height="8" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </>
  ),
  chevron: <path d="M8 5.5l4.5 4.5L8 14.5" />,
  filter: <path d="M3.5 5h13M6 10h8M8.5 15h3" />,
  mail: (
    <>
      <rect x="3" y="5" width="14" height="10.5" rx="1.5" />
      <path d="M3.5 6l6.5 5 6.5-5" />
    </>
  ),
  upload: <path d="M10 13V3.5M6 7l4-4 4 4M3.5 13.5v2a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-2" />,
  bell: <path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13L5 13.5zM8.3 16.5a1.8 1.8 0 0 0 3.4 0" />,
  sliders: <path d="M4 5h7M15 5h1M4 10h2M10 10h6M4 15h9M17 15h-1M11 3.5v3M6 8.5v3M13 13.5v3" />,
  arrow: <path d="M4 10h12M11 5l5 5-5 5" />,
  list: <path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9M3.8 5.5h.01M3.8 10h.01M3.8 14.5h.01" />,
  alert: <path d="M10 3.5l7 12.5H3L10 3.5zM10 8.5v3.5M10 14.3h.01" />,
  undo: <path d="M6 8.5H13a3.5 3.5 0 0 1 0 7H9M6 8.5l3-3M6 8.5l3 3" />,
  shield: <path d="M10 2.8l6 2.4v4.3c0 3.6-2.5 6.4-6 7.7-3.5-1.3-6-4.1-6-7.7V5.2l6-2.4zM7.3 10l2 2 3.6-3.8" />,
  id: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <circle cx="7.5" cy="9.5" r="1.8" />
      <path d="M5 13.2c.5-1 1.4-1.5 2.5-1.5s2 .5 2.5 1.5M12 8.5h3.5M12 11.5h2.5" />
    </>
  ),
};

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      {PATHS[name]}
    </svg>
  );
}

const fieldBase =
  "mt-1 block min-h-10 w-full rounded-control border bg-surface py-1.5 text-sm text-fg shadow-sm transition-colors duration-150 placeholder:text-fg-subtle focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60";

// Champ des formulaires d'administration (bordure ≥ 3:1, anneau de focus, état d'erreur) ; pad pour une icône à gauche
export function fieldCls(err = false, pad = "px-3") {
  return `${fieldBase} ${pad} ${err ? "border-danger focus:border-danger focus:ring-danger/25" : "border-line-strong hover:border-fg-muted focus:border-primary focus:ring-primary/25"}`;
}
export const labelCls = "block text-sm font-medium text-fg-muted";


// Promu dans @/components/ui (même rendu que DataTable) ; réexporté pour les écrans d'administration
export { SortHeader, type SortDir } from "@/components/ui/sort-header";
