import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { DetailTip } from "@/components/help/info-tip";
import { Icon, type IconName } from "./icons";

// Composants de présentation partagés. Tous les écrans les utilisent pour rester cohérents (docs/qa/CHARTE_UI.md).

export { Icon, Spinner, ICON_NAMES, type IconName } from "./icons";
export {
  Button,
  ButtonLink,
  buttonCls,
  buttonClass,
  FormActions,
  ActionBar,
  MenuLink,
  MenuButton,
  menuItemCls,
  menuItemClass,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from "./button";
export { ConfirmButton, ConfirmDialog, SubmitButton, type ConfirmReason } from "./confirm";
export { MoreActions } from "./more-actions";
export { StatusSummary, QuestionAnswer, StatusPill, Section, Steps, ColorLegend, type Verdict, type StepStatus } from "./insight";
export { ThemeToggle, useTheme, setTheme, applyTheme, THEME_OPTIONS, type ThemePreference, type ResolvedTheme } from "./theme";
export { THEME_STORAGE_KEY } from "./theme-script";
export { Toaster, toast, useActionToast, withActionToast, toastResult, type ToastOptions, type ToastTone, type ActionResult, type ActionToastOptions } from "./toast";
export { Skeleton, SkeletonText, SkeletonCard, SkeletonHeader, SkeletonKpiRow, SkeletonTable, SkeletonChart, SkeletonPage, type SkeletonPageVariant } from "./skeleton";
export { cardCls, tableCls, fieldCls } from "./classes";
export { DataTable, type DataTableColumn, type DataTableRow, type SortValue } from "./data-table";
export { SortHeader, type SortDir } from "./sort-header";
import { cardCls } from "./classes";

// En-tête d'écran : titre (= libellé du menu), périmètre et période, au plus 2 actions visibles (le reste dans <ActionBar more={…}>).
// La phrase d'objectif n'est pas affichée : elle est lue dans la bulle « ? » à côté du titre.
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  scope,
  period,
  badge,
}: {
  title: string;
  /** Bulle « ? » à côté du titre : à quoi sert l'écran. */
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
  /** Périmètre des données : « Votre équipe — 9 collaborateurs », « Toute l'entreprise ». */
  scope?: ReactNode;
  /** Période ou date : « Données au 31/08/2026 », « sept. 2025 – août 2026 ». */
  period?: ReactNode;
  /** Mention à côté du titre (au lieu du surtitre) : <StatusBadge tone="warning">Prévision indicative</StatusBadge>. */
  badge?: ReactNode;
}) {
  const heading = (
    <div className="flex min-w-0 items-start gap-1">
      <h1 className="min-w-0 break-words text-2xl font-semibold leading-tight text-heading sm:text-[26px]">{title}</h1>
      <DetailTip label={title} details={subtitle} prefix="Aide" className="mt-1" />
    </div>
  );
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 border-l-4 border-accent pl-3">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-brand-magenta dark:text-fuchsia-300">{eyebrow}</p>}
        {badge ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {heading}
            {badge}
          </div>
        ) : (
          heading
        )}
        {(scope || period) && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-muted">
            {scope && (
              <span className="inline-flex items-center gap-1.5">
                <Icon name="users" className="h-3.5 w-3.5 text-fg-subtle" />
                <span className="sr-only">Périmètre : </span>
                {scope}
              </span>
            )}
            {period && (
              <span className="inline-flex items-center gap-1.5">
                <Icon name="calendar" className="h-3.5 w-3.5 text-fg-subtle" />
                <span className="sr-only">Période : </span>
                {period}
              </span>
            )}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}

// Titre de section (niveau 2 par défaut, 3 sous une section) et actions à droite. La bulle « ? » (tip) est posée après le titre,
// hors du titre (qui reste son seul nom) ; `description` n'est pas affichée : elle est lue dans cette bulle.
export function SectionHeader({
  title,
  description,
  actions,
  tip,
  id,
  level = 2,
  className = "",
}: {
  title: string;
  /** Bulle « ? » : ajoutée à `tip`, ou bulle propre sans `tip`. */
  description?: ReactNode;
  actions?: ReactNode;
  /** Bulle « ? » posée après le titre (<TermTip … />). */
  tip?: ReactNode;
  id?: string;
  level?: 2 | 3;
  className?: string;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div className={`mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 ${className}`}>
      <div className="flex min-w-0 items-start gap-1">
        <Heading id={id} className={`min-w-0 scroll-mt-4 break-words font-semibold text-heading ${level === 3 ? "text-base" : "text-lg"}`}>
          {title}
        </Heading>
        <DetailTip label={title} tip={tip} details={description} prefix="Aide" className={level === 3 ? "" : "mt-0.5"} />
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  children,
  className = "",
  actions,
  headingLevel = 2,
  description,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
  /** Bulle « ? » après le titre. */
  description?: ReactNode;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className={`${cardCls} min-w-0 p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-1">
            {title && <Heading className="min-w-0 text-base font-semibold text-heading">{title}</Heading>}
            <DetailTip label={title ?? "Détails"} details={description} prefix="Aide" />
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Variation d'une tuile (même contrat que Delta de KpiCard) : `good` = sens favorable, « neutral » (alias « none ») sans jugement. */
export type TileDelta = { value: number; label: string; good: "up" | "down" | "none" | "neutral"; reference?: string };

const TILE_VERDICT = {
  favorable: { text: "favorable", cls: "bg-success-soft text-success ring-success/30", arrow: "text-success" },
  defavorable: { text: "à surveiller", cls: "bg-danger-soft text-danger ring-danger/30", arrow: "text-danger" },
  stable: { text: "stable", cls: "bg-surface-3 text-fg-muted ring-line", arrow: "text-fg-subtle" },
  neutre: { text: "", cls: "", arrow: "text-fg-muted" },
} as const;

// Variation lisible sans la couleur : flèche + sens écrit (lecteur d'écran) + texte + jugement écrit
function TileDeltaLine({ delta }: { delta: TileDelta }) {
  const v =
    delta.value === 0 ? "stable" : delta.good === "none" || delta.good === "neutral" ? "neutre" : (delta.value > 0) === (delta.good === "up") ? "favorable" : "defavorable";
  const s = TILE_VERDICT[v];
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] tabular-nums text-fg-muted">
      <span aria-hidden="true" className={`font-semibold ${s.arrow}`}>
        {delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "▬"}
      </span>
      <span className="sr-only">{delta.value > 0 ? "En hausse" : delta.value < 0 ? "En baisse" : "Stable"} : </span>
      <span>
        {delta.label}
        {delta.reference && <span className="text-fg-subtle"> {delta.reference}</span>}
      </span>
      {s.text && <span className={`rounded-full px-1.5 text-[11px] font-semibold ring-1 ring-inset ${s.cls}`}>{s.text}</span>}
    </p>
  );
}

const shown = (n: ReactNode) => n != null && n !== false && n !== "";

// Un tableau d'éléments transmis à DetailTip (composant client) est contrôlé comme une liste : clé obligatoire.
export const detailItems = (nodes: ReactNode[]) => nodes.filter(shown).map((d, i) => <Fragment key={i}>{d}</Fragment>);

// Tuile d'indicateur simple ; même lecture que KpiCard : libellé, valeur + unité, variation facultative (delta).
// Période et aide sont lues dans la bulle « ? » du coin (ajoutées à `tip` s'il est fourni).
export function KpiTile({
  label,
  value,
  hint,
  href,
  unit,
  period,
  tip,
  detailHref,
  detailLabel = "Voir le détail",
  delta,
}: {
  label: string;
  value: ReactNode;
  /** Bulle « ? ». */
  hint?: ReactNode;
  href?: string;
  unit?: string;
  /** Bulle « ? ». */
  period?: ReactNode;
  tip?: ReactNode;
  /** Lien de pied (sans rendre la carte cliquable). */
  detailHref?: string;
  detailLabel?: string;
  /** Variation : { value: -0.4, label: "−0,4 pt", reference: "vs avant l'action", good: "down" } → flèche, texte et « favorable ». */
  delta?: TileDelta | null;
}) {
  const body = (
    <>
      <p className="text-[13px] font-medium leading-snug text-fg-muted">{label}</p>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1 text-2xl font-semibold leading-tight tabular-nums text-heading">
        <span>{value}</span>
        {unit && <span className="text-sm font-medium text-fg-muted">{unit}</span>}
      </p>
      {delta && <TileDeltaLine delta={delta} />}
      {href && (
        <span className="mt-auto inline-flex items-center gap-1 pt-2 text-[13px] font-medium text-link underline-offset-2 group-hover:underline">
          {detailLabel} <span aria-hidden="true">›</span>
        </span>
      )}
      {!href && detailHref && (
        <Link href={detailHref} className="mt-auto inline-flex min-h-8 items-center gap-1 self-start pt-2 text-[13px] font-medium text-link underline-offset-2 transition-colors duration-150 hover:underline">
          {detailLabel}
          <span aria-hidden="true">›</span>
          <span className="sr-only"> : {label}</span>
        </Link>
      )}
    </>
  );
  const help = shown(tip) || shown(period) || shown(hint);
  const cls = `flex h-full flex-col ${cardCls} min-w-0 p-4 ${help ? "pr-10" : ""}`;
  const card = href ? (
    <Link href={href} className={`group ${cls} transition duration-200 hover:-translate-y-px hover:border-primary/50 hover:shadow-pop active:translate-y-0`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
  if (!help) return card;
  return (
    <div className="relative h-full">
      {card}
      <span className="absolute right-2 top-2.5">
        <DetailTip label={label} tip={tip} details={detailItems([period, hint])} align="end" />
      </span>
    </div>
  );
}

const RISK_STYLE = {
  ELEVE: "bg-danger-soft text-danger ring-danger/40",
  MOYEN: "bg-warning-soft text-warning ring-warning/40",
  FAIBLE: "bg-success-soft text-success ring-success/40",
} as const;
const RISK_DOT = { ELEVE: "bg-danger", MOYEN: "bg-warning", FAIBLE: "bg-success" } as const;
const RISK_LABEL = { ELEVE: "Élevé", MOYEN: "Moyen", FAIBLE: "Faible" } as const;

// Niveau de risque : couleur toujours accompagnée du mot (« Risque Élevé », ou « Élevé » avec compact sous un en-tête « Niveau de risque »)
export function RiskBadge({ level, compact = false }: { level: keyof typeof RISK_STYLE | null | undefined; compact?: boolean }) {
  if (!level)
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg-muted ring-1 ring-inset ring-line-strong/50">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full border border-line-strong" />
        Non évalué
      </span>
    );
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${RISK_STYLE[level]}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${RISK_DOT[level]}`} />
      {compact ? RISK_LABEL[level] : `Risque ${RISK_LABEL[level]}`}
    </span>
  );
}

export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";
const STATUS_STYLE: Record<StatusTone, { cls: string; dot: string }> = {
  success: { cls: "bg-success-soft text-success ring-success/40", dot: "bg-success" },
  info: { cls: "bg-info-soft text-info ring-info/40", dot: "bg-info" },
  warning: { cls: "bg-warning-soft text-warning ring-warning/40", dot: "bg-warning" },
  danger: { cls: "bg-danger-soft text-danger ring-danger/40", dot: "bg-danger" },
  neutral: { cls: "bg-surface-2 text-fg-muted ring-line-strong/50", dot: "bg-fg-subtle" },
};

// Statut en mots (« En cours », « Traitée », « Échec ») : texte ≥ 4,5:1, pastille de couleur décorative
export function StatusBadge({ tone = "neutral", children, dot = true }: { tone?: StatusTone; children: ReactNode; dot?: boolean }) {
  const s = STATUS_STYLE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      {dot && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />}
      {children}
    </span>
  );
}

const BADGE_TONE = {
  neutral: "bg-surface-3 text-fg-muted",
  info: "bg-info-soft text-info",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
} as const;
// Anciens noms de tons (couleurs Tailwind) → jetons sémantiques
const BADGE_LEGACY = { slate: "neutral", sky: "info", red: "danger", amber: "warning", emerald: "success" } as const;

/** Étiquette rectangulaire. Tons : neutral, info, success, warning, danger (anciens noms slate, sky, emerald, amber, red acceptés). */
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof BADGE_TONE | keyof typeof BADGE_LEGACY }) {
  const key = tone in BADGE_LEGACY ? BADGE_LEGACY[tone as keyof typeof BADGE_LEGACY] : (tone as keyof typeof BADGE_TONE);
  return <span className={`inline-flex items-center whitespace-nowrap rounded-[4px] px-1.5 py-0.5 text-xs font-medium ${BADGE_TONE[key]}`}>{children}</span>;
}

// État vide : titre + action (bouton ou lien). Le pourquoi (children) n'est pas affiché : il est lu dans la bulle « ? » du titre.
// compact : sans pictogramme, dans un petit visuel.
export function EmptyState({
  title,
  children,
  action,
  actions,
  icon = "inbox",
  compact = false,
  headingLevel,
  className = "",
}: {
  title: string;
  /** Bulle « ? » à côté du titre. */
  children?: ReactNode;
  /** Bouton(s) ou lien(s) sous le titre (ButtonLink primaire + secondaire). */
  action?: ReactNode;
  /** Alias de action. */
  actions?: ReactNode;
  icon?: IconName;
  compact?: boolean;
  /** Titre rendu comme titre de niveau 1 à 3 (page « introuvable » : 1) ; paragraphe par défaut. */
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const Title = headingLevel ? (`h${headingLevel}` as "h1" | "h2" | "h3") : "p";
  const act = action ?? actions;
  return (
    <div className={`flex flex-col items-center rounded-card border border-dashed border-line-strong/60 bg-surface/70 text-center ${compact ? "px-4 py-5" : "px-6 py-8"} ${className}`}>
      {!compact && (
        <span aria-hidden="true" className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 text-fg-subtle">
          <Icon name={icon} className="h-5 w-5" />
        </span>
      )}
      <div className="flex max-w-full items-start justify-center gap-1">
        <Title className={`min-w-0 font-semibold text-fg ${headingLevel === 1 ? "text-xl" : "text-base"}`}>{title}</Title>
        <DetailTip label={title} details={children} prefix="Aide" align="center" className={headingLevel === 1 ? "mt-0.5" : ""} />
      </div>
      {act && <div className="mt-4 flex flex-wrap justify-center gap-2">{act}</div>}
    </div>
  );
}

type NoticeTone = "info" | "success" | "warning" | "error" | "neutral" | "sky" | "amber" | "red";
const NOTICE: Record<"info" | "success" | "warning" | "error" | "neutral", { cls: string; icon: IconName; iconCls: string; prefix: string }> = {
  info: { cls: "border-info/30 bg-info-soft text-fg", icon: "info", iconCls: "text-info", prefix: "Information" },
  success: { cls: "border-success/30 bg-success-soft text-fg", icon: "success", iconCls: "text-success", prefix: "Succès" },
  warning: { cls: "border-warning/40 bg-warning-soft text-fg", icon: "warning", iconCls: "text-warning", prefix: "Attention" },
  error: { cls: "border-danger/30 bg-danger-soft text-fg", icon: "error", iconCls: "text-danger", prefix: "Erreur" },
  neutral: { cls: "border-line bg-surface text-fg", icon: "info", iconCls: "text-fg-subtle", prefix: "Note" },
};
const TONE_ALIAS = { sky: "info", amber: "warning", red: "error" } as const;

/**
 * Message en bandeau. Tons : info, success, warning, error, neutral (anciens noms sky, amber, red acceptés).
 * `live` : annoncé aux lecteurs d'écran (role="status", ou role="alert" pour warning et error). Voir aussi Alert.
 */
export function Notice({
  children,
  tone = "info",
  title,
  live = false,
  role: roleProp,
  action,
  className = "",
  id,
}: {
  children: ReactNode;
  tone?: NoticeTone;
  title?: ReactNode;
  live?: boolean;
  /** Rôle explicite (prioritaire sur live). */
  role?: "status" | "alert";
  action?: ReactNode;
  className?: string;
  id?: string;
}) {
  const key = (TONE_ALIAS as Record<string, keyof typeof NOTICE>)[tone] ?? (tone as keyof typeof NOTICE);
  const s = NOTICE[key];
  const role = roleProp ?? (live ? (key === "error" || key === "warning" ? "alert" : "status") : undefined);
  return (
    <div id={id} role={role} className={`flex flex-wrap gap-x-2.5 gap-y-2 rounded-control border px-3 py-2.5 text-sm leading-snug ${s.cls} ${className}`}>
      <Icon name={s.icon} className={`mt-px h-[18px] w-[18px] ${s.iconCls}`} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : role && <span className="sr-only">{s.prefix} : </span>}
        <div className={title ? "mt-0.5" : undefined}>{children}</div>
      </div>
      {/* Sous 640 px, l'action passe sous le texte (le texte garde toute la largeur) */}
      {action && <div className="w-full pl-7 sm:w-auto sm:shrink-0 sm:self-center sm:pl-0">{action}</div>}
    </div>
  );
}

// Message de retour d'action (succès, erreur…) annoncé aux lecteurs d'écran
export function Alert(props: Omit<Parameters<typeof Notice>[0], "live" | "role">) {
  return <Notice {...props} live />;
}

// Initiales pour les pastilles d'identité (utilisateur connecté, noms dans les listes)
export function Initials({ name, className = "" }: { name: string; className?: string }) {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  const text = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  return (
    <span aria-hidden="true" className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-link ring-1 ring-inset ring-line ${className}`}>
      {text}
    </span>
  );
}

// Fuseau explicite : rendu identique serveur/navigateur ; une date seule (AAAA-MM-JJ) n'est jamais décalée d'un jour
const TZ = "Africa/Tunis";
const NBSP = " ";

export const fmt = {
  int: (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("fr-FR").format(Math.round(n))),
  pct: (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${(n * 100).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NBSP}%`),
  tnd: (n: number | null | undefined) => (n == null ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)}${NBSP}TND`),
  /** Nombre à décimales fixes : fmt.num(1234.5, 1) → « 1 234,5 ». */
  num: (n: number | null | undefined, digits = 1) => (n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })),
  /** Variation d'un taux en points : fmt.pts(0.004) → « +0,4 pt ». */
  pts: (n: number | null | undefined, digits = 1) =>
    n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n * 100).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NBSP}pt`,
  date: (s: string | null | undefined) => {
    if (!s) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("fr-FR", { timeZone: TZ });
  },
  dateTime: (s: string | null | undefined) => {
    if (!s) return "—";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: TZ });
  },
  /** Ordre unique des noms (REVUE_TRANSVERSE T4) : « Nom Prénom », comme la liste et la fiche. */
  person: (nom: string | null | undefined, prenom?: string | null) => [nom, prenom].filter((x) => x && x.trim()).join(" ") || "—",
  /** Mois d'un « AAAA-MM » (ou d'une date) : « août 2026 » ; short : « sept. 2025 » (axes, tableaux serrés). */
  month: (ym: string | null | undefined, { short = false }: { short?: boolean } = {}) => {
    const m = /^(\d{4})-(\d{2})/.exec(ym ?? "");
    if (!m) return ym || "—";
    return `${(short ? MONTHS_SHORT : MONTHS)[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  },
  /** « d'août 2026 », « de septembre 2026 » (élision devant une voyelle). */
  ofMonth: (ym: string | null | undefined) => elide("de", fmt.month(ym)),
  /** Élision de « de » : fmt.de("Amri Nadia") → « d'Amri Nadia » ; fmt.de("Souissi Hazem") → « de Souissi Hazem ». */
  de: (text: string) => elide("de", text),
  /**
   * Modèle en mots, sans identifiant technique : « modèle mis en service le 30/09/2026 » ; sans date de mise en service,
   * date portée par l'identifiant (« logreg-v1-20260930 » → « modèle du 30/09/2026 »), sinon « modèle en service ».
   */
  model: (version: string | null | undefined, promotedAt?: string | null) => {
    if (promotedAt) return `modèle mis en service le ${fmt.date(promotedAt)}`;
    const d = /(\d{4})(\d{2})(\d{2})$/.exec(version ?? "");
    return d ? `modèle du ${d[3]}/${d[2]}/${d[1]}` : "modèle en service";
  },
};

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const elide = (word: "de", text: string) => (/^[aeiouyàâäéèêëîïôöûüœ]/i.test(text) ? `d'${text}` : `${word} ${text}`);
